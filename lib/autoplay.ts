import type { WatchStatus } from "@/lib/kids-feed";

// Picks the next playlist index for autoplay, scanning cyclically from the
// current video (current → end → start): first unwatched (0) wins, then
// started-but-unfinished (1); if everything is watched it falls back to
// plain sequential order wrapping to index 0, so the player loops forever
// instead of returning to the portal. The current video is never a
// candidate except via the wrap fallback (length 1 replays itself).
export function pickNextIndex(
  length: number,
  currentIndex: number,
  statusAt: (i: number) => WatchStatus
): number {
  if (length <= 1) return 0;
  let started = -1;
  for (let k = 0; k < length - 1; k++) {
    const i = (currentIndex + 1 + k) % length;
    const status = statusAt(i);
    if (status === 0) return i;
    if (status === 1 && started === -1) started = i;
  }
  return started !== -1 ? started : (currentIndex + 1) % length;
}
