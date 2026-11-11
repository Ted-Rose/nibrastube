# Spec Delta

## Purpose

Unpin tombstones widen to cover manual pins on approved channels,
and ingest paths refuse videos YouTube marks non-embeddable.

## MODIFIED Requirements

### Requirement: Manual unpin of synced videos leaves a tombstone

Unpinning a video whose pin came from channel sync — OR a manual
pin whose video belongs to a channel approved for the profile —
SHALL insert a `channel_video_exclusions` row so the next sync
does not resurrect it; the check SHALL happen atomically via
`DELETE … RETURNING` so a concurrent sync insert cannot slip past.
Manually pinning the same video SHALL delete the tombstone.
Un-approving a channel SHALL delete that channel's `viaChannelId`
pins and clear all of the profile's tombstones for that channel's
videos, while manual pins survive.

#### Scenario: Unpinned synced video stays gone

- **WHEN** a parent unpins a channel-synced video and the daily
  sync later polls that channel
- **THEN** the tombstone prevents the video from being re-added

#### Scenario: Manual unpin on an approved channel stays gone

- **WHEN** a parent unpins a manually pinned video whose channel
  is approved for the profile, and sync later polls that channel
- **THEN** the tombstone prevents the video from being re-added —
  re-pinning it manually clears the tombstone

#### Scenario: Re-pinning clears the tombstone

- **WHEN** a parent manually pins a video that has an exclusion
  row
- **THEN** the exclusion row is deleted alongside the new pin

#### Scenario: Un-approving restores a clean slate

- **WHEN** a parent un-approves a channel
- **THEN** its auto-added pins and the channel's tombstones are
  removed; re-approving later backfills from scratch

## ADDED Requirements

### Requirement: Ingest refuses non-embeddable videos

`pinVideo` and the song-import fetch path SHALL reject a video
whose YouTube metadata reports `embeddable` other than `true` —
both for a freshly fetched id and an already-cached
`embeddable:false` row — instead of storing a whitelist entry or
song that can never play. `getVideoDetails` SHALL return `null`
for unknown/dead ids (like `getChannelDetails`), and `pinVideo`
SHALL surface a friendly not-found error.

#### Scenario: Pinning a dead video id

- **WHEN** a parent pins a YouTube id that no longer exists
- **THEN** the action reports a friendly not-found error, not a
  500

#### Scenario: Non-embeddable video is refused

- **WHEN** a pin or song import resolves to an
  `embeddable !== true` video
- **THEN** the action refuses it rather than writing an
  unplayable row
