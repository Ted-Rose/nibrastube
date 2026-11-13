# Spec Delta

## Purpose

Stale profile references fail closed everywhere: a deleted profile
bound to a kid session or a lock cookie can neither loop redirects
nor wedge the device on `/`.

## ADDED Requirements

### Requirement: Stale profile references fail closed

A kid session that reaches its own profile's pages while the
profile no longer exists SHALL see a kid-safe 404 (`notFound()`)
rather than a redirect that bounces back into `proxy.ts`. The
`activeProfileId` device lock SHALL be existence-probed: on a miss
the cookie is deleted. A `profileExists` database error SHALL be
treated as "exists" rather than 500ing every matched navigation.

#### Scenario: Kid session hits a deleted profile's pages

- **WHEN** a kid-session device requests its own feed/watch pages
  within the existence-cache window after deletion
- **THEN** the page renders a kid-safe `notFound()`; `proxy.ts`
  still clears the session and lock cookies on its next match

#### Scenario: Lock cookie points at a deleted profile

- **WHEN** a sessionless device whose `activeProfileId` names a
  deleted profile requests `/` or a matching `/kids/<id>` path
- **THEN** the response redirects to a safe landing and deletes
  the `activeProfileId` cookie

#### Scenario: Existence check hits a database error

- **WHEN** `profileExists` cannot reach Postgres
- **THEN** the request is treated as "profile exists" instead of
  failing the navigation
