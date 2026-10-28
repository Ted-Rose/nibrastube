"use client";

import Link from "next/link";
import { Check } from "@phosphor-icons/react";
import { approveChannel } from "@/app/actions/channels";
import { DashboardVideoCard } from "./dashboard-video-card";
import { SubmitButton } from "@/components/submit-button";
import { TokenPagerSentinel } from "@/components/token-pager-sentinel";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useTokenPager } from "@/components/use-token-pager";
import { cn } from "@/lib/utils";
import type { DashboardVideo, YouTubeChannel } from "@/lib/youtube";

export type SearchGridItem = DashboardVideo | YouTubeChannel;

// Both paging actions fit this shape — pinnedIds for video pages,
// approvedIds for channel pages; the pager unions them into one set.
export type SearchLoadMore = (pageToken: string | null) => Promise<{
  items: SearchGridItem[];
  nextPageToken: string | null;
  pinnedIds?: string[];
  approvedIds?: string[];
}>;

// Video pages flag pins, channel pages flag channel approvals —
// union both (only one kind appears per search type).
const FLAG_KEYS = ["pinnedIds", "approvedIds"] as const;

// Infinite-scroll wrapper around the dashboard's YouTube search
// results — the token-keyed paging machinery lives in
// use-token-pager.ts; this component owns only the grid + cards.
export function SearchResultsGrid({
  searchType,
  initialItems,
  initialFlaggedIds,
  initialNextPageToken,
  profileId,
  profileName,
  previewBaseHref,
  channelBaseHref,
  loadMore,
}: {
  searchType: "videos" | "channels";
  initialItems: SearchGridItem[];
  // Ids already pinned (videos) / approved (channels) for the profile —
  // the union with each appended page's flag list renders correct
  // Approved state without a refresh.
  initialFlaggedIds: string[];
  initialNextPageToken: string | null;
  profileId: string;
  profileName: string;
  // Dashboard URLs without the &video= / &channel= param — cards append
  // their id so closing the overlay/drill-in restores this context.
  previewBaseHref: string;
  channelBaseHref: string;
  loadMore?: SearchLoadMore;
}) {
  const {
    items,
    flaggedIds,
    hasMore,
    fetching,
    failed,
    sentinelRef,
    showMore,
  } = useTokenPager<SearchGridItem>({
    initialItems,
    initialFlaggedIds,
    initialNextPageToken,
    loadMore,
    flagKeys: FLAG_KEYS,
    // Tighter than the kids feed's 600px — each search page costs
    // 100 YouTube quota units.
    rootMargin: "300px",
  });

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {items.map((item) =>
          searchType === "channels" ? (
            <ChannelResultCard
              key={item.id}
              channel={item as YouTubeChannel}
              approved={flaggedIds.has(item.id)}
              profileId={profileId}
              profileName={profileName}
              href={`${channelBaseHref}&channel=${item.id}`}
            />
          ) : (
            <DashboardVideoCard
              key={item.id}
              video={item as DashboardVideo}
              pinned={flaggedIds.has(item.id)}
              profileId={profileId}
              profileName={profileName}
              previewHref={`${previewBaseHref}&video=${item.id}`}
            />
          )
        )}
      </div>
      {hasMore && (
        <TokenPagerSentinel
          sentinelRef={sentinelRef}
          fetching={fetching}
          failed={failed}
          onClick={showMore}
          label="Show more results"
        />
      )}
    </>
  );
}

// Channel hit in search results — the avatar+title links into the
// ?channel= drill-in; the footer keeps the approve CTA.
function ChannelResultCard({
  channel,
  approved,
  profileId,
  profileName,
  href,
}: {
  channel: YouTubeChannel;
  approved: boolean;
  profileId: string;
  profileName: string;
  href: string;
}) {
  return (
    <Card
      className={cn(
        "overflow-hidden group transition-all flex flex-col",
        "hover:ring-2 hover:ring-primary/40"
      )}
    >
      <CardHeader className="p-4 flex-1">
        <Link
          href={href}
          scroll={false}
          className={cn(
            "flex items-center gap-4 rounded-md",
            "focus-visible:outline-none",
            "focus-visible:ring-2 focus-visible:ring-primary/40"
          )}
        >
          <img
            src={channel.thumbnail}
            className="w-16 h-16 object-cover rounded-full shadow-sm"
            alt={channel.title}
          />
          <CardTitle
            className={cn(
              "text-base line-clamp-2 leading-snug",
              "group-hover:underline"
            )}
          >
            {channel.title}
          </CardTitle>
        </Link>
      </CardHeader>
      <CardFooter className="p-4 pt-0">
        {approved ? (
          <Button
            disabled
            className={cn(
              "w-full bg-green-100 text-green-700 border-green-200",
              "hover:bg-green-100"
            )}
          >
            <Check size={18} className="mr-2" /> Approved
          </Button>
        ) : (
          <form
            action={approveChannel.bind(null, profileId, channel.id)}
            className="w-full"
          >
            <SubmitButton
              variant="outline"
              size="touch"
              pendingLabel="Approving…"
              className={cn(
                "w-full transition-colors",
                "hover:bg-primary hover:text-white"
              )}
            >
              Approve Channel for {profileName}
            </SubmitButton>
          </form>
        )}
      </CardFooter>
    </Card>
  );
}
