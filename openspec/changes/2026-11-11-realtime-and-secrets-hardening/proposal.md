# Proposal

## Why

Distilled from the retired `docs/plans/architecture-refactor-plan.md`
phase 1 (master plan W2), which resolved `docs/reviews/OVERALL.md`
issues #2, #3, #25, #26, #34 and parts of #46 — still open on
`main`. The browser-side half of OVERALL #1 already landed
(`NEXT_PUBLIC_PUSHER_KEY`/`NEXT_PUBLIC_PUSHER_CLUSTER` are read with
an `eu` fallback), but the structural problems remain: the Node
`pusher` SDK ships to every kid's browser inside `lib/pusher.ts`,
every action `await`s `pusherServer.trigger` after its DB commit so
a Pusher outage surfaces as a false "Couldn't save",
`/api/sync-channels` is an unauthenticated endpoint that spends
YouTube quota, and silent config fallbacks (`JWT_SECRET="secret"`,
the `nibrastube.example.com` Capacitor URL) mask misconfiguration.

## What Changes

- Split `lib/pusher.ts` into `lib/pusher-server.ts`
  (`import "server-only"`; the `pusherServer` factory plus a
  best-effort `notifyProfile(profileId, event, payload)` that
  try/catches `trigger`) and `lib/pusher-client.ts`
  (`getPusherClient` on `NEXT_PUBLIC_PUSHER_*`).
- Repoint the seven `await pusherServer.trigger(...)` call sites
  (playlists, pinning ×2, channels, refresh, channel-sync,
  video-reactions route) to `notifyProfile` — a failed trigger can
  no longer turn a committed write into a client-visible failure.
- `components/pusher-listener.tsx`: `pusher.disconnect()` in the
  effect cleanup so remounts stop leaking WebSockets.
- Auth-gate `/api/sync-channels`: POST requires a `getSession()`;
  GET requires `Authorization: Bearer ${CRON_SECRET}` (decision D6:
  keep the CRON-gated GET vs delete it — rec: keep).
- Fail fast on missing `JWT_SECRET` (`lib/auth.ts`) and
  `CAPACITOR_SERVER_URL` (`capacitor.config.ts`) instead of
  shipping silent fallbacks.
- **BREAKING (config only)**: deployments missing the new env vars
  (`CRON_SECRET`, `NEXT_PUBLIC_PUSHER_*`) fail loudly at
  boot/build/request time rather than silently degrading.

### Owner decision flagged

The hardcoded Pusher-key fallback in `getPusherClient` is listed in
AGENTS.md "Known gaps & sharp edges — do NOT 'fix' without asking".
The source plan wanted it deleted (fail fast); the gap entry says
leave it. The implementation PR must either delete the fallback +
the gap entry, or keep both — owner call.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `action-api-contract`: `/api/sync-channels` gains authentication
  requirements (session for POST, bearer for GET); write actions
  route realtime notification through a best-effort helper whose
  failure never fails the mutation.

## Impact

- Whitelist safety: **none** — no kid-visible surface changes;
  endpoint auth and notification reliability only.
- Code: `lib/pusher.ts` split, six server-action call sites +
  `app/api/video-reactions/route.ts` + `lib/channel-sync.ts`,
  `components/pusher-listener.tsx`,
  `app/api/sync-channels/route.ts`, `lib/auth.ts`,
  `capacitor.config.ts`.
- Env: `CRON_SECRET` new; `NEXT_PUBLIC_PUSHER_KEY` /
  `NEXT_PUBLIC_PUSHER_CLUSTER` must exist in `.env` AND the deploy
  env (already wired as Cloud Build args for Cloud Run — verify
  Vercel/`ENV_FILE` too); AGENTS.md env-var list updated.
- Deps: add `server-only`.
- Verify with `npm run typecheck`, `npm run lint`, `npm run build`
  (module split + env changes).
