# Proposal

## Why

Distilled from `docs/plans/architecture-refactor-plan.md` phase 4
(master plan W6; OVERALL #7, #8, #10, #11, #29, #30, #31 +
`youtube-sync` report #7) — still open on `main`: `getVideoDetails`
crashes on dead ids (opaque 500 on pin), unplayable
`embeddable:false` videos can be pinned or imported as songs,
manually-unpinned videos on approved channels resurrect at the
next sync, re-approving a channel re-backfills from page 1,
`pollChannel` permanently misses uploads past its 5-page window,
tombstones don't count as known-stop markers (~10 wasted quota
units/day), `isQuotaError` can itself throw, and no YouTube call
has a timeout.

## What Changes

- Shared `ytGet(path, params)` in `lib/youtube.ts` — owns
  `BASE_URL`, the API-key guard (repeated 8× today) and a 15 s
  axios timeout; normalizes 403/429 quota bodies
  (`quotaExceeded | dailyLimitExceeded | userRateLimitExceeded`)
  into a thrown `QuotaExceededError` (moved out of
  `channel-sync.ts`, where it is declared but never thrown).
- `getVideoDetails` returns `FullVideoDetails | null` on empty
  `items` (matching `getChannelDetails`); `pinVideo` surfaces a
  friendly "video not found" instead of a 500.
- Ingest refusal: `embeddable !== true` rejected on the two paths
  that bypass `getVideosBatch`'s filter — `pinVideo` and
  `getOrFetchVideo` (song import). (Decision D8: do NOT also AND
  `embeddable` into the visibility fragments — ingest refusal +
  `videos:refresh --prune` covers it.)
- `unpinVideo`: `DELETE … RETURNING via_channel_id` (closes the
  find-then-delete race) + tombstone when the deleted pin was
  channel-sourced **or** the video's channel is approved for the
  profile — a manual unpin on an approved channel stays unpinned.
- `approveChannel`'s `after()`: skip `backfillChannel` when
  `backfillComplete` is already true — no re-scan, no "Syncing…"
  resurrection.
- `pollChannel`: union `channel_video_exclusions` into the
  known-stop lookup; when the 5-page cap hits without a known id,
  persist a resume cursor (decision D7, recommended: reuse
  `backfillPageToken` + `backfillComplete=false` — no schema
  change).
- Tidy: `syncAllChannels` `ORDER BY last_sync_at ASC NULLS FIRST`
  via `sql` (drop the JS re-sort); `triggerPinned` routes through
  `notifyProfile` (depends on the realtime-hardening change).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `channel-sync`: tombstones count as known-stop markers; the poll
  persists a resume cursor past its window; re-approval skips a
  completed backfill; quota detection covers all quota reasons.
- `whitelist-content`: unpin tombstones widen to manual pins on
  approved channels; ingest refuses non-embeddable videos.

## Impact

- Whitelist safety: **tightened** — unpins can no longer be
  silently undone by sync, and unplayable videos can't enter the
  whitelist/song catalog. Semantics change worth calling out in the
  PR body: after this, a parent who wants a manually-unpinned
  channel video back must re-pin manually (clears the tombstone).
- Code: `lib/youtube.ts`, `lib/channel-sync.ts`,
  `app/actions/{pinning,channels,songs}.ts`,
  `app/parent/dashboard/_components/video-preview.tsx` (null
  handling already guarded).
- Ordering: depends on `2026-11-11-realtime-and-secrets-hardening`
  for `notifyProfile` (`triggerPinned` repoint); land after it.
- Verify with `npm run typecheck`, `npm run lint` + the manual
  checks in `tasks.md`.
