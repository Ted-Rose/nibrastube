# Plan: Kids feed memory — restore position & order after watching
**Status: not implemented**
Feature branch: `feature/feed-memory`.

## Goal

When a kid taps a video card, watches, and returns to the feed ("Back
to Videos" button, browser back, or Android back), the feed should be
exactly where they left it:

- same list order (a just-watched video does NOT jump to the bottom of
  the default `sort=status` "Not watched" ordering; For-You does NOT
  re-rank it away),
- same loaded depth (windowed "Show more" cards and For-You
  `loadMore` pages stay mounted),
- same scroll position — focused on the tapped card, not the top.

Same freeze applies mid-browse: a `router.refresh()` from
`PusherListener` must not reorder or collapse the grid under the kid.

## Current behavior (why it breaks)

- `WatchExperience`'s Back button is `<Link href={portalUrl}>` — a
  push navigation; Next scrolls to top on every push.
- `KidsVideoGrid` mounts only `PAGE_SIZE = 48` cards, so even native
  popstate scroll restoration clamps when the kid was deeper.
- `getKidsVideos` `sort=status` (the default) demotes videos as soon
  as `watch_progress` lands; `getRecommendedVideos` re-ranks on the
  kid's own watch signals — so a refetched feed literally reorders.
- On new `initialRows` (refresh/remount), `KidsVideoGrid` resets
  `rows`/`visible` wholesale — collapsing mounted depth and applying
  the new order.
- Helpful fact: in-player advance/swipe already uses
  `history.replaceState`, so feed→watch is always ONE history entry —
  `router.back()` reliably returns to the feed.

## Design

A per-feed snapshot store in `sessionStorage`, keyed
`nt:feed:${profileId}:${feedQuery}` — `feedQuery` already encodes
view + channel + playlist + date + sort + dir + type + min/max + q, so
every surface (All videos, For You, Shorts, Liked, channel drill-ins,
playlist details, searches) gets its own entry automatically. A
deliberate sort/filter/tab change produces a different key → fresh
server order → correct.

### Snapshot shape

```ts
{
  savedAt: number;            // Date.now()
  scrollY: number;
  anchorVideoId: string | null; // card tapped to enter the player
  visible: number;            // mounted window size
  offset: number;             // loadMore fetch offset
  orderIds: string[];         // non-paged grids: ordering only
  rows: FeedRow[] | null;     // paged grids (loadMore): full rows
}
```

- **Non-paged grids** store `orderIds` only — fresh `initialRows` is
  the full list anyway; reorder it to `orderIds`. This keeps snapshots
  ~10x smaller AND honors unpins instantly (a removed id drops out);
  genuinely new ids append at the end in server order.
- **Paged grids** (`loadMore` prop set — For-You, Shorts) store the
  full `rows` (pages 2+ cannot be refetched for free). Restore rows
  verbatim, then patch `progress`/`reaction`/`video` fields in place
  from fresh `initialRows` for matching ids — order untouched.
- **TTL:** ignore snapshots older than 2h OR from a different calendar
  day (For-You reseeds its daily `md5` shuffle at midnight).
- **Fail-open everywhere:** missing/corrupt/quota-exceeded → normal
  server-rendered feed, identical to today. Wrap `setItem`/`getItem`
  in try/catch; cap entry count with simple oldest-first eviction.

### Writes

Throttled scroll listener (~300–500ms) + on card-link click
(capture-phase records `anchorVideoId` + final `scrollY`) + unmount
cleanup. One small client helper module (e.g.
`lib/feed-memory.ts`) owns read/write/evict so the logic is testable
and shared.

### Restore

On mount, if a fresh snapshot exists for the key:

1. Rebuild `rows` (non-paged: reorder fresh rows by `orderIds`,
   update fields from fresh data; paged: verbatim + in-place patch).
2. Set `visible`/`offset` to the saved values so the page is tall
   enough to contain the saved scroll (the one-time extra mount cost
   of a larger window is acceptable; thumbnails reserve `aspect-video`
   height so pixel offsets are stable before images load).
3. `useLayoutEffect`: `scrollIntoView({ block: "center" })` on the
   anchor card — needs a stable DOM handle, e.g.
   `data-feed-anchor={video.id}` on the card wrapper (grid cards only,
   matching the existing `vt` rule) — fallback `scrollTo(0, scrollY)`.
4. Re-assert once ~400ms later (late-streaming `HomeShelves` Suspense
   content above the grid can shift offsets, and Next's own popstate
   scroll restoration races us) — CANCELLED if any `wheel`,
   `touchmove`, or `keydown` arrived in between (user already took
   over scrolling).

### Refresh merge (fix B)

Replace the current `initialRows` hard-reset: when `feedQuery` is
unchanged but `initialRows` identity changed (pusher refresh, back-nav
refetch), run the same merge — keep current order, patch per-id
fields, append new ids at end, drop missing ids (non-paged). When
`feedQuery` changed (real sort/filter change) keep the existing full
reset — a deliberate re-sort must reorder.

### Back button → `router.back()`

- A tiny listener (capture-phase `click` on `document`, registered by
  a client component on the kids portal page — e.g. alongside
  `PusherListener`) sets `nt:watchFrom = 1` in sessionStorage when the
  click target is inside `a[href*="/watch/"]`. Covers grid cards,
  shelf cards and history rows with zero per-card plumbing.
- `WatchExperience` Back button: if `nt:watchFrom` is set →
  `router.back()` (real popstate: native scroll restoration + no
  history-stack growth, and it fixes the shelf→back→wrong-tab quirk).
  Otherwise → `router.push(portalUrl)` (deep-linked watch page: fresh
  tabs have empty sessionStorage, so it can't exit the app).
- Marker needs no clearing: it's only ever set by a card tap, and
  `back()` landing on the feed is always a sane destination.

### History view

`HistoryView` gets scroll-restore only (same store + scrollY + its
expanded-days `Set`) — NO order freeze; chronological re-sort is the
point of that tab.

### Non-goals

- Shelf row contents/order are server-rendered and may change on
  return ("Continue watching" gains the watched video) — accepted; the
  anchor-card scroll absorbs the shift.
- No freeze for tile pages (channels/playlists tabs) — watching never
  reorders tiles; plain scroll restore is out of scope.
- Horizontal (within-shelf) scroll is not preserved.
- Liked-tab membership freezes for the session: an unliked video stays
  visible until next refresh/expiry — deliberate (nothing vanishes
  under the kid's finger).

## Files touched (expected)

- `lib/feed-memory.ts` — NEW: snapshot type, read/write/evict,
  merge helpers, `nt:watchFrom` marker + click tracker.
- `components/kids-video-grid.tsx` — snapshot hydrate/save,
  merge-on-refresh, anchor scroll restore.
- `components/video-card.tsx` — `data-feed-anchor` attr on the
  wrapper when `vt` is set.
- `components/history-view.tsx` — scroll + expanded-days restore.
- `components/watch-experience.tsx` — back button → guarded
  `router.back()`.
- `app/kids/[profileId]/page.tsx` — mount the click tracker (may
  fold into `PusherListener` or a new tiny client component).

## Verification

`npm run typecheck && npm run lint` (79-char limit). Manual UI
walkthrough on :3100:

1. Videos tab: scroll ~2 screens, tap a card, back → same spot, same
   order, watched card shows its new progress bar in its old slot.
2. Repeat with browser/Android back.
3. For-You tab: "Show more" once, open a video, back → appended page
   still mounted, same scroll.
4. While browsing, trigger a pusher event (pin/unpin on the parent
   dashboard on another device) → grid updates data without
   reordering or collapsing.
5. Change a sort chip → fresh order (snapshot correctly ignored).
6. Shelf card → watch → back → returns to home (not the shelf's tab).
