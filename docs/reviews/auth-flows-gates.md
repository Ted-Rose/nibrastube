# Review: Login, signup, PIN gate & invite flows

## Summary

This unit is in good shape relative to its documented threat model:
`safeCallback` closes every listed open-redirect bypass (verified
against the WHATWG URL parser), the kid/parent session split fails
closed everywhere, and the gate→cookie interplay between `proxy.ts`,
`/kids?gate=1`, and `verifyParentPin` is coherent. The weakest spots
are the invite flow — the link is never actually delivered to the
inviter, so the feature is unreachable in practice — and brute-force
protection that amounts to a fixed 500 ms delay which concurrent
requests defeat.

## Strengths

- `safeCallback` (app/actions/auth.ts:31-45) checks *normalized* URLs:
  origin equality plus a `pathname.startsWith("//")` guard. Verified
  cases: `/\evil.com` and `\\evil.com` parse to host `evil.com`
  (origin mismatch → rejected); a literal tab in `/\t/evil.com` is
  stripped → `//evil.com` → rejected; `/%09/evil.com` keeps `%09` as
  encoded path data and stays same-origin when navigated;
  `/..//evil.com` and `/%2e%2e//evil.com` normalize to pathname
  `//evil.com` → rejected; `javascript:`/`data:` yield origin `null`
  → rejected. Only `pathname + search` is returned, so no raw input
  reaches `redirect()`. No remaining open-redirect path found.
- Kid callback scope filter (auth.ts:176-183) runs on the normalized
  path; the `feed`/`feed/`/`feed?` prefix match can't be satisfied by
  percent-encoded variants since nothing is decoded.
- One generic login error for identifier-miss and password-miss
  (auth.ts:186-189), and the 500 ms failure delay covers both parent
  and kid lookups.
- `decrypt` fails closed on well-signed tokens of the wrong shape —
  a `parentUnlocked` JWT pasted into `session` returns null
  (lib/auth.ts:73-87). Unlock tokens are `sub`-bound to the session
  user and 24 h-exp (lib/auth.ts:196-202); `/kids` verifies rather
  than presence-checks the cookie (app/kids/page.tsx:31).
- `loginKid` clears `parentUnlocked` so a stale unlock can't leak into
  a kid-pinned device (lib/auth.ts:111-115); kid sessions fail closed
  in `parentSession`, `assertCanManageProfile`, `verifyParentPin`
  (safety.ts:43), and proxy.ts:52-85.
- `gate=1` auto-open is gated on verified unlock state
  (app/kids/page.tsx:80), the `key` remount handles same-page nav
  (line 79), and proxy deletes stale `parentUnlocked` when bouncing
  `/parent/*` so the modal opens instead of dead-ending
  (proxy.ts:150-156, lib/auth.ts:250-258).
- PIN never leaves the server: gate components only ship the entered
  PIN up; `verifyParentPin` reads `users.parentPin` from the DB
  (safety.ts:45-48). Stored PIN never reaches client components.
- Portal-to-`document.body` rationale is correct — the kids header's
  backdrop-filter/collapse transform would clip a fixed descendant —
  and the `useSyncExternalStore` mounted flag is the right
  hydration-safe gate (parental-gate-wrapper.tsx:21-39).
- Prefetch hazards are handled consistently: `prefetch={false}` on
  auth-conditional targets (app/kids/page.tsx:52-58,
  app/invite/[token]/page.tsx:40, app/kids/[profileId]/page.tsx:147,
  components/watch-experience.tsx:687,778).
- `selectProfile` re-asserts manageability server-side and fails to a
  benign redirect rather than a raw error (safety.ts:17-31).
- Invite tokens are 256-bit random with a 24 h expiry and a unique
  column (invites.ts:18-27, schema.ts:307-320); acceptance is
  idempotent via `onConflictDoNothing` (invites.ts:60-67).

## Issues

1. **med — invite link is undeliverable; the feature is unreachable.**
   `inviteParent` (app/actions/invites.ts:29-31) comments "we'll just
   return the link so the user can copy it" but returns `void` and
   only `console.log`s `/invite/<token>` to server logs.
   `createInviteAction` (invites.ts:36-42) returns nothing, and the
   pending-invites UI (app/parent/profiles/page.tsx:107-112) renders
   only the email + a "Pending" badge — no link, no copy button. A
   parent cannot obtain the URL, so `acceptInvite` is dead code in
   practice. Fix: return `{ url }` (or the token) from
   `createInviteAction`, and render a copyable
   `<origin>/invite/<token>` link in the pending-invite row.
   (Already flagged in docs/reviews/architecture.md:32.)

2. **med — brute-force throttling is a fixed delay; parallel requests
   defeat it.** Failures sleep 500 ms (auth.ts:188, safety.ts:52) but
   nothing counts attempts or serializes them — N concurrent server-
   action calls try N candidates per window. The 4-digit PIN space
   (10k) and 4-char kid passwords are enumerable in minutes under
   modest concurrency; plaintext PIN storage is accepted, but the
   throttle as written only throttles a single-threaded attacker.
   Fix: per-account (and/or per-IP) failed-attempt counter with
   escalating delay or a `lockedUntil` timestamp, e.g. columns on
   `users`/`profiles` or a small attempts table.

3. **low — login timing still enumerates identifier existence.**
   On a miss, `login` runs zero `bcrypt.compare`s; on an existing
   email/username with a wrong password it runs one (~60-100 ms at
   cost 10) *before* the flat 500 ms sleep (auth.ts:144-189). The
   ~10-20% latency delta is measurable over repeated requests and
   reveals which identifiers exist, despite the generic error.
   Fix: keep a module-level dummy hash and always run one
   `bcrypt.compare` (user → real or dummy, profile → real or dummy)
   so every failure path performs a constant compare count.

4. **low — login identifiers are case-sensitive end to end.**
   Signup stores `email` verbatim (auth.ts:60,97-101) and login
   compares verbatim (auth.ts:145); Postgres's `unique` on
   `users.email` is case-sensitive, so `A@x.com` and `a@x.com` are
   distinct accounts and a case-typoed login fails. Kid usernames
   are only trimmed, not folded (profiles.ts:97-112). Fix: normalize
   with `.trim().toLowerCase()` at signup, login, `setKidCredentials`,
   `kidIdentifierTaken`, and `inviteParent` — ideally a shared
   `normalizeIdentifier()` helper.

5. **low — expired invites still render a working-looking Accept
   button.** The page checks only `invite.status !== "pending"`
   (app/invite/[token]/page.tsx:29); a `pending` invite past
   `expiresAt` shows the full accept card, then `acceptInvite`
   silently returns (invites.ts:55-57) and the page re-renders the
   same dead button — no error, no state change. Related: pending
   rows on /parent/profiles never get re-labeled after expiry
   (page.tsx:107-112). Fix: treat `invite.expiresAt < new Date()`
   like non-pending on the page, and return an error string from
   `acceptInvite` instead of a bare `return`.

6. **low — `invites.email` is decorative; acceptance is not bound to
   it.** `inviteParent` stores whatever the form sent — no zod
   validation, no trim/lowercase, no self-invite or duplicate
   (profileId, email) guard (invites.ts:12-27) — and `acceptInvite`
   grants `shared_access` to *any* logged-in parent holding the
   token (invites.ts:44-73). "Token is the credential" is the
   documented model and entropy makes it acceptable, but since an
   email is collected anyway, comparing
   `invite.email.toLowerCase() === user.email.toLowerCase()` with a
   "wrong account — log in as X" message is cheap defense-in-depth
   against forwarded links and makes the column meaningful.

7. **low — raced duplicate-email signup 500s instead of erroring.**
   The check-then-insert at auth.ts:78-103 can both pass the
   `existingUser` check under concurrency; the loser's insert hits
   the `users.email` unique index and throws → error boundary, not
   the friendly "already exists". (Cross-table username/email races
   are documented-accepted in profiles.ts:93-96 — this one is the
   same-table case.) Fix: `.onConflictDoNothing().returning()` and
   treat a missing returned row as the exists error, or catch the
   `23505` violation.

8. **low — gate modal accessibility gaps.** The overlay
   (parental-gate-wrapper.tsx:83-101) has no `role="dialog"` /
   `aria-modal`, no focus trap, no Escape-key or backdrop-click close,
   and focus is not restored to the trigger on close (entry relies
   on the PIN input's `autoFocus`, parental-gate.tsx:62). Fix: add
   dialog semantics, Escape/backdrop dismiss, and focus restore on
   `setIsOpen(false)`.

9. **low — `handlePass` leaves `verifying` true on a non-redirecting
   success.** On a falsy error return it does `setIsOpen(false)` but
   never `setVerifying(false)` (parental-gate-wrapper.tsx:52-61). This
   is correct only because `verifyParentPin` always `redirect()`s on
   success — the z-60 spinner overlay (lines 69-80) outlives the gate
   for any future verifier that resolves without navigating. Fix:
   clear `verifying` alongside `setIsOpen(false)`; the redirect path
   never reaches it anyway, which also removes the fragile contract
   documented in the comment.

10. **low — FormData entries are cast to string before validation;
    crafted File values 500.** `(formData.get("identifier") as
    string).trim()` runs before zod sees the value (auth.ts:132) —
    `FormDataEntryValue` can be a `File`, and `.trim()` on it throws.
    Same pattern in `createProfile` (app/actions/profiles.ts:45).
    `acceptInvite(token)` (invites.ts:51-53) and
    `createInviteAction`'s raw `profileId`/`email` (invites.ts:37-40)
    likewise pass unvalidated values into uuid-column `eq()`s →
    Postgres `invalid input syntax` 500s. Fix: type-guard
    (`typeof v === "string" ? v.trim() : ""`) or zod-parse the raw
    entry first.

11. **low — an already-unlocked parent on a kid-locked device must
    re-enter the PIN with no prompt.** proxy.ts:138-140 bounces
    `/parent/*` + `activeProfileId` to `/kids?gate=1`, but
    app/kids/page.tsx:80 suppresses the auto-open when the unlock
    token verifies — yet only `verifyParentPin` clears
    `activeProfileId` (safety.ts:59). A parent who just password-
    logged in on a locked tablet (auth.ts:149-152 sets unlock, keeps
    the lock) lands on a plain picker and must find the gate and
    re-enter the PIN. Fix: either let `verifyParentPin` short-circuit
    to "clear the lock" when `isParentUnlockedCookie` is already true,
    or surface a "Switch to parent mode" affordance on the picker
    when `parentUnlocked && activeProfileId` both hold.

12. **trivial nits.** `verifyParentPin` always lands on
    `/parent/dashboard` rather than the `/parent/*` page originally
    requested (safety.ts:60) — minor UX; password fields lack
    `autoComplete` hints (`current-password` in login-form.tsx:30,
    `email`/`new-password` in signup-form.tsx); `KidLogoutButton` has
    no pending state (idempotent — cosmetic); `signup` doesn't trim
    `name` so "  " passes `min(2)` (auth.ts:50); debug
    `console.log` of the invite link stays in prod logs
    (invites.ts:31 — also architecture.md:21).

## Refactor suggestions

1. **Deliver the invite link** (issue 1) — the only outright broken
   flow. Return the URL from `createInviteAction` and render it
   copyable next to each pending invite on /parent/profiles; delete
   the `console.log`.
2. **Real throttling** (issue 2): a `failedAttempts`/`lockedUntil`
   pair on `users` and `profiles` checked in `login` and
   `verifyParentPin`, reset on success. Covers the PIN space and the
   short kid passwords without new infra.
3. **One `normalizeIdentifier()` helper** (issues 4, 6) used by
   signup, login, `setKidCredentials`/`kidIdentifierTaken`, and
   `inviteParent` — fixes casing, whitespace, and invite-email
   binding inputs in one place.
4. **Constant-work login failures** (issue 3): dummy-hash compare on
   each miss so enumeration-by-timing needs far more samples.
5. **Expiry-aware invite UX + email binding** (issues 5, 6): fold
   `expiresAt` into the page's pending check, return errors from
   `acceptInvite`, and warn on invite-email/session-email mismatch.
6. **Gate contract hardening** (issues 8, 9, 11): dialog semantics +
   Escape/focus-restore, clear `verifying` on close, and a lock-clear
   path for already-unlocked parents.
7. **Robustness sweep** (issues 7, 10): `onConflictDoNothing` on the
   users insert, and a shared `getString(formData, key)` guard before
   `.trim()`/uuid `eq()`s across auth/invites/profiles actions.
