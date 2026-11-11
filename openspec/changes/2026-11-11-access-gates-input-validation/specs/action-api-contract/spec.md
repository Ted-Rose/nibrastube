# Spec Delta

## Purpose

One shared kid-write authorization core, and malformed identifiers
or form fields become client errors instead of Postgres 500s.

## ADDED Requirements

### Requirement: Kid-write authorization shares one gate core

The `/api/*` kid-write routes and `assertCanEditKidData` SHALL
evaluate the same gate — a matching kid session (plus a
profile-existence check), a matching `activeProfileId` lock, or a
managing parent via `assertCanManageProfile`. API routes SHALL map
a denied gate to JSON 403; the action helper SHALL keep its
throw-on-failure semantics.

#### Scenario: Deleted-profile kid JWT writes are rejected

- **WHEN** a request carries a kid session whose bound profile no
  longer exists
- **THEN** kid-write routes and actions reject before touching
  data — 403 JSON from the routes, throw from the action

#### Scenario: Locked device still writes its own data

- **WHEN** a device with only `activeProfileId=<id>` posts a
  kid-write for `<id>`
- **THEN** the write passes the gate without a session

### Requirement: Malformed identifiers and form fields are 4xx

Profile-id inputs SHALL be shape-validated (`z.uuid()`) inside the
shared assert helpers before reaching Postgres, and raw
`formData.get` values SHALL go through a string type-guard — a
`File` value or non-uuid id MUST NOT produce a Postgres
`invalid input syntax` 500.

#### Scenario: Crafted non-uuid profile id

- **WHEN** a request or action call carries `profileId=not-a-uuid`
- **THEN** it is rejected as a client error (4xx/throw) with no
  Postgres type error
