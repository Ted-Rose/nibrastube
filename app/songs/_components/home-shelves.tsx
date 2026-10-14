import { SongCard } from "@/components/song-card";
import { VideoShelf } from "@/components/video-shelf";
import {
  getNewSongs,
  getUserSongs,
  songsCatalogUrl,
  type SongsFeedParams,
} from "@/lib/songs-feed";

// Home shelves on the plain Songs tab — "Newly added" for everyone,
// "Your imports" only for signed-in parents. Streams inside its own
// Suspense boundary so the grid never waits on these queries; a shelf
// with no rows doesn't render at all.
export async function HomeShelves({
  feed,
  userId,
}: {
  feed: SongsFeedParams;
  userId: string | null;
}) {
  const [newRows, userRows] = await Promise.all([
    getNewSongs(),
    userId ? getUserSongs(userId) : Promise.resolve([]),
  ]);

  if (newRows.length === 0 && userRows.length === 0) {
    return null;
  }

  // Only the first shelf's first 2 thumbnails load eagerly.
  let eagerLeft = 2;
  const takeEager = () => eagerLeft-- > 0;

  return (
    <>
      {newRows.length > 0 && (
        <VideoShelf title="Newly added">
          {newRows.map((song) => (
            <SongCard
              key={song.id}
              song={song}
              userId={userId}
              size="compact"
              eager={takeEager()}
            />
          ))}
        </VideoShelf>
      )}

      {userRows.length > 0 && (
        <VideoShelf
          title="Your imports"
          seeAllHref={songsCatalogUrl(feed, { view: "mine" })}
        >
          {userRows.map((song) => (
            <SongCard
              key={song.id}
              song={song}
              userId={userId}
              size="compact"
              eager={takeEager()}
            />
          ))}
        </VideoShelf>
      )}
    </>
  );
}
