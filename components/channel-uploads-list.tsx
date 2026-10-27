"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { DashboardVideoCard } from "@/components/dashboard-video-card";
import { cn } from "@/lib/utils";
import type { DashboardVideo } from "@/lib/youtube";

export interface ChannelUploadsFetch {
  items: DashboardVideo[];
  pinnedIds: string[];
  nextPageToken: string | null;
}

// Layout effect on the client, plain effect during SSR (layout
// effects don't run there). The stale-fetch generation bump must land
// in the same commit as the fresh first page — a passive effect would
// leave a microtask window where an in-flight loadMore could still
// append a stale page over the reset.
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

// Infinite-scroll uploads list for the dashboard channel drill-in —
// same token-keyed accumulation as SearchResultsGrid. Each page is a
// playlistItems.list call (1 quota unit), so a wide 600px prefetch is
// cheap here.
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
  const [items, setItems] = useState(initialItems);
  const [pinnedIds, setPinnedIds] = useState(
    () => new Set(initialFlaggedIds)
  );
  const [nextToken, setNextToken] = useState(initialNextPageToken);
  const [fetching, setFetching] = useState(false);
  const [failed, setFailed] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  // Generation counter the reset invalidates: fetchNext captures it
  // before loadMore and .then bails if it changed mid-flight, so a
  // stale page can't append over the fresh first page. Bumped in the
  // commit (not during render — refs are render-pure) so it also
  // can't trip on a discarded concurrent render.
  const generationRef = useRef(0);
  useIsomorphicLayoutEffect(() => {
    generationRef.current += 1;
  }, [initialItems]);
  const hasMore = !!loadMore && nextToken != null;

  // A server refresh (pin revalidation) swaps in a fresh first page —
  // drop appended pages and restart from it. Same accepted tradeoff as
  // the kids feed's prevInitial reset.
  const [prevInitial, setPrevInitial] = useState(initialItems);
  if (prevInitial !== initialItems) {
    setPrevInitial(initialItems);
    setItems(initialItems);
    setPinnedIds(new Set(initialFlaggedIds));
    setNextToken(initialNextPageToken);
    setFetching(false);
    setFailed(false);
  }

  const fetchNext = useCallback(() => {
    if (!loadMore || fetching || nextToken == null) return;
    setFetching(true);
    const generation = generationRef.current;
    loadMore(nextToken)
      .then((page) => {
        // A reset landed mid-flight — this page belongs to the old
        // first page's token chain.
        if (generation !== generationRef.current) return;
        setItems((prev) => {
          const seen = new Set(prev.map((v) => v.id));
          return [
            ...prev,
            ...page.items.filter((v) => !seen.has(v.id)),
          ];
        });
        setPinnedIds((prev) => {
          const next = new Set(prev);
          for (const id of page.pinnedIds) next.add(id);
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
      { rootMargin: "600px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, failed, showMore]);

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
                : "Show more videos"}
          </button>
        </div>
      )}
    </>
  );
}
