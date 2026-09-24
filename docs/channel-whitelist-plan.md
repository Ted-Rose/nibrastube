# Plan: Channel Whitelisting ("Approve Entire Channel")

Let parents approve a whole YouTube channel for a kid. All existing videos are
backfilled, and every future upload is auto-approved by a daily sync triggered
when the app is opened.

Decisions (confirmed):

- **Backfill**: all existing videos in the channel's uploads playlist.
- **Un-approve**: removes all channel-auto-added videos; manually pinned videos
  stay.
- **New videos**: daily polling triggered by a client ping on app open; the
  server dedupes to at most one run per day.
- **Kids UI**: unchanged — channel videos appear like regular pins in the grid
  and in the watch page's auto-advance playlist (see §7).

## Design overview

```
Parent approves channel
  └─> channels + whitelisted_channels rows created (backfillComplete=false)
  └─> sync engine backfills uploads playlist in batches of 50
        └─> insert into videos + whitelisted_videos (viaChannelId set)

App open ──> DailySyncPing component (localStorage-gated, once/day/device)
  └─> POST /api/sync-channels
        ├─> insert daily_syncs row for today (UTC); conflict → "already done"
        └─> else for each whitelisted_channels row:
              ├─> resume backfill if incomplete
              └─> else fetch newest uploads page, stop at first known videoId
                    └─> insert new videos + whitelist rows, trigger Pusher refresh
```

Materializing pins into `whitelisted_videos` keeps the kids portal query
unchanged and allows per-video unpin overrides.

## 1. Schema changes (`lib/db/schema.ts`)

New tables / columns (one drizzle migration via `drizzle-kit generate` +
`drizzle-kit migrate`). Note: there is no `drizzle/` dir or `db:migrate` npm
script yet — `generate` creates `./drizzle` per `drizzle.config.ts`; either run
`npx drizzle-kit migrate` directly or add a script:

- **`channels`**
  - `id text pk` — YouTube channel ID (e.g. `UC...`)
  - `title text`, `thumbnail text`
  - `uploadsPlaylistId text` — from `channels.list` `contentDetails`
  - `createdAt timestamp`

- **`whitelisted_channels`** (pk: `profileId` + `channelId`)
  - `profileId uuid → profiles.id (cascade)`
  - `channelId text → channels.id (cascade)`
  - `approvedAt timestamp`
  - `backfillComplete boolean default false`
  - `backfillPageToken text` — resume cursor for large channels
  - `lastSyncAt timestamp` — last poll time (for incremental fetch + UI)

- **`whitelisted_videos`**: add `viaChannelId text` (nullable).
  `null` = manually pinned. Lets un-approve delete only channel-sourced pins.

- **`channel_video_exclusions`** (pk: `profileId` + `videoId`)
  - `profileId uuid`, `videoId text`
  - Tombstone so the sync does not re-add a video the parent explicitly
    unpinned from an approved channel.

- **`videos`**: add `channelId text` (needed to attribute pins; backfill fills
  it; backfill existing rows lazily or leave null — only used for new inserts).

- **`daily_syncs`** (pk: `syncDate`)
  - `syncDate text pk` — UTC date, `YYYY-MM-DD`
  - `startedAt timestamp`, `finishedAt timestamp`, `channelsSynced integer`
  - Doubles as the daily dedup lock: the route inserts today's row with
    `onConflictDoNothing`; if the row already exists it replies
    `{ alreadyDone: true }` and does no work. Concurrent pings are safe —
    exactly one insert wins.

## 2. YouTube client (`lib/youtube.ts`)

Add (keep axios + `BASE_URL` style):

- `searchChannels(query)` — `/search` with `type: "channel"`, `part: "snippet"`.
  Optionally extend `searchYouTube` to `type: "video,channel"` for one mixed
  result list.
- `getChannelDetails(channelId)` — `/channels` `part: "snippet,contentDetails"`
  → `{ id, title, thumbnail, uploadsPlaylistId }`.
- `getUploadsPage(playlistId, pageToken?)` — `/playlistItems`
  `part: "snippet,contentDetails"`, `maxResults: 50` → `{ videoIds, nextPageToken }`.
  1 quota unit per call — much cheaper than `search.list` (100 units).
- `getVideosBatch(ids: string[])` — `/videos`
  `part: "snippet,status"`, up to 50 ids per call → full metadata; **filter to
  `status.embeddable === true`** since playback is via embedded IFrame.

Quota math (default 10,000 units/day): backfill a 1,000-video channel ≈
20 playlistItems calls + 20 videos calls + 1 channels call ≈ **41 units**.
Daily poll ≈ 1 unit/channel (+ 1 per 50 new videos).

## 3. Sync engine (`lib/channel-sync.ts`, new)

- `backfillChannel(profileId, channelRow)`:
  - loop `getUploadsPage` with stored `backfillPageToken`; for each page:
    `getVideosBatch` → upsert `videos` (with `channelId`) → insert
    `whitelisted_videos { profileId, videoId, viaChannelId }` with
    `onConflictDoNothing`, skipping ids in `channel_video_exclusions`.
  - persist `backfillPageToken` after each page (crash/quota-safe resume);
    set `backfillComplete = true` when `nextPageToken` is absent.
- `pollChannel(profileId, channelRow)` (runs only when backfill complete):
  - fetch first uploads page(s); collect items until hitting a `videoId`
    already in `whitelisted_videos` for that profile (newest-first ordering),
    then insert the new batch and update `lastSyncAt`.
  - Pusher: one `video-pinned` trigger on `profile-${profileId}` per synced
    batch → existing `PusherListener` calls `router.refresh()`.
- `syncAllChannels()`:
  - select `whitelisted_channels` joined to `channels`, ordered by `lastSyncAt`
    nulls-first; cap per run (e.g. 50 channels or a time budget ~4 min) so the
    work fits the host's execution limits; remaining channels picked up on the
    next day's ping (or continue in the background via `after()` — see §5).
  - Per-channel try/catch: log and continue; on quota error (403
    `quotaExceeded`) abort the whole run early.

## 4. Server actions

New `app/actions/channels.ts`:

- `approveChannel(profileId, channelId)`:
  - authz: session + profile ownership/shared access (see §6).
  - upsert `channels` via `getChannelDetails`; insert `whitelisted_channels`.
  - kick off `backfillChannel` in the background (`after()` from
    `next/server`, or just await the first few pages then let the next daily
    sync finish).
- `unapproveChannel(profileId, channelId)`:
  - delete `whitelisted_channels` row;
  - delete `whitelisted_videos` where `profileId` + `viaChannelId = channelId`
    (manual pins survive);
  - delete that channel's `channel_video_exclusions` rows;
  - Pusher `video-unpinned` + `revalidatePath`.

Update `app/actions/pinning.ts`:

- `pinVideo`: unchanged (inserts with `viaChannelId = null`); when pinning a
  video that has an exclusion row, delete the exclusion.
- `unpinVideo`: if the removed row had `viaChannelId` set, insert a
  `channel_video_exclusions` tombstone so sync doesn't resurrect it.

## 5. Daily sync endpoint + client ping

No scheduler — the client pings the server on app open, at most once per day.

**Server**: `app/api/sync-channels/route.ts` — `POST` handler (also accept
`GET` for manual triggering):

- Compute today's UTC date; insert `{ syncDate: today, startedAt: now }` into
  `daily_syncs` with `onConflictDoNothing`.
- Row already existed → `NextResponse.json({ ok: true, alreadyDone: true })`,
  no work. This is the single source of truth for "job done today".
- Insert won → run `await syncAllChannels()` (or hand it to `after()` from
  `next/server` so the route responds immediately and the sync continues in
  the background — preferred, since it removes the request-timeout concern),
  then set `finishedAt` + `channelsSynced` on the row and respond
  `{ ok: true, synced }`.
- No `CRON_SECRET` needed: the `daily_syncs` row makes the endpoint idempotent
  per day, so an unauthenticated ping can at worst trigger a sync that would
  have happened anyway. (`proxy.ts`'s matcher only covers `/parent`, `/kids`,
  `/login`, `/signup`, so `/api/*` is reachable without a session — required
  here since the ping fires on app open.)
- Local dev / manual run: `curl -X POST localhost:3000/api/sync-channels`.

**Client**: new `components/daily-sync-ping.tsx` (client component):

- `useEffect` on mount: read `localStorage["nibrastube:lastSyncPing"]`; if it
  equals today's local date, do nothing. Otherwise
  `fetch("/api/sync-channels", { method: "POST" })` and, on success, write
  today's date. (On failure leave it unset so the next app open retries.)
- Mount next to `PusherListener` in `app/kids/[profileId]/page.tsx` and in the
  parent dashboard — covers both "kid opens app" and "parent opens app".
  localStorage makes the gate per-device; multiple devices may each ping, and
  the `daily_syncs` row dedupes them server-side.

Tradeoff vs a scheduler: channels only sync when someone opens the app. If the
app sits unused for days, the next ping catches up — `pollChannel`'s
stop-at-first-known-videoId logic handles multi-day gaps (just pages through
more items).

## 6. Authorization hardening (bundle with this work)

`pinVideo`/`unpinVideo` currently check only that a session exists — any logged
in parent can pin to any `profileId`. Add a shared helper, e.g.
`assertCanManageProfile(session, profileId)`, that allows
`profiles.parentId === user.id` OR a `shared_access` row, and call it from
`pinVideo`, `unpinVideo`, `approveChannel`, `unapproveChannel`. Note
`lib/profiles.ts` does not exist — create it, or put the helper in
`lib/auth.ts`.

Related gap to fix while here: the dashboard only queries
`profiles.parentId === session.user.id`, so shared-access parents can't see or
reach those profiles at all (PRD Flow C claims they can). Include
`shared_access` profiles in the dashboard's profile query — otherwise the
hardened helper authorizes actions the UI can never trigger.

## 7. Parent dashboard UI (`app/parent/dashboard/page.tsx`)

- Search: add a **Videos / Channels toggle** (or search both types) —
  `?type=channels` param; channel cards show avatar, title, and an
  "Approve Channel" button bound to `approveChannel` (`PushPin` → `Check`
  state when already approved).
- Sidebar: new "Approved Channels" card per kid — channel avatar/title, pinned
  count, and a spinner/"Syncing…" badge while `backfillComplete = false`;
  remove button → `unapproveChannel`.
- Consider a small "last synced" line using `lastSyncAt`.
- Kids portal: **no visible changes** — materialized pins flow into the
  existing grid. The only addition is mounting the invisible `DailySyncPing`
  component (§5) next to `PusherListener`. Since this plan was written the
  portal gained a fullscreen watch page
  (`/kids/[profileId]/watch/[videoId]`) that auto-advances through the
  whitelist ordered by `pinnedAt`, plus a guard in `watch-experience.tsx` that
  snaps the embed back if YouTube's "More videos" loads an unapproved video.
  Both derive from `whitelisted_videos`, so channel videos work unchanged —
  but note that backfilled pins all get `pinnedAt ≈` backfill time, so an
  approved channel's catalog will dominate the tail of the auto-advance order.
  Acceptable for V1; revisit if ordering matters.

## 8. Edge cases

- **Quota exceeded** mid-backfill → `backfillPageToken` resumes next run; UI
  shows "Syncing…".
- **Deleted/private/non-embeddable videos**: `getVideosBatch` only returns
  live videos and we filter `status.embeddable`, so dead items never enter
  `videos`. (V1 does not retroactively prune videos later deleted on YouTube —
  acceptable; note as follow-up.)
- **Re-approving a removed channel**: exclusions for that channel were deleted
  with it, so the full catalog is re-added — matches "approve = trust channel".
- **Duplicate videos across channels / manual pins**: `onConflictDoNothing` on
  the `whitelisted_videos` pk; unpinning removes the row regardless of source
  (one pin per profile+video).
- **Ping safety**: the `daily_syncs` row makes repeated/concurrent calls
  no-ops; inserts are idempotent; per-run work is capped. If a run crashes
  after claiming the day (`finishedAt` stays null), V1 treats it as done —
  the next day's ping resumes everything (backfill via `backfillPageToken`,
  poll via last-known videoId). Optional refinement: allow a same-day retry
  when `startedAt` is older than some threshold and `finishedAt` is null.

## 9. Task breakdown

1. Schema: add `channels`, `whitelisted_channels`, `channel_video_exclusions`,
   `daily_syncs`, `videos.channelId`, `whitelisted_videos.viaChannelId`;
   `drizzle-kit generate` + apply migration.
2. `lib/youtube.ts`: `searchChannels`, `getChannelDetails`, `getUploadsPage`,
   `getVideosBatch` (embeddable filter).
3. `lib/channel-sync.ts`: `backfillChannel`, `pollChannel`, `syncAllChannels`.
4. Create `lib/profiles.ts` with `assertCanManageProfile`; wire into pinning
   actions; include `shared_access` profiles in the dashboard query.
5. `app/actions/channels.ts`: `approveChannel` / `unapproveChannel`; update
   `unpinVideo`/`pinVideo` for `viaChannelId` + exclusions.
6. `app/api/sync-channels/route.ts` (daily dedup via `daily_syncs`) +
   `components/daily-sync-ping.tsx` (localStorage once-per-day gate), mounted
   in the kids portal and parent dashboard.
7. Dashboard UI: channel search toggle, approve button, "Approved Channels"
   card with sync status.
8. Verify: `npm run typecheck`, `npm run lint`, `npm run build`; manual end-to
   end — approve a small channel, `curl -X POST` the sync route, confirm
   videos appear in kids portal and new uploads sync; ping again same day,
   confirm `{ alreadyDone: true }`; clear the localStorage key and reload the
   app, confirm no extra sync runs; unpin one video, re-run sync, confirm it
   is not re-added; un-approve channel, confirm its videos are removed but
   manual pins remain.
9. Update `prd.md` checkbox list with the new capability.
