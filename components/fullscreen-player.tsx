"use client";

import { useEffect, useRef, useState } from "react";
import { CornersOut, X } from "@phosphor-icons/react";
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
  // Render-side mirror of userExitedRef — gates the re-enter button so it
  // can't flash during the mount-time auto-request/view-transition morph.
  const [hasExited, setHasExited] = useState(false);
  // The effect-owned requestFs, surfaced to the re-enter button below —
  // needed because YouTube's Shorts embed skin renders no fullscreen
  // control of its own, leaving no way back in after exiting.
  const requestFsRef = useRef<() => void>(() => {});

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
        finished.then(requestFs, requestFs);
        return;
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
      // fall back to a CSS overlay that fills the viewport.
      if (!el.requestFullscreen) {
        setPseudoFullscreen(true);
        return;
      }
      Promise.resolve(el.requestFullscreen()).catch(() =>
        setPseudoFullscreen(true)
      );
    };

    requestFsRef.current = requestFs;
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

    const onFsChange = () => {
      if (document.fullscreenElement) {
        setIsFullscreen(true);
        setPseudoFullscreen(false);
      } else {
        setIsFullscreen(false);
        setHasExited(true);
        userExitedRef.current = true;
      }
    };

    window.addEventListener("pointerdown", onInteract);
    window.addEventListener("keydown", onInteract);
    document.addEventListener("fullscreenchange", onFsChange);

    return () => {
      disposed = true;
      if (morphTimer) clearTimeout(morphTimer);
      window.removeEventListener("pointerdown", onInteract);
      window.removeEventListener("keydown", onInteract);
      document.removeEventListener("fullscreenchange", onFsChange);
    };
  }, []);

  // Prevent the page behind the overlay from scrolling
  useEffect(() => {
    if (!pseudoFullscreen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [pseudoFullscreen]);

  return (
    <div
      ref={ref}
      className={cn(
        "w-full bg-slate-900 overflow-hidden group",
        pseudoFullscreen
          ? "fixed inset-0 z-50 h-full"
          : "relative max-w-6xl aspect-video rounded-[32px] shadow-2xl border-4 border-slate-800",
        "fullscreen:max-w-none fullscreen:aspect-auto fullscreen:h-full fullscreen:rounded-none fullscreen:border-0"
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
        {hasExited && !pseudoFullscreen && !isFullscreen && (
          <button
            onClick={() => {
              userExitedRef.current = false;
              requestFsRef.current();
            }}
            aria-label="Enter fullscreen"
            className="absolute top-3 left-3 z-50 w-11 h-11 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80"
          >
            <CornersOut size={22} weight="bold" />
          </button>
        )}
        {(pseudoFullscreen || isFullscreen) && (
          <button
            onClick={() => {
              userExitedRef.current = true;
              setHasExited(true);
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
