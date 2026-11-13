# Spec Delta

## Purpose

Realtime notification becomes best-effort: a Pusher outage can no
longer turn a committed whitelist write into a client-visible
failure.

## MODIFIED Requirements

### Requirement: Whitelist changes notify open sessions

Pin, unpin, and channel un-approve SHALL trigger Pusher on channel
`profile-<profileId>` immediately — `video-pinned` for a pin,
`video-unpinned` for removals. A channel approve SHALL NOT fire
directly: its background backfill emits `video-pinned` only when it
attempts at least one insert — `onConflictDoNothing` may still
skip every row. All call sites SHALL send through a shared
best-effort `notifyProfile` helper whose `trigger` is wrapped in
try/catch — a Pusher failure SHALL be logged and swallowed, never
fail the mutation (`revalidatePath` already covers the acting
client). The server Pusher client SHALL live in a `server-only`
module so the Node SDK cannot enter the browser bundle; `pusher`
SHALL still be imported dynamically inside the action.

#### Scenario: Pin triggers a live refresh

- **WHEN** a video is pinned for a profile
- **THEN** a `video-pinned` event fires on `profile-<id>` so open
  clients refresh

#### Scenario: Approval without inserts stays silent

- **WHEN** an approved channel's backfill queues no inserts (muted
  or zero new uploads)
- **THEN** no Pusher event fires for the approval

#### Scenario: Pusher outage does not fail the write

- **WHEN** `pusherServer.trigger` rejects or times out after a
  committed pin/unpin
- **THEN** the action still succeeds for the acting client and the
  failure is only logged
