# Design

Source: `docs/plans/refactoring-plan.md` W12–W13 + the decision
list (retired into this change). OVERALL.md issues not owned by
any first-wave change live here.

## How to read this change

It is a tracker, not an implementation plan. Each batch is
self-contained; when one is scheduled, create a dedicated
openspec change (`openspec new change`) that re-states the batch
items against the then-current code, gives it delta specs if it
alters spec-covered behavior, and closes the relevant OVERALL
issue numbers on merge.

## Batch details

### W12 — optional component add-ons (cherry-pick)

- Export `FOR_YOU_PAGE_SIZE` (removes the `=== 60` magic coupling
  between grid paging and the feed limit).
- `SwipeConfirmDialog` Escape/backdrop dismissal.
- `kids-search` `urlRef` render-phase assignment tidy.
- Filtered-playlist `sortable` gate + reorder-failure surfacing
  (#24 — a filtered reorder posts a subset and always throws
  today; pass `sortable` iff `!q && type=all && !minLen &&
  !maxLen` and show a "clear filters to reorder" hint).
- Live-position `Map` for revisited videos (after the
  `useYouTubePlayer` extraction — already shipped).

### W13 batches (no first-wave owner)

- **Parser**: sort lines by `startSeconds` before the end-fill
  pass (#28 — verified repro: out-of-order tracklists drop
  songs); reject bare `start - end` lines that mint songs titled
  with the end timestamp (#44); regression cases in
  `scripts/test-song-parser.ts`.
- **Feed**: `getWatchHistory` LIMIT or rolling window (#22);
  hoist the shared For-You CTEs so the home render runs the
  ranking query once (#23); `parseKidsFeedParams` normalization —
  trim `q`, swap inverted min/max, relax the server-TZ
  future-date check — plus `Promise.all` and a slimmer
  `getKidsChannels` (#41).
- **Watch**: queue depth per D12 (#20); #40 remainder — `day`
  built from server date parts not the `en-CA` trick, server-side
  clamp, `db.transaction` around the two upserts, sent-markers on
  success only, document the 500 ms snapback window.
- **Playlist**: per-playlist serialization + single `UPDATE …
  FROM (VALUES …)`, hidden-row position normalization,
  `createAndAdd` split try/catch, caps counting hidden rows
  (#39).
- **Auth**: brute-force counters per D13 (#13); `normalizeIdentifier`
  everywhere, dummy-hash constant-work compare,
  `onConflictDoNothing` on the users insert, gate-dialog a11y,
  `verifying`-stuck fix, already-unlocked-parent affordance
  (#42).
- **Songs**: import `db.transaction`, repost-orphan GC scoped to
  video+importer, `deleteSong` TOCTOU fold, `onConflictDoNothing`
  on the `videos` insert, `ilike` wildcard escaping,
  case-insensitive title sort (#44).
- **Parent**: `hydrateUploadsPage` +
  `getPinnedVideoIds`/`getApprovedChannelIds` helpers (unowned
  half of #17), delete-kid/unapprove confirmations,
  `createProfile` trim/max-length (#45).
- **Sync/platform**: `isChannelSyncEnabled` query collapse,
  `parseIsoDuration` bare-"PT" guard, reconcile-script fix + Neon
  doc, `channelsSynced` metric, `string | null` token
  unification, `test-foryou-paging` guards (#43); `videos.raw`
  slimming, tsconfig strictness, `sw.js` cache-name, `format`
  glob, identifier-uniqueness comment, pool max per D14 (#46).

## Decisions pending owner sign-off

D10, D11, D12, D13, D14, D17, D18 — stated with recommendations
in `proposal.md`. Each gates its batch; none block first-wave
work.
