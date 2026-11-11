# Review: YouTube API layer & channel sync

## Summary

This unit is in good shape: the ingest contract (embeddable-only into
the cache, made-for-kids exempt on vetted surfaces, NULL audience
flags treated as unknown-not-unsafe) is consistently applied, quota
spend is disciplined to 1-unit endpoints in all sync code, and the
backfill is genuinely resumable via `backfillPageToken` checkpointed
per page. The weak spots are at the edges: `/api/sync-channels` is an
unauthenticated mutating endpoint, `getVideoDetails` crashes instead
of returning null on dead videos, `isQuotaError` can itself throw,
`pollChannel` can permanently miss uploads past its 5-page window,
and `QuotaExceededError` is dead code nothing throws.

## Strengths

- Null semantics are correct and consistent: `madeForKids`,
  `ageRestricted`, `hasCaptions` stay `null` when the API omits them
  (`lib/youtube.ts:218-226`), matching the documented
  "NULL = suitable" contract in `lib/video-suitability.ts`.
- `embeddable` defaults to `false` when `status` is absent
  (`lib/youtube.ts:223`) — fail-closed on the one flag that decides
  playability, and `getVideosBatch` drops non-embeddable items
  (`lib/youtube.ts:588`) so unplayable rows never reach the cache.
- `isShort` derivation is honest about its limits — `<=60s` or a
  `#shorts` substring in title/description/tags
  (`lib/youtube.ts:177-185`) — with the 3-minute-Shorts blind spot
  documented in the comment.
- `searchYouTube` filters `madeForKids`/`ageRestricted` *after*
  hydration (`lib/youtube.ts:320-327`), preserving search order and
  documenting that a hydrating-to-empty page with a live token is a
  valid `SearchPage` — the "exhaustion = null token" invariant.
- `backfillChannel` writes `backfillPageToken`/`backfillComplete`/
  `lastSyncAt` after *every* page (`lib/channel-sync.ts:154-166`), so
  an `after()`/serverless kill resumes cleanly; inserts are
  `onConflictDoNothing` so replaying a page is idempotent.
- `isChannelSyncEnabled` is re-checked at the top of every backfill
  page *and* immediately before the pin insert
  (`lib/channel-sync.ts:144, 94`), closing the mid-flight
  unapprove/pause race as far as a non-transactional flow can.
- `syncAllChannels` prefilters muted channels in SQL
  (`lib/channel-sync.ts:243-257`) and correctly works around
  Postgres `ASC NULLS LAST` with an explicit JS resort
  (`lib/channel-sync.ts:259-264`).
- `upsertVideoRows` currently covers every mutable `videos` column —
  verified key-by-key against `videoRowValues`
  (`lib/youtube.ts:241-268`, `lib/video-cache.ts:14-48`; only `id` and
  `createdAt` are excluded, correctly).
- `daily_syncs`'s PK insert is a race-safe dedup lock
  (`app/api/sync-channels/route.ts:11-19`); `DailySyncPing` only
  stores its localStorage key on `res.ok`, so a failed ping retries
  next open (`components/daily-sync-ping.tsx:24-30`).
- `scripts/refresh-videos.ts` is a genuinely solid CLI: typed
  `--missing` column lookup, AND-combined predicates, dry-run
  default path, and `--prune` is honest about cascade effects.

## Issues

1. **med — `getVideoDetails` throws TypeError on missing videos.**
   `lib/youtube.ts:345-346` does `response.data.items[0]` with no
   empty check; for deleted/private/never-existed ids `items` is
   empty, so `mapVideoItem(undefined)` crashes reading `.snippet`.
   `pinVideo` (`app/actions/pinning.ts:40`) doesn't catch — pinning a
   dead id surfaces an opaque server-action 500. `songs.ts:100` and
   `video-preview.tsx:67` do catch, but `getChannelDetails` already
   returns `null` for the identical case (`lib/youtube.ts:395-396`) —
   the two lookup functions have inconsistent contracts.
   Fix: `const item = response.data.items?.[0]; if (!item) return
   null;` and type the return `FullVideoDetails | null`; handle the
   null in `pinVideo` with a user-visible "video not found" path.

2. **med — `/api/sync-channels` is an unauthenticated mutation.**
   `app/api/sync-channels/route.ts:39-46` exports GET and POST with no
   auth; `proxy.ts:168`'s matcher doesn't cover `/api/*`, and the
   path ships in the client bundle via `daily-sync-ping.tsx:24`. The
   `daily_syncs` PK caps damage at one run/day, but an outsider still
   controls *when* the run fires, can force quota spend on days no
   real user opens the app (idle days would otherwise cost zero), and
   GET is trivially triggerable by link crawlers/prefetchers.
   Fix: require a valid session cookie for POST (the ping component
   only mounts on session-gated pages anyway) and gate GET behind
   `Authorization: Bearer ${CRON_SECRET}` — or drop GET entirely.

3. **med — `isQuotaError` can throw inside the catch handler.**
   `lib/channel-sync.ts:32`: when axios gets a 403 with no body,
   `err.response.data` is `undefined`, `JSON.stringify(undefined)`
   returns `undefined` (not a string), and `.includes(...)` throws a
   TypeError — which propagates out of the `catch` in
   `syncAllChannels` (line 276) and kills the run as an unexpected
   error instead of a clean quota abort.
   Fix: `JSON.stringify(err.response.data ?? "")` or, better, check
   `err.response?.data?.error?.errors?.some(e =>
   /quotaExceeded|dailyLimitExceeded/.test(e.reason))`.

4. **med — quota detection misses sibling reasons.**
   Same site (`lib/channel-sync.ts:28-34`): only bodies containing
   `"quotaExceeded"` match. YouTube also returns
   `dailyLimitExceeded` (the actual 10k/day hit), and
   `userRateLimitExceeded` — all 403s that should abort the run the
   same way. A `dailyLimitExceeded` run today would log a generic
   per-channel error and keep trying all 50 channels.
   Fix: match the reason list explicitly (see fix in #3).

5. **med — `pollChannel` permanently misses uploads beyond its
   window.** `lib/channel-sync.ts:191-213`: stop-on-known-id is
   bounded by `MAX_POLL_PAGES_PER_RUN = 5` (~250 ids) and the page
   token is discarded. If >250 uploads land between syncs — or no
   whitelisted id appears in the first 250 for any other reason — the
   ids below the cutoff are never revisited: `backfillComplete` stays
   `true`, so the backfill repair path never runs.
   Fix: when the cap is hit without `hitKnown` and a
   `nextPageToken` remains, persist it as a poll resume cursor
   (reuse `backfillPageToken` with a flag, or add a dedicated
   column) and continue from it next run.

6. **med — `QuotaExceededError` is dead code.**
   Declared at `lib/channel-sync.ts:19`, checked at line 276, thrown
   nowhere — `youtube.ts` surfaces raw axios errors only. It implies
   a typed quota channel that doesn't exist.
   Fix: either delete it, or (better) normalize inside a shared
   YouTube request helper so the class is actually thrown.

7. **low — tombstoned videos don't count as "known" stop markers.**
   `lib/channel-sync.ts:195-201` checks `whitelisted_videos` only. A
   channel whose recent uploads are all unpinned (all tombstoned)
   makes every daily run scan the full 5 pages and hydrate ~250 ids
   via `videos.list` — ~10 wasted quota units/day — before
   `upsertVideosAndWhitelist` filters them out at line 89.
   Fix: union the page's ids against `channel_video_exclusions` for
   the stop condition — a tombstone proves the video was seen.

8. **low — no axios timeout anywhere in `lib/youtube.ts`.**
   Contrast `lib/notify.ts:13` (`AbortSignal.timeout(5000)`). A hung
   googleapis socket stalls a server action or `after()` task until
   the platform kills it; backfill page loops make a hang
   statistically likelier.
   Fix: `axios.create({ timeout: 15000 })` shared instance, or add
   `timeout` per call.

9. **low — `isChannelSyncEnabled` is 3 sequential queries, called
   per page.** `lib/channel-sync.ts:50-69` runs at every backfill
   page top (line 144) *and* inside `upsertVideosAndWhitelist`
   (line 94) — ~6 round trips/page × 40 pages, against a pooled Neon
   connection. The profile row is re-fetched although `parentId` is
   stable for the run.
   Fix: pass `parentId` down from the caller (or replicate
   `syncAllChannels`'s single joined query at lines 243-255) and
   keep just the approval re-check before insert.

10. **low — `refreshVideoIds`'s `missing` conflates two fates.**
    `lib/video-cache.ts:63-71` reports "deleted/private upstream"
    and "returned but non-embeddable" (filtered at
    `lib/youtube.ts:588`) identically. Both callers then delete the
    rows — intended, but pruning also cascade-deletes `songs` rows
    (`schema.ts:89-91`), which the `--prune` doc comment
    (`scripts/refresh-videos.ts:22-26`) doesn't mention.
    Fix: document the songs cascade in the script header; optionally
    have `getVideosBatch` return `{ items, nonEmbeddableIds }` so
    prune can distinguish dead from merely unplayable.

11. **low — `parseIsoDuration` accepts bare `"PT"` → 0.**
    `lib/youtube.ts:168` — all groups optional, so `"PT"` yields 0
    (→ `isShort` via `<=60`), while `"P0D"` (live/upcoming) falls to
    `null` as desired. YouTube doesn't emit bare "PT" today, but the
    regex should require at least one component.
    Fix: guard with `if (!m?.[1] && !m?.[2] && !m?.[3]) return null`
    or tighten the pattern.

12. **low — `reconcile-migration-hashes.ts` hard-fails on pending
    migrations.** Lines 105-111 throw when stored rows ≠ journal
    entries — precisely the state you'd have after adding a new
    migration alongside the drift you're reconciling. Also the usage
    comment (lines 27-31) references `avnadmin` credentials; the DB
    is Neon now — `DATABASE_URL_UNPOOLED` is the equivalent.
    Fix: align the first `min(stored, journal)` rows instead of
    refusing; update the doc comment to the Neon env var.

13. **low — `channelsSynced` overstates work.**
    `app/api/sync-channels/route.ts:31` records `synced` incremented
    for every non-throwing channel (`lib/channel-sync.ts:274`),
    including polls that added 0 videos — the metric reads as
    "channels processed", not "channels that changed".
    Fix: rename or track videos added.

14. **low — `UploadsPage.nextPageToken` typing is inconsistent.**
    `lib/youtube.ts:34` uses `string | undefined` while `SearchPage`
    (line 42) uses `string | null` for the same concept; every caller
    papers over it with `?? undefined`/`?? null`.
    Fix: unify on `string | null`.

15. **low — client/server dedup dates use different clocks.**
    `daily-sync-ping.tsx:7-13` dedups on *local* date;
    `route.ts:9` dedups on UTC. Around midnight a device pings twice
    (harmless — server dedups) or skips a day the server would have
    accepted. Cosmetic, but undocumented.
    Fix: compute `today` as `new Date().toISOString().slice(0,10)`
    client-side to match the server's UTC day.

16. **low — `test-foryou-paging.ts` crashes on an empty `profiles`
    table** (`top.name`, line 19) and does an N+1 title lookup per
    affinity row (lines 36-42). Ad-hoc script, but a two-line guard
    and one `inArray` join would make it safer to hand to others.

## Refactor suggestions

1. Extract a shared `ytGet(path, params)` helper in `lib/youtube.ts`:
   one place for `BASE_URL`, the `API_KEY` guard (currently repeated
   8×), a 15 s `timeout`, and normalization of axios 403/429 bodies
   into `QuotaExceededError`. Then `isQuotaError` moves next to the
   class and every caller gets quota detection for free.
2. Return `FullVideoDetails | null` from `getVideoDetails` (matching
   `getChannelDetails`) and thread the null through `pinVideo`,
   `songs.ts`, `video-preview.tsx`.
3. Auth-gate `/api/sync-channels` (issue #2): session check for
   POST, `CRON_SECRET` bearer or removal for GET.
4. Give `pollChannel` a persisted resume cursor (issue #5) and count
   tombstones as known-stop markers (issue #7) in the same pass.
5. Make `upsertVideoRows`'s `set` map exhaustive by construction —
   derive it from `videoRowValues`'s keys via a typed
   `Record<keyof ReturnType<typeof videoRowValues>, SQL>` or add a
   `getTableColumns(videos)` assertion so a new column can't ship
   insert-only. The two lists currently agree; nothing enforces it.
6. Replace the `asc()` + JS resort in `syncAllChannels`
   (`lib/channel-sync.ts:256-264`) with
   `ORDER BY last_sync_at ASC NULLS FIRST` via `sql` — one ordering,
   no dead SQL sort.
7. Split `RefreshResult.missing` into `notFound` vs `nonEmbeddable`
   (issue #10) so prune semantics are honest per row.
8. Cache the caller's `parentId` for the run and collapse
   `isChannelSyncEnabled`'s three lookups into the joined query
   `syncAllChannels` already writes (issue #9).
9. Unify page-token nullability on `string | null` across
   `UploadsPage`/`SearchPage` (issue #14).
10. Merge `isQuotaError`'s reason set to
    `quotaExceeded|dailyLimitExceeded|userRateLimitExceeded` and
    treat 429 the same way (issues #3, #4).
