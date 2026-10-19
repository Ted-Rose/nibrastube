import { EmptyState } from "@/components/empty-state";
import { KidsVideoGrid } from "@/components/kids-video-grid";
import { SaveToPlaylistProvider } from "@/components/save-to-playlist-dialog";
import { loadMoreShorts } from "@/app/actions/kids-feed";
import {
  getPlaylists,
  getRecommendedVideos,
  kidsFeedQuery,
  kidsPortalUrl,
  type KidsFeedParams,
} from "@/lib/kids-feed";
import { FeedHeader } from "@/components/feed-header";
import { feedTitle, KIDS_VIEWS } from "./view-config";

// Shorts tab — the For You ranking filtered to videos.is_short (see
// getRecommendedVideos). No sort chips: the ranking IS the sort.
export async function ShortsView({
  profileId,
  feed,
}: {
  profileId: string;
  feed: KidsFeedParams;
}) {
  const { q: query } = feed;

  const rows = await getRecommendedVideos(profileId, {
    q: query,
    shortsOnly: true,
  });
  // Playlists snapshot — feeds the shared "Save to playlist" dialog
  // behind every video card's ⋮ menu.
  const playlistRows = await getPlaylists(profileId);
  const ViewIcon = KIDS_VIEWS.shorts.icon;

  return (
    <>
      <FeedHeader title={feedTitle(feed)} />

      {rows.length === 0 ? (
        <EmptyState
          icon={<ViewIcon size={48} weight="fill" />}
          message={query ? "No shorts found!" : "No shorts yet!"}
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
            // A short first page means the whitelist is already
            // exhausted — no paging hook needed.
            loadMore={
              rows.length === 60
                ? loadMoreShorts.bind(null, profileId, query)
                : undefined
            }
          />
        </SaveToPlaylistProvider>
      )}
    </>
  );
}
