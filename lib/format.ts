// Shared duration label for badges: "4:05" under an hour, "1:02:03"
// above it. Returns null when there's nothing to show (unknown or
// zero-length duration).
export function formatDuration(seconds: number | null): string | null {
  if (!seconds) return null;
  const total = Math.round(seconds);
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${Math.floor(total / 60)}:${String(s).padStart(2, "0")}`;
}
