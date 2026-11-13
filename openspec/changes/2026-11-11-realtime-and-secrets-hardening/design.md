# Design

Source: `docs/plans/architecture-refactor-plan.md` phase 1 (now
retired into this change) + `refactoring-plan.md` W2. OVERALL.md
issues #2, #3, #25, #26, #34, part of #46.

## Module split

Today `lib/pusher.ts` is one module doing three wrong things:

- `new PusherServer(...)` at module scope — the whole Node `pusher`
  package ships to the browser via the `"use client"` import in
  `components/pusher-listener.tsx` (the secret VALUE doesn't ship —
  non-public envs are undefined in the bundle — but the package is
  dead weight and a bundler/SDK change could throw at eval time).
- `getPusherClient` carries a hardcoded fallback key pointing at a
  *different* Pusher app (see "Known gap" below).
- Awaited `pusherServer.trigger` after each committed write turns a
  Pusher outage into a false action failure — the client reverts a
  change that actually persisted.

Target shape:

```
lib/pusher-server.ts   import "server-only"
                       pusherServer factory
                       notifyProfile(profileId, event, payload):
                         try { await pusherServer.trigger(...) }
                         catch (e) { console.warn(...) }
lib/pusher-client.ts   getPusherClient reading
                       NEXT_PUBLIC_PUSHER_KEY + NEXT_PUBLIC_PUSHER_CLUSTER
```

Keep the six `await import(...)` call sites dynamic — `server-only`
makes wrong-direction imports a build error (intended), and dynamic
import keeps the server SDK out of client graphs.

Call sites to repoint to `notifyProfile`:
`app/actions/playlists.ts`, `app/actions/pinning.ts` (×2),
`app/actions/channels.ts`, `app/actions/refresh.ts`,
`lib/channel-sync.ts` (`triggerPinned`),
`app/api/video-reactions/route.ts`.

`components/pusher-listener.tsx`: repoint to the client module and
add `pusher.disconnect()` in the effect cleanup after `unsubscribe`
(every remount currently leaks a WebSocket). A module-level
singleton client is an acceptable alternative.

## `/api/sync-channels` auth

The route exposes GET+POST with no auth (the proxy matcher
intentionally excludes `/api/*`); any crawler can claim the daily
`daily_syncs` slot and burn YouTube quota.

- POST → `getSession()`; 401 when null (`DailySyncPing` only mounts
  on session-gated pages, so legit callers carry the cookie).
- GET → `Authorization: Bearer ${process.env.CRON_SECRET}`; 401 on
  mismatch. Decision D6 (from the master plan): keep the CRON-gated
  GET so manual triggering stays possible — recommended. Deleting
  GET outright is equally correct and smaller if no external cron
  exists.

## Fail-fast secrets

- `lib/auth.ts`: remove the `JWT_SECRET || "secret"` fallback —
  throw at module load when unset. (AGENTS.md documents the
  fallback as a known gap; this change removes it deliberately —
  update the gap entry in the same PR.)
- `capacitor.config.ts`: throw when `CAPACITOR_SERVER_URL` is unset
  instead of silently baking `https://nibrastube.example.com` into
  a signed APK (CI sources it from the `APP_URL` repo var).
- `next.config.mjs` optional hardening: `poweredByHeader: false`,
  `serverExternalPackages: ["pg"]`.

## Known gap / open decision

`getPusherClient`'s hardcoded fallback key is in AGENTS.md
"Known gaps — do NOT 'fix' without asking". The retired plan
recommended deleting it (fail fast). Two coherent outcomes:

- (a) Delete the fallback → missing `NEXT_PUBLIC_PUSHER_KEY`
  throws; update the AGENTS.md gap entry in the same PR.
- (b) Keep the fallback → document the decision in the PR body.

Default to (a) unless the owner says otherwise — a fail-fast
misconfig beats silently connecting to the wrong Pusher app.

## Risks

- **Deploy-env ordering**: `NEXT_PUBLIC_PUSHER_*` and `CRON_SECRET`
  must exist wherever the app is deployed before/at merge —
  fail-fast makes a missing var a loud break, not silent dead
  realtime. Cloud Run already passes the `NEXT_PUBLIC_PUSHER_*`
  pair as Docker build args (`docs/deploy-gcp-cloud-run.md`);
  confirm Vercel/`ENV_FILE` too. `CRON_SECRET` is new — add it to
  `ENV_FILE` if the CRON-gated GET is kept.
- `notifyProfile` swallows trigger errors by design — realtime is
  best-effort; `revalidatePath` already covers the acting client.

## Verification

- `npm run typecheck && npm run lint && npm run build` (module
  split + env).
- Manual on port 3100: open a kids feed on two tabs/devices — pin
  on one, the other refreshes itself; dev tools show the socket on
  `ws-eu`. `curl -i -X POST localhost:3100/api/sync-channels` →
  401 logged out, 200 logged in; `curl -i
  localhost:3100/api/sync-channels` → 401 without the bearer.
