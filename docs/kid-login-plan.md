# Plan: Unified Parent + Kid Login

Feature branch prefix: `feature/` (e.g. `feature/kid-login`).

## Goal

One login form — identifier + password — that works for **both** account
types. The server figures out the scope from the credentials:

- **Parent** logs in → `session` JWT (parent scope) → `/parent/dashboard`
  (or callback), same as today.
- **Kid** logs in → `session` JWT with `role: "kid"` bound to one
  `profileId` → `/kids/<profileId>` feed — their own whitelist, history,
  playlists, reactions. Nothing else is reachable.

The kid scope is enforced by a **signed JWT**, not by a cookie the kid
could edit — an upgrade over today's capability-URL model.

## How parent↔kid interaction works today

Two actor types, only one has credentials:

| | Parent | Kid |
|---|---|---|
| Identity | `users` row (email, `passwordHash`, `parentPin`) | `profiles` row (name, avatar, `parentId`) — **no credentials** |
| Sign-in | `/login` email+password → bcrypt → `session` JWT (1y, rolling refresh in `proxy.ts`) | none — a parent picks the kid's avatar on `/kids` |
| Device lock | `parentUnlocked` signed cookie (24h) gates `/parent/*`; 4-digit PIN re-unlocks | `activeProfileId` **unsigned** cookie locks the device to `/kids/<id>` |
| Authz | `assertCanManageProfile` (owner or `shared_access`) + `requireParentUnlocked` on mutations | `activeProfileId === profileId` match, or a managing parent session (`assertCanEditKidData`, `canViewProfile`) |

Facts from the code that shape the design:

- **`activeProfileId` is forgeable.** It's a plain UUID cookie — any kid
  who learns a sibling's profile UUID can set it in devtools (the
  documented "capability URL" trade-off). A kid session JWT closes that
  hole for logged-in kids.
- **Kid-scope reads/writes already have a two-path guard.**
  `assertCanEditKidData` (`lib/profiles.ts:43`) and
  `/api/watch-progress` accept `activeProfileId` match **or** a managing
  session — a kid session slots in as a third accepted path with no
  refactor of the call sites.
- **Kid sessions fail closed everywhere else for free.** Every
  parent-only check reads `session.user.id`
  (`assertCanManageProfile`, `requireParentUnlocked`, `getManageableProfiles`,
  the `/kids` picker gate) — a kid-scoped payload has no `user`, so all
  of them throw/redirect without being touched.
- **`proxy.ts` is the single routing brain.** `/` dispatch, the
  kid-lock snap-back, the `/parent` + `parentUnlocked` gate, and
  signed-in bounce off `/login`/`/signup` all live there — kid-scope
  rules go in the same place. There is no `middleware.ts`.
- **`refreshSessionCookie` re-encrypts `{ user: session.user }` only**
  (`lib/auth.ts:93`) — it would silently strip kid claims on the daily
  rolling refresh; it must carry the full payload.
- **`setParentUnlocked`/`verifyParentPin` assume `session.user.id`
  exists** — they need an explicit `role === "parent"` guard, otherwise
  a kid session could mint an unlock token bound to `sub: undefined`.

## Design

### Schema (`lib/db/schema.ts`)

Kid credentials live **on the `profiles` row** — the profile already is
the kid identity that whitelists, progress, reactions and playlists key
off:

```ts
username:     text("username").unique(),   // nullable — no login until set
passwordHash: text("password_hash"),       // nullable
```

`npm run db:generate` → `drizzle/0010_*.sql`; both columns nullable so
the migration is a no-op on existing rows.

**Identifier namespace.** The form takes one `identifier` field
("Email or username"): lookup tries `users.email` first, then
`profiles.username`. Both must share one namespace or a kid username
equal to a parent's email would be shadowed — enforce at write time:

- `signup` rejects an email already used as a `profiles.username`.
- `setKidCredentials` rejects a username already used as a
  `users.email` or another profile's username.

Kids don't need real mailboxes — a unique handle (`emma`, `emma.rosen`)
works; a real email (parent's `+alias`) works too.

### Session payload (`lib/auth.ts`)

```ts
export type SessionPayload = JWTPayload &
  (
    | { role: "parent"; user: { id: string; email: string; name: string | null } }
    | { role: "kid"; profileId: string; name: string }
  );
```

- `login()` gains a sibling `loginKid(profile)` that signs the kid
  variant into the same `session` cookie (same 1y expiry — kid tablets
  shouldn't need re-login).
- **Backward compat:** existing parent JWTs have `user` and no `role` —
  normalize in `decrypt`/`getSession` (`role ??= "parent"` when `user`
  is present) so deployed sessions survive the rollout.
- `refreshSessionCookie` re-signs the **whole** payload, not just `user`.
- Helpers: `isKidSession(s)`, `parentSession(s)` (returns `s.user` or
  null) so call sites read naturally and `session.user.id` typechecks
  only under the parent variant.
- `setParentUnlocked` returns early unless `role === "parent"`;
  `verifyParentPin` redirects kid sessions to their feed instead of
  querying `users` with `undefined`.

### Login action (`app/actions/auth.ts`)

```
identifier + password
  → users.email match && bcrypt ok   → parent: authLogin + setParentUnlocked → safeCallback
  → profiles.username match && ok    → kid: loginKid + set activeProfileId → /kids/<id>
  → else                             → "Invalid email or password." (+500ms delay)
```

- Keep the same generic error for both lookups (no account enumeration).
- Add a small delay on failures — the PIN gate already does 500ms;
  credential stuffing kid passwords is cheaper than PIN brute force
  otherwise.
- **`activeProfileId` stays** and is set on kid login: it's the compat
  shim that keeps `canViewProfile`, `assertCanEditKidData`,
  `/api/watch-progress`, `/api/video-reactions` and the `/` redirect
  working unchanged while session-based checks roll in. `logout`
  already deletes it.
- **Callback is scope-filtered:** a kid session may only be sent to
  `/kids/<own profileId>` — anything else (e.g. a crafted
  `callback=/parent/dashboard`) falls back to their feed. The
  `parentUnlocked` gate would still block it, but don't rely on that.

### Route guard (`proxy.ts`)

New kid-session branches alongside the existing rules:

| Path | Kid session (`role === "kid"`) |
|---|---|
| `/` | → `/kids/<profileId>` (before the `activeProfileId` branch — same result anyway) |
| `/kids` (picker) | → `/kids/<profileId>` — picker stays parent-only |
| `/kids/<id>` | id === profileId → allow; else snap back to `/kids/<profileId>` |
| `/parent/*` | → `/kids/<profileId>` (no PIN gate — a kid has no unlock path) |
| `/login`, `/signup` | → `/kids/<profileId>` |

Parent rules are untouched. `updateSession` keeps refreshing either
role.

### Kid-scope authz (`lib/profiles.ts`, API routes)

- `canViewProfile`: also `true` when `session.role === "kid" &&
  session.profileId === profileId`. **Verify the profile still exists**
  in that branch (one `findFirst`) — a deleted profile with a live JWT
  would otherwise 404/redirect-loop; on missing profile, treat as
  signed-out and clear the session cookie.
- `assertCanEditKidData`: accept the matching kid session in addition
  to `activeProfileId` and parent-manage paths. Same for the inline
  checks in `/api/watch-progress` and `/api/video-reactions`.
- `assertCanManageProfile`, `getManageableProfiles`,
  `requireParentUnlocked`: **unchanged** — kid sessions fail closed.

### Credential management UI (`/parent/profiles`)

- Extend profile create/edit with optional **username + password**
  fields → new `setKidCredentials` server action:
  `getSession` + `requireParentUnlocked` + owner check.
- **Owner-only, not shared:** `deleteProfile` already requires
  `profiles.parentId === session.user.id` — credential changes are at
  least as sensitive (a shared-access parent could lock the kid out),
  so follow that precedent, not `assertCanManageProfile`.
- Kid password min length **4** (kid-typeable) vs parent min 6 —
  bcrypt either way.
- No self-service reset: forgotten kid password → parent re-sets it in
  the profiles page. Nothing new to build.

## Alternatives considered

- **Separate `kid_accounts` table** (credentials → FK profile): cleaner
  if one login should ever map to several profiles or need its own
  lifecycle — but every feature keys on `profileId`, so it's a join
  with no payoff today.
- **Unified `accounts` table** (`role` column, users+profiles
  reference it): "correct" RBAC shape, but `users.id` is baked into
  `parentId` FKs, `shared_access`, invites and every `session.user.id`
  call site — a migration-heavy refactor for a two-role app.
- **Keep picker-only kid access:** the device lock already works for
  young kids; kid login is additive for older kids / their own devices.
  Both coexist — picker flow is unchanged.

## Edge cases

- **Two kids, one tablet:** kid A logs out (new Log out control on the
  kid feed footer, next to the PIN gate), kid B logs in — each gets only
  their own feed. Cookie `activeProfileId` is overwritten per login.
- **Stale `activeProfileId` vs kid session:** if they disagree (cookie
  from an older picker lock), the session wins in `proxy.ts` checks and
  the cookie is re-set to the session's profileId.
- **Parent session + kid session can't coexist** — one `session`
  cookie, one scope. A parent who logs in on the kid's tablet replaces
  the kid session; logging back is one form fill.
- **Kid tries `/parent/*`:** bounced to their feed by proxy — no PIN
  modal (that's a parent-with-session affordance).
- **JWT size:** +2 claims, negligible.

## Security notes

- Kid session is strictly **less** privileged than today's
  `activeProfileId` model: signed, bound server-side, unforgeable.
  Nothing a logged-in kid can do exceeds what any visitor holding the
  profile UUID cookie can already do.
- Keep `assertCanManageProfile` untouched — the blast radius of a
  stolen kid JWT is one profile's feed + its playlists/reactions/
  progress rows, never whitelist management or `/parent/*`.
- `parentUnlocked` minting is parent-role-gated server-side; the JWT
  `sub` is always a real `users.id`.

## Task breakdown

1. Schema: `profiles.username` (unique) + `profiles.password_hash`;
   `db:generate` + `db:migrate`.
2. `lib/auth.ts`: `SessionPayload` union + normalize, `loginKid`,
   `isKidSession`/`parentSession` helpers, full-payload rolling
   refresh, parent-role guards in `setParentUnlocked`.
3. `app/actions/auth.ts`: identifier lookup (users → profiles), generic
   error + failure delay, kid login path, scope-filtered callback;
   `signup` namespace-collision check.
4. `proxy.ts`: kid-session rows in the routing table.
5. `lib/profiles.ts` + `/api/watch-progress` + `/api/video-reactions`:
   accept matching kid session; profile-exists check for the kid
   branch.
6. `app/actions/profiles.ts`: `setKidCredentials` (owner-only,
   `requireParentUnlocked`) + profiles page fields.
7. `verifyParentPin`/`safety.ts`: kid-session guard; kid feed footer:
   Log out button.
8. `typecheck` + `lint` + manual: parent login unchanged, kid login →
   own feed only, sibling snap-back, `/parent/*` bounce, deleted
   profile → signed out, old parent JWTs still valid.
