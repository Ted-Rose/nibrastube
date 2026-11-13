# Tasks

## 1. Invite delivery + hardening

- [ ] 1.1 `createInviteAction`/`inviteParent` returns `{ url }`;
      pending rows on `/parent/profiles` render a copyable
      `<origin>/invite/<token>` link (D1 rec)
- [ ] 1.2 Owner-only minting (`profile.parentId ===
      session.user.id`); `z.email()` + `normalizeIdentifier` on
      email; `z.uuid()` on profileId
- [ ] 1.3 Expiry-aware UI: `/invite/[token]` + pending rows treat
      expired like non-pending ("Expired" label); `acceptInvite`
      returns an error instead of a bare return
- [ ] 1.4 `acceptInvite` binds `invite.email.toLowerCase() ===
      user.email` (D3 rec) with a "wrong account" error

## 2. Dead schema + claims

- [ ] 2.1 Drop `shared_access.role` (D2) via `npm run db:generate`
- [ ] 2.2 Narrow `invites.status` to `pending | accepted` (D4)
- [ ] 2.3 Drop `KidClaims.name` from the claims type + `loginKid`
      (D5)

## 3. Hygiene tail

- [ ] 3.1 `.prettierrc` `semi: true` — do NOT run `npm run format`
- [ ] 3.2 `shadcn` → `devDependencies`; drop `@types/bcryptjs`
- [ ] 3.3 Remove `ThemeProvider`/`next-themes` + dead `dark:`
      variants (D15)
- [ ] 3.4 Verify `ui/button.tsx`/`ui/label.tsx` carry no
      `"use client"` (may already be fixed on `main`)

## 4. Verification

- [ ] 4.1 `npm run typecheck && npm run lint && npm run build`
- [ ] 4.2 Manual invite round-trip: create → copy link → accept as
      second account → shared profile appears; expired link →
      "Expired"

## Hand-off (user-run)

- [ ] H1 `npm run db:migrate` — production Neon, unpooled URL —
      for the `shared_access.role` / `invites.status` changes
