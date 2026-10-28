import { EmptyState } from "@/components/empty-state";
import { KidsLengthFilter } from "@/components/kids-length-filter";
import { KidsTypeFilter } from "@/components/kids-type-filter";
import { KidsVideoGrid } from "@/components/kids-video-grid";
import { SaveToPlaylistProvider } from "@/components/save-to-playlist-dialog";
import { loadMoreForYou } from "@/app/actions/kids-feed";
import {
  FOR_YOU_PAGE_SIZE,
  getPlaylists,
  getRecommendedVideos,
  kidsFeedQuery,
  type KidsFeedParams,
} from "@/lib/kids-feed";
import { emptyStateFor } from "@/lib/empty-state";
import { FeedHeader } from "@/components/feed-header";
import { feedTitle, KIDS_VIEWS } from "./view-config";

// For You tab — whitelisted videos ranked by predicted interest (see
// getRecommendedVideos). No sort chips: the ranking IS the sort; the
// ?type=/?max= filters still apply.
export async function ForYouView({
  profileId,
  feed,
}: {
  profileId: string;
  feed: KidsFeedParams;
}) {
  const { q: query } = feed;

  const rows = await getRecommendedVideos(profileId, {
    q: query,
    limit: FOR_YOU_PAGE_SIZE,
    type: feed.type,
    minLen: feed.minLen,
    maxLen: feed.maxLen,
  });
  // Playlists snapshot — feeds the shared "Save to playlist" dialog
  // behind every video card's ⋮ menu.
  const playlistRows = await getPlaylists(profileId);
  const ViewIcon = KIDS_VIEWS.foryou.icon;

  const empty = emptyStateFor({
    feed,
    profileId,
    icon: ViewIcon,
    noun: feed.type === "shorts" ? "shorts" : "videos",
    filtered: [
      { type: "shorts", message: "No shorts picked yet!" },
      { type: "videos", message: "No videos picked yet!" },
      {
        type: "band",
        message: (l) => `Nothing ${l} picked yet!`,
      },
    ],
    empty: {
      message: "Nothing picked yet!",
      action: {
        label: "Find videos",
        overrides: { view: "videos", channel: null },
      },
    },
  });

  return (
    <>
      <FeedHeader
        title={feedTitle(feed)}
        actions={
          <div
            data-drag-scroll
            className="flex max-w-full flex-nowrap items-center gap-3 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            <KidsTypeFilter profileId={profileId} feed={feed} />
            <KidsLengthFilter minLen={feed.minLen} maxLen={feed.maxLen} />
          </div>
        }
      />

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
            // A short first page means the whitelist is already
            // exhausted — no paging hook needed.
            loadMore={
              rows.length === FOR_YOU_PAGE_SIZE
                ? loadMoreForYou.bind(
                    null,
                    profileId,
                    query,
                    feed.type,
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
