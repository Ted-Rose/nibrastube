"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { VideoCard } from "./video-card";
import type { watchProgress } from "@/lib/db/schema";
import type { FeedVideo, VideoReaction } from "@/lib/kids-feed";

export interface FeedRow {
  video: FeedVideo;
  progress: typeof watchProgress.$inferSelect | null;
  reaction: VideoReaction | null;
}

// Approved feeds can hold ~2k videos; mounting every card at once made the
// DOM (and each pusher-driven re-render) expensive on kid devices. Mount a
// window and grow it as the sentinel scrolls into view.
const PAGE_SIZE = 48;

// Layout effect on the client, plain effect during SSR (layout
// effects don't run there). The stale-fetch generation bump must land
// in the same commit as the fresh first page — a passive effect would
// leave a microtask window where an in-flight loadMore could still
// append a stale page over the reset.
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

export function KidsVideoGrid({
  rows: initialRows,
  profileId,
  feedQuery,
  eagerCount = 4,
  loadMore,
}: {
  rows: FeedRow[];
  profileId: string;
  feedQuery: string;
  // Thumbnails of the first `eagerCount` cards load eagerly — they're the
  // ones visible without scrolling.
  eagerCount?: number;
  // Server-paging hook (For You): called with the next row offset once
  // the local window is exhausted; resolves with the next page ([] =
  // end of feed). When omitted, `rows` is the complete feed and only
  // client-side windowing applies.
  loadMore?: (offset: number) => Promise<FeedRow[]>;
}) {
  const [rows, setRows] = useState(initialRows);
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [fetching, setFetching] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  // A failed fetch pauses the observer (no auto-retry loop) but keeps
  // the sentinel's button as a manual retry.
  const [failed, setFailed] = useState(false);
  // Fetch offset tracked separately from rows.length — dedup below can
  // drop rows, and the offset must still advance past them.
  const [offset, setOffset] = useState(initialRows.length);
  const sentinelRef = useRef<HTMLDivElement>(null);
  // Generation counter the reset invalidates: fetchNext captures it
  // before loadMore and .then/.catch bail if it changed mid-flight,
  // so a stale page can neither append old-filter rows nor corrupt
  // offset/exhausted/failed. Bumped in the commit (not during render —
  // refs are render-pure) so it also can't trip on a discarded
  // concurrent render.
  const generationRef = useRef(0);
  useIsomorphicLayoutEffect(() => {
    generationRef.current += 1;
  }, [initialRows]);
  const hasMore = visible < rows.length || (!!loadMore && !exhausted);

  // A server refresh (pusher event, navigation) swaps in a re-ranked
  // first page — drop appended pages and restart from it.
  const [prevInitial, setPrevInitial] = useState(initialRows);
  if (prevInitial !== initialRows) {
    setPrevInitial(initialRows);
    setRows(initialRows);
    setVisible(PAGE_SIZE);
    setFetching(false);
    setExhausted(false);
    setFailed(false);
    setOffset(initialRows.length);
  }

  const fetchNext = useCallback(() => {
    if (!loadMore || fetching || exhausted) return;
    setFetching(true);
    const generation = generationRef.current;
    loadMore(offset)
      .then((page) => {
        // A reset landed mid-flight — this page belongs to the old
        // first page's filter.
        if (generation !== generationRef.current) return;
        setOffset((o) => o + page.length);
        if (page.length === 0) {
          setExhausted(true);
          return;
        }
        // Whitelist changes between pages can shift offsets — never
        // mount the same video twice.
        setRows((prev) => {
          const seen = new Set(prev.map((r) => r.video.id));
          return [...prev, ...page.filter((r) => !seen.has(r.video.id))];
        });
      })
      .catch(() => {
        if (generation !== generationRef.current) return;
        setFailed(true);
      })
      .finally(() => {
        if (generation === generationRef.current) setFetching(false);
      });
  }, [loadMore, fetching, exhausted, offset]);

  const showMore = useCallback(() => {
    if (visible < rows.length) {
      setVisible((v) => Math.min(v + PAGE_SIZE, rows.length));
    } else {
      setFailed(false);
      fetchNext();
    }
  }, [visible, rows.length, fetchNext]);

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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
        {rows.slice(0, visible).map(({ video, progress, reaction }, i) => (
          <VideoCard
            key={video.id}
            href={`/kids/${profileId}/watch/${video.id}${feedQuery}`}
            video={video}
            profileId={profileId}
            progress={progress}
            reaction={reaction}
            eager={i < eagerCount}
            // The grid renders each video once, so it owns the unique
            // video-<id> view-transition name that morphs into the player.
            vt
          />
        ))}
      </div>
      {hasMore && (
        <div ref={sentinelRef} className="flex justify-center pt-8">
          <button
            type="button"
            disabled={fetching}
            onClick={showMore}
            className="rounded-full bg-white px-8 py-3 text-lg font-bold text-slate-500 shadow-sm hover:text-slate-800 transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/40 disabled:opacity-60"
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
