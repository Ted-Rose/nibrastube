"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { LinkPendingSpinner } from "./link-pending-spinner";
import {
  feedSnapshotKey,
  readFeedSnapshot,
  restoreFeedScroll,
  useFeedSaver,
  writeFeedSnapshot,
  type FeedSnapshot,
} from "@/lib/feed-memory";
import type { FeedRow } from "./kids-video-grid";

export interface HistoryRow extends FeedRow {
  watchedOn: string; // YYYY-MM-DD kid-local date
  lastSeenAt: Date;
}

const PREVIEW_COUNT = 4;

// Layout effect on the client, plain effect during SSR — the scroll
// restore must land before paint or the list visibly jumps.
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

// Rows arrive pre-sorted (day desc, then lastSeenAt desc) — the client only
// buckets by watchedOn and collapses each day to the last 4 videos until
// "Show all" is tapped.
export function HistoryView({
  rows,
  profileId,
  feedQuery,
}: {
  rows: HistoryRow[];
  profileId: string;
  feedQuery: string;
}) {
  // watchedOn keys of day sections expanded past the first PREVIEW_COUNT.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Feed memory for this tab is scroll + open sections only — NO order
  // freeze: the chronological re-sort is the point of history.
  const saveSnapshot = (scrollY: number) => {
    writeFeedSnapshot(feedSnapshotKey(profileId, feedQuery), {
      savedAt: Date.now(),
      scrollY,
      anchorVideoId: null,
      visible: 0,
      offset: 0,
      orderIds: [],
      rows: null,
      expandedDays: [...expanded],
    });
  };
  useFeedSaver(saveSnapshot, feedQuery);

  // Restore once on mount — applied from an effect so the first client
  // render still matches the server HTML (no hydration mismatch).
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
      if (snap) {
        if (snap.expandedDays?.length) {
          // Reopen day sections first — the scroll lands on the NEXT
          // commit, after the expanded rows have mounted.
          snapRef.current = snap;
          scrollPendingRef.current = true;
          setExpanded(new Set(snap.expandedDays));
        } else {
          // Nothing to reopen — the DOM is already final; scroll now.
          disposeScrollRef.current = restoreFeedScroll(snap);
        }
      }
      return;
    }
    if (scrollPendingRef.current) {
      scrollPendingRef.current = false;
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

  const days = new Map<string, HistoryRow[]>();
  for (const row of rows) {
    const bucket = days.get(row.watchedOn);
    if (bucket) bucket.push(row);
    else days.set(row.watchedOn, [row]);
  }

  const today = new Date().toLocaleDateString("en-CA");
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = yesterdayDate.toLocaleDateString("en-CA");

  const dayLabel = (watchedOn: string) => {
    if (watchedOn === today) return "Today";
    if (watchedOn === yesterday) return "Yesterday";
    // Noon anchor keeps the rendered date on the right day in every tz.
    const d = new Date(`${watchedOn}T12:00:00`);
    return d.toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
      ...(d.getFullYear() !== new Date().getFullYear()
        ? { year: "numeric" as const }
        : {}),
    });
  };

  const toggle = (watchedOn: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(watchedOn)) next.delete(watchedOn);
      else next.add(watchedOn);
      return next;
    });

  return (
    <div
      className="flex flex-col gap-10"
      onClickCapture={(e) => {
        // Final-position snapshot before the watch page pushes on top.
        if ((e.target as HTMLElement).closest?.('a[href*="/watch/"]')) {
          saveSnapshot(window.scrollY);
        }
      }}
    >
      {[...days.entries()].map(([watchedOn, dayRows]) => {
        const isOpen = expanded.has(watchedOn);
        const shown = isOpen ? dayRows : dayRows.slice(0, PREVIEW_COUNT);
        return (
          <section key={watchedOn}>
            <h3 className="mb-4 text-2xl font-black text-slate-900 tracking-tight">
              {dayLabel(watchedOn)}
              <span className="ml-3 text-lg font-bold text-slate-400">
                {dayRows.length} {dayRows.length === 1 ? "video" : "videos"}
              </span>
            </h3>
            <div className="flex flex-col gap-3">
              {shown.map(({ video, lastSeenAt }) => (
                <Link
                  key={video.id}
                  href={`/kids/${profileId}/watch/${video.id}${feedQuery}`}
                  className="group flex items-center gap-4 rounded-3xl bg-white p-3 shadow-sm transition-transform motion-safe:hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/40"
                >
                  <div className="relative w-32 sm:w-40 shrink-0">
                    <img
                      src={video.thumbnail}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="aspect-video w-full rounded-2xl object-cover"
                    />
                    <LinkPendingSpinner
                      size={24}
                      weight="bold"
                      className="absolute inset-0 m-auto text-white drop-shadow"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 font-bold leading-tight text-slate-900 group-hover:underline">
                      {video.title}
                    </p>
                    <p className="mt-1 truncate font-medium text-slate-500">
                      {video.channelTitle}
                    </p>
                  </div>
                  <span className="shrink-0 pr-2 text-sm font-bold text-slate-400">
                    {lastSeenAt.toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                </Link>
              ))}
            </div>
            {dayRows.length > PREVIEW_COUNT && (
              <button
                type="button"
                onClick={() => toggle(watchedOn)}
                className="mt-3 rounded-full bg-white px-5 py-2 text-base font-bold text-slate-500 shadow-sm hover:text-slate-800 transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/40"
              >
                {isOpen ? "Show less" : `Show all ${dayRows.length}`}
              </button>
            )}
          </section>
        );
      })}
    </div>
  );
}
