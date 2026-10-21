"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export function FullscreenPlayer({
  children,
  // Portrait video (a Short): constrain the player box to ~9:16 so the
  // embed letterboxes instead of cropping the video to fill a landscape
  // frame — applied inline AND in native fullscreen.
  portrait,
}: {
  children: React.ReactNode;
  portrait?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Once the user deliberately leaves fullscreen, stop auto-requesting it —
  // otherwise every subsequent tap re-enters fullscreen and traps them.
  const userExitedRef = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || document.fullscreenElement) return;

    // A fullscreen element joins the top layer ABOVE the
    // ::view-transition-* pseudos — entering while a share morph is
    // animating hides it (hard cut), so defer until no transition is in
    // flight.
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
      // iOS/Safari PWA can't fullscreen arbitrary elements, and a
      // platform-vetoed request must not be retried or every tap
      // re-runs the enter→exit flap — both cases just stay inline.
      // There is deliberately NO fixed-position CSS fallback: a
      // viewport-covering layer around the cross-origin OOPIF desyncs
      // touch hit-regions on real mobile engines (WebKit bug 261390),
      // leaving the embed's controls dead.
      if (!el.requestFullscreen || nativeFsDenied) return;
      // A rejection (missing gesture, or a denied request) likewise
      // stays inline — the pointerdown retry below turns the first
      // real tap into the user gesture this request needed.
      Promise.resolve(el.requestFullscreen()).catch(() => {});
    };

    requestFs();

    // Browsers require a user gesture for fullscreen, so retry on
    // interaction if the automatic request was rejected. Skip taps on
    // interactive chrome — their own handlers should run undisturbed,
    // and a pointerdown-time fullscreen request races them (e.g. a nav
    // link entering fs an instant before the route changes, or the
    // swipe dialog's checkbox yanking the page fullscreen mid-modal).
    const onInteract = (e: Event) => {
      if (
        e.target instanceof Element &&
        e.target.closest("button, a, input, label, select, textarea")
      ) {
        return;
      }
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
          // stay inline and stop asking for native fullscreen (each
          // retry is another visible flap). Leave userExitedRef
          // unlatched so a denied request can't wedge the player.
          nativeFsDenied = true;
        }
      }
      // Keep wasOurs true through a nested iframe fullscreen so
      // exiting that to null still counts as leaving ours.
      if (ours || !fsEl) wasOurs = ours;
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
    // INVARIANT: the cross-origin YouTube iframe's ancestor chain must
    // stay plain document flow — no position:fixed/absolute layer, no
    // overflow clip/scroll container, no new stacking context wrapping
    // it. Viewport-anchored layers around an OOPIF desync the
    // UI-process touch hit-regions on real mobile engines (WebKit bug
    // 261390 et al.): DOM hit-tests look clean while real touches die.
    // The only permitted "fullscreen" is this element's own :fullscreen
    // top layer — and the inline "card" is the only other state.
    <div
      ref={ref}
      className={cn(
        // Card look in normal flow. No overflow-hidden: corner rounding
        // comes from border-radius on this div AND on the iframe/mount
        // container itself (the mount divs in watch-experience and
        // song-player-overlay, whose classes the YT API transfers to
        // the iframe — the [&_iframe] rules here back that up) — radius
        // on the element clips its own rendering without creating a
        // scroll container the way overflow does.
        "relative w-full h-full bg-slate-900 rounded-3xl shadow-2xl border-4 border-slate-800",
        "[&_iframe]:rounded-3xl fullscreen:[&_iframe]:rounded-none",
        "fullscreen:fixed fullscreen:inset-0 fullscreen:h-full fullscreen:w-full fullscreen:max-w-none fullscreen:rounded-none fullscreen:border-0 fullscreen:overflow-visible fullscreen:shadow-none fullscreen:aspect-auto"
      )}
    >
      {/* Inner box the overlays anchor to — narrowed to ~9:16 for
          portrait videos (inline and fullscreen alike) so the embed
          letterboxes instead of cropping. */}
      <div
        className={cn(
          "relative h-full",
          portrait
            ? "aspect-[9/16] w-auto max-w-full mx-auto"
            : "w-full"
        )}
      >
        {children}
      </div>
    </div>
  );
}
