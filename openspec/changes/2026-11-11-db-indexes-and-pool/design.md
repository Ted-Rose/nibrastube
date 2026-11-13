# Design

Source: `docs/plans/architecture-refactor-plan.md` phase 2 +
`refactoring-plan.md` W3 (retired into this change). OVERALL.md
issues #32, #33; decision D14 (pool max stays 3).

## Indexes to add (`index()` entries in `lib/db/schema.ts`)

Hot-path filters:

- `videos(channel_id)` — `unapproveChannel`'s tombstone-cleanup
  subquery seq-scans the largest table; also hit by
  `videos:refresh --channel` and the `?channel=` feed filter.
- `whitelisted_videos(profile_id, via_channel_id)` partial
  `WHERE via_channel_id IS NOT NULL` — un-approve pin delete and
  the dashboard pin-count group-by.
- `watch_history(profile_id, watched_on, last_seen_at)` — history
  feed filters `watchedOn = day` and orders `watched_on DESC,
  last_seen_at DESC`; the PK order serves neither.
- `songs(imported_by)` — "Yours" tab filter.
- `playlists(profile_id)` — tile query.

Trailing-FK indexes so row deletes don't seq-scan ~6 child tables:

- `video_id` on `whitelisted_videos`, `watch_progress`,
  `watch_history`, `video_reactions`, `playlist_items`,
  `channel_video_exclusions`
- `channel_id` on `whitelisted_channels`, `channel_sync_exclusions`
- `profiles(parent_id)`, `shared_access(profile_id)` (PK leads
  with `parent_id`), `invites(profile_id)`,
  `invites(from_parent_id)`

(`songs.video_id` already covered — it leads the
`songs_video_start_uniq` unique index.)

## Pool fixes (`lib/db/index.ts`)

- `idleTimeoutMillis: 10_000` → `60_000` — the comment claims to
  beat pg's 10 s default but sets exactly that.
- `pool.on("error", (e) => console.error("pg idle client error",
  e))` — Neon routinely drops idle clients; an unhandled
  EventEmitter `'error'` can crash a long-lived server.
- Fix the comment to match.
- D14: `max` stays 3 — parallel page queries queue on three
  connections; revisit only if traces show queueing.

## Risks

- `CREATE INDEX` takes a brief write lock; drizzle emits plain
  (non-`CONCURRENTLY`) indexes — fine at family scale. Never add
  `CONCURRENTLY` inside drizzle's transaction (it fails).
- Migration runs against production Neon — unpooled URL only;
  `drizzle.config.ts` already prefers `DATABASE_URL_UNPOOLED`.

## Verification

- `npm run db:generate` produces a single additive `00NN_*.sql`.
- After the user-run migrate: `\d+ whitelisted_videos` /
  `SELECT indexname FROM pg_indexes` shows the new indexes.
- `npm run typecheck && npm run lint`; dev server idles >10 s
  across navigations — no crash, no per-nav handshake stall.
