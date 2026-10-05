# Plan: Persistent Parent Auth + Server-side PIN Gate

Fix branch prefix: `fix/` (e.g. `fix/persistent-parent-auth`).

## Goal

A parent logs in **once per device** and stays logged in indefinitely.
On that device:

- Kids can move freely between all of the parent's kid profiles.
- The parent area (`/parent/*`) is reachable **only** after entering the
  Parent PIN — never by back button, URL typing, or an expired cookie.
- Entering the PIN never bounces the parent to `/login`.

## Facts established by codebase investigation

### Root cause 1 — the session dies after 2h and is never refreshed

- `lib/auth.ts` `encrypt()` signs the JWT with
  `setExpirationTime("2h")`, and `login()` sets the `session` cookie with
  a matching 2h `expires`.
- `updateSession()` exists but is **dead code** — nothing calls it
  (`proxy.ts` doesn't). Even if wired, it would only extend by 2h.
- After 2h every `/parent/*` guard (`proxy.ts`, `app/parent/layout.tsx`,
  `parent/dashboard/page.tsx`, `parent/profiles/page.tsx`) redirects to
  `/login`. **This is the primary "keeps asking me to log in" bug.**

### Root cause 2 — "parent area locked" is inferred from the kid cookie

- The only thing blocking `/parent` is the *presence* of the
  `activeProfileId` cookie (`proxy.ts` rule 2).
- `activeProfileId` has its own `maxAge` of 24h (`app/actions/safety.ts`
  `selectProfile`).
- Two independent clocks (2h session, 24h kid cookie) produce two
  broken states:
  - **No kid cookie + valid session** (right after login, after
    "Kids Corner" before a profile is picked, after 24h expiry):
    `/parent/dashboard` is open **without a PIN**. A kid on the `/kids`
    picker can hit the browser back button into the dashboard.
  - **Kid cookie + expired session:** PIN passes → `unlockParentPortal`
    deletes `activeProfileId` → redirect to `/parent/dashboard` →
    `/login`. The PIN was pointless and the device is now un-locked.
- The PIN is verified **only on the client**: it's shipped as a prop
  (`KidsFooterGate correctPin=...`) and compared in `ParentalGate`.
  The server has no notion of "the parent unlocked this device".

### Root cause 3 — kids are URL-locked to one profile

- `proxy.ts` rule 1 redirects `/kids/<otherId>` back to
  `/kids/<activeProfileId>`. Switching via the `/kids` picker works
  (`selectProfile` overwrites the cookie), but direct links, history
  entries and bookmarks to a sibling's profile bounce.

### Collateral issues

- **Cross-family data leak:** with no session, `app/kids/page.tsx` runs
  `db.query.profiles.findMany()` with no filter — every family's kids
  are listed. Because of root cause 1 this is the normal state of a kid
  device. The gate PIN then falls back to `allProfiles[0]`'s owner —
  potentially another family's PIN.
- **Stale PIN:** `parentPin` is embedded in the JWT at login
  (`app/actions/auth.ts`), so a PIN change (currently DB-only, no UI)
  isn't picked up until the next login.
- **Silent auth failures:** `login` / `signup` server actions just
  `return` on validation or credential failure — no error shown, which
  looks like "login is broken".
- Cookies have no explicit `sameSite` / `secure`.
- *Unverified suspicion:* the Android Capacitor WebView may drop
  cookies if the app is killed before the cookie store flushes. Worth
  testing on device after the main fix.

## Design

Three independent cookies, each with one job:

| Cookie            | Meaning                              | Lifetime                    |
| ----------------- | ------------------------------------ | --------------------------- |
| `session`         | Which parent owns this device        | Long (1 year), rolling      |
| `parentUnlocked`  | PIN was entered; parent area allowed | Short (see decision below)  |
| `activeProfileId` | Last kid profile used on this device | Long (1 year), informational |

All set with `httpOnly`, `sameSite: "lax"`, `path: "/"`,
`secure: process.env.NODE_ENV === "production"`.

### Route rules (`proxy.ts`)

1. `/` → `/kids` if `session` (otherwise show landing page).
2. `/kids` and `/kids/*` → require `session`; else `/login`.
   No per-profile lock. (Page-level check that the profile is
   manageable by the session user — see below.)
3. `/parent/*` → require `session` (else `/login`) **and**
   `parentUnlocked` (else `/kids?gate=1`, which auto-opens the PIN
   modal).
4. `/login`, `/signup` with `session` → `/kids`.
5. On every matched request with a valid `session` whose JWT is older
   than ~1 day, reissue it (rolling refresh) on the response.
   Read cookies from `request.cookies`, write via `NextResponse`.

### Server-side PIN verification

- New server action `verifyParentPin(formData)` in
  `app/actions/safety.ts`:
  - `getSession()`; if none → `redirect("/login")`.
  - Load `users.parentPin` from DB (not from the JWT).
  - On match: set `parentUnlocked` cookie, `redirect("/parent/dashboard")`.
  - On mismatch: return `{ error: "Incorrect PIN" }` (use
    `useActionState` in the client).
- `ParentalGate` submits to this action instead of comparing locally.
  **Stop passing `correctPin` to any client component.**
- `login` / `signup` also set `parentUnlocked` (the parent just proved
  identity with a password).

### Leaving the parent area

- New server action `lockParentPortal()` deletes `parentUnlocked` and
  redirects to `/kids`. Used by the "Kids Corner" nav link in
  `components/parent-nav.tsx` (convert the link to a form/button).
- `logoutAction` clears `session`, `parentUnlocked` and
  `activeProfileId`.

### Kids area

- `app/kids/page.tsx`: list `getManageableProfiles(session.user.id)`
  (owned + shared). Remove the unfiltered `findMany()` and the
  `gatePin` fallback logic.
- `app/kids/[profileId]/page.tsx` and `watch/[videoId]/page.tsx`:
  after loading the profile, `assertCanManageProfile(session, id)`
  (catch → `redirect("/kids")`). Remove `profileOwner.parentPin`.
- `selectProfile` keeps setting `activeProfileId` (long-lived) so
  `/api/watch-progress` and `/api/video-reactions` keep working; it
  should also verify the profile is manageable by the session user.
- Header "switch profile" links keep pointing at `/kids`.

### Auth helpers (`lib/auth.ts`)

- Single `SESSION_MAX_AGE` constant (1 year) used by `encrypt` and the
  cookie.
- Drop `parentPin` from the JWT payload.
- Replace dead `updateSession()` with a helper used by `proxy.ts` for
  the rolling refresh.
- Add `setParentUnlocked()` / `clearParentUnlocked()` helpers.

### Login / signup UX

- Return `{ error }` from `login` / `signup` and render it in the forms
  (`useActionState`), so failures are visible.

## Decisions to confirm

1. **`parentUnlocked` lifetime** — options:
   - *Browser-session cookie + cleared on "Kids Corner"* (default
     proposal), or
   - *Fixed 15 min* idle window, refreshed by `proxy.ts` on each
     `/parent/*` request.
2. **Drop the "locked to one kid profile" behaviour entirely?**
   Default proposal: yes — any of the parent's kids, freely.

## Files touched

- `lib/auth.ts` — lifetimes, cookie options, refresh + unlock helpers
- `proxy.ts` — new route rules, rolling refresh
- `app/actions/safety.ts` — `verifyParentPin`, `lockParentPortal`,
  hardened `selectProfile`
- `app/actions/auth.ts` — errors, set `parentUnlocked`, full logout
- `app/login/page.tsx`, `app/signup/page.tsx` — show errors
- `app/kids/page.tsx`, `app/kids/[profileId]/page.tsx`,
  `app/kids/[profileId]/watch/[videoId]/page.tsx` — scoping, no PIN prop
- `components/parental-gate.tsx`, `parental-gate-wrapper.tsx`,
  `kids-footer-gate.tsx` — server-action PIN, `?gate=1` auto-open
- `components/parent-nav.tsx` — "Kids Corner" locks the parent area
- `AGENTS.md` — update "Two auth layers" / "Known sharp edges"

No DB schema change.

## Verification

`npm run typecheck` and `npm run lint`, then manually:

1. Log in → land on `/kids`; parent dashboard reachable via nav.
2. Click "Kids Corner" → `/kids`. Browser back → redirected to
   `/kids?gate=1` with PIN modal, **not** the dashboard.
3. Type `/parent/dashboard` in the URL bar → PIN modal.
4. Wrong PIN → error shown, stay on kids page. Right PIN → dashboard.
5. Pick kid A, open a video, go back, pick kid B, open a direct
   `/kids/<A-id>` URL → loads A (no bounce).
6. Shorten `SESSION_MAX_AGE` refresh threshold temporarily (or edit the
   cookie) to confirm rolling refresh reissues `session`.
7. Close the browser / kill the app, reopen → still logged in, kids
   picker shows only this family's profiles; PIN still required for
   parent area.
8. Log in as a second parent in another browser → `/kids` shows only
   their own + shared profiles; `/kids/<other-family-id>` → `/kids`.
9. Change `users.parent_pin` in the DB (no PIN-change UI exists yet)
   → new PIN works immediately without re-login.
10. Android APK: repeat 7 on device.
