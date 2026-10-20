import { EmptyState } from "@/components/empty-state";
import { KidsLengthFilter } from "@/components/kids-length-filter";
import { KidsTypeFilter } from "@/components/kids-type-filter";
import { KidsVideoGrid } from "@/components/kids-video-grid";
import { SaveToPlaylistProvider } from "@/components/save-to-playlist-dialog";
import { loadMoreForYou } from "@/app/actions/kids-feed";
import {
  getPlaylists,
  getRecommendedVideos,
  kidsFeedQuery,
  kidsPortalUrl,
  lenRangeLabel,
  type KidsFeedParams,
} from "@/lib/kids-feed";
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
    type: feed.type,
    minLen: feed.minLen,
    maxLen: feed.maxLen,
  });
  // Playlists snapshot — feeds the shared "Save to playlist" dialog
  // behind every video card's ⋮ menu.
  const playlistRows = await getPlaylists(profileId);
  const ViewIcon = KIDS_VIEWS.foryou.icon;

  return (
    <>
      <FeedHeader
        title={feedTitle(feed)}
        actions={
          <div className="flex max-w-full flex-nowrap items-center gap-3 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <KidsTypeFilter profileId={profileId} feed={feed} />
            <KidsLengthFilter minLen={feed.minLen} maxLen={feed.maxLen} />
          </div>
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={<ViewIcon size={48} weight="fill" />}
          message={
            query
              ? feed.type === "shorts"
                ? "No shorts found!"
                : "No videos found!"
              : feed.type === "shorts"
                ? "No shorts picked yet!"
                : feed.type === "videos"
                  ? "No videos picked yet!"
                  : feed.minLen !== null || feed.maxLen !== null
                    ? `Nothing ${lenRangeLabel(feed.minLen, feed.maxLen)} picked yet!`
                    : "Nothing picked yet!"
          }
          action={
            query
              ? {
                  label: "Clear search",
                  href: kidsPortalUrl(profileId, feed, { q: "" }),
                }
              : feed.type !== "all" ||
                  feed.minLen !== null ||
                  feed.maxLen !== null
                ? {
                    label: "Show everything",
                    href: kidsPortalUrl(profileId, feed, {
                      type: "all",
                      minLen: null,
                      maxLen: null,
                    }),
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
