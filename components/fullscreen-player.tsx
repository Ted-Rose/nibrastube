"use client";

import { useEffect } from "react";
import { cn } from "@/lib/utils";

export function FullscreenPlayer({
  children,
  // Portrait video (a Short): constrain the player box to ~9:16 so the
  // embed letterboxes instead of cropping the video to fill a landscape
  // frame — inline only; in the embed's own fullscreen the box isn't in
  // the top layer at all, so the letterbox there is the embed's own.
  portrait,
}: {
  children: React.ReactNode;
  portrait?: boolean;
}) {
  useEffect(() => {
    // iOS Safari drops touches inside cross-origin iframes unless the
    // top window also listens for them (WebKit bug 128924) — without
    // this the YouTube embed's controls are untappable on iPhone.
    const noopTouch = () => {};
    window.addEventListener("touchstart", noopTouch, { passive: true });
    return () => window.removeEventListener("touchstart", noopTouch);
  }, []);

  return (
    // INVARIANT: the cross-origin YouTube iframe's ancestor chain must
    // stay plain document flow — no position:fixed/absolute layer, no
    // overflow clip/scroll container, no new stacking context wrapping
    // it. Viewport-anchored layers around an OOPIF desync the
    // UI-process touch hit-regions on real mobile engines (WebKit bug
    // 261390 et al.): DOM hit-tests look clean while real touches die.
    // The app therefore NEVER requests fullscreen itself — the embed's
    // own ⛶ button is the single fullscreen owner, so its enter/exit
    // state always matches the browser's and no foreign embedder
    // element ever enters the top layer around the OOPIF. An app
    // request (on the iframe, this wrapper, or the page root) left the
    // embed thinking it was inline: its ⛶ then nested a second
    // fullscreen inside ours and could only pop that inner layer,
    // trapping the kid in fullscreen with no working exit.
    <div
      className={cn(
        // Card look in normal flow. No overflow-hidden: corner rounding
        // comes from border-radius on this div AND on the iframe/mount
        // container itself (the mount divs in watch-experience and
        // song-player-overlay, whose classes the YT API transfers to
        // the iframe — the [&_iframe] rule here backs that up) — radius
        // on the element clips its own rendering without creating a
        // scroll container the way overflow does. No fullscreen:*
        // classes: this div never enters the top layer (only the
        // embed's ⛶ fullscreens, and it targets the iframe) so they
        // would be dead, and the iframe's own fullscreen:rounded-none
        // already lives on YT_MOUNT_CLASS.
        "relative w-full h-full bg-slate-900 rounded-3xl shadow-2xl border-4 border-slate-800",
        "[&_iframe]:rounded-3xl"
      )}
    >
      {/* Inner box the overlays anchor to — narrowed to ~9:16 for
          portrait videos so the embed letterboxes instead of
          cropping. Irrelevant while the iframe is fullscreen: it's in
          the top layer, not laid out inside this box. */}
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
