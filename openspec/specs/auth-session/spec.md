# Auth Session Specification

## Purpose

Defines how devices authenticate: the three cookies (`session`,
`parentUnlocked`, `activeProfileId`), the parent/kid role split
inside the session JWT, the route-protection table enforced by
`proxy.ts` (Next 16's middleware replacement — Node.js runtime, so
DB calls inside it are safe), and the guard helpers every server
action and kid-scope write goes through.

## Requirements

### Requirement: Session cookie carries a signed role-scoped JWT

The `session` cookie SHALL be an httpOnly, `sameSite=lax` HS256 JWT
signed with `JWT_SECRET`, expiring 1 year out. Its payload is one of
two scopes: `role: "parent"` carrying the `users` row identity, or
`role: "kid"` carrying `profileId` + `name`. `proxy.ts` SHALL
rolling-refresh the cookie (re-signing the whole payload) whenever
the JWT is older than ~1 day, so an active session effectively never
expires.

#### Scenario: Parent login mints a parent-scoped session

- **WHEN** a parent completes password login or signup
- **THEN** the `session` cookie holds a JWT with `role: "parent"`
  and the `user` claims

#### Scenario: Kid login mints a kid-scoped session

- **WHEN** a kid logs in with their profile username + password
- **THEN** the `session` cookie holds a JWT with `role: "kid"`
  bound to that `profileId`, and any `parentUnlocked` cookie on the
  device is cleared

#### Scenario: Stale session is refreshed on activity

- **WHEN** a request reaches `proxy.ts` with a session JWT issued
  more than ~1 day ago
- **THEN** the response re-sets `session` with a re-signed copy of
  the same payload (kid claims included) and a fresh 1-year expiry

### Requirement: Session decrypt fails closed

`decrypt` SHALL return `null` (treated as signed-out) for tokens
that verify but have the wrong shape — including a `parentUnlocked`
JWT pasted into the session cookie. Tokens minted before the `role`
claim existed SHALL be normalized to `role: "parent"` so deployed
sessions survive the rollout.

#### Scenario: Legacy token still authenticates

- **WHEN** the session cookie holds a well-signed JWT with `user`
  but no `role`
- **THEN** it is treated as a parent session

#### Scenario: Wrong-shape token is anonymous

- **WHEN** the session cookie holds a well-signed JWT that is
  neither a parent nor a kid payload (e.g. the parent-unlock token)
- **THEN** the request is treated as having no session

### Requirement: Parent portal requires the PIN unlock token

`/parent/*` pages and parent-mutating server actions SHALL require,
in addition to a parent session, a `parentUnlocked` cookie holding a
signed JWT with `scope: "parent-unlock"`, `sub` bound to the
session's user id, and a 24h expiry inside a browser-session cookie.
Kid-scoped sessions MUST NOT be able to mint an unlock token.

#### Scenario: Parent area without unlock redirects to the gate

- **WHEN** a signed-in parent requests a `/parent/*` path without a
  valid `parentUnlocked` token
- **THEN** they are redirected to `/kids?gate=1` and the
  stale/forged cookie is deleted

#### Scenario: Unlock token bound to the session user

- **WHEN** a `parentUnlocked` JWT's `sub` does not match the session
  user's id, or its scope is not `parent-unlock`, or it is expired
- **THEN** the device is treated as locked

#### Scenario: Server action without unlock redirects to the gate

- **WHEN** a parent-mutating server action runs without a valid
  unlock token
- **THEN** `requireParentUnlocked()` deletes the cookie and
  redirects to `/kids?gate=1`

### Requirement: PIN verification is server-side and throttled

`verifyParentPin` SHALL compare the submitted PIN against
`users.parentPin` in the DB — the PIN never enters the session JWT
or the client. A failed check SHALL delay ~500 ms before returning
an error (the same throttle as failed logins). On success it SHALL
set `parentUnlocked`, delete `activeProfileId` (lifting the kid
lock), and redirect to the parent dashboard. A kid session hitting
it SHALL be redirected back to its own feed.

#### Scenario: Correct PIN unlocks and lifts the kid lock

- **WHEN** a parent submits the correct PIN
- **THEN** `parentUnlocked` is set, `activeProfileId` is deleted,
  and the device lands on `/parent/dashboard`

#### Scenario: Wrong PIN is throttled

- **WHEN** a parent submits an incorrect PIN
- **THEN** the response waits ~500 ms and returns an error string,
  leaving the device locked

### Requirement: Kid sessions are pinned to their own profile

A `role: "kid"` session SHALL be restricted to that profile's pages:
every other matched path redirects to `/kids/<profileId>`. When the
bound profile no longer exists, the response SHALL clear `session`
and `activeProfileId` and redirect to `/login`. Within the allowed
pages, a mismatched `activeProfileId` cookie SHALL be re-pinned to
the session's profileId.

#### Scenario: Kid session reaching another profile's pages

- **WHEN** a kid-session device requests any matched path outside
  `/kids/<session.profileId>` (including `/`, `/parent/*`, `/login`)
- **THEN** it is redirected to its own feed

#### Scenario: Deleted profile revokes the kid session

- **WHEN** the profile a kid JWT is bound to has been deleted
- **THEN** the next matched request clears `session` and
  `activeProfileId` and redirects to `/login` (a ~60 s
  existence-check cache may delay this)

### Requirement: Route protection for root and kid paths

`proxy.ts` SHALL guard the matched paths
(`/`, `/parent/:path*`, `/kids/:path*`, `/login`, `/signup`) — all
other paths (`/songs`, `/api/*`) get no protection layer. `/`
SHALL redirect to `/kids/<activeProfileId>` when the lock cookie
is set, else `/parent/dashboard` with a session, else `/signup`.
`/kids` SHALL require a session; `/kids/<id>` SHALL require a
session or a matching `activeProfileId`.

#### Scenario: Root redirects by device state

- **WHEN** a request hits `/`
- **THEN** it lands on the locked kid's feed, the parent dashboard,
  or `/signup` — in that priority order

#### Scenario: Kid-locked device cannot switch profiles via URL

- **WHEN** a device with `activeProfileId=A` requests `/kids/B`
- **THEN** it is redirected to `/kids/A`

#### Scenario: Sessionless device off the lock reaches login

- **WHEN** a device with no session and no matching
  `activeProfileId` requests `/kids/<id>`
- **THEN** it is redirected to `/login?callback=<path>`

### Requirement: Route protection for parent and auth paths

`/parent/*` SHALL require a parent session AND a valid
`parentUnlocked` token — a sessionless request redirects to
`/login`, a kid-locked device (`activeProfileId` set) or a
missing/stale unlock redirects to `/kids?gate=1` with the stale
cookie deleted. `/login` and `/signup` SHALL redirect signed-in
parent sessions to `/parent/dashboard`.

#### Scenario: Locked device bounces off the parent portal

- **WHEN** a device with `activeProfileId` set requests `/parent/*`
- **THEN** it is redirected to `/kids?gate=1`, which auto-opens the
  PIN modal

#### Scenario: Signed-in parent skips auth pages

- **WHEN** a signed-in parent session requests `/login` or
  `/signup`
- **THEN** it is redirected to `/parent/dashboard`

### Requirement: Profile authorization guards

Profile-scoped access SHALL go through `lib/profiles.ts` helpers
that treat kid sessions as non-parents: `assertCanManageProfile`
(throws) requires ownership or a `shared_access` row;
`assertCanEditKidData` also accepts a matching kid session or
`activeProfileId` lock; `canViewProfile` is the boolean read
variant. The signed session wins wherever it disagrees with the
forgeable `activeProfileId` cookie.

#### Scenario: Shared-access parent manages the profile

- **WHEN** a parent with a `shared_access` row for a profile calls a
  guarded mutation
- **THEN** `assertCanManageProfile` returns the profile

#### Scenario: Kid session may only edit its own profile's data

- **WHEN** `assertCanEditKidData` runs under a kid session for a
  different profileId
- **THEN** it throws "Not authorized for this profile"

#### Scenario: Locked device edits kid data without a session

- **WHEN** `activeProfileId` matches the target profile and no
  session exists
- **THEN** `assertCanEditKidData` allows the write
