"use client";

// "Shown but ignored" feed impressions. A grid card counts as seen
// once it is ≥50% visible for ≥1 continuous second; seen ids queue per
// profile and flush in batches to POST /api/impressions — the server
// dedupes to one counted impression per (profile, video) per kid-local
// day and lib/kids-feed.ts turns the count into a ranking penalty.
//
// Deliberately separate from lib/feed-memory.ts's useFeedSaver: that
// one is a throttled scroll → sessionStorage writer, this one is an
// IntersectionObserver + network queue with its own lifecycle.

import { useEffect, type RefObject } from "react";

const ENDPOINT = "/api/impressions";
const VISIBLE_RATIO = 0.5;
const DWELL_MS = 1000;
const FLUSH_INTERVAL_MS = 15_000;
// Server-side batch cap — larger queues go out in several requests.
const MAX_BATCH = 500;

// Kid-local YYYY-MM-DD from the date parts (not toLocaleDateString —
// see useProgressFlush in components/player-hooks.ts).
function localDay(now = new Date()): string {
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${m}-${d}`;
}

// --- per-day seen-set (sessionStorage) ----------------------------
// Ids already flushed today are never re-queued. Storage failures
// fail open to plain re-sends, which the server dedupes anyway.

interface SeenSet {
  day: string;
  ids: string[];
}

const seenKey = (profileId: string) => `nt:imp:${profileId}`;

function readSeen(profileId: string): Set<string> {
  try {
    const raw = sessionStorage.getItem(seenKey(profileId));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as SeenSet;
    if (parsed.day !== localDay() || !Array.isArray(parsed.ids)) {
      return new Set();
    }
    return new Set(parsed.ids);
  } catch {
    return new Set();
  }
}

function markSeen(profileId: string, ids: string[]) {
  try {
    const seen = readSeen(profileId);
    for (const id of ids) seen.add(id);
    const value: SeenSet = { day: localDay(), ids: [...seen] };
    sessionStorage.setItem(seenKey(profileId), JSON.stringify(value));
  } catch {
    // Storage disabled/full — the server's per-day dedup still holds.
  }
}

// --- pending queue ------------------------------------------------

const pending = new Map<string, Set<string>>();

function isRecorded(profileId: string, videoId: string): boolean {
  return (
    !!pending.get(profileId)?.has(videoId) ||
    readSeen(profileId).has(videoId)
  );
}

function recordImpression(profileId: string, videoId: string) {
  if (isRecorded(profileId, videoId)) return;
  let queue = pending.get(profileId);
  if (!queue) {
    queue = new Set();
    pending.set(profileId, queue);
  }
  queue.add(videoId);
}

// beacon = unload paths (pagehide/hidden/unmount); keepalive fetch
// otherwise. Failures are silent — impressions are best-effort.
export function flushImpressions(profileId: string, beacon = false) {
  const queue = pending.get(profileId);
  if (!queue || queue.size === 0) return;
  const ids = [...queue];
  pending.delete(profileId);
  markSeen(profileId, ids);
  const day = localDay();
  for (let i = 0; i < ids.length; i += MAX_BATCH) {
    const payload = JSON.stringify({
      profileId,
      videoIds: ids.slice(i, i + MAX_BATCH),
      day,
    });
    try {
      if (beacon && navigator.sendBeacon) {
        navigator.sendBeacon(
          ENDPOINT,
          new Blob([payload], { type: "application/json" })
        );
      } else {
        fetch(ENDPOINT, {
          method: "POST",
          body: payload,
          keepalive: true,
          headers: { "Content-Type": "application/json" },
        }).catch(() => {});
      }
    } catch {
      // sendBeacon can throw on oversized payloads — drop silently.
    }
  }
}

// --- observer hook ------------------------------------------------

// Watches every `[data-feed-anchor]` card under `containerRef` and
// records it once it holds ≥50% visibility for ≥1s. Re-queries when
// the windowed grid mounts more cards (observe() is idempotent),
// unobserves cards once recorded, and disconnects + flushes on
// cleanup.
export function useImpressionObserver(
  containerRef: RefObject<HTMLElement | null>,
  profileId: string
) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof IntersectionObserver === "undefined") {
      return;
    }
    const timers = new Map<Element, ReturnType<typeof setTimeout>>();
    const clearTimer = (el: Element) => {
      const t = timers.get(el);
      if (t !== undefined) {
        clearTimeout(t);
        timers.delete(el);
      }
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const el = entry.target;
          if (
            entry.isIntersecting &&
            entry.intersectionRatio >= VISIBLE_RATIO
          ) {
            if (timers.has(el)) continue;
            timers.set(
              el,
              setTimeout(() => {
                timers.delete(el);
                observer.unobserve(el);
                const id = el.getAttribute("data-feed-anchor");
                if (id && el.isConnected) recordImpression(profileId, id);
              }, DWELL_MS)
            );
          } else {
            clearTimer(el);
          }
        }
      },
      { threshold: VISIBLE_RATIO }
    );

    const observeCards = () => {
      // One storage read per pass, not per card.
      const seen = readSeen(profileId);
      const queue = pending.get(profileId);
      const cards =
        container.querySelectorAll<HTMLElement>("[data-feed-anchor]");
      for (const el of cards) {
        const id = el.getAttribute("data-feed-anchor");
        if (id && !seen.has(id) && !queue?.has(id)) observer.observe(el);
      }
    };
    observeCards();

    // The grid mounts more cards as its window grows (and swaps rows
    // on refresh) — pick up the new ones and drop removed ones.
    const mutations = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.removedNodes) {
          if (node instanceof Element) {
            clearTimer(node);
            observer.unobserve(node);
          }
        }
      }
      observeCards();
    });
    mutations.observe(container, { childList: true });

    const interval = setInterval(
      () => flushImpressions(profileId),
      FLUSH_INTERVAL_MS
    );
    const flushBeacon = () => flushImpressions(profileId, true);
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flushBeacon();
    };
    window.addEventListener("pagehide", flushBeacon);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      clearInterval(interval);
      window.removeEventListener("pagehide", flushBeacon);
      document.removeEventListener(
        "visibilitychange",
        onVisibilityChange
      );
      mutations.disconnect();
      observer.disconnect();
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      flushBeacon();
    };
  }, [containerRef, profileId]);
}
