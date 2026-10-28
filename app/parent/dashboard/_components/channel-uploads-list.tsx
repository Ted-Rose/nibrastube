"use client";

import { DashboardVideoCard } from "./dashboard-video-card";
import { TokenPagerSentinel } from "@/components/token-pager-sentinel";
import { useTokenPager } from "@/components/use-token-pager";
import type { DashboardVideo } from "@/lib/youtube";

export interface ChannelUploadsFetch {
  items: DashboardVideo[];
  pinnedIds: string[];
  nextPageToken: string | null;
}

const FLAG_KEYS = ["pinnedIds"] as const;

// Infinite-scroll uploads list for the dashboard channel drill-in —
// the token-keyed paging machinery lives in use-token-pager.ts. Each
// page is a playlistItems.list call (1 quota unit), so a wide 600px
// prefetch is cheap here.
export function ChannelUploadsList({
  initialItems,
  initialFlaggedIds,
  initialNextPageToken,
  profileId,
  profileName,
  previewBaseHref,
  loadMore,
}: {
  initialItems: DashboardVideo[];
  initialFlaggedIds: string[]; // pinned video ids
  initialNextPageToken: string | null;
  profileId: string;
  profileName: string;
  // Dashboard URL that keeps the &channel= drill-in — the card appends
  // &video= so the preview overlay opens on top of this view.
  previewBaseHref: string;
  loadMore?: (
    pageToken: string | null
  ) => Promise<ChannelUploadsFetch>;
}) {
  const {
    items,
    flaggedIds: pinnedIds,
    hasMore,
    fetching,
    failed,
    sentinelRef,
    showMore,
  } = useTokenPager<DashboardVideo>({
    initialItems,
    initialFlaggedIds,
    initialNextPageToken,
    loadMore,
    flagKeys: FLAG_KEYS,
    rootMargin: "600px",
  });

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {items.map((video) => (
          <DashboardVideoCard
            key={video.id}
            video={video}
            pinned={pinnedIds.has(video.id)}
            profileId={profileId}
            profileName={profileName}
            previewHref={`${previewBaseHref}&video=${video.id}`}
          />
        ))}
      </div>
      {hasMore && (
        <TokenPagerSentinel
          sentinelRef={sentinelRef}
          fetching={fetching}
          failed={failed}
          onClick={showMore}
          label="Show more videos"
        />
      )}
    </>
  );
}
