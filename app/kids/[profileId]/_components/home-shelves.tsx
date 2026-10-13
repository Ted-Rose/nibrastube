import { KidsTileCard } from "@/components/kids-tile-card";
import { SaveToPlaylistProvider } from "@/components/save-to-playlist-dialog";
import { VideoCard } from "@/components/video-card";
import { VideoShelf } from "@/components/video-shelf";
import {
  getContinueWatching,
  getLikedVideos,
  getNewForYou,
  getPlaylists,
  kidsFeedQuery,
  kidsPortalUrl,
  type KidsFeedParams,
} from "@/lib/kids-feed";

// Home shelves on the plain Videos tab — Continue watching, New for you,
// playlists and Liked rows above the "All videos" grid. Streams inside
// its own Suspense boundary so the grid never waits on these queries;
// a shelf with no rows doesn't render at all.
export async function HomeShelves({
  profileId,
  feed,
}: {
  profileId: string;
  feed: KidsFeedParams;
}) {
  // Pool max is 3, so the 4th query just queues behind the others.
  const [continueRows, newRows, playlistRows, likedRows] =
    await Promise.all([
      getContinueWatching(profileId),
      getNewForYou(profileId),
      getPlaylists(profileId),
      getLikedVideos(profileId, { limit: 20 }),
    ]);

  if (
    continueRows.length === 0 &&
    newRows.length === 0 &&
    playlistRows.length === 0 &&
    likedRows.length === 0
  ) {
    return null;
  }

  // Only the first shelf's first 2 thumbnails load eagerly. KidsTileCard
  // has no eager variant, so the budget passes through to the first
  // video cards whichever shelf they land in.
  let eagerLeft = 2;
  const takeEager = () => eagerLeft-- > 0;

  // Watch-page autoplay rebuilds the queue from the link's feed params:
  // shelf cards keep the home feed (unwatched-first across all videos),
  // Liked-shelf cards keep the Liked queue they were picked from.
  const homeFeedQuery = kidsFeedQuery(feed);
  const likedFeedQuery = kidsFeedQuery(feed, { view: "liked" });
  const watchHref = (videoId: string, feedQuery: string) =>
    `/kids/${profileId}/watch/${videoId}${feedQuery}`;

  return (
    <SaveToPlaylistProvider profileId={profileId} playlists={playlistRows}>
      {continueRows.length > 0 && (
        <VideoShelf title="Continue watching">
          {continueRows.map(({ video, progress, reaction }) => (
            <VideoCard
              key={video.id}
              href={watchHref(video.id, homeFeedQuery)}
              video={video}
              profileId={profileId}
              progress={progress}
              reaction={reaction}
              size="compact"
              eager={takeEager()}
            />
          ))}
        </VideoShelf>
      )}

      {newRows.length > 0 && (
        <VideoShelf title="New for you">
          {newRows.map(({ video, progress, reaction }) => (
            <VideoCard
              key={video.id}
              href={watchHref(video.id, homeFeedQuery)}
              video={video}
              profileId={profileId}
              progress={progress}
              reaction={reaction}
              size="compact"
              eager={takeEager()}
            />
          ))}
        </VideoShelf>
      )}

      {playlistRows.length > 0 && (
        <VideoShelf
          title="Your playlists"
          seeAllHref={kidsPortalUrl(profileId, feed, {
            view: "playlists",
            list: null,
          })}
        >
          {playlistRows.map((p) => (
            <KidsTileCard
              key={p.id}
              variant="cover"
              href={kidsPortalUrl(profileId, feed, {
                view: "playlists",
                list: p.id,
              })}
              title={p.name}
              count={p.videoCount}
              thumbnail={p.coverThumbnail}
            />
          ))}
        </VideoShelf>
      )}

      {likedRows.length > 0 && (
        <VideoShelf
          title="Liked"
          seeAllHref={kidsPortalUrl(profileId, feed, { view: "liked" })}
        >
          {likedRows.map(({ video, progress, reaction }) => (
            <VideoCard
              key={video.id}
              href={watchHref(video.id, likedFeedQuery)}
              video={video}
              profileId={profileId}
              progress={progress}
              reaction={reaction}
              size="compact"
              eager={takeEager()}
            />
          ))}
        </VideoShelf>
      )}
    </SaveToPlaylistProvider>
  );
}
