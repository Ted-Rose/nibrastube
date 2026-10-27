"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check } from "@phosphor-icons/react";
import { approveChannel } from "@/app/actions/channels";
import { DashboardVideoCard } from "@/components/dashboard-video-card";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { DashboardVideo, YouTubeChannel } from "@/lib/youtube";

export type SearchGridItem = DashboardVideo | YouTubeChannel;

// Both paging actions fit this shape — pinnedIds for video pages,
// approvedIds for channel pages; the grid unions them into one set.
export type SearchLoadMore = (pageToken: string | null) => Promise<{
  items: SearchGridItem[];
  nextPageToken: string | null;
  pinnedIds?: string[];
  approvedIds?: string[];
}>;

// Infinite-scroll wrapper around the dashboard's YouTube search
// results — same accumulation model as kids-video-grid.tsx but keyed
// on YouTube's opaque page token instead of a row offset. Exhaustion
// is `nextPageToken == null`, never an empty page (a hydrated page can
// filter to zero usable cards while a token remains — the sentinel
// stays alive so the observer re-fires or the user clicks).
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
  const [items, setItems] = useState(initialItems);
  const [flaggedIds, setFlaggedIds] = useState(
    () => new Set(initialFlaggedIds)
  );
  const [nextToken, setNextToken] = useState(initialNextPageToken);
  const [fetching, setFetching] = useState(false);
  // A failed fetch pauses the observer (no auto-retry loop) but keeps
  // the sentinel's button as a manual retry.
  const [failed, setFailed] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const hasMore = !!loadMore && nextToken != null;

  // A server refresh (new search, pin revalidation, tab switch) swaps
  // in a fresh first page — drop appended pages and restart from it.
  // Same accepted tradeoff as the kids feed's prevInitial reset.
  const [prevInitial, setPrevInitial] = useState(initialItems);
  if (prevInitial !== initialItems) {
    setPrevInitial(initialItems);
    setItems(initialItems);
    setFlaggedIds(new Set(initialFlaggedIds));
    setNextToken(initialNextPageToken);
    setFetching(false);
    setFailed(false);
  }

  const fetchNext = useCallback(() => {
    if (!loadMore || fetching || nextToken == null) return;
    setFetching(true);
    loadMore(nextToken)
      .then((page) => {
        // YouTube ranking drifts between pages — dedup by id so a
        // shifted result never mounts twice.
        setItems((prev) => {
          const seen = new Set(prev.map((v) => v.id));
          return [
            ...prev,
            ...page.items.filter((v) => !seen.has(v.id)),
          ];
        });
        setFlaggedIds((prev) => {
          const next = new Set(prev);
          for (const id of page.pinnedIds ?? page.approvedIds ?? []) {
            next.add(id);
          }
          return next;
        });
        setNextToken(page.nextPageToken);
      })
      .catch(() => setFailed(true))
      .finally(() => setFetching(false));
  }, [loadMore, fetching, nextToken]);

  const showMore = useCallback(() => {
    setFailed(false);
    fetchNext();
  }, [fetchNext]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore || failed) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) showMore();
      },
      // Tighter than the kids feed's 600px — each search page costs
      // 100 YouTube quota units.
      { rootMargin: "300px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, failed, showMore]);

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
        <div ref={sentinelRef} className="flex justify-center pt-8">
          <button
            type="button"
            disabled={fetching}
            onClick={showMore}
            className={cn(
              "rounded-full bg-white px-8 py-3 text-lg font-bold",
              "text-slate-500 shadow-sm transition-colors",
              "hover:text-slate-800 focus-visible:outline-none",
              "focus-visible:ring-4 focus-visible:ring-primary/40",
              "disabled:opacity-60"
            )}
          >
            {fetching
              ? "Loading…"
              : failed
                ? "Couldn't load more — retry"
                : "Show more results"}
          </button>
        </div>
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
