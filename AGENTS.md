# NibrasTube — Agent Guide

Guidance for AI agents working in this repository. Read before
editing; **trust the code over any doc that disagrees**. Known-stale
docs:

- `README.md` still shows `npx drizzle-kit push` and port 3000 — the
  real flow is migration files (`npm run db:generate` + `db:migrate`)
  and the dev server on port 3100.
- `prd.md` is the product spec — unchecked boxes are roadmap, not
  bugs.
- `docs/plans/*-plan.md` each carry a status header — check it before
  treating a plan as pending work.

## What this is

Single repo (not a workspace). Parent-curated, whitelist-only YouTube
player for kids: parents approve specific videos or entire channels;
kids can only watch approved content.

- Next.js 16 App Router (Turbopack), React 19, TypeScript, ESM
  (`"type": "module"`)
- PostgreSQL via Drizzle ORM (`drizzle-orm/node-postgres` + `pg`
  Pool) — hosted on Neon (production DB; local `.env` points at it,
  see "Known gaps & sharp edges")
- Auth: JWT (`jose`) in an httpOnly `session` cookie, bcryptjs
  passwords
- Real-time: Pusher (server: `pusher`, client: `pusher-js`)
- UI: Tailwind CSS 4 + shadcn/ui (`components.json` style `base-mira`,
  baseColor `olive`), Phosphor icons, `next-themes`
- Validation: zod. HTTP client: axios (YouTube Data API only)

Deploy targets: the Next.js app at a public HTTPS URL (the Capacitor
APK just loads `server.url`, so a deploy is required for the Android
app to work) and a signed Android APK built by GitHub Actions (see
"Android APK").

Remotes: `origin` = my fork (`Ted-Rose/nibrastube`), `upstream` =
source (`shamimhcp1/nibrastube`). **ALL GitHub operations (issues,
PRs, comments, reviews, releases) target the fork** — pass
`--repo Ted-Rose/nibrastube` to every `gh` call; never touch upstream
unless explicitly asked. Repo is configured for **squash-merge only**
PRs (`.github/settings.yml`); `main` is protected (no force pushes or
deletions, enforced for admins).

## Layout

Route protection lives in `proxy.ts` (Next 16's middleware
replacement — it always runs on the Node.js runtime, so DB calls in
it are safe). Kid sessions (`session` JWT with `role: "kid"`) are
handled first: every matched path redirects to
`/kids/<session.profileId>` except that profile's own feed/watch
pages, which pass through (and re-pin a stale `activeProfileId`); a
session whose profile was deleted gets both cookies cleared and lands
on `/login`. For parents: `/` redirects to
`/kids/<activeProfileId>` (kid-locked device), `/parent/dashboard`
(session) or `/signup`; `/kids` needs a session; `/kids/:profileId/*`
needs a session OR an `activeProfileId` cookie matching that profile
(other profiles snap back to the locked one); `/parent/*` needs
`session` **and** the `parentUnlocked` cookie — kid-locked devices
bounce to `/kids`, missing/stale unlock redirects to `/kids?gate=1`,
which auto-opens the PIN modal; `/login`/`/signup` redirect
signed-in users to `/parent/dashboard`. `proxy.ts` also
rolling-refreshes `session` (reissues JWTs older than ~1 day, whole
payload so kid claims survive). There is **no** `middleware.ts` — do
not create one; extend `proxy.ts` instead.

All mutations are Server Actions in `app/actions/*.ts`
(`"use server"`). Pages are Server Components that query Drizzle
directly; client components (`"use client"`) exist only where
interactivity requires them.

```
app/
  page.tsx                      Redirect stub — proxy.ts routes `/` to
                                /kids/<activeProfileId>,
                                /parent/dashboard or /signup
  login/ signup/                Unified auth — one identifier+password
                                form serves parents (email) and kids
                                (profiles.username)
  invite/[token]/               Accept shared-access invite
  parent/dashboard/             Search YouTube (paginated), preview
                                videos (?video=), drill into channels
                                (?channel=), pin videos, approve
                                channels, import song compilations
    _components/                Route-private view code: page
                                split-outs (approved-channels-card,
                                pinned-videos-card, song-import-card,
                                search-results, fallbacks, dashboard-
                                url), video-preview (?video= server
                                wrapper) + video-preview-overlay,
                                channel-detail (?channel= drill-in) +
                                channel-uploads-list, dashboard-search,
                                dashboard-video-card (vetting card:
                                duration badge, preview link,
                                pin/Approved/Blocked states),
                                pinned-videos-panel, search-results-
                                grid (token-keyed infinite scroll),
                                song-import-form
  parent/profiles/              Manage kids + send invites
  kids/                         "Who's watching?" profile picker
  kids/[profileId]/             Kids portal — 5 feed tabs, sticky
                                header, debounced search; streams via
                                Suspense
    _components/                Route-private view code: per-view
                                server components, KIDS_VIEWS table
    settings/                   Kid-facing profile settings — name +
                                preset-emoji avatar picker
                                (avatar-picker.tsx)
  songs/                        Public song catalog — no sign-in
                                required; session only adds the
                                "Yours" tab, "Your imports" shelf,
                                owner-only delete
    _components/                Route-private view code mirroring the
                                kids feed: SONGS_VIEWS table, per-view
                                server components, catalog-header
  kids/[profileId]/watch/[videoId]/  Watch page → <WatchExperience>
  actions/                      Server actions (auth, profiles,
                                pinning, channels, playlists, songs,
                                invites, safety, refresh, kids-feed —
                                For-You + Shorts infinite-scroll
                                paging, search + channel-videos —
                                dashboard vetting paging)
  api/sync-channels/            Daily channel sync trigger (GET+POST)
  api/watch-progress/           POST upsert for resume position
  api/video-reactions/          POST like/dislike per profile+video
  global-error.tsx              Root-layout crash boundary — reports
                                the error to Sentry, own <html>/<body>
components/
  ui/                           shadcn primitives (button, card,
                                input, label)
  watch-experience.tsx          YouTube IFrame player: auto-advance,
                                resume, rogue-video snapback,
                                progress beacons; Back pops history
                                when the nt:watchFrom marker is set
  watch-from-tracker.tsx        Capture-phase document listener that
                                sets nt:watchFrom on any /watch/ link
                                tap — feed→watch entry marker
  fullscreen-player.tsx         Fullscreen wrapper w/ iOS CSS-overlay
                                fallback
  parental-gate*.tsx            4-digit Parent PIN modal (portals to
                                document.body — header transform/
                                filter would clip an inline overlay)
  kids-footer-gate.tsx          PIN gate trigger — "footer" button on
                                /kids, "icon" lock in the kids header
  kid-logout-button.tsx         Sign-out icon in the kids header,
                                shown only for kid-session devices
  kids-header.tsx               Sticky frosted 2-row kids header;
                                row 1 collapses on phone scroll
                                (transform only)
  kids-view-tabs.tsx            Always-visible tab strip for feeds
                                (kids portal + /songs; per-tab icon)
  kids-sort-chips.tsx           Link-based sort chips (rewrite
                                ?sort/?dir)
  kids-type-filter.tsx          Segmented All/Videos/Shorts link
                                control (rewrites ?type=)
  kids-length-filter.tsx        Dual-thumb 0m–30m+ min/max length
                                slider (rewrites ?min=/?max= on
                                release)
  feed-header.tsx               Feed view title row (h1 + actions)
  back-link.tsx                 "All channels/playlists/…" drill-in
                                exit
  video-shelf.tsx               Horizontal snap-scroll card shelf
  empty-state.tsx               Shared kids empty-state card + CTA
  kids-tile-card.tsx            Channel/playlist/compilation tile
                                ("avatar"/"cover", `noun` for count)
  song-card.tsx                 /songs catalog card — links to the
                                ?song=<uuid> in-app player overlay
  song-card-menu.tsx            Owner-only ⋮ "Delete song" on the card
  song-catalog-grid.tsx         Windowed song grid (sentinel paging)
  song-player-overlay.tsx       Full-screen IFrame player for
                                ?song= — watch-page chrome
                                (FullscreenPlayer); plays the
                                segment then auto-advances through
                                the feed's song queue in place,
                                closing at queue end or on Escape;
                                snaps rogue suggested videos back
                                to the segment
  video-grid-skeleton.tsx       Grid + shelf skeletons (Suspense
                                fallbacks)
  pusher-listener.tsx           Subscribes `profile-<id>`,
                                router.refresh() on events
  daily-sync-ping.tsx           Once/day/device POST to
                                /api/sync-channels
  pwa-register.tsx              Registers public/sw.js
  app-update-banner.tsx         Native-APK update card — mounts in
                                root layout, polls update.json via
                                lib/app-update.ts
  drag-scroll.tsx               Root-layout global: mouse drag-to-scroll
                                on every `[data-drag-scroll]` strip
                                (shelf rows, filter chip rows); window
                                delegation, snap off while dragging,
                                trailing click swallowed
lib/
  app-update.ts                 Hourly-throttled update.json poll →
                                typed UpdateCheck union; never throws
  auth.ts                       JWT encrypt/decrypt,
                                login/loginKid/logout, getSession,
                                isKidSession/parentSession helpers
  feed-memory.ts                sessionStorage feed snapshots (key
                                `nt:feed:<profile>:<query>`): order +
                                depth + scroll restore, row merge
                                helpers, nt:watchFrom marker
  kid-avatars.ts                KID_AVATARS preset-emoji allow-list —
                                shared by the settings picker and
                                updateKidAvatar validation
  profiles.ts                   assertCanManageProfile,
                                getManageableProfiles
  kids-feed.ts                  Kids feed params/URL builder + row
                                queries
  songs-feed.ts                 /songs catalog params/URL builder +
                                queries
  yt-player.ts                  Shared YouTube IFrame-API types + the
                                ensureYouTubeAPI script loader (the
                                Window.YT global lives here —
                                declaring it per-component collides
                                as TS2717)
  youtube.ts                    YouTube Data API wrappers +
                                ISO-8601 duration parse
  song-timestamps.ts            Pure parser for timestamped
                                tracklist comments → ParsedSong[]
  channel-sync.ts               backfillChannel / pollChannel /
                                syncAllChannels
  pusher.ts                     pusherServer + getPusherClient
                                factories
  notify.ts                     notifyAdmin() — Telegram sendMessage;
                                no-ops without TELEGRAM_* env vars
  report.ts                     Sentry chokepoint for CAUGHT failures
                                (captureInternalException /
                                captureProviderException)
  db/schema.ts                  All tables (single file)
  db/index.ts                   pg Pool → drizzle client
  utils.ts                      cn() (clsx + tailwind-merge)
  format.ts                     formatDuration() → "m:ss"/"h:mm:ss"
public/sw.js                    PWA service worker (cache-first
                                static only)
scripts/generate-icons.mjs      Regenerates PWA icons in
                                public/icons/
scripts/test-song-parser.ts     Ad-hoc checks for the song parser
                                (npx tsx …) — see "Testing"
android/                        Capacitor 8 Android project
                                (generated, committed) — WebView loads
                                server.url
capacitor.config.ts             appId + server.url (from
                                CAPACITOR_SERVER_URL)
instrumentation.ts              Sentry server init — register() on
                                NEXT_RUNTIME=nodejs + onRequestError
instrumentation-client.ts       Sentry browser init (DSN-gated,
                                replay + tracing + beforeSend)
capacitor-www/                  Placeholder webDir for `cap sync`
                                (SSR app has no static export; APK
                                loads remote URL)
openspec/                       Spec-driven planning: specs/ = current
                                behavior, changes/ = proposed changes
                                (see "OpenSpec")
.agents/skills/                 OpenSpec-generated workflow skills —
                                upstream-owned, keep verbatim
docs/plans/                     Implementation plans with status
                                headers — frozen for new work (see
                                "OpenSpec"), deleted once fully
                                implemented (see Conventions)
.devin/skills/                  Agent skills (see "Agent config
                                layout")
.devin/workflows/               Workflow docs (create-pr.md)
```

## Data model (`lib/db/schema.ts`)

- `users` — parents; `parentPin` (default "0000") gates parent areas;
  `songCommenterHandle` = YT handle whose timestamped comments get
  imported as songs
- `profiles` — kids, owned by `parentId`; avatars are emoji strings;
  optional `username` (unique, shares the login-identifier namespace
  with `users.email`) + `passwordHash` enable kid login
- `videos` — global YouTube video cache, PK = YouTube video ID;
  `isShort` marks Shorts (derived at fetch time: ≤60 s or `#shorts`
  in title/description/tags — the API exposes no flag)
- `channels` — global YouTube channel cache, PK = `UC...` ID, stores
  `uploadsPlaylistId`
- `songs` — global registry of songs parsed from timestamped comments
  on compilation videos (title + `videoId` + `startSeconds`/`endSeconds`;
  `endSeconds` NULL = play to video end). NOT whitelist-tied — shared
  by everyone
- `whitelisted_videos` — (profileId, videoId) pins; `viaChannelId`
  NULL = manual pin, set = added by channel sync
- `whitelisted_channels` — (profileId, channelId) approvals with
  `backfillComplete` / `backfillPageToken` resumable-backfill state
  and `lastSyncAt`
- `channel_video_exclusions` — tombstones so unpinning a
  channel-synced video isn't undone by the next sync
- `channel_sync_exclusions` — (parentId, channelId) mutes: channel
  sync skips the channel for all profiles owned by that parent
- `watch_progress` — (profileId, videoId) resume position +
  `completed`
- `watch_history` — per-profile watch events grouped by day
- `video_reactions` — per-(profile, video) like/dislike
- `playlists` + `playlist_items` — kid playlists with manual ordering
- `daily_syncs` — one row per UTC date = dedup lock for the daily
  sync
- `shared_access` + `invites` — second-parent access via token links

## Business rules & invariants (the contract)

- **Whitelist is absolute.** Kids never see unapproved content: the
  watch page redirects non-whitelisted videoIds, the player polls
  every 500ms and snaps back if a "More videos" suggestion hijacks
  the embed, and `/api/watch-progress` rejects non-whitelisted
  writes.
- **Age suitability — two tiers.** YouTube gives exactly two
  audience flags, treated differently:
  - `age_restricted=true` (YouTube's own 18+ flag) is a **hard
    floor**: the video can never play for kids, even when a parent
    pinned it. Enforced at query time via the shared
    `suitableVideo` WHERE fragment (`lib/video-suitability.ts`,
    `age_restricted IS DISTINCT FROM true` — NULL flags count as
    suitable) on every display/write surface: all
    `lib/kids-feed.ts` queries (which also cover the watch page),
    `lib/songs-feed.ts`, `searchYouTube` hydration, and the
    `/api/watch-progress` + `/api/video-reactions` whitelist
    checks. There is no ingest drop — a pin on a restricted video
    is an inert row, labeled "Blocked" in the dashboard's
    Approved Videos list so it isn't silently invisible.
  - `made_for_kids=true` (the only under-13 signal) is filtered
    **on unvetted surfaces only** — YouTube search hydration and
    the public `/songs` catalog/imports. Parent-approved content
    is exempt: `getVideosBatch` must ingest every embeddable
    video (channel sync's backfill/poll depend on it — filtering
    here silently empties kids' channels), manual pins accept
    made-for-kids videos, and `lib/kids-feed.ts` does not filter
    on the flag.
- **Every mutating server action** must call `getSession()` then
  `assertCanManageProfile(session, profileId)` (owner or
  `shared_access` row). Watch-progress also accepts the
  `activeProfileId` cookie matching the profile (a locked kid device
  may lack a manageable session).
- **Three auth cookies:** `session` = JWT (1 year, rolling refresh
  via `proxy.ts`) in one of two scopes — `role: "parent"` carries
  `user` (a `users` row), `role: "kid"` carries `profileId` + `name`
  and pins the device to that profile's pages. Kid sessions are
  minted by the unified login (`loginKid`); they fail closed on every
  parent check (`assertCanManageProfile`, `requireParentUnlocked`,
  `setParentUnlocked`, `verifyParentPin`) since they carry no `user`
  — call sites needing `session.user` must go through
  `parentSession()` or a `role === "parent"` guard. `decrypt`
  normalizes pre-role parent JWTs to `role: "parent"` so old sessions
  survive. `parentUnlocked` = signed JWT (scope `parent-unlock`,
  bound to the session user, 24h exp) inside a browser-session cookie
  set by `verifyParentPin`/login/signup, cleared by "Kids Corner"
  (`lockParentPortal`) — `/parent/*` is unreachable without it, and
  parent-mutating server actions re-verify it via
  `requireParentUnlocked()` (invite acceptance excepted — the token
  is the credential); `activeProfileId` = which kid profile the
  device is locked to (1 year; also read by `/api/watch-progress` &
  `/api/video-reactions`) — set on kid login too as a compat shim,
  with the signed session winning wherever they disagree. The `/kids`
  picker needs a **parent** session and lists owned+shared profiles
  (`getManageableProfiles`); `/kids/<id>` pages allow the matching
  `activeProfileId` lock, a matching kid session, or a managing
  parent session (`canViewProfile`). PIN verification is server-side
  (`verifyParentPin` reads `users.parentPin` from the DB, with a
  500 ms delay on failures to throttle brute force — login failures
  get the same delay) — never pass the PIN to client components. Kid
  credentials are owner-only (`setKidCredentials` requires
  `profiles.parentId === session.user.id`, like `deleteProfile`); kid
  passwords can be 4 chars vs parents' 6.
- **Channel sync:** approving a channel backfills its uploads
  playlist in the background (`after()`), resumable via
  `backfillPageToken`. Daily sync (`/api/sync-channels`, pinged
  once/day by clients) polls newest uploads until it hits a known
  videoId. Manual unpin of a synced video → tombstone; un-approving a
  channel removes its `viaChannelId` pins and clears its tombstones.
  YouTube quota errors abort the run early. `channel_sync_exclusions`
  are keyed by profile owner; paused channels are filtered in
  `syncAllChannels` and abort mid-flight via the approval re-check,
  and approving a paused channel skips the backfill.
- **Song imports:** parents paste a compilation-video URL in the
  dashboard; `app/actions/songs.ts` fetches the video's comments,
  finds the one by `users.songCommenterHandle`, and parses its
  timestamped tracklist (`lib/song-timestamps.ts`) into `songs` rows.
  Re-import identity = `sourceCommentId`; (videoId, startSeconds) is
  unique.
- **Kids feed memory:** leaving a feed for the watch page and
  returning restores the feed's order, mounted window depth and
  scroll position from a sessionStorage snapshot (`lib/feed-memory.ts`,
  key `nt:feed:<profile>:<feedQuery>` — a sort/filter change is a
  different key → fresh server order). Same-feed `router.refresh()`s
  merge rows in place rather than reordering; the History tab
  restores scroll + expanded day sections only. Snapshot writes are
  bound to the `feedQuery` they were taken under (`useFeedSaver`'s
  `key`) — a param change cancels pending writes and flushes under
  the outgoing key, so one feed's state can never leak into the next
  feed's snapshot. The watch page's Back button is `router.back()`
  when `nt:watchFrom` says the kid arrived via a feed card, else
  `router.push(portalUrl)`.
- **Real-time:** after any whitelist change, trigger Pusher on
  channel `profile-<profileId>` with `video-pinned`/`video-unpinned`;
  `PusherListener` calls `router.refresh()`. Import `pusherServer`
  dynamically inside actions.
- **Watch progress:** client flushes on pause/end/pagehide
  (sendBeacon) and every ~10s while playing; server upserts guarded
  by `sentAt` so late beacons can't overwrite newer positions.
  `completed` ≥95%.
- **Kids portal chrome:** the feed page has no footer — the parent
  gate is the lock icon in `KidsHeader` (`KidsFooterGate` with
  `variant="icon"`); the `/kids` picker keeps the labelled "footer"
  variant. The header avatar links to `/kids/<id>/settings` (gear
  badge — kid self-service avatar picker; same link for kid
  sessions, locked devices and parents), not the `/kids` picker.
  The PIN modal and its verifying spinner portal to
  `document.body` — rendered inline inside the header, its
  backdrop-filter and collapse transform would clip the fixed
  overlay.
- **Kids search is type-ahead:** `KidsSearch` debounces input 300 ms,
  then `router.replace`s inside `startTransition` (`scroll: false`)
  — a native GET form would be a full navigation with no pending
  state. Only `q` changes; the URL is rebuilt from the live
  `searchParams`, so view/channel/list/date/sort/dir/type survive
  untouched.
- **Dashboard vetting params:** `/parent/dashboard` accepts `q`,
  `profileId`, `type` (videos|channels) plus `video` (in-app IFrame
  preview overlay — pin without leaving the page) and `channel`
  (drill-in: header stats + paginated uploads, pin videos or approve
  the channel). `searchYouTube`/`searchChannels` return
  `SearchPage` (maxResults 25 + opaque nextPageToken; search.list is
  100 quota units/call, video search pre-filters with
  `videoEmbeddable`); `loadMoreSearchVideos`/`loadMoreSearchChannels`
  and `loadChannelUploads` (~3 units/page for unapproved
  channels — channels.list fallback + playlistItems + videos.list;
  2/page once the channel row is cached) are read
  actions gated by parentSession + isParentUnlockedCookie +
  assertCanManageProfile. Grids accumulate token-keyed like the kids
  feed — exhaustion = null token, never empty page. Channel uploads
  deliberately show made-for-kids rows (vetted surface) and badge
  age-restricted rows "Blocked" with the pin disabled.
- **Home shelves:** the plain Videos tab (no `q`, no `channel`)
  renders "Continue watching", "Picked for you", "Shorts", "New for
  you", "Your playlists" and "Liked" shelves above the All-videos
  grid, streaming in their own Suspense boundary; empty shelves don't
  render. Watch-page autoplay rebuilds its queue from the card href's
  feed params, so shelf cards carry the params that reproduce the
  right queue — the home feed for the video shelves, `view=foryou`
  for the Picked-for-you shelf, `view=shorts` for the Shorts shelf,
  `view=liked` for the Liked shelf (playlist tiles deep-link to
  their drill-in).
- **Kids feed code is route-private:**
  `app/kids/[profileId]/_components/` holds the per-view server
  components (`videos-view`, `channels-view`, `liked-view`,
  `playlists-view` + `playlist-detail-view`, `history-feed-view`,
  `foryou-view`, `shorts-view`), `home-shelves` and the `KIDS_VIEWS`
  config table
  (labels, icons, titles, placeholders). `feed-header` and
  `back-link` live in `components/` — the public `/songs` catalog
  shares them and the rest of the kids chrome (`KidsHeader`,
  `KidsViewTabs`, `KidsSortChips`, `KidsSearch`, `EmptyState`,
  skeletons). `feed-content.tsx` picks the view; everything below
  the header streams under Suspense. `foryou` and `shorts` are feeds
  with NO tab — each is reached via its home shelf's see-all link
  ("Picked for you", "Shorts"; `?view=foryou`/`?view=shorts` also
  carry the autoplay context); a 6th phone tab was rejected for
  cramped tap targets. `shorts` runs the same For-You ranking with
  type "shorts" and pages via `loadMoreShorts`. Every video-listing
  view also carries an `?type=` segmented filter (All/Videos/Shorts,
  default all): `KidsTypeFilter` in the FeedHeader rewrites `type`,
  each feed query applies it via `typeFilter()` on
  `videos.is_short`, the Channels tab narrows tiles to channels that
  have matching videos, home shelves filter too ("Picked for you"
  collapses into "Shorts" under type=shorts, the Shorts shelf hides
  under type=videos), and the watch page rebuilds its autoplay queue
  with the same type. Beside it, `KidsLengthFilter` is a dual-thumb
  Radix slider (`ui/slider.tsx`) rewriting `?min=`/`?max=` —
  duration_seconds bounds in whole minutes; the left "0m" and
  right "30m+" end positions omit their param = unbounded, NULL
  durations drop out of a bounded band via `lenFilter(minLen,
  maxLen)`), applied everywhere `type` is — shelves, channels,
  playlists, history, For-You paging and the watch-page queue
  included.
- **The `/songs` catalog is public** — `proxy.ts`'s matcher doesn't
  cover it. Anonymous visitors and kid-locked devices (no session)
  get the read-only catalog plus signup chrome; a parent session
  adds the "Yours" tab (`songs.importedBy`), the "Your imports"
  shelf, a ⋮ delete menu on their own rows and a Parent portal link.
  `deleteSong` re-verifies `importedBy === session.user.id`
  server-side. Kid-locked devices also get a Videos pill back to
  `/kids/<activeProfileId>` — the kids header links here via its
  MusicNotes button (the parent dashboard has a "Song catalog"
  button too). Song cards open the `?song=<uuid>` overlay player
  in-app — a watch-page-style full-screen IFrame player that plays
  each song's `start`/`end` segment, then auto-advances through the
  feed's song queue in place (the ?song= URL follows via
  replaceState; last song or Escape → close; rogue suggested-video
  loads snap back to the segment); `?song=` is not a feed param, so
  tab/sort/search navigation closes the overlay.

## Commands

```bash
npm run dev         # dev server (Turbopack), runs on port 3100 via
                    # .vscode/launch.json (npm run dev -p 3100)
npm run typecheck   # tsc --noEmit — run before finishing any change
npm run lint        # eslint (eslint-config-next)
npm run build       # full production build check
npm run format      # prettier --write (uses
                    # prettier-plugin-tailwindcss)
npm run db:generate # drizzle-kit generate → new migration in
                    # drizzle/ — safe, touches files only
npm run db:migrate  # drizzle-kit migrate — runs against
                    # DATABASE_URL_UNPOOLED (Neon's direct endpoint)
                    # via drizzle.config.ts; the pooled URL breaks
                    # migrate's session behavior
npm run videos:refresh -- --dry-run   # re-fetch videos rows missing
                    # YouTube fields (filters: --stale --missing cols
                    # --ids --channel --whitelisted --all --where;
                    # --prune deletes YT-dead videos — destructive,
                    # dry-run first)
npx tsx scripts/test-song-parser.ts   # ad-hoc checks for the song
                                      # parser — see "Testing"
```

DB schema changes: edit `lib/db/schema.ts`, then `npm run
db:generate` (commit the generated `drizzle/` files), `npm run
db:migrate` to apply.

## Android APK

Capacitor wrapper — see `docs/ANDROID_APK.md`. Requires the app to be
deployed at a public HTTPS URL (set `CAPACITOR_SERVER_URL` locally /
`APP_URL` repo variable in CI). `.github/workflows/android-release.yml`
builds a debug APK on the `android` branch / dispatch, a signed
release APK on `v*` tags (attached to that tag's release), and —
on every push to `main` — a signed APK + `update.json` published on
the rolling `continuous` prerelease (installed APKs poll the manifest
and self-update via `AppUpdateBanner`; the `releases/latest` URL
stays on `v*` milestones). Do not push `v*` tags or commits to
`android` casually; each push spends CI and signed releases go
straight to GitHub Releases. Capacitor plugins: `@capacitor/app`,
`@capacitor/keyboard` — after adding/removing plugins run
`npx cap sync android` and commit the `android/` changes
(`app/src/main/assets/` is gitignored; the workflow fails on other
cap-sync drift).

## Sentry event streams

Project `nibrastube-app` in org `nibrastube-a2` (EU, de.sentry.io)
covers BOTH the browser and the Node.js server runtime in a single
project. Init is DSN-gated: `instrumentation-client.ts` (browser)
and `instrumentation.ts` (`register()` on `NEXT_RUNTIME ===
'nodejs'`) only call `Sentry.init` when `NEXT_PUBLIC_SENTRY_DSN` is
set — no DSN, no traffic. `app/global-error.tsx` reports
root-layout render crashes; `lib/report.ts` is the chokepoint for
caught failures.

**INERT until activated**: `NEXT_PUBLIC_SENTRY_DSN` is not yet set
on the `redzi` Vercel project (Production scope, then redeploy —
env vars bake in at build time; pending user action), so prod
sends nothing today. The server-side transport was verified E2E
locally with a real DSN. Org config worth knowing: project
inbound filters (browser-extensions, web-crawlers,
legacy-browsers, localhost), org-level dataScrubber +
sensitiveFields, and a "New issues and regressions (production)"
email workflow matching `environment:production` +
`level:error`. REST `rateLimit` PUTs silently no-op — the
rate-limits feature is not enabled on these orgs.

`is:unresolved level:error environment:production` = agent-fixable
bugs only:

- Client exceptions — `captureException` / `global-error`, level
  error.
- Server/RSC crashes — `onRequestError` + runtime init, level
  error.
- Caught server bugs — `captureInternalException`, level error,
  tag `error_code:internal_error`.
- YouTube quota/outages — `captureProviderException`, level
  warning, tag `error_code:rate_limited` / `provider_error`.

Events carry `environment` from `NEXT_PUBLIC_VERCEL_ENV` /
`VERCEL_ENV` (`production`/`preview`/`development`) and `release`
from the Vercel git SHA, so previews and dev stay out of the prod
queue and `resolvedInNextRelease` resolves at the next deploy.
Logs stay console/Vercel logs — no logging integration events.

REST ops (the agent fix queue) — `source
~/.config/devin/sentry.env` (exports `SENTRY_API_TOKEN`), then:

```bash
curl -sS -H "Authorization: Bearer $SENTRY_API_TOKEN" \
  "https://de.sentry.io/api/0/projects/<org>/<proj>/issues/"\
"?query=is:unresolved+level:error+environment:production"
```

That issue list IS the fix queue; `GET
/issues/<id>/events/latest/` for event detail; `PUT
/issues/<id>/` with `{"status":"resolvedInNextRelease"}` — only
after the fix merges.

Scripting quirk: `import * as Sentry from "@sentry/nextjs"` under
plain `tsx`/ESM loses the named exports (CJS interop) — write
one-off Sentry test scripts as `.cts` + `require()` or import
`@sentry/node` instead.

## Conventions / rules

Repo-local style:

- Style: 2 spaces, double quotes, 80-col width. **Prettier config
  says `semi: false` but all code uses semicolons** — match
  surrounding code; be aware `npm run format` will strip semicolons
  repo-wide (fix the config or the code, don't mix). Tailwind class
  order is enforced by `prettier-plugin-tailwindcss` (`cn`/`cva`
  aware).
- Icons: `@phosphor-icons/react` in client components,
  `@phosphor-icons/react/dist/ssr` in server components.
- Kids UI style: big rounded cards (`rounded-[32px]`/`rounded-3xl`),
  heavy fonts (`font-black`), playful emoji avatars, slate/primary
  palette.
- Forms use server actions via `<form action={...}>`; validation with
  zod `safeParse` on FormData.
- Branch names must use a prefix: `feature/` for new functionality,
  `fix/` for bug fixes, `chore/` for maintenance/tooling, `docs/` for
  documentation, `refactor/` for restructuring without behavior
  change (e.g. `feature/kids-profile-switcher`,
  `fix/dark-mode-titles`).
- Path alias `@/*` → repo root (`tsconfig.json`).
- Env vars needed: `DATABASE_URL` (Neon pooled endpoint),
  `DATABASE_URL_UNPOOLED` (direct endpoint — used by drizzle-kit
  migrate), `JWT_SECRET`, `YOUTUBE_API_KEY`, `PUSHER_APP_ID`,
  `PUSHER_KEY`, `PUSHER_SECRET`, `PUSHER_CLUSTER` (see `.env`,
  never commit it). Sentry: `NEXT_PUBLIC_SENTRY_DSN` enables
  monitoring (reaches the browser bundle AND the Node runtime —
  unset = SDK never initializes); optional build-time
  `SENTRY_AUTH_TOKEN` + `SENTRY_ORG=nibrastube-a2` +
  `SENTRY_PROJECT=nibrastube-app` enable sourcemap upload and
  release creation (skipped silently when unset), and EU-region
  uploads also need `SENTRY_URL=https://de.sentry.io` or they 401.
- Long-lived work is usually done in **git worktrees** under the
  sibling dir `nibrastube-wt/<name>` (`git worktree add
  ../nibrastube-wt/<name> -b <branch> origin/main`) — the main
  checkout often holds the user's uncommitted work; do NOT switch
  branches in it.

Workflow rules (workspace-wide conventions — follow them all):

1. **Max 79 chars per line, every file type** (code, md, config).
   Verify: `awk 'length > 79 {print FILENAME":"NR}' <file>`. Fix
   violations you introduce plus long lines in files already being
   modified. Exempt: Prettier's `printWidth: 80` may emit 80-char
   lines in TS/TSX (formatter output — don't hand-tune it), and
   vendored upstream skill files under `.agents/skills/` and
   `.devin/skills/` (`openspec-*`, `vercel-react-best-practices/`)
   stay verbatim.
   Historical `docs/plans/*` files carry pre-existing long lines
   (tables/code blocks) — don't re-wrap them unless rewriting the
   section anyway.
2. **Commit format** `Type: Capitalized message` —
   `Feat:`/`Fix:`/`Docs:`/`Refactor:`/`Test:`/`Chore:`.
3. **Commit on feature branches only, never `main`.** Stage only
   files changed this session, by path — never `git add -A`,
   `git add .` or `git commit -a`; run `git status` first; leave the
   user's dirty files alone; never commit plan/scratch markdown
   (plan files live in `docs/plans/` — see rule 11 — but only commit
   them for planning work, or briefly inside the implementing PR per
   rule 11's commit-then-delete flow).
4. **Dangerous commands — never run these:**
   - `npm run db:migrate` against `DATABASE_URL` (the pooled
     endpoint) — PgBouncer transaction pooling breaks migrate's
     session behavior; `drizzle.config.ts` already prefers
     `DATABASE_URL_UNPOOLED`, so the plain command is correct.
     Generating migration files (`npm run db:generate`) is always
     safe.
   - `npx drizzle-kit push` — bypasses migration files; README's
     mention is stale.
   - `npm run videos:refresh -- --prune` — deletes rows; dry-run
     first.
   - Pushing `v*` tags or commits to the `android` branch — triggers
     signed release builds.
   - `git push --force`, deleting branches, rewriting history.
   - Anything writing to the production Neon DB beyond the
     sanctioned migrate — if a task genuinely needs it, write the
     change and tell the user the command to run.
5. **Scoped verification** — no test suite exists; verify with
   `npm run typecheck` + `npm run lint` (+ `npm run build` for
   infra-level changes) and a manual run. When touching the song
   parser, run `npx tsx scripts/test-song-parser.ts`.
6. **PR bodies go to a temp file** + `gh pr create --body-file`,
   never inline `--body`; delete the temp file after. See
   `.devin/workflows/create-pr.md`.
7. **Every PR body includes a UI verification / QC section** —
   concrete steps (which pages to open, which buttons to click,
   expected result) exercising the change end-to-end through the UI.
   Omit only when the change is genuinely unreachable from the UI —
   then give an equivalent (curl command, script, log line).
8. **`origin` is the user's fork** — all GitHub operations target
   `Ted-Rose/nibrastube`; never upstream unless asked.
9. **No secrets in code.** Secrets live in `.env` (gitignored) and in
   GitHub secrets/vars (`ANDROID_KEYSTORE_BASE64`, `KEY_ALIAS`,
   `KEYSTORE_PASSWORD`, `KEY_PASSWORD`, `APP_URL` var) for release
   signing. Never print or commit `.env` values or keystores
   (`*.p12`/`*.keystore`/`*.jks` are gitignored).
10. **Keep docs in sync:** update this file (AGENTS.md is the repo's
    contract doc for future sessions) after functionality changes,
    and delete any `docs/plans/*-plan.md` the change fully implements
    (see rule 11).
11. **Plans live in `docs/plans/`** — *frozen for new feature work:
    new plans go through `openspec changes` (see "OpenSpec").*
    Existing `<feature>-plan.md` files keep their status header:
    `implemented` / `partial` / `in progress` / `not implemented` /
    `reverted`. **A fully implemented plan is deleted, not archived**
    — a done plan only garbages the directory. In the implementing
    PR, commit the plan file first (reviewers need the context), then
    delete it in a follow-up commit on the same branch before merge
    so the done plan never lands in `main`. Only `partial` /
    `in progress` / `reverted` plans stay, with the header updated.
12. **Test login for UI verification:** parent account
    `tester@example.com` / `password`, parent PIN `0000`. Use it when
    asked to log in and exercise the UI; if it fails where you're
    testing, ask the user rather than hunting for credentials.
13. **This file is self-updating.** When you hit local-setup,
    infrastructure, or missing-tooling friction — a CLI that isn't
    installed, a non-obvious way to run the project locally, a
    required version or local path — don't grind through many failing
    alternatives. Missing tool → tell the user what to install.
    Working flow or local quirk discovered → write it into this
    AGENTS.md and commit the doc update alongside the work that
    discovered it.

## Agent config layout

- `AGENTS.md` (this file) — the contract doc every agent reads;
  `CLAUDE.md` just `@`-imports it.
- `.devin/skills/fix-good-first-issue/` — pick up a "good first
  issue", fix it, open a draft PR, watch checks.
- `.devin/skills/implement-plan/` — execute a `docs/plans/*-plan.md`
  file with implementer → reviewer → fixer subagents.
- `.devin/skills/vercel-react-best-practices/` — vendored React/Next
  performance rules (SKILL.md index + per-rule files).
- `.devin/skills/openspec-*/` — OpenSpec workflow skills: copies of
  `.agents/skills/openspec-*/` with frontmatter stripped to
  `name:`/`description:` (see "OpenSpec").
- `.devin/workflows/create-pr.md` — PR body via `--body-file`.
- `.devin/config.local.json` — permission allowlist, user-local and
  untracked (gitignored).

Skill frontmatter must be plain `name:` + `description:` only —
extra fields silently break discovery.

## OpenSpec

`openspec/` at the repo root is the spec-driven planning layer (npm
`@fission-ai/openspec`). `openspec/specs/` holds capability specs —
the source of truth for how the system behaves NOW — seeded with
`auth-session`, `whitelist-content`, `action-api-contract` and
`channel-sync`; grow them as real changes touch new areas.
`openspec/changes/` holds proposed changes (`proposal.md`,
`design.md`, `tasks.md` + delta specs that merge into `specs/` on
archive).

- **Run `openspec` commands from the repo root.** The CLI is a
  global npm install under `/opt/homebrew/bin` — prepend it to PATH
  in non-interactive shells (see "Known gaps").
- Workflow: `openspec-propose` → implement via
  `openspec-apply-change` → `openspec-archive-change`. The skills
  live twice: `.agents/skills/openspec-*/` are the upstream-owned
  originals `openspec update` refreshes (keep verbatim);
  `.devin/skills/openspec-*/` are the Devin discovery copies with
  frontmatter stripped to `name:`/`description:`. After
  `openspec update`, re-copy each SKILL.md into `.devin/skills/`
  and re-strip the frontmatter.
- Specs describe CURRENT behavior — write them by verifying claims
  against the code, not stale docs (code wins).
- **`docs/plans/` is frozen for new feature plans** — new feature
  work goes through `openspec changes`. Existing `docs/plans/*`
  files stay as history; rule 11 still governs their lifecycle.

## Known gaps & sharp edges (do NOT "fix" without asking)

- `lib/auth.ts` falls back to `JWT_SECRET="secret"` — dev only,
  always set the env var.
- Parent PIN is stored/compared in plaintext — acceptable for a
  family app, but don't build security-critical features on it.
- `getPusherClient` has a hardcoded fallback Pusher key.
- `capacitor-www/` is an intentional placeholder — the app is SSR and
  has no static export; the APK loads the remote URL. Don't try to
  make `next build` produce an export.
- Dev machine sits behind a TLS-intercepting proxy (Netskope).
  Node-side calls (axios → YouTube) need `NODE_EXTRA_CA_CERTS` (set
  in `~/.zshrc`); Turbopack ignores that var — `.env` carries
  `NEXT_TURBOPACK_EXPERIMENTAL_USE_SYSTEM_TLS_CERTS=1` so
  `next/font`'s Google Fonts downloads validate. Without it every
  render retries the font fetch and stalls for seconds. Do NOT move
  it to `experimental.turbopackUseSystemTlsCerts` in next.config —
  the config key broke tailwindcss module resolution (env var does
  not).
- `/kids/<uuid>` is effectively a capability URL: `activeProfileId`
  is the profile UUID, so anyone who learns a UUID can self-set the
  cookie and view that feed without a session. Unguessable UUIDs keep
  the risk low — this is the accepted model. Kid-session JWTs close
  the forgeable-cookie hole for logged-in kids (signed, server-bound),
  but the lock cookie stays for picker flow and backwards compat.
- YouTube Data API quota is finite (10k units/day); searches are 100
  units each — prefer `videos`/`playlistItems` endpoints in sync
  code.
- Dev server runs on **port 3100** (`.vscode/launch.json` frees the
  port then runs `npm run dev -- -p 3100`) — VSCode stop leaves
  orphaned `next-server` processes holding the port +
  `.next/dev/lock`, so re-launching without the kill prefix caused
  EADDRINUSE. A stray `p_projects/yarn.lock` (parent dir, no
  package.json) once made Turbopack infer that 3.8 GB dir as
  workspace root → slow boots; it was deleted — do NOT set
  `turbopack.root` in next.config to fix this, it breaks tailwindcss
  resolution. If weird resolution errors appear, `rm -rf .next`
  (cache poisoning persists across restarts).
- **`.env` connects to the production Neon Postgres** — every local
  `npm run dev`, script, or DB command touches live data. Two URLs:
  `DATABASE_URL` is the pooled (PgBouncer) endpoint the app uses,
  `DATABASE_URL_UNPOOLED` is the direct endpoint for
  `drizzle-kit migrate` (`drizzle.config.ts` prefers it) and DB
  inspection/`pg_dump`. Both are full-access **production** — treat
  every write as live.
- The pooled `DATABASE_URL` runs through Neon's PgBouncer in
  transaction mode — session-level features (`SET`, `LISTEN`,
  advisory locks) don't survive between statements. The app uses
  none of them, which is why `drizzle-kit migrate`/`pg_dump` must go
  through `DATABASE_URL_UNPOOLED`.
- `npm`/`gh` may be missing from PATH in non-interactive shells
  (`npm: command not found`); prepend
  `export PATH="/opt/homebrew/bin:$PATH"`.

## Testing

No test suite exists. Verify with:

1. `npm run typecheck` and `npm run lint` — required before finishing
   any change.
2. `npm run build` — for infra/config-level changes.
3. `npx tsx scripts/test-song-parser.ts` — ad-hoc assertions for the
   song timestamp parser (`lib/song-timestamps.ts` +
   `parseYouTubeVideoId`); run it when touching song-import code.
4. Manual run on `http://localhost:3100` for UI changes — log in with
   the test account (Conventions rule 12) and walk the flow end to
   end; that's also what every PR's UI-verification section should
   describe.
