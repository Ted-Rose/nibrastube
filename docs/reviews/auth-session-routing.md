# Review: Session model, cookies & the proxy redirect table

## Summary

Solid, well-documented unit: the three-cookie model (`session` JWT in
two scopes, signed `parentUnlocked`, unsigned `activeProfileId` lock)
is enforced with real discipline — every `session.user` read goes
through a role guard, every parent mutation re-verifies the PIN unlock,
and `decrypt` fails closed on wrong-shape signed tokens. The redirect
table terminates for every traced input pair except one: the new
`profileExistsCache` reintroduces a bounded (≤60 s) proxy↔page
redirect ping-pong for deleted-profile kid sessions that the code
comments explicitly claim is impossible. The other meaningful gap is
defense-in-depth: the PIN gate for `/parent/*` *reads* exists only in
`proxy.ts` — the layout/pages backstop the session but not the unlock.

## Strengths

- **Discriminated session union, consistently narrowed.**
  `SessionPayload = ParentClaims | KidClaims` (lib/auth.ts:21-36) with
  `parentSession()`/`isKidSession()` as the only accessors. Audited all
  7 direct `session.user` reads (safety.ts:46, profiles.ts:69,85,172,
  invites.ts:24, channels.ts:110) — every one sits behind an explicit
  `role !== "parent"` or `isKidSession` early-out. No kid-claim leaks.
- **`decrypt` shape-validation is genuinely fail-closed.**
  lib/auth.ts:71-87: a well-signed token of the wrong shape — e.g. a
  `parentUnlocked` JWT pasted into the `session` cookie (no `role`, no
  `user`) — returns null rather than a partial session. The reverse
  confusion is also closed: `verifyUnlockToken` (auth.ts:213-216)
  requires `scope === "parent-unlock"` AND `sub === user.id`, so a
  session JWT can't masquerade as an unlock token, and unlock tokens
  can't cross users. Legacy pre-`role` JWTs are normalized, not
  rejected (auth.ts:71).
- **Redirect table terminates for the adversarial inputs asked about.**
  Deleted-profile kid JWT → `/login` + both cookies cleared
  (proxy.ts:60-65, once the cache entry expires — see Issue 1); forged
  `activeProfileId` can only satisfy rule 2 by already matching the URL
  (proxy.ts:114-133) so it converges in one hop; stale/forged
  `parentUnlocked` → redirect + `res.cookies.delete` (proxy.ts:150-156)
  so the next hop can't re-trigger. `/` with lock+session sends the
  lock first (proxy.ts:95-102) — deliberate per AGENTS.md.
- **Unlock is re-verified, not presence-checked, at every write.**
  `requireParentUnlocked` (auth.ts:250-258) re-verifies the signed
  token per action; read actions use the throwing variant
  `assertDashboardReader` (search.ts:42-49, channel-videos.ts:37-42).
  `loginKid` clears a stale `parentUnlocked` (auth.ts:114) and
  `verifyParentPin` lifts the kid lock on success (safety.ts:59) — the
  cross-cookie transitions are handled at every entry point.
- **Cookie hygiene.** httpOnly + `sameSite: "lax"` + prod `secure`
  (auth.ts:14-19); every `activeProfileId` writer shares
  `activeProfileCookieOptions` (auth.ts:119-125, safety.ts:29,
  actions/auth.ts:168-172, proxy.ts:74-78); `safeCallback` defeats the
  `\\`, `%09`, and `..//` open-redirect tricks (actions/auth.ts:31-45).

## Issues

1. **med — Proxy↔page redirect ping-pong for deleted-profile kid
   sessions inside the cache window.** `profileExistsCache`
   (proxy.ts:24-42) can hold a stale `exists: true` for up to 60 s
   after deletion. In that window: proxy.ts:60-84 passes the kid
   through to (or back to) `/kids/<id>`, but the page's
   `canViewProfile` does an *uncached* existence check
   (lib/profiles.ts:87-91) → false → `redirect("/kids")`
   (app/kids/[profileId]/page.tsx:58-60;
   watch/[videoId]/page.tsx:33-35; `assertCanEditKidData` does the same
   at profiles.ts:62) → proxy's kid rule redirects `/kids` back to the
   feed (proxy.ts:84) → loop, ~2 full navigations per round-trip until
   the TTL expires. The comments at proxy.ts:53-56 and
   lib/profiles.ts:83-86 assert this loop can't happen — the cache
   reintroduced it. **Fix:** when `canViewProfile` fails under a
   kid session, render `notFound()` instead of redirecting to `/kids`
   (proxy owns cookie revocation; every matched redirect target bounces
   back to the feed). Alternatively export `profileExists` and share
   the TTL entry so both layers agree (stale-true → page proceeds →
   profile lookup → clean 404).
2. **med — The PIN gate has no server-side backstop on `/parent/*`
   reads.** `app/parent/layout.tsx:10-11` and both pages check
   `parentSession` only; `proxy.ts:150-156` is the sole unlock
   enforcement for page loads. Mutations are safe
   (`requireParentUnlocked`), but if the matcher is ever narrowed or
   proxy regresses, a session-only (PIN-never-entered) device reads the
   whole portal. **Fix:** add
   `if (!(await isParentUnlockedCookie(session))) redirect("/kids?gate=1")`
   to `app/parent/layout.tsx` — one line, covers all current and
   future `/parent/*` pages.
3. **med — Drift copies of the kid-write guard diverge on the
   deleted-profile check.** `app/api/watch-progress/route.ts:35-47`
   and `app/api/video-reactions/route.ts:31-43` copy the
   `isKidSession → activeProfileId → assertCanManageProfile` chain but
   skip the existence re-check `assertCanEditKidData` performs
   (lib/profiles.ts:55-63). Writes still fail closed — the
   `whitelisted_videos` rows cascade-delete with the profile, so the
   `approved` check 403s — but the guard now exists in three divergent
   forms, and `/api/*` is outside the matcher so a deleted profile's
   kid JWT is never revoked there (it silently 403s for up to a year).
   **Fix:** extract `assertKidWriteAccess(profileId)` returning a
   result the routes map to 403; share the existence check.
4. **low — Double JWT decrypt on every matched request.** proxy.ts:46
   decrypts, then `updateSession` (proxy.ts:72,164) calls
   `getRequestSession` again (auth.ts:179). `refreshSessionCookie`
   already accepts the payload (auth.ts:157-173) — proxy could call it
   directly on a `NextResponse.next()`. Same pattern in actions:
   `requireParentUnlocked` re-fetches the session (auth.ts:251) that
   callers already hold (pinning.ts:22+27, channels.ts:25+27, etc.).
   **Fix:** `updateSession(request, session)` /
   `requireParentUnlocked(session)` overloads.
5. **low — `/songs` treats a kid session as a signed-in parent.**
   `signedIn={!!session}` and the `mine` tab gate
   (app/songs/page.tsx:68,88) use the raw session, so a logged-in kid
   gets a "Parent portal" button (catalog-header.tsx:52-62 — proxy
   bounces it back to their feed) and a "Yours" tab that fails closed
   to zero rows via the nil-UUID filter (lib/songs-feed.ts:238-241).
   `userId` already uses `parentSession` (page.tsx:60) — the chrome
   flags should too. Kid sessions reaching `/songs` at all is fine
   (public catalog, deliberate matcher omission).
6. **low — Stale unsigned `activeProfileId` on a deleted profile is a
   permanent dead end.** Existence is only probed for kid *sessions*
   (proxy.ts:60). A cookie-locked device: `/` → `/kids/<deleted>`
   → rule 2 passes on cookie match (proxy.ts:125) → `canViewProfile`
   returns true on the cookie match without checking existence
   (lib/profiles.ts:93) → profile lookup misses → `notFound()`. Every
   `/` nav then 404s for the cookie's 1-year life (recoverable only
   via picker → PIN verify, which deletes the cookie at safety.ts:59).
   **Fix:** run `profileExists` on the `activeProfileId ===
   profileIdInUrl` branch too — same cached-probe cost — and clear the
   lock cookie on a miss.
7. **low — Two cosmetic redirect inefficiencies.** Rule 3
   (proxy.ts:138-140) fires before the session check, so a logged-out
   locked device hitting `/parent/*` lands on `/login?callback=/kids`
   with the `gate=1` intent dropped (post-login the modal doesn't
   auto-open). Rule 6 (proxy.ts:159-161) sends signed-in users to
   `/parent/dashboard` which then bounces to `/kids?gate=1` when
   unlocked=false — two hops; could target `/kids` directly.
8. **low — `startsWith("/parent")` is an open prefix.** proxy.ts:138,
   143, 150 also match a hypothetical `/parental-*` route; use
   `pathname === "/parent" || pathname.startsWith("/parent/")`. (Rule
   2's `/kids/` split already guards the empty segment correctly.)
9. **low — `KidClaims.name` is dead, permanently-stale payload.**
   Minted at login (auth.ts:101-107), never read anywhere (all UI uses
   the DB `profile.name`), and the rolling refresh re-signs the same
   payload (auth.ts:169), so it can't even self-heal on rename. Drop
   it from the claims, or treat `refreshSessionCookie` as the place to
   re-derive claims.
10. **low — `decrypt` validates `user.id` but not `user.email`/`name`**
    (auth.ts:75-83). Unreachable today since only `login`/`loginKid`
    can mint signed tokens, but a one-line `typeof user.email ===
    "string"` check costs nothing and closes the only under-validated
    field. Also worth noting: a *deleted user's* parent session is
    never re-validated against `users` (unlike the kid-side
    `profileExists` probe) — it degrades gracefully because all queries
    key off `user.id`, which cascades, but there's no revocation path.
11. **low — `profileExists` propagates DB errors.** proxy.ts:33-36: a
    Neon hiccup throws through `proxy` → every matched navigation 500s
    (a kid device can't even reach `/login` cleanly). Pages would fail
    anyway, but catching → "treat as exists" (fail open to the feed
    render's own error path) or → fail closed to `/login` would degrade
    more politely. Expired cache entries also never get evicted —
    trivial at this scale, but `profileExistsCache.delete` on expiry is
    free.

## Refactor suggestions

1. **Fix the ping-pong first (Issue 1):** `notFound()` — not
   `redirect("/kids")` — when `canViewProfile` fails under a kid
   session; apply to both kids pages and `assertCanEditKidData`.
2. **Add the PIN-unlock backstop to `app/parent/layout.tsx`**
   (Issue 2) so the gate doesn't hinge on the matcher alone.
3. **Thread the session through helpers** (Issue 4):
   `updateSession(request, session)` and
   `requireParentUnlocked(session)` — removes a `jwtVerify` per
   navigation and per action.
4. **Unify the kid-write guard (Issue 3):** one
   `assertKidWriteAccess(profileId)` in lib/profiles.ts returning
   `{ ok } | { status }`, consumed by `assertCanEditKidData` and both
   API routes; fold in the existence check so all three copies agree.
5. **Share `assertDashboardReader`** between actions/search.ts and
   actions/channel-videos.ts (currently a verbatim inline copy at
   channel-videos.ts:37-42).
6. **Gate `/songs` chrome on `parentSession(session)`** (Issue 5) —
   `signedIn` and the `mine` tab, matching the `userId` derivation two
   lines later.
7. **Existence-probe the cookie lock in proxy** (Issue 6) — reuse the
   same TTL map so `/` never routes to a dead profile's 404.
8. **Tighten path-prefix matching** (Issue 8) with a tiny
   `isUnder(pathname, "/parent")` helper; also redirect
   `/login`/`/signup` → `/kids` instead of `/parent/dashboard` to save
   the second hop (Issue 7).
