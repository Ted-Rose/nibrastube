import { EmptyState } from "@/components/empty-state";
import { KidsVideoGrid } from "@/components/kids-video-grid";
import { SaveToPlaylistProvider } from "@/components/save-to-playlist-dialog";
import {
  getLikedVideos,
  getPlaylists,
  kidsFeedQuery,
  kidsPortalUrl,
  type KidsFeedParams,
} from "@/lib/kids-feed";
import { FeedHeader } from "@/components/feed-header";
import { feedTitle, KIDS_VIEWS } from "./view-config";

// Liked tab — videos the kid tapped 👍 on, newest reaction first.
export async function LikedView({
  profileId,
  feed,
}: {
  profileId: string;
  feed: KidsFeedParams;
}) {
  const { q: query } = feed;

  const rows = await getLikedVideos(profileId, { q: query });
  // Playlists snapshot — feeds the shared "Save to playlist" dialog
  // behind every video card's ⋮ menu.
  const playlistRows = await getPlaylists(profileId);
  const ViewIcon = KIDS_VIEWS.liked.icon;

  return (
    <>
      <FeedHeader title={feedTitle(feed)} />

      {rows.length === 0 ? (
        <EmptyState
          icon={<ViewIcon size={48} weight="fill" />}
          message={
            query
              ? "No videos found!"
              : "No liked videos yet! Tap the 👍 while watching."
          }
          action={
            query
              ? {
                  label: "Clear search",
                  href: kidsPortalUrl(profileId, feed, { q: "" }),
                }
              : {
                  label: "Find videos",
                  href: kidsPortalUrl(profileId, feed, {
                    view: "videos",
                    channel: null,
                  }),
                }
          }
        />
      ) : (
        <SaveToPlaylistProvider
          profileId={profileId}
          playlists={playlistRows}
        >
          <KidsVideoGrid
            rows={rows}
            profileId={profileId}
            feedQuery={kidsFeedQuery(feed)}
          />
        </SaveToPlaylistProvider>
      )}
    </>
  );
}
