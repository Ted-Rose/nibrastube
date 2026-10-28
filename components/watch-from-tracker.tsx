"use client";

import { useEffect } from "react";
import { markWatchFrom } from "@/lib/feed-memory";

// Capture-phase, document-wide: any tap landing inside a /watch/ link
// (grid card, shelf card, history row, playlist row) marks "the watch
// page was entered from inside the app" — zero per-card plumbing. The
// watch page's Back button consumes the marker to pick router.back()
// (a real popstate) over router.push().
export default function WatchFromTracker() {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!(e.target instanceof Element)) return;
      if (e.target.closest('a[href*="/watch/"]')) markWatchFrom();
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);
  return null;
}
