# Action And API Contract Specification

## Purpose

Defines the guard and response-shape contract every mutation path
follows: how `app/actions/*` server actions order their auth
checks, how the three `/api/*` routes validate and answer
requests, and how caught failures reach Sentry through the
`lib/report.ts` chokepoint.

## Requirements

### Requirement: Parent-mutating actions run the guard chain

Every server action that mutates parent-owned state SHALL run, in
order: `getSession()` (absent → return or throw), then
`requireParentUnlocked()` (redirects to `/kids?gate=1` on
failure), then `assertCanManageProfile(session, profileId)`
(throws on non-owner/non-shared). Kid sessions SHALL fail closed at
every step — they carry no `user`. Invite acceptance is the one
exception: the invite token itself is the credential.

#### Scenario: Unlocked parent manages an owned profile

- **WHEN** an unlocked parent calls e.g. `pinVideo` for a profile
  they own or share
- **THEN** the mutation proceeds

#### Scenario: Locked device hits the PIN gate

- **WHEN** any session calls a parent-mutating action without a
  valid unlock token
- **THEN** the action redirects to `/kids?gate=1` and no mutation
  happens

#### Scenario: Foreign profile is rejected

- **WHEN** an unlocked parent calls a mutating action for a profile
  they neither own nor share
- **THEN** `assertCanManageProfile` throws "Not authorized for this
  profile"

### Requirement: Kid-scope writes use the kid-data guard

Actions writing kid-side data (playlists, reactions) SHALL gate via
`assertCanEditKidData` — which accepts a matching kid session, a
matching `activeProfileId` lock, or a managing parent — and SHALL
NOT call `requireParentUnlocked`, so a locked kid device can keep
using them. Read actions SHALL gate via the boolean
`canViewProfile` instead of the throwing manage check.

#### Scenario: Locked kid device edits its playlist

- **WHEN** a device with only `activeProfileId=<id>` (no session)
  calls a kid-scope write for `<id>`
- **THEN** the write succeeds without any PIN challenge

#### Scenario: Feed paging uses the read gate

- **WHEN** `loadMoreForYou`/`loadMoreShorts` run for a profile the
  device cannot view
- **THEN** they throw "Not authorized for this profile"

### Requirement: API routes share the ok/status envelope

`/api/watch-progress` and `/api/video-reactions` SHALL parse the
JSON body with zod and respond `{ ok: false }` with a status — 400
for invalid bodies, 403 for auth or whitelist failures — and
`{ ok: true }` on success. `/api/sync-channels` SHALL answer
`{ ok: true, alreadyDone: boolean }` on GET and POST alike.

#### Scenario: Malformed body is a 400

- **WHEN** a POST arrives whose JSON fails the route's zod schema
- **THEN** it responds 400 `{ ok: false }` with no DB writes

#### Scenario: Successful write returns ok

- **WHEN** an authorized, whitelisted write succeeds
- **THEN** it responds 200 `{ ok: true }`

### Requirement: Watch-progress beacons are order-guarded

`/api/watch-progress` SHALL upsert `watch_progress` (and the
per-day `watch_history` row) only when the incoming `sentAt` is
newer than the stored timestamp, so late/out-of-order beacons
cannot overwrite fresher positions; `sentAt` SHALL be clamped to
server time so a far-future client clock cannot poison the guard.
`completed` SHALL be client-reported (≥95% watched).

#### Scenario: Late beacon is dropped

- **WHEN** a periodic-flush POST lands after a newer pagehide
  beacon for the same (profile, video)
- **THEN** the stored position is unchanged

#### Scenario: Re-watch lands under each day

- **WHEN** a video is watched on two different days
- **THEN** `watch_history` holds one row per (video, watched-on
  day), each with the latest `lastSeenAt`

### Requirement: Caught failures route through lib/report.ts

Caught internal bugs SHALL be reported via
`captureInternalException` (Sentry level `error`, tag
`error_code:internal_error` — the agent fix queue); expected
provider failures (YouTube quota/outage) via
`captureProviderException` (level `warning`, tag
`error_code:rate_limited` or `provider_error` — trend-only, never
the fix queue). All Sentry traffic SHALL be DSN-gated: without
`NEXT_PUBLIC_SENTRY_DSN` no events are sent.

#### Scenario: Unexpected action failure lands in the fix queue

- **WHEN** a caught, unexpected error is reported
- **THEN** it reaches Sentry at level error tagged
  `error_code:internal_error`

#### Scenario: Quota outage stays out of the fix queue

- **WHEN** a YouTube quota abort is reported
- **THEN** it reaches Sentry at level warning tagged
  `error_code:rate_limited`
