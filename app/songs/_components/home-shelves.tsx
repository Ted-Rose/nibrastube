import { SongCard } from "@/components/song-card";
import { VideoShelf } from "@/components/video-shelf";
import {
  getLikedSongs,
  getNewSongs,
  getUserSongs,
  songPlayerUrl,
  songsCatalogUrl,
  type SongsFeedParams,
} from "@/lib/songs-feed";

// Home shelves on the plain Songs tab — "Newly added" for everyone,
// "Liked" when a kid profile resolves (kid session or lock cookie),
// "Your imports" only for signed-in parents. Streams inside its own
// Suspense boundary so the grid never waits on these queries; a shelf
// with no rows doesn't render at all.
export async function HomeShelves({
  feed,
  userId,
  profileId,
}: {
  feed: SongsFeedParams;
  userId: string | null;
  profileId: string | null;
}) {
  const [newRows, likedRows, userRows] = await Promise.all([
    getNewSongs(12, userId ?? undefined, profileId ?? undefined),
    // Fixed recent-first order like the other shelves — the feed's
    // sort/dir chips target the grid, not the shelves.
    profileId
      ? getLikedSongs(
          profileId,
          { sort: "recent", dir: "desc", q: "" },
          userId ?? undefined,
          12
        )
      : Promise.resolve([]),
    userId
      ? getUserSongs(userId, 12, profileId ?? undefined)
      : Promise.resolve([]),
  ]);

  if (
    newRows.length === 0 &&
    likedRows.length === 0 &&
    userRows.length === 0
  ) {
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
              href={songPlayerUrl(feed, song.id)}
              size="compact"
              eager={takeEager()}
            />
          ))}
        </VideoShelf>
      )}

      {likedRows.length > 0 && (
        <VideoShelf
          title="Liked"
          seeAllHref={songsCatalogUrl(feed, { view: "liked" })}
        >
          {likedRows.map((song) => (
            <SongCard
              key={song.id}
              song={song}
              href={songPlayerUrl(feed, song.id)}
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
              href={songPlayerUrl(feed, song.id)}
              size="compact"
              eager={takeEager()}
            />
          ))}
        </VideoShelf>
      )}
    </>
  );
}
