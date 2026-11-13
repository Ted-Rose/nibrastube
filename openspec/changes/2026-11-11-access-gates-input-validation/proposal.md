# Proposal

## Why

Distilled from `docs/plans/architecture-refactor-plan.md` phase 3
(master plan W4; OVERALL #4, #5, #6, #14, parts of #17 and #42) —
still open on `main`. The `isKidSession → activeProfileId →
assertCanManageProfile` kid-write gate exists in three diverging
copies (both `/api/*` routes skip the profile-existence re-check
that `assertCanEditKidData` performs — a deleted profile's JWT
writes hit an FK 500 instead of a 403), crafted uuids/FormData
reach Postgres as 500s instead of 4xx, `/parent/*` page loads have
no server-side PIN-unlock backstop outside `proxy.ts`, and a
deleted lock-profile means a permanent `/` → 404.

(Phase 3.7's `/songs` kid-session chrome already shipped —
`app/songs/page.tsx` gates on `parentSession`/`isKidSession` —
and is excluded.)

## What Changes

- Extract one `kidWriteGate(profileId)` core in `lib/profiles.ts`
  (kid session → own profile + existence check, else
  `activeProfileId` match, else `assertCanManageProfile`); both API
  routes map failure → 403 JSON, `assertCanEditKidData` delegates
  and keeps throw semantics. **Small behavior delta**: API routes
  gain the profile-existence check.
- `z.uuid()` inside `assertCanManageProfile`/`kidWriteGate`; a
  shared `getString(formData, key)` helper for raw FormData reads —
  crafted inputs 4xx instead of Postgres `invalid input syntax`
  500s.
- One-line `isParentUnlockedCookie` backstop in
  `app/parent/layout.tsx` — `/parent/*` reads get a server-side
  guard even if the proxy matcher is narrowed.
- Decrypt dedup: `updateSession`/`requireParentUnlocked` accept an
  already-decrypted session; `decrypt` also requires
  `typeof user.email === "string"`.
- Deleted-profile edges: under a kid session, `canViewProfile`
  failure renders `notFound()` instead of `redirect("/kids")` (the
  ping-pong); `profileExists` catches DB errors (treat as exists —
  a Neon hiccup currently 500s every navigation) and evicts expired
  hits; existence-probe the `activeProfileId` cookie lock (on miss,
  delete the cookie); close the `startsWith("/parent")` prefix.
- Ship `app/kids/[profileId]/not-found.tsx` in the same PR —
  `notFound()` under a kid session otherwise shows stock 404
  chrome for one release window (kid-safe card shared with the
  error-surfaces change).
- Share `assertDashboardReader` via `lib/profiles.ts` (today
  re-implemented inline in `channel-videos.ts`).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `auth-session`: deleted-profile kid sessions get `notFound()`
  not a redirect bounce; the `activeProfileId` lock is
  existence-probed and revoked on miss; `/parent/*` reads gain a
  server-side unlock backstop.
- `action-api-contract`: one `kidWriteGate` core backs API routes
  and `assertCanEditKidData`; malformed ids/FormData produce
  4xx-not-500 responses.

## Impact

- Whitelist safety: **strengthened edges only** — the gates get
  stricter (deleted profiles, crafted uuids, lock probes); nothing
  new becomes visible to a kid.
- Code: `lib/profiles.ts`, `lib/auth.ts`, `proxy.ts`,
  `app/api/watch-progress/route.ts`,
  `app/api/video-reactions/route.ts`, `app/parent/layout.tsx`,
  `app/actions/{search,channel-videos,auth,profiles,invites,
  safety}.ts`, `app/kids/[profileId]/{page,watch/[videoId]/page,
  not-found}.tsx`, new `lib/form-data.ts` (or similar).
- Verify with `npm run typecheck`, `npm run lint` + the manual
  gate checks in `tasks.md`.
