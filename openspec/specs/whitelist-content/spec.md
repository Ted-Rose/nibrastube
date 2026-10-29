# Whitelist Content Specification

## Purpose

Defines the core safety invariant: kids can only ever see
parent-approved content. Covers the `whitelisted_videos` /
`whitelisted_channels` model, the two-tier age-suitability rule,
every enforcement surface (feed queries, watch page, player
snapback, write APIs), and the tombstone mechanics that keep
channel sync from resurrecting manually removed videos.

## Requirements

### Requirement: Kids only see whitelisted content

Every video rendered in the kids portal and playable on the watch
page SHALL be backed by a `whitelisted_videos` row for that
profile (`viaChannelId` NULL = manual pin, set = added by channel
sync). The watch page SHALL verify authorization before approval so
404-vs-redirect can't be used to probe whether a profile UUID
exists.

#### Scenario: Watch page rejects unapproved video

- **WHEN** a kid navigates to
  `/kids/<profileId>/watch/<videoId>` and the video is not
  whitelisted (or is suitable-blocked) for that profile
- **THEN** they are redirected back to the feed they came from

#### Scenario: Watch page hides unauthorized profiles

- **WHEN** a device that cannot view the profile requests a watch
  page under it
- **THEN** it is redirected to `/kids` before any approval check

#### Scenario: Player snaps back from rogue suggested videos

- **WHEN** a "More videos" suggestion inside the YouTube embed loads
  a videoId outside the approved playlist
- **THEN** the player's ~500 ms tick detects the foreign video,
  flushes the approved video's position, and reloads the approved
  video at its resume point

### Requirement: Age-restricted is a hard floor

`videos.age_restricted` (YouTube's 18+ flag) SHALL disqualify a
video for kids absolutely — even when a parent pinned it.
Enforcement SHALL be query-time via the shared `suitableVideo`
WHERE fragment (`age_restricted IS DISTINCT FROM true` — NULL
counts suitable) ANDed into every display and write surface: feed
queries, search hydration, and the write APIs. There SHALL be no
ingest drop: a pin on a restricted video is an inert row shown as
"Blocked" in the parent dashboard.

#### Scenario: Pinned 18+ video never plays

- **WHEN** a parent pins a video whose `age_restricted` flag is true
- **THEN** the pin row exists but the video is excluded from feeds,
  the watch page, and write APIs

#### Scenario: Unknown suitability counts as suitable

- **WHEN** a video row has `age_restricted` NULL
- **THEN** it is treated as kid-suitable (stale rows heal via
  `npm run videos:refresh`)

### Requirement: Made-for-kids filters only unvetted surfaces

`videos.made_for_kids` SHALL be filtered on unvetted surfaces only
— YouTube search hydration and the public `/songs`
catalog/imports. Parent-approved content is exempt:
`getVideosBatch` MUST ingest every embeddable video (channel sync
depends on it), manual pins accept made-for-kids videos, and kids
feed queries do not filter on the flag.

#### Scenario: Search results hide made-for-kids rows

- **WHEN** the parent dashboard hydrates YouTube search results
- **THEN** `made_for_kids` rows are filtered out of the vetting list

#### Scenario: Approved channel keeps its made-for-kids uploads

- **WHEN** channel sync ingests an approved channel's uploads
- **THEN** made-for-kids videos are pinned and shown like any other

### Requirement: Write APIs enforce the whitelist

`/api/watch-progress` and `/api/video-reactions` SHALL reject
writes for videos that are not whitelisted-and-suitable for the
target profile, after their auth check (kid session bound to the
profile, matching `activeProfileId`, or a managing parent).

#### Scenario: Progress beacon for unapproved video is rejected

- **WHEN** a POST to `/api/watch-progress` names a videoId that is
  not whitelisted or fails the 18+ floor for that profile
- **THEN** it responds 403 with `{ "ok": false }` and writes nothing

#### Scenario: Kid session cannot write another profile's data

- **WHEN** a kid-session device posts a write naming a different
  profileId
- **THEN** it responds 403 with `{ "ok": false }`

### Requirement: Manual unpin of synced videos leaves a tombstone

Unpinning a video whose pin came from channel sync SHALL insert a
`channel_video_exclusions` row so the next sync does not resurrect
it. Manually pinning the same video SHALL delete the tombstone.
Un-approving a channel SHALL delete that channel's `viaChannelId`
pins and clear all of the profile's tombstones for that channel's
videos, while manual pins survive.

#### Scenario: Unpinned synced video stays gone

- **WHEN** a parent unpins a channel-synced video and the daily sync
  later polls that channel
- **THEN** the tombstone prevents the video from being re-added

#### Scenario: Re-pinning clears the tombstone

- **WHEN** a parent manually pins a video that has an exclusion row
- **THEN** the exclusion row is deleted alongside the new pin

#### Scenario: Un-approving restores a clean slate

- **WHEN** a parent un-approves a channel
- **THEN** its auto-added pins and the channel's tombstones are
  removed; re-approving later backfills from scratch

### Requirement: Whitelist changes notify open sessions

After any whitelist mutation (pin, unpin, channel approve/un-approve,
sync-added batch) the action SHALL trigger Pusher on channel
`profile-<profileId>` with `video-pinned` or `video-unpinned`, and
`pusherServer` SHALL be imported dynamically inside the action.

#### Scenario: Pin triggers a live refresh

- **WHEN** a video is pinned for a profile
- **THEN** a `video-pinned` event fires on `profile-<id>` so open
  clients refresh
