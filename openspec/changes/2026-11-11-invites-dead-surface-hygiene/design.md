# Design

Source: `docs/plans/architecture-refactor-plan.md` phase 6 +
`refactoring-plan.md` W11 (retired into this change). OVERALL.md
issues #12, #36, #37, parts of #46; decisions D1–D5, D15, D16.

## Invite flow (#12)

The feature is unreachable: `inviteParent` only `console.log`s the
link and the pending UI renders no URL.

- **D1 — delivery (recommended: copyable link).**
  `inviteParent`/`createInviteAction` returns `{ url }`; each
  pending row on `/parent/profiles` renders a copyable
  `<origin>/invite/<token>` link. Alternative: real email sending —
  needs a provider that doesn't exist (`lib/notify.ts` is
  admin-facing Telegram only).
- Hardening regardless of D1: owner-only invites —
  `profile.parentId === session.user.id` (today
  `assertCanManageProfile` lets a shared-access *editor* mint
  invites for the owner's profile); `z.email()` +
  `normalizeIdentifier` on the email; `z.uuid()` on profileId
  (shared helper from the access-gates change).
- Expiry-aware UI: `/invite/[token]` treats
  `invite.expiresAt < new Date()` like non-pending; `acceptInvite`
  returns an error instead of a bare `return`; pending rows past
  expiry show "Expired" on `/parent/profiles`.

## Dead schema columns (#37) — decisions with recs

- **D2 `shared_access.role`** — only `"editor"` is ever written,
  nothing reads it. Rec: **drop** in the same migration.
- **D3 `invites.email`** — collected, never used. Rec: **keep +
  bind at accept** (`invite.email.toLowerCase() === user.email`,
  "wrong account" error) — cheap defense-in-depth. Alt: drop
  column + form field.
- **D4 `invites.status`** — `"rejected"` is never set. Rec:
  **narrow to `pending | accepted`** + expiry-aware UI. Alt:
  build a reject path — scope creep for a two-parent app.
- **D5 `KidClaims.name`** — minted by `loginKid`, never read,
  can't self-heal on rename. Rec: **drop** from the claims type +
  `loginKid`; old JWTs keep working (`decrypt` doesn't require
  the field).

## Hygiene tail (#36, #46)

- `.prettierrc` `semi: false` → `true` — matches every source file
  and disarms the `npm run format` trap. Do NOT run `npm run
  format` — the codebase already matches.
- Verify `"use client"` removal on `ui/button.tsx`/`ui/label.tsx`
  (already removed on `main` if a component-fix PR landed first —
  `ui/input.tsx` proves the primitives work server-side).
- `package.json`: `shadcn` → `devDependencies`; drop redundant
  `@types/bcryptjs` (bcryptjs 3.x bundles types).
- **D15** — remove `ThemeProvider`/`next-themes` (`forcedTheme=
  "light"` ships JS while `dark:` variants rot as dead code).
  Alt: commit to dark mode — a new feature, a new plan.

## Risks

- Migrations touch production Neon — verify no live flow reads a
  column before generating its drop (verified for `role`;
  `invites.email` depends on D3).
- Invite token stays the credential for acceptance (per
  `action-api-contract`); email binding is an additional check,
  not a replacement.

## Verification

- `npm run db:generate` for the drops; `npm run typecheck &&
  npm run lint && npm run build`.
- Manual invite round-trip: create → copy link → accept as a
  second account → shared profile appears; expired link →
  "Expired", no dead button.
