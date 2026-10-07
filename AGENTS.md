# NibrasTube — Agent Guide

Parent-curated, whitelist-only YouTube player for kids. Parents approve
specific videos or entire channels; kids can only watch approved content.
Product spec: `prd.md` (unchecked boxes = roadmap, not bugs).

## Stack

- Next.js 16 App Router (Turbopack), React 19, TypeScript, ESM (`"type": "module"`)
- PostgreSQL via Drizzle ORM (`drizzle-orm/node-postgres` + `pg` Pool)
- Auth: JWT (`jose`) in an httpOnly `session` cookie, bcryptjs passwords
- Real-time: Pusher (server: `pusher`, client: `pusher-js`)
- UI: Tailwind CSS 4 + shadcn/ui (`components.json` style `base-mira`,
  baseColor `olive`), Phosphor icons, `next-themes`
- Validation: zod. HTTP client: axios (YouTube Data API only)

## Commands

```bash
npm run dev         # dev server (Turbopack)
npm run typecheck   # tsc --noEmit — run before finishing any change
npm run lint        # eslint (eslint-config-next)
npm run format      # prettier --write (uses prettier-plugin-tailwindcss)
npm run db:generate # drizzle-kit generate → new migration in drizzle/
npm run db:migrate  # drizzle-kit migrate
npm run videos:refresh -- --dry-run   # re-fetch videos rows missing
                                    # YouTube fields (filters: --stale
                                    # --missing cols --ids --channel
                                    # --whitelisted --all --where;
                                    # --prune deletes YT-dead videos)
```

No test suite exists — verify with `typecheck` + `lint` + manual run.
DB schema changes: edit `lib/db/schema.ts`, then `npm run db:generate`
(commit the generated `drizzle/` files), `npm run db:migrate` to apply.
Repo is configured for **squash-merge only** PRs (`.github/settings.yml`).
Remotes: `origin` = my fork (`Ted-Rose/nibrastube`), `upstream` = source.
All `gh` operations (issues, PRs, comments, reviews) go to the fork —
pass `--repo Ted-Rose/nibrastube` when in doubt.

## Architecture

Route protection lives in `proxy.ts` (Next 16's middleware replacement):
`/` redirects to `/kids/<activeProfileId>` (kid-locked device),
`/parent/dashboard` (session) or `/signup`; `/kids` needs a session;
`/kids/:profileId/*` needs a session OR an `activeProfileId` cookie
matching that profile (other profiles snap back to the locked one);
`/parent/*` needs `session` **and** the `parentUnlocked` cookie —
kid-locked devices bounce to `/kids`, missing/stale unlock redirects
to `/kids?gate=1`, which auto-opens the PIN modal; `/login`/`/signup`
redirect signed-in users to `/parent/dashboard`. `proxy.ts` also
rolling-refreshes `session` (reissues JWTs older than ~1 day). There is
**no** `middleware.ts` — do not create one; extend `proxy.ts` instead.

All mutations are Server Actions in `app/actions/*.ts` (`"use server"`).
Pages are Server Components that query Drizzle directly; client components
(`"use client"`) exist only where interactivity requires them.

```
app/
  page.tsx                      Redirect stub — proxy.ts routes `/` to
                                /kids/<activeProfileId>, /parent/dashboard
                                or /signup
  login/ signup/                Parent auth (server actions, FormData + zod)
  invite/[token]/               Accept shared-access invite
  parent/dashboard/             Search YouTube, pin videos, approve channels
  parent/profiles/              Manage kids + send invites
  kids/                         "Who's watching?" profile picker
  kids/[profileId]/             Whitelisted video grid + internal search
  kids/[profileId]/watch/[id]/  Watch page → <WatchExperience>
  actions/                      Server actions (auth, profiles, pinning,
                                channels, invites, safety)
  api/sync-channels/            Daily channel sync trigger (GET + POST)
  api/watch-progress/           POST upsert for resume position
components/
  ui/                           shadcn primitives (button, card, input, label)
  watch-experience.tsx          YouTube IFrame player: auto-advance, resume,
                                rogue-video snapback, progress beacons
  fullscreen-player.tsx         Fullscreen wrapper w/ iOS CSS-overlay fallback
  parental-gate*.tsx            4-digit Parent PIN modal
  kids-footer-gate.tsx          PIN gate for switching to parent area
  pusher-listener.tsx           Subscribes `profile-<id>`, router.refresh() on events
  daily-sync-ping.tsx           Once/day/device POST to /api/sync-channels
  pwa-register.tsx              Registers public/sw.js
lib/
  auth.ts                       JWT encrypt/decrypt, login/logout, getSession
  profiles.ts                   assertCanManageProfile, getManageableProfiles
  youtube.ts                    YouTube Data API wrappers + ISO-8601 duration parse
  channel-sync.ts               backfillChannel / pollChannel / syncAllChannels
  pusher.ts                     pusherServer + getPusherClient factories
  db/schema.ts                  All tables (single file)
  db/index.ts                   pg Pool → drizzle client
  utils.ts                      cn() (clsx + tailwind-merge)
public/sw.js                    PWA service worker (cache-first static only)
scripts/generate-icons.mjs      Regenerates PWA icons in public/icons/
android/                      Capacitor 8 Android project (generated,
                              committed) — WebView loads server.url
capacitor.config.ts           appId + server.url (from CAPACITOR_SERVER_URL)
capacitor-www/                Placeholder webDir for `cap sync` (SSR app
                              has no static export; APK loads remote URL)
```

## Android APK

Capacitor wrapper — see `docs/ANDROID_APK.md`. Requires the app to be
deployed at a public HTTPS URL (set `CAPACITOR_SERVER_URL` locally /
`APP_URL` repo variable in CI). `.github/workflows/android-release.yml`
builds a debug APK on the `android` branch / dispatch and a signed
release APK on `v*` tags.

## Data model (`lib/db/schema.ts`)

- `users` — parents; `parentPin` (default "0000") gates parent areas
- `profiles` — kids, owned by `parentId`; avatars are emoji strings
- `videos` — global YouTube video cache, PK = YouTube video ID
- `channels` — global YouTube channel cache, PK = `UC...` ID, stores
  `uploadsPlaylistId`
- `whitelisted_videos` — (profileId, videoId) pins; `viaChannelId` NULL =
  manual pin, set = added by channel sync
- `whitelisted_channels` — (profileId, channelId) approvals with
  `backfillComplete` / `backfillPageToken` resumable-backfill state and
  `lastSyncAt`
- `channel_video_exclusions` — tombstones so unpinning a channel-synced
  video isn't undone by the next sync
- `watch_progress` — (profileId, videoId) resume position + `completed`
- `daily_syncs` — one row per UTC date = dedup lock for the daily sync
- `shared_access` + `invites` — second-parent access via token links

## Business rules & invariants

- **Whitelist is absolute.** Kids never see unapproved content: the watch
  page redirects non-whitelisted videoIds, the player polls every 500ms
  and snaps back if a "More videos" suggestion hijacks the embed, and
  `/api/watch-progress` rejects non-whitelisted writes.
- **Every mutating server action** must call `getSession()` then
  `assertCanManageProfile(session, profileId)` (owner or `shared_access`
  row). Watch-progress also accepts the `activeProfileId` cookie matching
  the profile (a locked kid device may lack a manageable session).
- **Three auth cookies:** `session` = parent JWT (1 year, rolling
  refresh via `proxy.ts`); `parentUnlocked` = signed JWT (scope
  `parent-unlock`, bound to the session user, 24h exp) inside a
  browser-session cookie set by `verifyParentPin`/login/signup, cleared
  by "Kids Corner" (`lockParentPortal`) — `/parent/*` is unreachable
  without it, and parent-mutating server actions re-verify it via
  `requireParentUnlocked()` (invite acceptance excepted — the token is
  the credential); `activeProfileId` = which kid profile the device is
  locked to (1 year; also read by `/api/watch-progress` &
  `/api/video-reactions`). The `/kids` picker needs a session and lists
  owned+shared profiles (`getManageableProfiles`); `/kids/<id>` pages
  allow the matching `activeProfileId` lock OR a managing session
  (`canViewProfile`). PIN verification is server-side
  (`verifyParentPin` reads `users.parentPin` from the DB, with a 500 ms
  delay on failures to throttle brute force) — never pass the PIN to
  client components.
- **Channel sync:** approving a channel backfills its uploads playlist in
  the background (`after()`), resumable via `backfillPageToken`. Daily
  sync (`/api/sync-channels`, pinged once/day by clients) polls newest
  uploads until it hits a known videoId. Manual unpin of a synced video →
  tombstone; un-approving a channel removes its `viaChannelId` pins and
  clears its tombstones. YouTube quota errors abort the run early.
- **Real-time:** after any whitelist change, trigger Pusher on channel
  `profile-<profileId>` with `video-pinned`/`video-unpinned`;
  `PusherListener` calls `router.refresh()`. Import `pusherServer`
  dynamically inside actions.
- **Watch progress:** client flushes on pause/end/pagehide (sendBeacon)
  and every ~10s while playing; server upserts guarded by `sentAt` so
  late beacons can't overwrite newer positions. `completed` ≥95%.

## Conventions

- Style: 2 spaces, double quotes, 80-col width. **Prettier config says
  `semi: false` but all code uses semicolons** — match surrounding code;
  be aware `npm run format` will strip semicolons repo-wide (fix the
  config or the code, don't mix). Tailwind class order is enforced by
  `prettier-plugin-tailwindcss` (`cn`/`cva` aware).
- Icons: `@phosphor-icons/react` in client components,
  `@phosphor-icons/react/dist/ssr` in server components.
- Kids UI style: big rounded cards (`rounded-[32px]`/`rounded-3xl`),
  heavy fonts (`font-black`), playful emoji avatars, slate/primary palette.
- Forms use server actions via `<form action={...}>`; validation with
  zod `safeParse` on FormData.
- Branch names must use a prefix: `feature/` for new functionality,
  `fix/` for bug fixes, `chore/` for maintenance/tooling, `docs/` for
  documentation, `refactor/` for restructuring without behavior change
  (e.g. `feature/kids-profile-switcher`, `fix/dark-mode-titles`).
- Path alias `@/*` → repo root (`tsconfig.json`).
- Env vars needed: `DATABASE_URL`, `JWT_SECRET`, `YOUTUBE_API_KEY`,
  `PUSHER_APP_ID`, `PUSHER_KEY`, `PUSHER_SECRET`, `PUSHER_CLUSTER`
  (see `.env`, never commit it).

## Known sharp edges

- `lib/auth.ts` falls back to `JWT_SECRET="secret"` — dev only, always set
  the env var.
- Parent PIN is stored/compared in plaintext — acceptable for a family
  app, but don't build security-critical features on it.
- `getPusherClient` has a hardcoded fallback Pusher key.
- Dev machine sits behind a TLS-intercepting proxy (Netskope). Node-side
  calls (axios → YouTube) need `NODE_EXTRA_CA_CERTS` (set in `~/.zshrc`);
  Turbopack ignores that var — `.env` carries
  `NEXT_TURBOPACK_EXPERIMENTAL_USE_SYSTEM_TLS_CERTS=1` so `next/font`'s
  Google Fonts downloads validate. Without it every render retries the
  font fetch and stalls for seconds. Do NOT move it to
  `experimental.turbopackUseSystemTlsCerts` in next.config — the config
  key broke tailwindcss module resolution (env var does not).
- `/kids/<uuid>` is effectively a capability URL: `activeProfileId` is
  the profile UUID, so anyone who learns a UUID can self-set the cookie
  and view that feed without a session. Unguessable UUIDs keep the risk
  low — this is the accepted model.
- YouTube Data API quota is finite (10k units/day); searches are 100
  units each — prefer `videos`/`playlistItems` endpoints in sync code.
- Dev server runs on **port 3100** (`.vscode/launch.json` frees the port
  then runs `npm run dev -- -p 3100`) — VSCode stop leaves orphaned
  `next-server` processes holding the port + `.next/dev/lock`, so
  re-launching without the kill prefix caused EADDRINUSE. A stray
  `p_projects/yarn.lock` (parent dir, no package.json) once made
  Turbopack infer that 3.8 GB dir as workspace root → slow boots; it was
  deleted — do NOT set `turbopack.root` in next.config to fix this, it
  breaks tailwindcss resolution. If weird resolution errors appear,
  `rm -rf .next` (cache poisoning persists across restarts).
- `.env` active `DATABASE_URL` is the `ai_agent` DB user, which has no
  SELECT on app tables. For read-only DB inspection use the commented
  `avnadmin` URL above it (Aiven prod; localhost URL is dev).
