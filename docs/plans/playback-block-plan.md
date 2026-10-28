# Plan: Persist runtime playback failures as a block flag

**Status: not implemented**

Scope: when the YouTube IFrame player reports a permanent playback
error for an approved video (age-gate, embed-disabled, removed), flag
the `videos` row so `suitableVideo` hides it on every surface —
feed, watch page, songs catalog, write APIs — instead of the video
being re-offered on every page load.

The in-session half of this already shipped: PR #46 wired
`events.onError` through the shared `useYouTubePlayer` hook into all
three players (watch page skip-chain + 15 s stall watchdog, songs
overlay `finishSong`, preview overlay error notice). This plan is the
persistence half only: an `onError` code → a DB flag → hidden
forever.

## Goal

- A whitelisted video that errors with code 150 (age-gate — cannot
  play embedded without sign-in), 101 (owner disabled embedding), or
  100 (removed/private) is recorded once in the DB and never shown
  again to any profile.
- Transient codes (2 invalid param, 5 HTML5 error) and the watchdog's
  no-event stall skip in-session only — no write.
- No new table: `suitableVideo` is already the single choke point
  every display/write query ANDs in (`lib/kids-feed.ts` all feed
  functions, `lib/songs-feed.ts`, watch-page redirect via the feed
  query, `/api/watch-progress`, `/api/video-reactions`,
  `app/actions/playlists.ts` visibility join). Extending the fragment
  is the entire enforcement change.

## Facts established by codebase investigation

- `events.onError` exists end-to-end: `lib/yt-player.ts:38`,
  `PlayerEvents` (`components/player-hooks.ts:32`), dispatched with a
  cancelled-guard at `player-hooks.ts:147-150`.
- Watch page: `onError: () => swipeNavRef.current?.skip()`
  (`watch-experience.tsx:238-244`) → `skipAndAdvance` (:453-460)
  marks `skippedRef`, frees `advancingRef`, stops when every queue
  entry failed. `skip` is also the watchdog's path (:399-413) — a
  stall has no error code and is often the network's fault, so only
  the `onError` call site passes a code.
- **Event-handler identity recreates the player.** `useYouTubePlayer`
  re-runs its effect on `events` identity (`player-hooks.ts:177-184`),
  so callers memoize `events` and delegate into effect closures via
  refs (`swipeNavRef`, `finishRef`). The flag POST must live inside
  those delegated callbacks — adding `stablePlaylist`/`queue` to the
  `events` memo deps would rebuild the iframe on every refresh.
- **Flag the loaded video, not the indexed one.** The video that
  errored is whatever the embed last loaded —
  `loadedVideoId(playerRef.current)`. A rogue "More videos"
  suggestion can load (and then error) inside the same iframe;
  posting `stablePlaylist[indexRef.current].id` in that case would
  flag an approved video that never failed. Posting the loaded id
  instead sends a rogue id to the server, where the whitelist check
  403s it harmlessly. `playerRef` is not reachable from the
  memoized `events` object (the hook creates it) — another reason the
  POST belongs in the delegated closures. Fallback to the expected
  id only when `loadedVideoId` returns undefined.
- `videos.ageRestricted` / `videos.embeddable` are **YouTube-API
  sourced**: `upsertVideoRows` (`lib/video-cache.ts:22-46`)
  overwrites both with `excluded.*`, so `npm run videos:refresh`
  silently clears any flag written into them at runtime. A
  player-observed block needs its own column(s) that refresh never
  touches. `age_restricted`'s documented semantic is
  `contentRating.ytRating === ytAgeRestricted` — overwriting it from
  a client error code would also conflate provenance on the
  dashboard's "Blocked" badge
  (`app/parent/dashboard/_components/dashboard-video-card.tsx`,
  `pinned-videos-panel.tsx`).
- IFrame-API `onError` `event.data` codes: 2 (invalid param),
  5 (HTML5 error), 100 (not found/private/removed), 101 (owner
  disallows embedding), 150 (docs: alias of 101; in practice the
  age-gate/embedding-impossible response).
- Write-API auth pattern (`watch-progress/route.ts:34-47`,
  `video-reactions/route.ts:30-43`): kid session must match
  `body.profileId`; else `activeProfileId` cookie match; else
  `assertCanManageProfile(session, profileId)`. Both then require a
  `whitelisted_videos` join before writing. `parentSession(session)`
  (`lib/auth.ts:47`) identifies a parent session for the
  no-profileId branch.
- `/api/*` is not in `proxy.ts`'s matcher
  (`["/", "/parent/:path*", "/kids/:path*", "/login", "/signup"]`) —
  a new API route needs no proxy changes.
- `videos` is a **global** registry shared by every family — a flag
  written by one profile hides the video for all. Acceptable because
  (a) the watch-page write is gated on the video being whitelisted
  for the caller's profile, so a kid can only flag content their own
  parent approved, and (b) 101/150 mean "YouTube refuses this embed"
  — an objective, platform-level verdict, not a preference.
  Residual: 150 also fires for region locks, which are
  viewer-country-specific — `blocked_reason` preserves provenance if
  a future admin surface needs to distinguish/heal.
- `videos:refresh` does not see the new column → the flag is sticky.
  Deliberate: YouTube can re-enable embedding later, but until an
  admin/heal path exists a false positive just re-errors once per
  unblocking rather than per page load.
- Playlist add (`app/actions/playlists.ts:148-154`) guards
  `ageRestricted === true` explicitly — it needs the same check for
  the new flag (a blocked video is equally inert).
- Sentry (`lib/report.ts`): do NOT report these. A 101/150 is an
  expected upstream verdict, not a bug — `captureInternalException`
  would pollute the level:error agent-fix queue and even
  `captureProviderException` warnings aren't actionable (the DB flag
  IS the record).
- Related-but-separate: `embeddable IS DISTINCT FROM false` in
  visibility fragments (songs-domain #3, refactoring-plan D8) covers
  *API-ingest* gating — still open. This plan covers
  *runtime-observed* gating; they compose, neither subsumes the
  other.

## Phase 1 — `playback_blocked` columns + `suitableVideo` — [behavior]

- `lib/db/schema.ts` `videos` table, beside `embeddable`:
  - `playbackBlocked`:
    `boolean("playback_blocked").default(false).notNull()`
  - `blockedReason`: `text("blocked_reason")` — "age-gated" |
    "embed-disabled" | "unavailable"
  - `blockedAt`: `timestamp("blocked_at", { withTimezone: true })`
- `npm run db:generate` → migration `0016_*.sql`; `npm run db:migrate`.
- `lib/video-suitability.ts`: extend the fragment to
  `age_restricted is distinct from true AND playback_blocked = false`
  and update the comment block — the floor is now "YouTube-flagged
  18+ OR player-verified unplayable". Every feed, the watch-page
  redirect, both write APIs, playlist visibility, and the songs
  catalog pick it up untouched.
- `app/actions/playlists.ts:148-154`: select `playbackBlocked` too;
  throw on `ageRestricted === true || playbackBlocked === true`
  (message "Video can't be played").
- Verify: `npm run typecheck` + `npm run lint`; `UPDATE videos SET
  playback_blocked=true WHERE id=<whitelisted>` in SQL → video
  vanishes from the kid feed and `/kids/<p>/watch/<id>` redirects to
  the portal; `=false` restores it.

## Phase 2 — `POST /api/video-errors` — [behavior]

New `app/api/video-errors/route.ts`, modeled verbatim on
`video-reactions/route.ts` (same file shape, same auth block).

- zod body: `{ videoId: z.string().min(1), code: z.union([
  z.literal(100), z.literal(101), z.literal(150)]),
  profileId: z.string().uuid().optional() }`.
- Auth, either branch:
  1. `profileId` present → the standard triple (kid session must
     match, else `activeProfileId` cookie, else
     `assertCanManageProfile`) **plus** a
     `(profileId, videoId)` row in `whitelisted_videos`. The
     whitelist requirement does double duty: a rogue "More videos"
     suggestion that errors inside the embed produces a POST the
     server 403s — it can't be flagged, since it was never
     approved. Do NOT add `suitableVideo` to this join — re-flagging
     an already-blocked row is idempotent and keeps `blocked_reason`
     updatable.
  2. `profileId` absent → require a parent session
     (`parentSession(session)`), covering the dashboard `?video=`
     preview and `/songs` player where no whitelist row exists. A
     kid/anon visitor's POST 403s harmlessly.
- Write: `db.update(videos).set({ playbackBlocked: true,
  blockedReason, blockedAt: new Date() }).where(eq(videos.id,
  videoId))`; map `150 → "age-gated"`, `101 → "embed-disabled"`,
  `100 → "unavailable"`. Row absent (never cached — e.g. a rogue
  suggestion flagged from the songs surface) → `{ ok: false }, 404`.
  No pusher, no `revalidatePath` — the flag is global and the next
  render of any surface picks it up.
- Verify: `curl -X POST` with a kid-locked `activeProfileId` cookie →
  `{ok:true}` and `playback_blocked` set; repeat with a
  non-whitelisted videoId → 403; `code:5` → 400.

## Phase 3 — Wire the POST into the existing `onError` paths —
[behavior]

All three players already handle `onError`; this phase only threads
`event.data` into the delegated callbacks and adds the fetch. Same
`.catch(() => {})` posture as `useProgressFlush` — a dropped report
is retried on the next watch of the dead video.

### 3.1 Watch page (`components/watch-experience.tsx`)

- `swipeNavRef` type (:119-123): `skip: (code?: number) => void`.
- `events.onError` (:238-244): `(event) =>
  swipeNavRef.current?.skip(event.data)` — no memo-dep change.
- `skipAndAdvance(code?: number)` (:453-460): after
  `skippedRef.current.add(cur.id)`, if `code` ∈ {100, 101, 150}:

  ```ts
  fetch("/api/video-errors", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      profileId,
      // The video that actually errored — a rogue suggestion's id
      // gets a 403, never flags the approved video.
      videoId: loadedVideoId(playerRef.current) ?? cur.id,
      code,
    }),
  }).catch(() => {});
  ```

- The watchdog's `skipAndAdvance()` call (:411) passes no code →
  no flag (a stall isn't the video's fault).
- Verify: pin a video that 150s in the embed (region-locked or
  age-gated — the pin path accepts them, OVERALL #11) → watch page
  auto-skips, `playback_blocked` row appears, and the video is gone
  from the feed on the next load.

### 3.2 Songs overlay (`components/song-player-overlay.tsx`)

- `finishRef` type (:61): `((code?: number) => void) | null`.
- `events.onError` (:73-79): `finishRef.current?.(event.data)`
  alongside the existing advancingRef release.
- Inside `finishSong(code?: number)` (:139-147) — fresh `queue`
  closure, `playerRef` in scope — same POST minus `profileId` with
  `loadedVideoId(playerRef.current) ?? queue[indexRef.current]
  .videoId` (`cur.id` is the song uuid, `videoId` the YouTube id —
  do not mix them up).
- Verify: `/songs?song=` a queue containing a dead compilation → it
  is skipped in place; signed-in parent → `playback_blocked` set;
  anon visitor → 403, no flag (skip still works).

### 3.3 Parent preview (`app/parent/dashboard/_components/
video-preview-overlay.tsx`)

- `events.onError` (:63-68): `(event) => { setErrored(true); <POST
  {videoId: video.id, code: event.data}> }` — `video.id` is a stable
  prop; add it to the memo deps. Parent session → branch 2 flags a
  dead video before it's ever pinned.
- Verify: `?video=` an embed-blocked video → notice shows AND
  `playback_blocked` is set.

## Out of scope / follow-ups

- Admin unblock/heal path (e.g., `videos:refresh --unblock` clearing
  `playback_blocked` when the API says `embeddable=true`,
  region-lock false positives). `blocked_reason`/`blocked_at` exist
  to support it.
- Parent-facing "blocked" badge on dashboard cards
  (`_components/pinned-videos-panel.tsx` shows one for
  `ageRestricted` — same treatment would surface player-verified
  blocks).
- Sentry reporting — deliberately not wired (see Facts).
- Flagging on watchdog stalls or codes 2/5 (transient — skip only).
