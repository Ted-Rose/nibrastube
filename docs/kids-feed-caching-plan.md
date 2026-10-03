# Kids Feed Caching & Instant-Navigation Plan

Goal: make switching between the profile picker, a kid's video grid, the
watch page, and back feel instant — render cached data immediately,
then reconcile with the server (stale-while-revalidate).

## Why navigation is slow today

1. **Every navigation is a full server round trip.** `/kids`,
   `/kids/[profileId]`, and `/kids/[profileId]/watch/[videoId]` are all
   dynamic (they read `cookies()` and `searchParams`), so Next.js serves
   them with `staleTime: 0` — the client Router Cache is never reused on
   forward navigation. Each click re-runs the whole server component:
   session decrypt + `canViewProfile`/`assertCanManageProfile` + profile
   row + 2–4 feed queries + RSC serialization.
2. **The payload is unbounded.** `getKidsVideos` returns *every*
   whitelisted video (all columns of `videos`, plus `watch_progress`
   and `video_reactions` joins). A large whitelist serializes hundreds
   of rows into every RSC response — and the watch page re-queries the
   *same full list* to build the autoplay playlist.
3. **Same-route param switches refetch everything.** Tabs, sort
   changes, and search are URL changes (`?view=`, `?sort=`, `?q=`).
   Each is a distinct Router Cache entry → another full round trip,
   even though the underlying rows are identical, just re-ordered or
   filtered.
4. **No client-side memory of the feed.** Leaving the watch page
   rebuilds the grid from scratch even though nothing changed.

PRs #19/#20/#22 (skeletons + spinners) made the wait *visible*; this
plan makes it *short or absent*.

## Design constraints

- **Whitelist stays absolute.** A stale grid may briefly show a just-
  unpinned thumbnail, but playback is still gated server-side (the
  watch page redirects non-whitelisted videoIds and the player snaps
  back). Caching never weakens this.
- **Freshness signal already exists.** Mutating actions call
  `revalidatePath`, and Pusher `profile-<id>` events drive
  `router.refresh()` on other devices. Any cache we add plugs into the
  same invalidation, not a parallel one.
- **Two data speeds.** Video metadata (title, thumbnail, channel) is
  written only by pin/unpin/channel-sync — safe to cache. Watch
  progress is written every ~10s by beacons and feeds `sort=status` —
  it must either stay uncached or invalidate cheaply (beacons firing
  `revalidateTag` every 10s would keep a monolithic cache permanently
  cold).

## Options

### A. Router Cache TTL — `staleTimes` (hours, keep)

```js
// next.config.mjs
experimental: { staleTimes: { dynamic: 30 } }
```

Re-visits within 30s serve the cached RSC payload instantly. Free, but
only helps revisits of identical URLs — not first visits, and a stale
entry can outlive a pin/unpin on *this* device until the router cache
is purged (Pusher `router.refresh()` and `revalidatePath` handle that
for the current page and data respectively). A modest TTL is still
worth it.

### B. Server-side data cache — `"use cache"` / `unstable_cache` (day)

Next 16 supports `"use cache"` + `cacheTag`/`cacheLife`
(`cacheComponents` flag, or `unstable_cache` without the flag). Split
the feed query in two:

- `getWhitelistedVideoRows(profileId)` — `whitelisted_videos ⋈ videos`
  only, cached with tag `feed:<profileId>`. Slow-changing; exactly the
  metadata the user asked to cache (ids, titles, thumbnails, channel).
- Per-request joins for `watch_progress` + `video_reactions` — cheap
  single-table lookups by `(profileId, videoId)…`, always fresh, so
  `sort=status` is correct and beacons never thrash the hot cache.

Invalidate `feed:<profileId>` in `pinning.ts`, `channels.ts` (pin/
unpin/approve/unapprove), the channel-sync writer, and
`api/video-reactions` only if reaction affects cached rows (it joins,
so no). Result: server work per navigation drops to a session check +
two small queries even for cold router cache.

### C. Client-side SWR feed — the actual ask (2–3 days)

Keep the server component for auth + profile header; move the grid to
a client `<FeedGrid>` backed by a route handler:

- `GET /api/kids/[profileId]/feed?view=&channel=&sort=&dir=&q=&cursor=`
  returns JSON rows `{video, progress, reaction}` (reuse
  `lib/kids-feed` queries; guard with `canViewProfile`).
- A module-level `Map<key, rows>` (+ optional `sessionStorage`
  persistence for cold-start instant paint) feeds `useSWR`-style
  logic: on mount/param change, render `cache.get(key)` instantly if
  present, fetch in background, diff-update the grid.
- `PusherListener` calls `mutate(key)` instead of `router.refresh()` —
  reuses the same invalidation channel.
- Bonus: with the full (or first-N) rows in memory, `sort`/`dir`
  switches and `q` filtering can run **client-side with zero network**
  — the most common navigation becomes truly instant.

This is the only option that literally implements "render cached,
then update from server". It also removes the RSC-payload tax for
param switches.

### D. Bound the payload — first ~20 rows + "load more" (day)

Regardless of caching: `LIMIT 24` on feed queries (+ keyset/offset
cursor) caps every response. The watch page needs only the playlist
window around `currentIndex`, not all rows. Pair with `next/image`
for thumbnails if we want optimization (YouTube thumbs are already
CDN'd — low priority).

### E. Prefetch audit (hours)

`<Link>` prefetching is effectively off for dynamic pages; explicit
`prefetch` on the highest-traffic links (grid → watch, watch → back)
plus `router.prefetch()` on hover for tabs would warm the Router
Cache in option A's world — mostly redundant once C lands.

## Recommended path

1. **Now (config):** `staleTimes.dynamic: 30` + first-24 `LIMIT` on
   feed queries. Instant revisits, bounded payloads, ~1 file each.
2. **Next:** server-side `"use cache"` on the whitelist⋈videos rows
   tagged `feed:<profileId>`; wire `revalidateTag` into the four
   mutating actions + channel sync. Progress/reaction joins stay
   uncached.
3. **Then:** client SWR grid (option C) — instant param switches and
   SWR on every revisit; `PusherListener` → `mutate`. Defer
   `sessionStorage` persistence until the in-memory version proves
   out.

Steps 1–2 alone should cut most waits to sub-second; step 3 makes
repeat navigation feel local.

## Risks

- **Stale unpin leak (cosmetic):** a cached grid can show a video the
  parent just removed until revalidation lands. Playback still
  redirects — acceptable; keep TTLs small and Pusher revalidation.
- **Progress staleness in `sort=status`:** if progress joins were
  cached, a just-finished video would linger in "not watched". Split
  the query (option B) so only slow data is cached.
- **Cache key space:** `(profileId, view, channel, sort, dir, q)` —
  searches fan out; cap `q` caching or handle search client-side
  (option C).
- **Double invalidation paths:** `revalidateTag` (server) and Pusher
  `mutate` (client) must both fire on mutation — keep them adjacent in
  the same actions to avoid drift.

## Verification

- Throttle to "Slow 3G" + remote DB latency; time `/kids` →
  `/kids/<id>` → watch → back before/after.
- Pin/unpin on device A → confirm device B's grid updates via Pusher
  (already manual-testable through the UI).
- After `sort=status` switch and a completed video, confirm ordering
  updates on next nav (progress freshness).
- `npm run typecheck` + `npm run lint` per phase.
