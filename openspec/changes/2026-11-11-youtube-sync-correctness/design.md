# Design

Source: `docs/plans/architecture-refactor-plan.md` phase 4 +
`refactoring-plan.md` W6 (retired into this change). OVERALL.md
issues #7, #8, #10, #11, #29, #30, #31 + `youtube-sync` report #7.

## 4.1 `ytGet` + quota normalization (#29, #31)

New private `ytGet(path, params)` in `lib/youtube.ts` owning
`BASE_URL`, `key: API_KEY`, the API-key guard (repeated 8× today)
and a 15 s `timeout` (no axios call has one — a hung googleapis
socket stalls an action/`after()` task until the platform kills
it). Move `QuotaExceededError` from `lib/channel-sync.ts` (declared,
never thrown) next to `ytGet` and actually throw it: inspect
axios 403/429 bodies for `error.errors[].reason` ∈ `quotaExceeded |
dailyLimitExceeded | userRateLimitExceeded`. `isQuotaError` then
becomes `err instanceof QuotaExceededError` plus the same reason
check for bypass paths — its `JSON.stringify(undefined)` →
`.includes` TypeError inside the catch handler dies with the
rewrite.

## 4.2 Null contract + embeddable ingest gate (#10, #11)

- `getVideoDetails`: `const item = response.data.items?.[0]; if
  (!item) return null;` — return type `FullVideoDetails | null`,
  matching `getChannelDetails`. `pinVideo` handles null with a
  friendly "video not found"; `songs.ts` and `video-preview.tsx`
  already guard — the null makes those live paths.
- Refuse `embeddable !== true` on the ingest paths bypassing
  `getVideosBatch`: `pinVideo` (post-fetch) and `getOrFetchVideo`
  (check `existing.embeddable === false` AND fetched details).
  A stored pin/song that can never play is the bug.
- D8 (decided in the master plan): do **not** add `embeddable IS
  DISTINCT FROM false` to `suitableVideo`/`visibleVideo` — ingest
  refusal + `videos:refresh --prune` covers the rest; the fragment
  deliberately encodes only the 18+ floor.

## 4.3 Unpin tombstone gaps (#7)

`unpinVideo` only tombstones when the deleted pin had
`viaChannelId` — a manual pin on an approved channel is re-added
by the next `pollChannel`, and find-then-delete can lose a
tombstone to a concurrent sync insert.

- `DELETE … RETURNING via_channel_id` — closes the race.
- Tombstone when `viaChannelId` was set **or** `videos.channelId`
  is an approved channel for the profile (join + whitelist check).
- `pinVideo`'s exclusion-delete already clears the tombstone on
  re-pin — no change needed.
- Semantic note for the PR body: a parent who wants the synced
  copy back must re-pin manually. Matches the documented
  tombstone contract.

## 4.4 Re-approve backfill skip (#8)

`approveChannel`'s `after()` re-fetches the whitelist row — add
`if (whitelist.backfillComplete) return;` before `backfillChannel`.
Today re-approving re-scans the whole uploads playlist and
resurrects "Syncing…".

## 4.5 Poll edges (#30, youtube-sync #7)

- Tombstones as known-stop markers: union
  `channelVideoExclusions` into the `known` lookup — a channel
  whose recent uploads are all unpinned currently makes every
  daily run scan 5 pages + hydrate ~250 ids (~10 wasted quota
  units/day).
- Poll resume cursor (D7, recommended): when the 5-page cap hits
  without `hitKnown` and a `nextPageToken` remains, reuse
  `backfillPageToken` + set `backfillComplete = false` — the next
  run's backfill continues forward from the cursor. Alternative: a
  dedicated nullable `poll_page_token` column (`[schema]`) —
  clearer semantics, +1 column.

## 4.6 Sync tidy

- `syncAllChannels`: replace `asc()` + JS re-sort with
  `ORDER BY last_sync_at ASC NULLS FIRST` via `sql`.
- `triggerPinned` routes through `notifyProfile` — depends on the
  realtime-hardening change's helper.

## Risks

- Embeddable gating narrows onError's trigger, doesn't remove it:
  ingest refusal stops NEW unplayable ingests, but
  region-lock/deletion can appear post-ingest — the playback-block
  and auto-skip machinery stays necessary.

## Verification

- `npm run typecheck && npm run lint`.
- Manual: pin a dead/private YouTube id → friendly error not 500;
  approve → unapprove → unpin a manual pin → trigger sync → pin
  does not resurrect; re-approve a completed channel → no
  "Syncing…" and no `backfillPageToken` reset; a forced 403 logs a
  quota abort (not a TypeError).
