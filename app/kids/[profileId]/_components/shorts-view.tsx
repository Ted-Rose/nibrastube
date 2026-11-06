import { EmptyState } from "@/components/empty-state";
import { KidsVideoGrid } from "@/components/kids-video-grid";
import { SaveToPlaylistProvider } from "@/components/save-to-playlist-dialog";
import { loadMoreShorts } from "@/app/actions/kids-feed";
import {
  FOR_YOU_PAGE_SIZE,
  getPlaylists,
  getRecommendedVideos,
  kidsFeedQuery,
  newFeedEpoch,
  type KidsFeedParams,
} from "@/lib/kids-feed";
import { emptyStateFor } from "@/lib/empty-state";
import { FeedHeader } from "@/components/feed-header";
import { feedTitle, KIDS_VIEWS } from "./view-config";

// Shorts tab — the For You ranking restricted to videos.is_short (see
// getRecommendedVideos). No sort chips: the ranking IS the sort; no
// type chips either — the feed is intrinsically shorts-only.
export async function ShortsView({
  profileId,
  feed,
}: {
  profileId: string;
  feed: KidsFeedParams;
}) {
  const { q: query } = feed;

  // Feed epoch — the impression penalty is evaluated "as of" this
  // server time on page 1 AND every loadMore page (see
  // impressionPenalty in lib/kids-feed.ts), so OFFSET paging stays
  // stable while the kid's own impressions land mid-scroll.
  const epoch = newFeedEpoch();
  const rows = await getRecommendedVideos(profileId, {
    q: query,
    asOf: new Date(epoch),
    limit: FOR_YOU_PAGE_SIZE,
    type: "shorts",
    minLen: feed.minLen,
    maxLen: feed.maxLen,
  });
  // Playlists snapshot — feeds the shared "Save to playlist" dialog
  // behind every video card's ⋮ menu.
  const playlistRows = await getPlaylists(profileId);
  const ViewIcon = KIDS_VIEWS.shorts.icon;

  const empty = emptyStateFor({
    feed,
    profileId,
    icon: ViewIcon,
    noun: "shorts",
    filtered: "No shorts yet!",
    empty: {
      message: "No shorts yet!",
      action: {
        label: "Find videos",
        overrides: { view: "videos", channel: null },
      },
    },
  });

  return (
    <>
      <FeedHeader title={feedTitle(feed)} />

      {rows.length === 0 ? (
        <EmptyState {...empty} />
      ) : (
        <SaveToPlaylistProvider
          profileId={profileId}
          playlists={playlistRows}
        >
          <KidsVideoGrid
            rows={rows}
            profileId={profileId}
            feedQuery={kidsFeedQuery(feed)}
            epoch={epoch}
            // A short first page means the whitelist is already
            // exhausted — no paging hook needed.
            loadMore={
              rows.length === FOR_YOU_PAGE_SIZE
                ? loadMoreShorts.bind(
                    null,
                    profileId,
                    query,
                    feed.minLen,
                    feed.maxLen
                  )
                : undefined
            }
          />
        </SaveToPlaylistProvider>
      )}
    </>
  );
}
