# Spec Delta

## Purpose

Sync correctness edges: tombstoned videos count as known-stop
markers, polls persist a resume cursor past their window,
re-approval skips a completed backfill, and quota detection covers
all quota error reasons.

## MODIFIED Requirements

### Requirement: Approving a channel backfills its uploads

`approveChannel` SHALL upsert the channel into `channels` (with
`uploadsPlaylistId`), insert the `whitelisted_channels` approval
row, and kick off `backfillChannel` in a background `after()`
task. When the profile's owner has a `channel_sync_exclusions` row
for the channel, the approval SHALL be recorded but the backfill
skipped entirely. Re-approving a channel whose `backfillComplete`
is already true SHALL NOT start another backfill.

#### Scenario: Approval triggers a background backfill

- **WHEN** an unlocked parent approves a channel for a managed
  profile
- **THEN** the approval row is written immediately and uploads are
  pinned in the background

#### Scenario: Approving a paused channel adds no videos

- **WHEN** the profile owner has muted sync for that channel
- **THEN** the approval is saved but no backfill runs until the
  mute is lifted

#### Scenario: Re-approving a completed channel does not re-scan

- **WHEN** a parent re-approves a channel whose backfill already
  completed
- **THEN** no backfill is queued and `backfillPageToken`/`Syncing`
  state stays untouched

### Requirement: Daily sync polls newest uploads

`syncAllChannels` SHALL process ≤50 channels per run ordered
never-synced-first (`lastSyncAt ASC NULLS FIRST` in SQL); for each
channel, an incomplete backfill SHALL resume in place of a poll.
`pollChannel` SHALL fetch newest uploads (≤5 pages, ~250 videos)
until it hits a known-stop marker — a videoId already whitelisted
**or** a `channel_video_exclusions` tombstone — insert the new
batch with the same re-checks as backfill, and update `lastSyncAt`
only while the channel remains enabled. When the page cap is hit
without a known stop and a `nextPageToken` remains, the poll SHALL
persist a resume cursor (reusing `backfillPageToken` with
`backfillComplete=false`) so the next run continues forward
through the gap.

#### Scenario: New upload becomes a pin

- **WHEN** an approved, unmuted channel publishes a video since the
  last sync
- **THEN** the next poll pins it for the profile and bumps
  `lastSyncAt`

#### Scenario: Never-synced channels go first

- **WHEN** more than 50 channels await sync
- **THEN** channels with NULL `lastSyncAt` are processed before
  recently synced ones

#### Scenario: Tombstoned uploads stop the poll

- **WHEN** a poll page contains only videos already tombstoned for
  the profile
- **THEN** the poll stops without scanning deeper pages or
  hydrating further ids

#### Scenario: Poll gap resumes later

- **WHEN** the poll reaches its page cap without a known stop
- **THEN** resume state is persisted and the next run pages forward
  from the cursor instead of abandoning the backlog

### Requirement: YouTube quota aborts the run early

A quota failure from the YouTube API — a 403 whose error reasons
include `quotaExceeded`, `dailyLimitExceeded`, or
`userRateLimitExceeded`, or a 429 — SHALL abort the whole sync run
(not just the channel), reported via `captureProviderException` at
warning level tagged `error_code:rate_limited`. Any other
per-channel failure SHALL be logged and reported via
`captureInternalException` without stopping the remaining
channels.

#### Scenario: Quota exhaustion stops the run

- **WHEN** a YouTube call returns a quota error mid-run
- **THEN** the run breaks early and reports a rate_limited warning

#### Scenario: Other failure skips only that channel

- **WHEN** one channel's sync throws a non-quota error
- **THEN** it is reported as an internal error and the run
  continues with the next channel
