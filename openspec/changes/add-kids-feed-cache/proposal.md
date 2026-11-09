# Proposal

## Why

Every navigation in the kids portal and to the watch page pays a
full server round trip with multiple serial Postgres queries
(cross-region RTT to Neon), so each click blocks ~1s+ before paint
— and tapping a video additionally waits on a fresh YouTube IFrame
API bootstrap. None of the feed data is cached at any layer, so
repeat visits re-run identical queries.

## What Changes

- Add a stale-while-revalidate data cache over the kids feed and
  watch-queue read queries (`unstable_cache`, ~10 minute TTL),
  keyed by profile + query params, tagged per profile so mutations
  invalidate it globally.
- Split `watchProgress` (resume position) out of the cached rows —
  it is fetched live and merged per request so resume and progress
  bars never go stale.
- Add `revalidateTag` alongside existing `revalidatePath` calls in
  every mutation that changes what a profile's feed/watch page can
  contain: pin/unpin, channel approve/un-approve, reactions,
  channel sync inserts, profile changes.
- Set `staleTimes.dynamic` in next.config so repeat visits and
  tab/sort switches within a few minutes serve the client router
  cache instead of a fresh RSC fetch.
- Reduce watch-startup latency: pre-warm the YouTube IFrame API
  while the kid browses the feed, prefetch the watch route on card
  pointer-down, and add `preconnect` hints for YouTube origins.

Non-goals: caching `getRecommendedVideos` (daily re-rank must stay
live), caching rendered pages/HTML, an SPA rewrite, windowing the
watch-queue query (separate change).

## Capabilities

### New Capabilities

- `feed-data-cache`: server-side SWR caching of kids feed/watch
  read paths with per-profile tag invalidation, freshness
  exclusions (recommendations, watch progress), client router
  cache tuning, and watch-page startup warm-up behavior.

### Modified Capabilities

- `whitelist-content`: the live-removal guarantee now extends to
  the cache layer — an unpin/block/un-approve MUST invalidate
  cached feed data so a removed video cannot be served to an open
  session beyond the mutation round trip.

## Impact

- `lib/kids-feed.ts` — query split (progress overlay vs cached
  rows) + `unstable_cache` wrappers with cache tags
- `app/kids/[profileId]/page.tsx`, `.../watch/[videoId]/page.tsx`,
  `app/kids/[profileId]/_components/*` — read through the cached
  functions, merge live progress
- `app/actions/*` (pinning, channels, playlists, safety, profiles,
  songs), `app/api/video-reactions/route.ts`, `lib/channel-sync.ts`
  — `revalidateTag` on the profile's feed tag
- `next.config.mjs` — `staleTimes.dynamic`
- `components/video-card.tsx` / kids feed surfaces — pointer-down
  prefetch of watch routes; `lib/yt-player.ts` warm-up call from
  the feed; `preconnect` hints in the kids layout/head

Whitelist-safety impact: the change affects what a kid can *see*
only insofar as staleness — mitigated by tag invalidation on every
content mutation, which is spec'd as a hard requirement. The query
results themselves are unchanged; no whitelist filtering moves.
