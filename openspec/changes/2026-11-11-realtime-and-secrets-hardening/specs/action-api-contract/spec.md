# Spec Delta

## Purpose

Authentication for the daily channel-sync trigger endpoint, which
today is an unauthenticated GET+POST that spends YouTube quota.

## ADDED Requirements

### Requirement: Daily sync trigger requires authentication

`/api/sync-channels` SHALL reject unauthenticated callers. POST
SHALL require a signed-in `getSession()` (the client ping only
fires on session-gated pages); GET SHALL require
`Authorization: Bearer ${CRON_SECRET}` for manual/cron triggering.

#### Scenario: Sessionless POST is rejected

- **WHEN** a POST arrives without a valid session cookie
- **THEN** the route responds 401 and performs no sync and no
  `daily_syncs` write

#### Scenario: Bearer-less GET is rejected

- **WHEN** a GET arrives without the `CRON_SECRET` bearer
- **THEN** the route responds 401 and performs no sync

#### Scenario: Authenticated trigger runs once per day

- **WHEN** an authenticated caller hits the route the first time
  on a UTC date
- **THEN** it responds `{ ok: true, alreadyDone: false }` and the
  sync proceeds in the background exactly as today
