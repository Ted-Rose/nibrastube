# Architecture Review

**Overall health: Good (~8/10).** The codebase has a clear,
  consistently-followed architecture: mutations live in `app/actions/*.ts`,
  read queries in `lib/*-feed.ts`, YouTube access in `lib/youtube.ts`, pages
  are Server Components that stream via Suspense, and client components exist
  only where interactivity demands. Comments are exceptional — nearly every
  non-obvious invariant, race, and quota cost is documented in place. The main
  debt is a small set of duplicated cross-cutting preambles, two oversized
  files, and a few client-bundle/auth inconsistencies.

## Strengths

- **Single-point safety enforcement.** `lib/video-suitability.ts`'s
  `suitableVideo` SQL fragment is ANDed into every kid-facing query
  (`lib/kids-feed.ts` all 7 feed functions, `lib/songs-feed.ts`, both write
  APIs in `app/api/`), and the whitelist is triple-enforced (watch-page
  redirect at `app/kids/[profileId]/watch/[videoId]/page.tsx:146-153`, 500 ms
  rogue-video snapback in `watch-experience.tsx:402-430`, write guards in the
  API routes). Adding the 18+ floor required touching almost nothing —
  exactly how a global invariant should work.
- **Disciplined auth model.** `lib/auth.ts` discriminates `SessionPayload` into
  `ParentClaims | KidClaims`; `parentSession()` is the only sanctioned way to
  reach `session.user`, so kid claims can't leak into parent checks. `decrypt`
  normalizes legacy JWTs and shape-validates (fail closed). `parentUnlocked` is
  a signed, user-bound JWT — forgeable-cookie attacks are closed except the
  deliberately-accepted `activeProfileId` capability URL.
- **URL-as-state done right.**
  `parseKidsFeedParams`/`kidsFeedQuery`/`kidsPortalUrl`
  (`lib/kids-feed.ts:106-188`) and the `songs-feed.ts` twins keep every filter
  in the URL; watch pages rebuild the autoplay queue from card hrefs, so
  filters, search, and back/forward compose correctly. Param validation rejects
  bad values into defaults rather than 500ing (`isCalendarDate` roundtrip at
  line 96 is a nice touch).
- **Performance awareness throughout.** Slim column selects (`feedVideoCols`
  — avoids ~9 KB `raw` JSONB per row), `react cache()` on
  `getPlaylists`/`getSongs` for per-request dedup, per-region Suspense
  streaming, client-side windowing (`PAGE_SIZE = 48` in `kids-video-grid.tsx`),
  eager/lazy thumbnail budgets, and quota-cost comments on every YouTube call.
- **Thoughtful channel sync** (`lib/channel-sync.ts`): resumable backfill via
  `backfillPageToken`, tombstones so unpins stick, mid-flight re-checks of
  approval/pause state before every batch insert, early abort on quota errors,
  atomic dedup via `daily_syncs` insert-returning.
- **Good conventions.** Route-private `_components/` for view code vs shared
  `components/`; consistent `{ video, progress, reaction }` row shape so
  cards/autoplay reuse queries; `view-config.tsx` tables instead of parallel
  ternaries; icon split (`/dist/ssr` on server, plain on client).

## Issues

**Med severity**

1. **Server Pusher SDK bundled into the client.**
   `components/pusher-listener.tsx` (a `"use client"` file) statically imports
   `getPusherClient` from `lib/pusher.ts`, which instantiates `new
   PusherServer({ secret: process.env.PUSHER_SECRET! })` at module scope (lines
   4-9). The secret value won't reach the browser (non-`NEXT_PUBLIC_` envs
   evaluate to `undefined`), but the entire Node `pusher` package ships to
   every kid's browser as dead weight and could break on a bundler/SDK change.
   Split into `lib/pusher-server.ts` + `lib/pusher-client.ts`.
2. **Unauthenticated trigger that spends money.**
   `app/api/sync-channels/route.ts` exposes GET *and* POST with no auth — any
   crawler/bot hitting `GET /api/sync-channels` once per UTC day claims the
   `daily_syncs` slot and burns YouTube quota. The dedup makes it once/day, but
   the first caller wins (a bot could starve legitimate pings or just cost
   quota daily). Gate it on a secret header or session.
3. **Auth preamble duplicated across write surfaces.** The `isKidSession →
   activeProfileId → assertCanManageProfile` chain is copy-pasted nearly
   verbatim in `app/api/watch-progress/route.ts:34-47` and
   `app/api/video-reactions/route.ts:30-43`, and re-implemented with different
   semantics in `lib/profiles.ts#assertCanEditKidData` (which additionally
   verifies a kid session's profile still exists — the API routes skip that,
   so a deleted profile's JWT writes hit an FK error → 500 instead of 403).
   Extract one `assertKidWriteAccess(profileId): Promise<{ok, status}>` helper.
4. **Inconsistent server-action error contracts.** `pinning.ts`/`channels.ts`
   return `void` and `console.log` failures; `playlists.ts` throws `Error`;
   `profiles.ts`/`songs.ts`/`auth.ts` return `{ error }` state objects; read
   actions (`kids-feed.ts`, `search.ts`) throw. Four conventions — a client
   can't uniformly surface failure. Also debug `console.log`s remain at
   `pinning.ts:24,29,103,108` and `invites.ts:31`.
5. **`app/parent/dashboard/page.tsx` is a god-page** (822 lines): the shell
   plus four private async sub-components (`PinnedVideosCard`,
   `ApprovedChannelsCard`, `SongImportCard`, `SearchResults`) plus the
   `dashboardUrl` builder. Works, but it's the worst offender against the
   repo's own `_components/` convention — moving these into
   `app/parent/dashboard/_components/` matches what was already done for
   `channel-detail`/`video-preview`.
6. **Hydration + reader-gate duplication on the dashboard.**
   `app/actions/channel-videos.ts:44-91` and
   `app/parent/dashboard/_components/channel-detail.tsx:102-160` repeat the
   same resolve-playlist → `getUploadsPage` → `getVideosBatch` →
   `upsertVideoRows` → pinned-lookup flow (~30 lines each), and
   `assertDashboardReader` (`search.ts:42-49`) is re-implemented inline in
   `channel-videos.ts:37-42`. Extract `hydrateChannelUploads()` and share
   the guard.
7. **`components/watch-experience.tsx` is the fragility hotspot** (~800 lines):
   one giant `useEffect` (~340 lines, deps: 8 values) managing ~15 refs for
   player lifecycle, flush, nav stack, swipe, reactions. All justified
   behavior, but the effect re-runs and destroys/recreates the player whenever
   the `playlist` prop identity changes (Pusher refresh), and three components
   (`watch-experience`, `song-player-overlay`, `video-preview-overlay`)
   re-implement the same `ensureYouTubeAPI → createPlayer
   → onReady-ref-publish
   → tick` lifecycle. Extract a `useYouTubePlayer` hook and smaller sub-hooks
   (`useProgressFlush`, `useNavStack`).
8. **No error boundaries.** Zero `error.tsx`/`not-found.tsx`/`global-error.tsx`
   files — a Neon hiccup or thrown render surfaces Next's default
   error screen
   (jarring on a kid device), and `notFound()` on the kids pages renders the
   stock 404 without kid chrome.
9. **Unvalidated uuid args reach uuid columns.** Most actions call
   `assertCanManageProfile(session, profileId)` before validating `profileId`'s
   shape — a crafted non-uuid value hits `eq(profiles.id, ...)` → Postgres
   `invalid input syntax` → 500 (`pinVideo`, `approveChannel`, `unpinVideo`,
   etc.). Playlists validate `playlistId` but not `profileId`. Cheap fix: one
   shared `z.uuid()` check inside the assert helpers.

**Low severity**

10. `proxy.ts` decrypts the JWT twice per request (`getRequestSession` at line
    46, then again inside `updateSession` at line 164); `getSession()`
    similarly re-verifies on every call within an RSC render — wrap
    `decrypt`/`getSession` in `react cache()`.
11. Empty-state message/action ternary chains are repeated per view
    (`videos-view.tsx:127-165`, `history-feed-view.tsx:38-74`, etc.) —
    consolidate into `view-config` or an `emptyStateFor(feed)` helper.
12. `inviteParent` doesn't validate `email` (only the form's `type=email`),
    never sends the invite (token is only `console.log`ged — feature
    incomplete), and `acceptInvite` doesn't bind `invite.email` to the
    accepting user (documented as token-as-credential, but then `invites.email`
    is decorative).
13. `components/ui/button.tsx` is `"use client"` — every
    server-rendered Button
    ships client JS; the shadcn `Card`/`Input` are correctly server components,
    so this stands out.
14. `shared_access.role` has `"viewer"`/`"editor"` values in schema but only
    `"editor"` is ever granted — dead role.
15. Main videos grid returns the entire whitelist (~2k rows possible) and
    windows client-side; `SONGS_LIMIT = 240` is a hard cap — both documented
    seams, worth revisiting before profiles grow further.
16. `getPusherClient` carries a hardcoded fallback Pusher key and `lib/auth.ts`
    a `"secret"` JWT fallback — both documented known gaps, but a
    `NEXT_PUBLIC_PUSHER_KEY` build-time check and a startup JWT_SECRET assert
    would close them cheaply.

**Recommendation priorities:** (a) split `lib/pusher.ts`, (b) auth-gate
  `/api/sync-channels`, (c) extract the shared kid-write guard for API routes +
  `assertCanEditKidData`, (d) break up the dashboard page into `_components/`,
  (e) unify action error contracts, (f) add at least a root
  `error.tsx`/`not-found.tsx` with kid-safe chrome.
