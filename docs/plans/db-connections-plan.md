# Plan: Postgres connection exhaustion on Aiven (max_connections=20)

**Status: partially implemented** — fixes 2–5 shipped in PRs #34–#36
(stacked); fix #1 (Aiven PgBouncer pool) deferred.

## Incident

After the kid-login merge, prod rendered the For-You feed query with a
Postgres `53300` fatal: `remaining connection slots are reserved for
non-replication superuser connections`. The Aiven free-tier service caps
at `max_connections = 20` (~17 usable — 3 reserved for superuser).

## What the investigation found

`pg_stat_activity` at incident time:

- 15 live connections, **all `avnadmin`, all `idle`** — from ~8 distinct
  IPs across AWS `us-east-1` *and* `eu-central` (Vercel lambda
  instances). Idle times ranged 1.5–10.5 minutes.
- Top `last_query`s: `select "id" from "profiles" where "id" = $1` (the
  profile-existence check `proxy.ts` runs on every matched request for a
  kid session — added by kid-login) and the heavy `channel_affinity`
  For-You CTE.
- Zero connections originated from this dev machine (verified via
  `lsof -iTCP:13968` after killing the local dev server).
- Vercel's `DATABASE_URL` is the **avnadmin** URL — every observed conn,
  including the app's, runs as the admin user.

Interim relief applied: `pg_terminate_backend` on 11 backends idle >90 s
freed the DB instantly (down to 1 conn); pools reconnect on demand.
Steady state refilled to ~8 within a minute.

## Root cause

1. **Frozen lambdas defeat `idleTimeoutMillis`.** Vercel suspends the
   Node event loop between invocations, so `pg.Pool`'s idle-reaper
   timers never fire while a lambda is parked. `idleTimeoutMillis:
   10_000` in `lib/db/index.ts` therefore doesn't release connections —
   each pool client lingers for the lambda's whole warm lifetime
   (minutes), not 10 s.
2. **Pool math doesn't fit the cap.** Each warm lambda instance owns a
   pool of `max: 3`. Vercel scales instances per-region, so ~7 warm
   instances ≈ 21 slots > the 17 usable. Any burst or multi-region
   traffic pushes over the edge.
3. **Kid-login raised the per-request DB cost.** `proxy.ts` now queries
   `profiles` on every matched request for kid sessions, keeping lambdas
   warm longer and lengthening the time conns stay checked out.

### Side finding — `db:migrate` is silently broken

Journal entries `0003`/`0004` hash-mismatch the rows in
`drizzle.__drizzle_migrations` (their `.sql` files were edited after
being applied). `drizzle-kit migrate` therefore tries to re-apply them
and dies on `relation already exists` — same silent exit-1 shape as the
`ai_agent` DDL issue. Schema state is otherwise correct: `0011` (songs)
and `0012` (kid credentials) are both applied.

## Fixes (in order)

1. **Aiven PgBouncer pool — the real fix.** Aiven console → service →
   *Connection pools* → create a `transaction` pool → point the app's
   `DATABASE_URL` (Vercel env) at the pooler URI (separate port).
   Transaction pooling multiplexes many client conns onto few real
   backends — the standard serverless fix.
   - Keep a **direct** URL for `drizzle-kit migrate` and `pg_dump` —
     transaction pooling breaks advisory locks and session state.
   - pg.Pool's unnamed prepared statements are pooler-safe; avoid
     session-level features (`SET`, `LISTEN`, advisory locks) on the
     pooled path — grep before switching.
2. **Shrink the lambda footprint** (`lib/db/index.ts`): `max: 2`,
   `idleTimeoutMillis: 1_500`, and set `application_name:
   "nibrastube"` so `pg_stat_activity` can attribute connections.
   Doesn't fix frozen timers but halves worst-case usage.
3. **Stop paying a DB round-trip per proxy request.** Wrap the
   profile-existence check for kid sessions in `unstable_cache` keyed by
   `profileId` with a ~60 s TTL (deletion detection lags ≤60 s —
   acceptable, proxy still clears cookies on the next nav after expiry).
4. **Reconcile `__drizzle_migrations`**: update the stored hashes for
   `0003`/`0004` to the sha256 of the current `.sql` files so
   `db:migrate` stops trying to re-apply them.
   - Never edit a migration file after it has been applied — if the
     files were *meant* to change, that belongs in a new migration.
5. **Ops runbook** (documented in AGENTS.md): terminate stale idlers
   when the cap is hit —
   `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE
   datname = current_database() AND state = 'idle'
   AND now() - state_change > interval '90 seconds';`
   If traffic keeps growing: Aiven plan bump or a DB host with a
   serverless-native driver (Neon/Supabase).

## Verification

- `SELECT state, count(*) FROM pg_stat_activity GROUP BY 1` stays
  comfortably under the cap while browsing the app.
- No `53300` in Vercel function logs; the For-You feed and kid login
  work under normal browsing.
- `npm run db:migrate` exits 0 (no pending entries re-applied).
