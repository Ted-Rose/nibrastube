# Proposal

## Why

Distilled from `docs/plans/architecture-refactor-plan.md` phase 6
(master plan W11; OVERALL #12, #36, #37, parts of #46) — still open
on `main`. The invite feature is unreachable: `inviteParent` only
`console.log`s the link and the pending UI renders no URL. A
shared-access *editor* can mint invites for the owner's profile.
Dead schema surface (`shared_access.role`, `invites.email`,
`invites.status:"rejected"`, `KidClaims.name`) and hygiene traps
(`.prettierrc` `semi:false` vs an all-semi codebase, forced-light
`ThemeProvider` with dead `dark:` classes) rot alongside.

## What Changes

- Invite delivery (decision D1, recommended: copyable link —
  `createInviteAction` returns `{ url }`; each pending row on
  `/parent/profiles` renders `<origin>/invite/<token>`; no email
  infra exists). **Feature becomes reachable.**
- Hardening: `inviteParent` requires `profile.parentId ===
  session.user.id` (owner-only — a shared editor can no longer
  mint invites); `z.email()` + `normalizeIdentifier` on the email.
- Expiry-aware UI: `/invite/[token]` treats expired like
  non-pending ("Expired" label, no dead Accept button);
  `acceptInvite` returns an error instead of a bare return.
- Dead-column decisions carried from the master plan (default recs):
  D2 drop `shared_access.role`; D3 keep `invites.email` + bind at
  accept (`invite.email.toLowerCase() === user.email`, "wrong
  account" error); D4 narrow `invites.status` to
  `pending | accepted`; D5 drop `KidClaims.name` from the claims
  type + `loginKid` (old JWTs keep working — `decrypt` doesn't
  require the field).
- Hygiene tail: `.prettierrc` `semi: true` (matches the codebase —
  do NOT run `npm run format`); `shadcn` → `devDependencies`; drop
  redundant `@types/bcryptjs`; remove `ThemeProvider`/`next-themes`
  + dead `dark:` variants (D15); verify `"use client"` removal on
  `ui/button.tsx`/`ui/label.tsx` (may already be done on `main`).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `auth-session`: shared-access invites become deliverable,
  owner-minted, optionally email-bound, and expiry-aware.

## Impact

- Whitelist safety: **parent surfaces only** — invite minting gets
  stricter (owner-only), nothing kid-visible changes.
- Code: `app/actions/invites.ts`, `app/parent/profiles/page.tsx`,
  `app/invite/[token]/`, `lib/auth.ts` (`KidClaims`),
  `lib/db/schema.ts` (column drops), `.prettierrc`,
  `package.json`, `app/layout.tsx`/`components/theme-provider.tsx`
  + `dark:` classes.
- `[schema]`: column drops → `npm run db:generate` in-PR;
  `npm run db:migrate` is a **user hand-off** (production Neon).
- Migrations touch live data — verify no live flow reads a column
  before generating its drop (done for `role`; `invites.email`
  depends on D3).
- Verify with `npm run typecheck`, `npm run lint`,
  `npm run build` (`"use client"` removal touches boundaries) +
  the invite round-trip in `tasks.md`.
