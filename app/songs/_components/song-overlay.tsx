import { SongPlayerOverlay } from "@/components/song-player-overlay";
import { getSong } from "@/lib/songs-feed";

// Async wrapper so the ?song= overlay streams inside its own Suspense
// boundary — a stale/unknown id renders nothing instead of 404ing.
export async function SongOverlay({
  songId,
  closeHref,
}: {
  songId: string;
  closeHref: string;
}) {
  const song = await getSong(songId);
  if (!song) return null;
  return <SongPlayerOverlay song={song} closeHref={closeHref} />;
}
