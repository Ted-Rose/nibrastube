# Tasks

## 1. Pusher module split

- [ ] 1.1 `npm i server-only`
- [ ] 1.2 Create `lib/pusher-server.ts` (`import "server-only"`;
      move the `pusherServer` factory; add best-effort
      `notifyProfile(profileId, event, payload)` wrapping `trigger`
      in try/catch → `console.warn`)
- [ ] 1.3 Create `lib/pusher-client.ts` (`getPusherClient` on
      `NEXT_PUBLIC_PUSHER_KEY` / `NEXT_PUBLIC_PUSHER_CLUSTER`);
      decide the hardcoded fallback key per the proposal's owner
      decision (default: delete + drop the AGENTS.md gap entry)
- [ ] 1.4 Repoint the seven `await pusherServer.trigger` sites
      (playlists, pinning ×2, channels, refresh, channel-sync
      `triggerPinned`, video-reactions route) to `notifyProfile`;
      keep the dynamic `await import` pattern
- [ ] 1.5 Repoint `components/pusher-listener.tsx` to the client
      module and add `pusher.disconnect()` in the effect cleanup

## 2. Endpoint + secrets hardening

- [ ] 2.1 `/api/sync-channels`: POST → `getSession()` 401 guard;
      GET → `CRON_SECRET` bearer (or delete GET — decision D6)
- [ ] 2.2 `lib/auth.ts`: throw at module load when `JWT_SECRET` is
      unset (drop the `"secret"` fallback + the AGENTS.md gap line)
- [ ] 2.3 `capacitor.config.ts`: throw when `CAPACITOR_SERVER_URL`
      is unset
- [ ] 2.4 Optional: `next.config.mjs` `poweredByHeader: false` +
      `serverExternalPackages: ["pg"]`

## 3. Docs + env

- [ ] 3.1 Update the AGENTS.md env-var list (`CRON_SECRET`,
      `NEXT_PUBLIC_PUSHER_*`) and remove/edit the Known-gap entry
      per the fallback decision

## 4. Verification

- [ ] 4.1 `npm run typecheck && npm run lint && npm run build`
- [ ] 4.2 Manual on port 3100: two-tab pin → live refresh; WS on
      `ws-eu`; `curl -i -X POST localhost:3100/api/sync-channels`
      → 401 logged out / 200 logged in; GET → 401 without bearer

## Hand-off (user-run)

- [ ] H1 Add `NEXT_PUBLIC_PUSHER_KEY`, `NEXT_PUBLIC_PUSHER_CLUSTER`
      and `CRON_SECRET` to the deploy env (Vercel project and/or
      the `ENV_FILE` GitHub secret for Cloud Run) **before merge**
      — fail-fast turns a missing var into a loud break
