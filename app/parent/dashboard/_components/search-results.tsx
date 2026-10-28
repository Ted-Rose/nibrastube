import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  whitelistedChannels,
  whitelistedVideos,
} from "@/lib/db/schema";
import {
  searchChannels,
  searchYouTube,
  toDashboardVideo,
} from "@/lib/youtube";
import {
  loadMoreSearchChannels,
  loadMoreSearchVideos,
} from "@/app/actions/search";
import { SearchResultsGrid } from "@/components/search-results-grid";

// YouTube search + the pinned/approved lookups the result buttons need all
// run here, inside Suspense — the page shell paints instantly and only this
// region waits on the YouTube API. The client grid owns accumulation from
// here on: "Show more" hits the paging actions one opaque token at a time
// (100 quota units per search page).
export async function SearchResults({
  query,
  searchType,
  profileId,
  profileName,
  previewBaseHref,
  channelBaseHref,
}: {
  query: string;
  searchType: "videos" | "channels";
  profileId: string;
  profileName: string;
  previewBaseHref: string;
  channelBaseHref: string;
}) {
  // The paging actions clamp to 200 chars — page 1 must use the same
  // string or a longer query would silently change between pages.
  const clampedQuery = query.slice(0, 200);
  const [videoPage, channelPage, pinnedRelations, approvedRelations] =
    await Promise.all([
      searchType === "videos"
        ? searchYouTube(clampedQuery)
        : Promise.resolve(null),
      searchType === "channels"
        ? searchChannels(clampedQuery)
        : Promise.resolve(null),
      db
        .select({ videoId: whitelistedVideos.videoId })
        .from(whitelistedVideos)
        .where(eq(whitelistedVideos.profileId, profileId)),
      db
        .select({ channelId: whitelistedChannels.channelId })
        .from(whitelistedChannels)
        .where(eq(whitelistedChannels.profileId, profileId)),
    ]);
  const pinnedVideoIds = new Set(pinnedRelations.map((r) => r.videoId));
  const approvedChannelIds = new Set(
    approvedRelations.map((r) => r.channelId)
  );

  if (searchType === "channels") {
    const items = channelPage?.items ?? [];
    return (
      <SearchResultsGrid
        searchType="channels"
        initialItems={items}
        initialFlaggedIds={items
          .filter((c) => approvedChannelIds.has(c.id))
          .map((c) => c.id)}
        initialNextPageToken={channelPage?.nextPageToken ?? null}
        profileId={profileId}
        profileName={profileName}
        previewBaseHref={previewBaseHref}
        channelBaseHref={channelBaseHref}
        loadMore={
          channelPage?.nextPageToken
            ? loadMoreSearchChannels.bind(null, profileId, clampedQuery)
            : undefined
        }
      />
    );
  }

  const items = (videoPage?.items ?? []).map(toDashboardVideo);
  return (
    <SearchResultsGrid
      searchType="videos"
      initialItems={items}
      initialFlaggedIds={items
        .filter((v) => pinnedVideoIds.has(v.id))
        .map((v) => v.id)}
      initialNextPageToken={videoPage?.nextPageToken ?? null}
      profileId={profileId}
      profileName={profileName}
      previewBaseHref={previewBaseHref}
      channelBaseHref={channelBaseHref}
      loadMore={
        videoPage?.nextPageToken
          ? loadMoreSearchVideos.bind(null, profileId, clampedQuery)
          : undefined
      }
    />
  );
}
