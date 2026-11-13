"use client";

import { useEffect } from "react";
import { ensureYouTubeAPI } from "@/lib/yt-player";

// Pre-warms the YouTube IFrame API while the kid browses the feed, so
// tap-to-play on a card doesn't pay the iframe_api download on the
// watch page. Mounted once on the kids feed page; ensureYouTubeAPI is
// idempotent and shares window.YT with every player.
export function YouTubeWarmup() {
  useEffect(() => {
    ensureYouTubeAPI(() => {});
  }, []);
  return null;
}
