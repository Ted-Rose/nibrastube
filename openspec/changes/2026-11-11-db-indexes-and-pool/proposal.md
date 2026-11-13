# Proposal

## Why

Distilled from `docs/plans/architecture-refactor-plan.md` phase 2
(master plan W3; OVERALL #32, #33) — still open on `main`. Every
`drizzle/meta` snapshot has `"indexes": {}`: hot filters
(`videos.channel_id`, `whitelisted_videos.via_channel_id`,
`watch_history` date+sort, `songs.imported_by`,
`playlists.profile_id`) and every trailing-FK cascade seq-scan,
and the pg pool's `idleTimeoutMillis` is set to the exact default
its comment claims to beat with no `pool.on("error")` handler.

## What Changes

- One `[schema]` migration adding secondary + trailing-FK indexes
  in `lib/db/schema.ts` (full list in `design.md`).
- `lib/db/index.ts`: `idleTimeoutMillis: 10_000` → `60_000`, add
  `pool.on("error", …)` logging, fix the stale comment.
- No observable behavior change — pure `[schema]`/`[refactor]`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None — no spec-level behavior changes (`skip_specs: true`).

## Impact

- Whitelist safety: **none** — query plans and pool lifecycle only.
- Code: `lib/db/schema.ts` (index entries), `lib/db/index.ts`,
  generated `drizzle/` migration files.
- Decision D14 carried over from the master plan: leave pool
  `max: 3` — family scale; revisit to ~6 only if traces show
  acquisition queueing.
- Verify with `npm run db:generate`, `npm run typecheck`,
  `npm run lint`. `npm run db:migrate` is a **user hand-off**
  (production Neon, unpooled URL per `drizzle.config.ts`).
