# Design

Source: `docs/plans/architecture-refactor-plan.md` phase 3 +
`refactoring-plan.md` W4 (retired into this change). OVERALL.md
issues #4, #5, #6, #14, part of #17, part of #42. Phase 3.7
(`/songs` kid chrome, OVERALL #38) already shipped — excluded.

## 3.1 Unified kid-write gate

One result-returning core in `lib/profiles.ts`:

```ts
kidWriteGate(profileId): Promise<{ ok: true } | { ok: false }>
```

Semantics: kid session → `session.profileId === profileId` →
profile-existence check; else `activeProfileId` cookie match; else
`assertCanManageProfile`. The two API routes map `{ ok: false }` →
`NextResponse.json({ ok: false }, { status: 403 })`;
`assertCanEditKidData` delegates to the core and keeps its
throw-on-failure action semantics. Behavior delta: the API routes
gain the existence check (today they fail closed later via the
whitelist join — the copies can no longer drift).

## 3.2 Boundary validation (500 → 4xx)

- `z.uuid().safeParse(profileId)` inside `assertCanManageProfile`
  and `kidWriteGate` — one check covers every current and future
  caller (a forged `activeProfileId=foo` currently dies in Postgres
  with `invalid input syntax`).
- Shared `getString(formData, key)` helper (`lib/form-data.ts`):
  `const v = formData.get(key); return typeof v === "string" ? v :
  null;` — applied where raw entries are cast/trimmed before zod
  (`app/actions/auth.ts`, `profiles.ts`, `invites.ts`, the PIN read
  in `safety.ts`; `refresh.ts` already type-guards).
- `createInviteAction`'s `profileId` → `z.uuid()` before
  `inviteParent`.

## 3.3 PIN-unlock backstop

`app/parent/layout.tsx` checks `parentSession` only; `proxy.ts` is
the sole unlock enforcement. Add
`if (!(await isParentUnlockedCookie(session)))
redirect("/kids?gate=1");` — one line covers every current/future
`/parent/*` page. Mutations already re-verify via
`requireParentUnlocked`.

## 3.4 Decrypt dedup + hardening

- `updateSession(request, session?)` accepts the session proxy
  already decrypted and skips the second `jwtVerify`.
- `requireParentUnlocked(session?)` accepts an optional session so
  actions that already called `getSession()` don't re-verify the
  same JWT.
- `decrypt` also requires `typeof user.email === "string"` —
  closes the only under-validated claim field.

## 3.5 Deleted-profile edges

`profileExistsCache` can hold stale `exists: true` ≤60 s after
deletion; the page's uncached `canViewProfile` then
`redirect("/kids")` and proxy bounces back — a bounded ping-pong.

- Under a **kid session**, `canViewProfile` failure renders
  `notFound()` instead of `redirect("/kids")` (kids feed page,
  watch page, and the missing-profile path in
  `assertCanEditKidData` — swap its `redirect("/kids")` for the
  gate result). Proxy owns cookie revocation; pages must not
  bounce back into it.
- `profileExists`: wrap the DB call in try/catch → on error treat
  as "exists" (a Neon hiccup currently 500s every matched
  navigation); `profileExistsCache.delete` an expired hit.
- Existence-probe the cookie lock: the `/` →
  `/kids/<activeProfileId>` redirect and the rule-2 cookie match
  skip `profileExists` today — a deleted lock profile = permanent
  `/` → 404. On a miss, redirect with
  `res.cookies.delete("activeProfileId")`.
- Replace `pathname.startsWith("/parent")` with
  `pathname === "/parent" || pathname.startsWith("/parent/")`.
- Ship `app/kids/[profileId]/not-found.tsx` in this PR (pulled
  forward from the error-surfaces change): one shared kid-safe
  error-card component, reused by the root `not-found`/`error`
  files there.

## 3.6 Shared `assertDashboardReader`

`search.ts`'s reader gate is re-implemented inline in
`channel-videos.ts`. Move it next to the other guards in
`lib/profiles.ts` and import from both.

## Risks

- `assertCanEditKidData` currently `redirect()`s on a missing
  profile; folding it into a result-returning core means callers
  pick redirect-vs-throw — keep the `notFound()` semantics
  consistent across pages and actions.

## Verification

- `npm run typecheck && npm run lint`.
- Manual on port 3100 (kid-locked device): playlist add + reaction
  + watch-progress beacon still work; a crafted
  `activeProfileId=not-a-uuid` request 403s instead of 500ing;
  `/parent/dashboard` bounces to the PIN gate without
  `parentUnlocked`; deleting a profile under a kid session shows
  the kid-safe 404, not a redirect loop.
