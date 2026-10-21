"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

export function FullscreenPlayer({
  children,
  // Portrait video (a Short): constrain the fullscreen box to ~9:16 so
  // the embed letterboxes instead of cropping the video to fill a
  // landscape frame.
  portrait,
}: {
  children: React.ReactNode;
  portrait?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pseudoFullscreen, setPseudoFullscreen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Once the user deliberately leaves fullscreen, stop auto-requesting it —
  // otherwise every subsequent tap re-enters fullscreen and traps them.
  const userExitedRef = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || document.fullscreenElement) return;

    // A fullscreen element joins the top layer ABOVE the
    // ::view-transition-* pseudos — entering while a share morph is
    // animating hides it (hard cut), and the iOS `fixed inset-0`
    // fallback would re-layout the morph target after the transition
    // captured its max-w-6xl geometry. So defer until no transition is
    // in flight.
    let disposed = false;
    let morphDeadline = 0;
    let morphTimer: ReturnType<typeof setTimeout> | null = null;
    // Set when a request entered fullscreen and died instantly — the
    // platform vetoed it (Capacitor's WebChromeClient hides the custom
    // view inside onShowCustomView), so retrying would re-flap on every
    // tap. Declared up here, not beside wasOurs/fsEnteredAt: requestFs
    // runs synchronously below, ahead of those declarations, so a `let`
    // there would still be in the TDZ when it's read.
    let nativeFsDenied = false;

    const requestFs = () => {
      if (disposed || userExitedRef.current) return;
      // Primary signal: this React build (next/dist/compiled/react-dom)
      // stores the in-flight ViewTransition on
      // `document.__reactViewTransition` and clears it once `finished`
      // settles — settled either way (finished or skipped) the pseudo
      // tree is gone. Re-running requestFs on settle also covers a
      // newer transition having started meanwhile.
      const viewTransition = (
        document as Document & {
          __reactViewTransition?: { finished?: Promise<unknown> } | null;
        }
      ).__reactViewTransition;
      const finished = viewTransition && viewTransition.finished;
      if (finished && typeof finished.then === "function") {
        // Bound the wait on the shared ~2s deadline — a stale settled
        // promise could otherwise re-schedule requestFs forever.
        if (!morphDeadline) morphDeadline = Date.now() + 2000;
        if (Date.now() < morphDeadline) {
          finished.then(requestFs, requestFs);
          return;
        }
      }
      // Fallback: React also applies view-transition-name to this
      // element for the duration of a morph, so a set name likewise
      // means "wait" — poll briefly, bounded in case the name is never
      // restored. undefined on browsers without view-transition-name
      // support — don't treat that as an in-flight morph.
      const vtName = el.style.viewTransitionName;
      if (typeof vtName === "string" && vtName !== "" && vtName !== "none") {
        if (!morphDeadline) morphDeadline = Date.now() + 2000;
        if (Date.now() < morphDeadline) {
          morphTimer = setTimeout(requestFs, 100);
          return;
        }
      }
      // iOS/Safari PWA doesn't support fullscreen on arbitrary elements —
      // and a platform-vetoed request must not be retried, or every tap
      // re-runs the enter→exit flap. Both fall back to a CSS overlay
      // that fills the viewport.
      if (!el.requestFullscreen || nativeFsDenied) {
        setPseudoFullscreen(true);
        return;
      }
      Promise.resolve(el.requestFullscreen()).catch(() =>
        setPseudoFullscreen(true)
      );
    };

    requestFs();

    // Browsers require a user gesture for fullscreen, so retry on
    // interaction if the automatic request was rejected. Skip taps on
    // buttons — their click handlers manage fullscreen themselves, and
    // a pointerdown-time request races them (e.g. the exit button's tap
    // would re-enter fullscreen as its exit click lands).
    const onInteract = (e: Event) => {
      if (e.target instanceof Element && e.target.closest("button")) return;
      if (!document.fullscreenElement) requestFs();
    };

    // iOS Safari drops touches inside cross-origin iframes unless the
    // top window also listens for them (WebKit bug 128924) — without
    // this the YouTube embed's controls are untappable on iPhone.
    const noopTouch = () => {};

    // Was OUR element the fullscreen root at the last change? The
    // YouTube iframe itself can take fullscreen (its own ⛶ button —
    // the embed has allowfullscreen), replacing our div in the top
    // layer: that's nested fullscreen, NOT a user exit of ours.
    // Only fullscreen emptying entirely while ours was the root is a
    // deliberate exit worth latching into userExitedRef.
    let wasOurs = false;
    // When our element became fullscreen — Capacitor's WebChromeClient
    // calls onCustomViewHidden() immediately inside onShowCustomView, so
    // a denied request arrives as an enter→exit fullscreenchange flap
    // rather than a rejected promise.
    let fsEnteredAt = 0;
    const onFsChange = () => {
      const fsEl = document.fullscreenElement;
      const ours = fsEl === el;
      if (ours) fsEnteredAt = Date.now();
      if (wasOurs && !fsEl) {
        if (Date.now() - fsEnteredAt > 500) {
          userExitedRef.current = true;
        } else {
          // Died instantly: a denied request, not a deliberate exit —
          // fall back to the CSS overlay and stop asking for native
          // fullscreen (each retry is another visible flap). Leave
          // userExitedRef unlatched so taps can still re-enter the
          // overlay.
          nativeFsDenied = true;
          setPseudoFullscreen(true);
        }
      }
      // Keep wasOurs true through a nested iframe fullscreen so
      // exiting that to null still counts as leaving ours.
      if (ours || !fsEl) wasOurs = ours;
      setIsFullscreen(ours);
      if (fsEl) setPseudoFullscreen(false);
    };

    window.addEventListener("pointerdown", onInteract);
    window.addEventListener("keydown", onInteract);
    window.addEventListener("touchstart", noopTouch, { passive: true });
    document.addEventListener("fullscreenchange", onFsChange);

    return () => {
      disposed = true;
      if (morphTimer) clearTimeout(morphTimer);
      window.removeEventListener("pointerdown", onInteract);
      window.removeEventListener("keydown", onInteract);
      window.removeEventListener("touchstart", noopTouch);
      document.removeEventListener("fullscreenchange", onFsChange);
    };
  }, []);

  return (
    <div
      ref={ref}
      className={cn(
        "w-full bg-slate-900 group",
        pseudoFullscreen
          ? // Two iOS/WebKit hit-testing constraints shape this overlay:
            // no overflow-hidden ancestor (it serves no purpose without
            // the rounded card anyway) and no scroll-locking html/body
            // while it's up — overflow-hidden scroll containers wrapping
            // the cross-origin iframe break touch hit-testing inside the
            // YouTube embed (dead controls). Viewport-anchored `fixed`
            // needs no scroll lock: the opaque overlay hides the page
            // behind it regardless of scroll offset.
            "fixed inset-0 z-50 h-full"
          : "relative max-w-6xl aspect-video rounded-[32px] shadow-2xl border-4 border-slate-800 overflow-hidden",
        "fullscreen:max-w-none fullscreen:aspect-auto fullscreen:h-full fullscreen:rounded-none fullscreen:border-0 fullscreen:overflow-visible fullscreen:shadow-none"
      )}
    >
      {/* Inner box the overlays anchor to — narrowed to ~9:16 for
          portrait videos so the embed letterboxes instead of cropping. */}
      <div
        className={cn(
          "relative w-full h-full",
          (pseudoFullscreen || isFullscreen) &&
            portrait &&
            "aspect-[9/16] w-auto max-w-full mx-auto"
        )}
      >
        {children}
        {/* Only in the CSS pseudo-overlay (iOS — no element fullscreen):
            there is no native way out of a fixed-position overlay, and
            the page header sits beneath it — without this button the
            kid would be trapped. Native fullscreen exits via the
            browser's own gesture/Esc, so no overlay is needed there. */}
        {pseudoFullscreen && (
          <button
            onClick={() => {
              userExitedRef.current = true;
              setPseudoFullscreen(false);
              if (document.fullscreenElement) document.exitFullscreen();
            }}
            aria-label="Exit fullscreen"
            className="absolute top-3 left-3 z-50 w-11 h-11 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80"
          >
            <X size={22} weight="bold" />
          </button>
        )}
      </div>
    </div>
  );
}
