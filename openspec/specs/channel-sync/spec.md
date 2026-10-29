# Channel Sync Specification

## Purpose

Defines how approving a YouTube channel turns into pins in a kid's
whitelist and stays current: the approval-time backfill, the daily
incremental poll behind `/api/sync-channels`, resumability and
pause semantics, quota-abort behavior, and the real-time
notifications sync emits.

## Requirements

### Requirement: Approving a channel backfills its uploads

`approveChannel` SHALL upsert the channel into `channels` (with
`uploadsPlaylistId`), insert the `whitelisted_channels` approval
row, and kick off `backfillChannel` in a background `after()`
task. When the profile's owner has a `channel_sync_exclusions` row
for the channel, the approval SHALL be recorded but the backfill
skipped entirely.

#### Scenario: Approval triggers a background backfill

- **WHEN** an unlocked parent approves a channel for a managed
  profile
- **THEN** the approval row is written immediately and uploads are
  pinned in the background

#### Scenario: Approving a paused channel adds no videos

- **WHEN** the profile owner has muted sync for that channel
- **THEN** the approval is saved but no backfill runs until the
  mute is lifted

### Requirement: Backfill is resumable and re-checks enablement

`backfillChannel` SHALL page the channel's uploads playlist (≤40
pages/run, ~2000 videos), persisting `backfillPageToken` and
`backfillComplete` so an interrupted backfill resumes where it left
off. Before each page and each insert batch it SHALL re-check that
the channel is still approved and unmuted, aborting mid-flight if
either changed. Synced videos SHALL be inserted as `viaChannelId`
pins skipping tombstoned exclusions.

#### Scenario: Interrupted backfill resumes via token

- **WHEN** a backfill stops before finishing the uploads playlist
- **THEN** the next run continues from `backfillPageToken` instead
  of restarting

#### Scenario: Un-approve during backfill stops inserts

- **WHEN** the approval row is deleted while a backfill is
  mid-flight
- **THEN** the enablement re-check stops further pins for that
  channel

#### Scenario: Tombstoned videos are skipped

- **WHEN** a video in the fetched page has a
  `channel_video_exclusions` row for the profile
- **THEN** it is not re-pinned

### Requirement: Daily sync polls newest uploads

`syncAllChannels` SHALL process ≤50 channels per run ordered
never-synced-first (lastSyncAt nulls first via JS sort — Postgres
`asc()` puts NULLs last); for each channel, an incomplete backfill
SHALL resume in place of a poll. `pollChannel` SHALL fetch newest
uploads (≤5 pages,
~250 videos) until it hits a videoId already whitelisted, insert
the new batch with the same re-checks as backfill, and update
`lastSyncAt` only while the channel remains enabled.

#### Scenario: New upload becomes a pin

- **WHEN** an approved, unmuted channel publishes a video since the
  last sync
- **THEN** the next poll pins it for the profile and bumps
  `lastSyncAt`

#### Scenario: Never-synced channels go first

- **WHEN** more than 50 channels await sync
- **THEN** channels with NULL `lastSyncAt` are processed before
  recently synced ones

### Requirement: Daily trigger dedupes by UTC date

`/api/sync-channels` (GET and POST) SHALL insert a `daily_syncs`
row keyed by the UTC date; success means the run is exclusive, a
conflict means it already ran and answers
`{ ok: true, alreadyDone: true }`. The actual sync SHALL run inside
`after()` after the response, finally recording `finishedAt` and
`channelsSynced`. Clients ping the route at most once per day.

#### Scenario: First call of the day runs the sync

- **WHEN** the first request for a UTC date arrives
- **THEN** it responds `{ ok: true, alreadyDone: false }` and the
  sync continues in the background

#### Scenario: Same-day repeat is a no-op

- **WHEN** another request arrives the same UTC day
- **THEN** it responds `{ ok: true, alreadyDone: true }` without
  starting a second run

### Requirement: YouTube quota aborts the run early

A `403` + `quotaExceeded` response from the YouTube API SHALL abort
the whole sync run (not just the channel), reported via
`captureProviderException` at warning level tagged
`error_code:rate_limited`. Any other per-channel failure SHALL be
logged and reported via `captureInternalException` without stopping
the remaining channels.

#### Scenario: Quota exhaustion stops the run

- **WHEN** a YouTube call returns a quota error mid-run
- **THEN** the run breaks early and reports a rate_limited warning

#### Scenario: Other failure skips only that channel

- **WHEN** one channel's sync throws a non-quota error
- **THEN** it is reported as an internal error and the run
  continues with the next channel

### Requirement: Sync pause is owner-scoped and survives re-approval

`channel_sync_exclusions` rows SHALL be keyed by `(parentId,
channelId)` — muting a channel skips it in sync for every profile
owned by that parent — and SHALL survive un-approve/re-approve (a
muted channel stays muted). A shared-access parent SHALL write the
profile owner's exclusion row, covering exactly the profiles they
manage.

#### Scenario: Mute applies to all the owner's kids

- **WHEN** a parent mutes sync for a channel approved on several of
  their profiles
- **THEN** one exclusion row mutes it for all of them

#### Scenario: Re-approving does not unmute

- **WHEN** a muted channel is un-approved and re-approved
- **THEN** the exclusion row persists and the channel still syncs
  nothing

### Requirement: Sync emits real-time notifications

Whenever backfill or poll adds at least one video, the sync SHALL
trigger a `video-pinned` event on Pusher channel
`profile-<profileId>` so open kids' sessions refresh.

#### Scenario: Batch insert notifies the profile

- **WHEN** a sync run pins N > 0 new videos for a profile
- **THEN** one `video-pinned` event fires on `profile-<id>`
