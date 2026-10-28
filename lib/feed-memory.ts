// Kids feed memory — when a kid leaves a feed to watch a video and
// comes back ("Back to Videos", browser back, Android back), the feed
// should be exactly where they left it: same list order (a
// just-watched video must not demote itself to the bottom of the
// default "Not watched" sort, and For You must not re-rank it away),
// same loaded depth ("Show more" windows and For-You pages stay
// mounted), same scroll position — focused on the tapped card, not
// the top. The same freeze applies mid-browse: a pusher-driven
// router.refresh() must not reorder or collapse the grid under the
// kid.
//
// Snapshots live in sessionStorage keyed by profile + the full feed
// query (view/channel/list/date/sort/dir/type/min/max/q), so every
// surface — All videos, For You, Shorts, Liked, channel drill-ins,
// searches — gets its own entry automatically, and a deliberate
// sort/filter/tab change produces a different key → fresh server
// order. Everything fails open: unavailable or corrupt storage
// degrades to today's plain server-rendered feed.

import { useEffect, useRef } from "react";
import type { FeedRow } from "@/components/kids-video-grid";

const STORAGE_PREFIX = "nt:feed:";
const INDEX_KEY = "nt:feed:index";
const WATCH_FROM_KEY = "nt:watchFrom";
const MAX_SNAPSHOTS = 20;
// 2h TTL, and never across midnight: For-You reseeds its daily md5
// shuffle each day, so yesterday's ranking must not be restored.
const TTL_MS = 2 * 60 * 60 * 1000;

export interface FeedSnapshot {
  savedAt: number; // Date.now()
  scrollY: number;
  // Card tapped to enter the player — the scrollIntoView target on
  // return; null when the kid left without tapping a card.
  anchorVideoId: string | null;
  // Mounted window size + loadMore fetch offset — restoring both
  // makes the page tall enough to contain the saved scroll position.
  visible: number;
  offset: number;
  // Non-paged grids store ordering only (~10x smaller): fresh rows
  // are re-sorted to match, so unpins drop out instantly and
  // genuinely new ids append at the end in server order.
  orderIds: string[];
  // Paged grids (loadMore set — For You, Shorts) store the full rows:
  // pages 2+ cannot be refetched for free. null on non-paged grids.
  rows: FeedRow[] | null;
  // History tab only: watchedOn keys of the expanded day sections.
  expandedDays?: string[];
}

export function feedSnapshotKey(profileId: string, feedQuery: string) {
  return `${STORAGE_PREFIX}${profileId}:${feedQuery}`;
}

function isFresh(savedAt: number) {
  if (Date.now() - savedAt > TTL_MS) return false;
  const then = new Date(savedAt);
  const now = new Date();
  return (
    then.getFullYear() === now.getFullYear() &&
    then.getMonth() === now.getMonth() &&
    then.getDate() === now.getDate()
  );
}

// Stored JSON is untrusted: `rows: ["x"]` satisfies Array.isArray but
// patchRows then dereferences row.video.id and crashes the mount
// layout effect — element shapes are checked so corruption fails open.
function isFeedRow(value: unknown): value is FeedRow {
  if (!value || typeof value !== "object") return false;
  const row = value as FeedRow;
  return (
    !!row.video &&
    typeof row.video === "object" &&
    typeof row.video.id === "string"
  );
}

function isSnapshot(value: unknown): value is FeedSnapshot {
  if (!value || typeof value !== "object") return false;
  const snap = value as FeedSnapshot;
  // Number.isFinite (not typeof) so a corrupt entry like
  // `visible: "x"` fails closed instead of NaN-ing the window math.
  return (
    Number.isFinite(snap.savedAt) &&
    Number.isFinite(snap.scrollY) &&
    Number.isFinite(snap.visible) &&
    Number.isFinite(snap.offset) &&
    (snap.anchorVideoId === null ||
      typeof snap.anchorVideoId === "string") &&
    Array.isArray(snap.orderIds) &&
    snap.orderIds.every((id) => typeof id === "string") &&
    (snap.rows === null ||
      (Array.isArray(snap.rows) && snap.rows.every(isFeedRow))) &&
    (snap.expandedDays === undefined ||
      (Array.isArray(snap.expandedDays) &&
        snap.expandedDays.every((day) => typeof day === "string")))
  );
}

// Read the snapshot for a key — null when absent, corrupt, or stale.
// Stale/corrupt entries are removed so they can't crowd the cap.
export function readFeedSnapshot(key: string): FeedSnapshot | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const snap: unknown = JSON.parse(raw);
    if (!isSnapshot(snap) || !isFresh(snap.savedAt)) {
      sessionStorage.removeItem(key);
      return null;
    }
    return snap;
  } catch {
    return null;
  }
}

// The index maps key → savedAt so eviction never has to parse the
// (potentially large) snapshots themselves.
function readIndex(): Record<string, number> {
  try {
    const parsed: unknown = JSON.parse(
      sessionStorage.getItem(INDEX_KEY) ?? "{}"
    );
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, number>;
  } catch {
    return {};
  }
}

export function writeFeedSnapshot(key: string, snap: FeedSnapshot) {
  try {
    sessionStorage.setItem(key, JSON.stringify(snap));
    const index = readIndex();
    index[key] = snap.savedAt;
    for (const k of Object.keys(index)) {
      // Entries evicted by quota pressure or manual clears must not
      // crowd out live ones.
      if (sessionStorage.getItem(k) === null) delete index[k];
    }
    const keys = Object.keys(index);
    if (keys.length > MAX_SNAPSHOTS) {
      keys.sort((a, b) => index[a] - index[b]);
      for (const old of keys.slice(0, keys.length - MAX_SNAPSHOTS)) {
        sessionStorage.removeItem(old);
        delete index[old];
      }
    }
    sessionStorage.setItem(INDEX_KEY, JSON.stringify(index));
  } catch {
    // Quota exceeded / storage disabled — memory is best-effort, the
    // feed works fine without it.
  }
}

// Non-paged merge (snapshot restore AND pusher-refresh): reorder the
// fresh complete list by the saved/current id order — ids still
// present keep their slots with FRESH row data, vanished ids drop out
// (unpins are honored instantly), new ids append at the end in server
// order.
export function reorderRows(
  fresh: FeedRow[],
  orderIds: string[]
): FeedRow[] {
  const byId = new Map(fresh.map((row) => [row.video.id, row]));
  const used = new Set<string>();
  const out: FeedRow[] = [];
  for (const id of orderIds) {
    const row = byId.get(id);
    if (row && !used.has(id)) {
      out.push(row);
      used.add(id);
    }
  }
  for (const row of fresh) {
    if (!used.has(row.video.id)) out.push(row);
  }
  return out;
}

// Paged merge (snapshot restore AND pusher-refresh): `saved` is the
// frozen order and may hold deeper pages the fresh first page can't
// cover — keep it verbatim, patching video/progress/reaction in place
// for ids the fresh data knows. Fresh ids never seen before append at
// the end.
export function patchRows(
  saved: FeedRow[],
  fresh: FeedRow[]
): FeedRow[] {
  const byId = new Map(fresh.map((row) => [row.video.id, row]));
  const known = new Set(saved.map((row) => row.video.id));
  const out = saved.map((row) => {
    const f = byId.get(row.video.id);
    return f
      ? { ...row, video: f.video, progress: f.progress, reaction: f.reaction }
      : row;
  });
  for (const row of fresh) {
    if (!known.has(row.video.id)) out.push(row);
  }
  return out;
}

// "Entered watch from a feed card" marker — set by WatchFromTracker's
// capture-phase listener on any /watch/ link tap, consumed by the
// watch page's Back button: set → router.back() (a real popstate —
// native scroll restoration, no history-stack growth; in-player
// advance already replaceStates, so feed→watch is always ONE entry),
// unset → router.push(portalUrl) since a deep-linked watch page in a
// fresh tab has empty sessionStorage and back() could exit the app.
export function markWatchFrom() {
  try {
    sessionStorage.setItem(WATCH_FROM_KEY, "1");
  } catch {
    // Storage disabled — Back falls back to push, which is safe.
  }
}

export function takeWatchFrom(): boolean {
  try {
    if (sessionStorage.getItem(WATCH_FROM_KEY) === null) return false;
    sessionStorage.removeItem(WATCH_FROM_KEY);
    return true;
  } catch {
    return false;
  }
}

// Timestamp of the most recent scroll-gesture input, tracked from
// module load: restoreFeedScroll's own cancel listeners attach too
// late to see a gesture that began before them (e.g. the kid already
// scrolling while the grid was still behind a Suspense fallback).
// Taps don't register — wheel/touchmove/keydown only, same set the
// restore cancels on.
let lastInputAt = 0;
if (typeof window !== "undefined") {
  const seenInput = () => {
    lastInputAt = Date.now();
  };
  window.addEventListener("wheel", seenInput, { passive: true });
  window.addEventListener("touchmove", seenInput, { passive: true });
  window.addEventListener("keydown", seenInput);
}

// Scroll the tapped card back to center (fallback: the raw saved
// scrollY), then re-assert once ~400ms later — late-streaming
// Suspense shelves above the grid and Next's own popstate scroll
// restoration can still shift the offset. The cancel listeners
// attach BEFORE the first scroll, and the initial scroll is skipped
// when input was seen in the last 300ms — a gesture started while
// the grid still sat behind a Suspense fallback must not get yanked
// mid-scroll (the re-assert still lands the restore once input
// stops). Any later input cancels the re-assert. Returns a disposer
// for unmount.
export function restoreFeedScroll(snap: FeedSnapshot): () => void {
  const scroll = () => {
    if (snap.anchorVideoId) {
      const el = document.querySelector(
        `[data-feed-anchor="${CSS.escape(snap.anchorVideoId)}"]`
      );
      if (el) {
        el.scrollIntoView({ block: "center" });
        return;
      }
    }
    window.scrollTo(0, snap.scrollY);
  };
  const cancel = () => detach();
  function detach() {
    clearTimeout(timer);
    window.removeEventListener("wheel", cancel);
    window.removeEventListener("touchmove", cancel);
    window.removeEventListener("keydown", cancel);
  }
  window.addEventListener("wheel", cancel, { passive: true });
  window.addEventListener("touchmove", cancel, { passive: true });
  window.addEventListener("keydown", cancel);
  if (Date.now() - lastInputAt > 300) scroll();
  const timer = setTimeout(() => {
    detach();
    scroll();
  }, 400);
  return detach;
}

// Shared snapshot-writer subscription for the feed surfaces: a
// ~400ms-throttled scroll listener plus an unmount flush. `write` is
// read through a ref so the listener never goes stale, and the
// unmount flush uses the last OBSERVED scrollY — a route change can
// reset the live scrollY before the cleanup runs. `key` must be the
// feedQuery the snapshot is stored under: an in-place feedQuery
// change does NOT remount the grid, so without keying, a pending
// throttled write or the cleanup flush would land the old feed's
// scrollY/rows under the new feed's key (or clobber the old feed's
// saved position with a nav-reset scrollY of 0). On a key change the
// old listener's cleanup runs BEFORE writeRef is swapped to the new
// render's saveSnapshot — the pending timer dies and the flush still
// writes under the OUTGOING key.
export function useFeedSaver(
  write: (scrollY: number) => void,
  key: string
) {
  const writeRef = useRef(write);
  useEffect(() => {
    writeRef.current = write;
  });
  useEffect(() => {
    let lastY = window.scrollY;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onScroll = () => {
      lastY = window.scrollY;
      if (timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        writeRef.current(lastY);
      }, 400);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (timer !== null) clearTimeout(timer);
      // lastY === 0 is a nav-clamp artifact (the incoming tree resets
      // scroll before this cleanup runs) — or a true top-of-feed
      // exit, whose restore is a no-op anyway. Either way it must
      // not clobber the last real scrollY.
      if (lastY > 0) writeRef.current(lastY);
    };
  }, [key]);
}
