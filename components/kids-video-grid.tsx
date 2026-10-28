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
import {
  feedSnapshotKey,
  patchRows,
  readFeedSnapshot,
  reorderRows,
  restoreFeedScroll,
  useFeedSaver,
  writeFeedSnapshot,
  type FeedSnapshot,
} from "@/lib/feed-memory";
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

// Layout effect on the client, plain effect during SSR (layout effects
// don't run there) — same convention as search-results-grid.tsx. The
// snapshot restore must land before paint or the kid sees the feed
// flash at the top and then jump.
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
  // Fetch offset tracked separately from rows.length — dedup below can
  // drop rows, and the offset must still advance past them.
  const [offset, setOffset] = useState(initialRows.length);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const hasMore = visible < rows.length || (!!loadMore && !exhausted);

  // The card tapped to enter the player — the snapshot's scroll anchor.
  const anchorRef = useRef<string | null>(null);

  const saveSnapshot = (scrollY: number, anchor?: string | null) => {
    if (anchor !== undefined) anchorRef.current = anchor;
    writeFeedSnapshot(feedSnapshotKey(profileId, feedQuery), {
      savedAt: Date.now(),
      scrollY,
      anchorVideoId: anchorRef.current,
      visible,
      offset,
      // Non-paged grids store ordering only — the fresh list is the
      // full feed anyway, so unpins drop out on restore. Paged grids
      // keep full rows because pages 2+ can't be refetched for free.
      orderIds: loadMore ? [] : rows.map((r) => r.video.id),
      rows: loadMore ? rows : null,
    });
  };
  useFeedSaver(saveSnapshot);

  // --- snapshot restore, once on mount ----------------------------
  // Applied from an effect (not initial state) so the first client
  // render still matches the server HTML — no hydration mismatch.
  const initRef = useRef(false);
  const snapRef = useRef<FeedSnapshot | null>(null);
  const scrollPendingRef = useRef(false);
  const disposeScrollRef = useRef<(() => void) | null>(null);

  useIsomorphicLayoutEffect(() => {
    if (!initRef.current) {
      initRef.current = true;
      const snap = readFeedSnapshot(
        feedSnapshotKey(profileId, feedQuery)
      );
      if (snap && (snap.rows?.length || snap.orderIds.length)) {
        snapRef.current = snap;
        scrollPendingRef.current = true;
        if (snap.rows?.length) {
          // Paged grid — restore every mounted page verbatim, then
          // patch per-id fields from the fresh first page in place
          // (order untouched). Accepted tradeoff: snapshot-only rows
          // stay verbatim, so a video unpinned since the snapshot can
          // remain visible until TTL/refresh — the watch page's
          // whitelist check still blocks playback.
          setRows(patchRows(snap.rows, initialRows));
        } else {
          // Non-paged — reorder the fresh full list to the saved
          // order; removed ids drop out, new ids append at the end.
          setRows(reorderRows(initialRows, snap.orderIds));
        }
        // Restore the mounted depth too — the page must be tall
        // enough to contain the saved scroll offset.
        setVisible(Math.max(PAGE_SIZE, snap.visible));
        setOffset(Math.max(snap.offset, initialRows.length));
      }
      return;
    }
    if (scrollPendingRef.current) {
      scrollPendingRef.current = false;
      // This commit has the restored rows/depth mounted.
      if (snapRef.current) {
        disposeScrollRef.current = restoreFeedScroll(snapRef.current);
      }
    }
  });

  useEffect(
    () => () => {
      disposeScrollRef.current?.();
    },
    []
  );

  // A new feedQuery is a different snapshot key — the card the kid
  // tapped under the old feed must not anchor the new one.
  useEffect(() => {
    anchorRef.current = null;
  }, [feedQuery]);

  // A server refresh (pusher event, back-nav refetch) swaps in a
  // re-ranked page — merge it under the order the kid sees instead of
  // resetting: same feed keeps its order and mounted depth; a
  // deliberate sort/filter change (new feedQuery = a different
  // snapshot key) still resets to the fresh server order.
  const [prevQuery, setPrevQuery] = useState(feedQuery);
  const [prevInitial, setPrevInitial] = useState(initialRows);
  if (prevQuery !== feedQuery) {
    setPrevQuery(feedQuery);
    setPrevInitial(initialRows);
    setRows(initialRows);
    setVisible(PAGE_SIZE);
    setFetching(false);
    setExhausted(false);
    setOffset(initialRows.length);
  } else if (prevInitial !== initialRows) {
    setPrevInitial(initialRows);
    setRows((cur) =>
      loadMore
        ? patchRows(cur, initialRows)
        : reorderRows(initialRows, cur.map((r) => r.video.id))
    );
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
      <div
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8"
        onClickCapture={(e) => {
          // Record the tapped card as the scroll anchor and take the
          // final-position snapshot before the watch page pushes on
          // top. Only real card-link taps count — the ⋮ menu trigger
          // is a sibling of the Link inside the same data-feed-anchor
          // wrapper, so without the href check a menu tap would pin a
          // stale anchor that later overrides the accurate scrollY.
          const target = e.target as HTMLElement;
          if (!target.closest?.('a[href*="/watch/"]')) return;
          const anchor = target.closest("[data-feed-anchor]");
          if (anchor) {
            saveSnapshot(
              window.scrollY,
              anchor.getAttribute("data-feed-anchor")
            );
          }
        }}
      >
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
