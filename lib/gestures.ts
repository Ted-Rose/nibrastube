export type SwipeDirection = "next" | "prev";

const THRESHOLD_PX = 60;
const MAX_DURATION_MS = 800;
// The dominant axis must beat the cross axis by this ratio so diagonal
// wobbles and near-45° drags don't fire.
const DOMINANCE_RATIO = 1.3;

// Classifies a single-touch swipe on the watch page: right/up → next
// video, left/down → previous. Returns null for taps, slow drags, and
// ambiguous diagonals.
export function classifySwipe(
  dx: number,
  dy: number,
  elapsedMs: number
): SwipeDirection | null {
  if (elapsedMs > MAX_DURATION_MS) return null;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax >= THRESHOLD_PX && ax >= ay * DOMINANCE_RATIO) {
    return dx > 0 ? "next" : "prev";
  }
  if (ay >= THRESHOLD_PX && ay >= ax * DOMINANCE_RATIO) {
    return dy < 0 ? "next" : "prev";
  }
  return null;
}
