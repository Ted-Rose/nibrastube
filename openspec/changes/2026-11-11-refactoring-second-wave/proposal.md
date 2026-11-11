# Proposal

## Why

`docs/reviews/OVERALL.md` (committed under `docs/reviews/`) lists
46 audited issues. The first-wave program retired in
`docs/plans/` already shipped the component work (dashboard
`_components/` split, `useTokenPager`, `useYouTubePlayer`,
`onError` resilience, generation-guarded paging, `?song=` strip)
and the remaining phase-sized work now lives as sibling
`2026-11-11-*` changes. This change is the **backlog tracker** for
everything left: the optional cherry-pick batch (W12), the
unowned second-wave batches (W13), and the still-open owner
decisions — so no review finding is unaccounted for. It declares
`skip_specs`: each batch becomes its own spec'd change when
scheduled.

## What Changes

Nothing directly — this proposal schedules and frames later work.
Each batch below ships as its own branch + PR (and its own
openspec change when it picks up spec-covered behavior):

- **W12 cherry-picks** (`[refactor]`/`[behavior]` mixed):
  `FOR_YOU_PAGE_SIZE` export; `SwipeConfirmDialog`
  Escape/backdrop; `kids-search` `urlRef` render-phase
  assignment; filtered-playlist `sortable` gate +
  reorder-failure surfacing (#24); live-position `Map`.
- **Parser batch** (S): #28 sort-before-fill +
  #44's phantom `start - end` titles in
  `lib/song-timestamps.ts`; add the review's verified repros to
  `scripts/test-song-parser.ts`.
- **Feed batch** (M): #22 bound `getWatchHistory`; #23 hoist the
  shared For-You CTEs; #41 normalize params once in
  `parseKidsFeedParams` + `Promise.all` independent awaits + slim
  `getKidsChannels`.
- **Watch batch** (M): #20/D12 queue depth; #40 remainder —
  server-side `day` clamp, `db.transaction` around the upserts,
  sent-markers on success only, document the 500 ms snapback
  window; D10/D11 decide the `completed` flip-back and
  mid-session-unpin questions.
- **Playlist batch** (M): #39 — serialization (advisory
  lock/`FOR UPDATE`), single `UPDATE … FROM (VALUES …)`,
  hidden-row position normalization, `createAndAdd` split
  try/catch, caps counting hidden rows.
- **Auth batch** (M–L, `[schema]`): #13/D13 brute-force counters
  (`failedAttempts`/`lockedUntil`); #42 remainder —
  `normalizeIdentifier` everywhere, dummy-hash compare,
  `onConflictDoNothing` on the users insert, gate-dialog a11y,
  `verifying`-stuck fix, already-unlocked-parent affordance.
- **Songs batch** (M): #44 remainder — import `db.transaction`,
  repost-orphan GC, `deleteSong` TOCTOU fold,
  `onConflictDoNothing` on the `videos` insert, `ilike` escaping,
  case-insensitive title sort.
- **Parent batch** (M): #45 remainder + the unowned half of #17 —
  `hydrateUploadsPage`/`getPinnedVideoIds`/`getApprovedChannelIds`
  helpers, delete-kid/unapprove confirmations, `createProfile`
  trim/max-length.
- **Sync/platform batch** (S–M): #43 remainder +
  #46 remainder — `isChannelSyncEnabled` collapse, `parseIsoDuration`
  bare-"PT" guard, reconcile-script fix + Neon doc,
  `channelsSynced` metric, `string | null` token unification,
  `videos.raw` slimming, tsconfig strictness, `sw.js` cache-name
  habit, `format` glob, identifier-uniqueness, pool max per D14.

### Open owner decisions (carried from the retired master plan)

- D10 `completed` flip-back: keep last-write-wins + document
  (rec) vs sticky `completed`.
- D11 mid-session unpin on the watch page: accept + document the
  revocation delay (rec) vs mount `PusherListener` on the watch
  route.
- D12 For-You/Shorts queue depth >60 rows: rebuild with a larger
  `limit` (rec) vs carry the card offset in the watch href.
- D13 brute-force counters: `failedAttempts`/`lockedUntil`
  columns (rec) vs consciously accept (family app).
- D14 pool `max: 3`: leave (rec) vs ~6 if traces show queueing.
- D17 token-pager reset-on-revalidation: keep as-is (rec).
- D18 `iframe_api` load-failure path: fold a load timeout + error
  state into the shared hook (rec) vs defer to the platform
  batch.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None — backlog tracking only (`skip_specs: true`); each batch
declares its own deltas when it becomes a real change.

## Impact

- Whitelist safety: **mixed later** — several batches touch
  kid-facing surfaces (feed bounds, watch queue, parser); each
  gets its own whitelist-safety callout when proposed.
- Sequencing: batches are independent; the master plan's ordering
  rationale (correctness → structure → dead surface) still holds.
  When a batch merges, its OVERALL issue numbers should be marked
  resolved in the implementing PR body.
