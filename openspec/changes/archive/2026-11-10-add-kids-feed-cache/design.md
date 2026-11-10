# Design

## Context

Every kids feed/watch read is a fresh Drizzle query against a
cross-region Neon database (~90-100ms RTT per query on Vercel),
with 3-6 serial queries per navigation and no caching anywhere.
The watch page additionally runs an unbounded feed query to build
its autoplay queue. The whitelist-safety invariant depends on
removals taking effect promptly, so the cache layer must
invalidate on every content mutation. See proposal.md.

## Goals / Non-Goals

**Goals:**

- Sub-~300ms repeat navigations via a 10-minute SWR data cache
- Instant tab/sort revisits via the client router cache
- Shorter tap-to-play: warm YouTube API + prefetched watch routes
- Removal safety: mutations bust the profile's cache globally

**Non-Goals:**

- Caching `getRecommendedVideos` or watch progress (stay live)
- Rendered-page/HTML caching, ISR, `cacheComponents`/PPR
- Windowing the watch-queue query, DB transport swap, Vercel
  region pinning (tracked separately)

## Decisions

### Cache the query layer, not rendered pages

Wrap the `lib/kids-feed.ts` read functions in `unstable_cache`
rather than caching page output. Feed rows are shared across
viewers of a profile while the rendered chrome differs by session
(kid vs parent), so page-level caching would leak personalization.
Query-level caching keeps rendering per-request and collapses
only the DB cost. `unstable_cache` over `"use cache"` because it
works without enabling `cacheComponents`, which is a larger
refactor.

Alternatives considered: Full Route Cache / ISR — rejected (per-
session output, auth-cookie pages). React `cache()` — per-request
only, no cross-request benefit.

### Tag scheme: one tag per profile

All cached reads for a profile carry tag `feed:<profileId>`.
Mutations call `revalidateTag("feed:<profileId>")` next to their
existing `revalidatePath` call — one line per call site, works
across all devices (the data cache is shared per deployment).
`revalidatePath` alone does not reliably bust `unstable_cache`
entries, so the tag call is mandatory, not optional.

### Split watch progress out of cached rows

Today `progressSeconds` is joined inside the feed queries, so a
10-minute cache would freeze resume positions. Cache the
whitelist+video+channel join only; run a separate live query for
`watchProgress` rows for the profile and merge by videoId in
code. Cost: one cheap indexed query per navigation vs. stale
resume — correct trade.

### TTL and client router cache

`revalidate: 600` (10 min) on cached reads — the user accepted
this window; mutations shrink the effective staleness to zero
anyway via tags. `staleTimes.dynamic = 300` (5 min) so repeat
navigations within a session skip the server entirely; Pusher
`router.refresh()` always bypasses it.

### Never-cached reads

`getRecommendedVideos` (daily md5 re-rank, forbidden by
`docs/recommendation-algorithm.md`), `canViewProfile`/
`assertCanManageProfile` (auth must be fresh and is 1 cheap
query), the live `watchProgress` overlay, and all
`/parent/*` reads (low traffic, vetting accuracy matters).

### Watch-startup warm-up

- Call `ensureYouTubeAPI(() => {})` once when the kids feed
  mounts, so `iframe_api` + `window.YT` are ready before the tap
- `<link rel="preconnect">` for `https://www.youtube.com` and
  `https://i.ytimg.com` in the kids layout head
- `router.prefetch(watchHref)` on video-card `onPointerDown` —
  overlaps the server round trip with the press; no prefetch of
  all 48 cards (too chatty)

## Risks / Trade-offs

- [A missed `revalidateTag` leaves removed content servable for
  up to 10 min — a safety regression] → spec makes tag
  invalidation a hard requirement; reviewer checklist enumerates
  every mutation site; centralized `invalidateProfileFeed()`
  helper so future mutations can't forget the tag
- [Cached feed hides new channel-sync videos up to 10 min] →
  `syncAllChannels`/`backfillChannel`/`pollChannel` invalidate
  the tag when they insert pins
- [Progress merge drifts from row shape] → merge happens in the
  existing view layer with a typed map; `getKidsVideos` keeps its
  signature by accepting the progress overlay
- [`unstable_cache` entries persist across deploys on Vercel] →
  keys include query params; a query-shape change naturally
  misses old entries; worst case is stale rows until TTL
- [Cache adds infra complexity for ~1 family of users] →
  accepted; the perceived-latency win is the point of the change
