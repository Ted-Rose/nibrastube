"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  // Fetch offset tracked separately from rows.length — dedup below can
  // drop rows, and the offset must still advance past them.
  const [offset, setOffset] = useState(initialRows.length);
  const sentinelRef = useRef<HTMLDivElement>(null);
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
    setOffset(initialRows.length);
  }

  const fetchNext = useCallback(() => {
    if (!loadMore || fetching || exhausted) return;
    setFetching(true);
    loadMore(offset)
      .then((page) => {
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
      .catch(() => setExhausted(true))
      .finally(() => setFetching(false));
  }, [loadMore, fetching, exhausted, offset]);

  const showMore = useCallback(() => {
    if (visible < rows.length) {
      setVisible((v) => Math.min(v + PAGE_SIZE, rows.length));
    } else {
      fetchNext();
    }
  }, [visible, rows.length, fetchNext]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) showMore();
      },
      { rootMargin: "600px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, showMore]);

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
            {fetching ? "Loading…" : "Show more videos"}
          </button>
        </div>
      )}
    </>
  );
}
