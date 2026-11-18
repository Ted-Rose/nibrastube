import { SongPlayerOverlay } from "@/components/song-player-overlay";
import {
  getSong,
  getSongs,
  type FeedSong,
  type SongQueueEntry,
  type SongsFeedParams,
} from "@/lib/songs-feed";

// Async wrapper so the ?song= overlay streams inside its own Suspense
// boundary — a stale/unknown id renders nothing instead of 404ing.
// The play queue is the feed's own song order: the grid row the
// visitor clicked continues into the rows below it (a compilation
// drill-in plays the compilation in track order). Once the feed's
// rows run out the queue rolls into the plain "all songs" catalog —
// songs have no picked-for-you list, so the shared catalog is the
// continuation (the drill-in's ?video= and the "mine" scope are
// dropped; sort/dir/q still apply, and feed rows already in the queue
// are skipped). A song outside the feed — hand-crafted URL, or beyond
// the grid's row cap — leads the queue alone, then continues into the
// catalog like any other last song.
export async function SongOverlay({
  songId,
  feed,
  userId,
  closeHref,
}: {
  songId: string;
  feed: SongsFeedParams;
  // session.user.id, or null for anonymous visitors, kid-locked
  // devices, and kid sessions — getSongs needs it for the "mine"
  // filter and the canDelete stamp.
  userId: string | null;
  closeHref: string;
}) {
  const [song, rows, catalogRows] = await Promise.all([
    getSong(songId),
    getSongs(feed, userId ?? undefined),
    getSongs(
      { ...feed, view: "songs", video: null },
      userId ?? undefined
    ),
  ]);
  if (!song) return null;

  const toEntry = (s: FeedSong): SongQueueEntry => ({
    id: s.id,
    title: s.title,
    videoId: s.videoId,
    videoTitle: s.videoTitle,
    videoDuration: s.videoDuration,
    startSeconds: s.startSeconds,
    endSeconds: s.endSeconds,
  });

  const queue = rows.map(toEntry);
  const found = queue.findIndex((s) => s.id === song.id);
  if (found === -1) queue.unshift(toEntry(song));
  const seen = new Set(queue.map((s) => s.id));
  for (const row of catalogRows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    queue.push(toEntry(row));
  }
  return (
    // Keyed by song id: navigating to another ?song= (Back/Forward)
    // remounts the player on that song instead of retuning in place.
    <SongPlayerOverlay
      key={song.id}
      queue={queue}
      startIndex={found === -1 ? 0 : found}
      closeHref={closeHref}
    />
  );
}
