# Proposal

## Why

The kids portal header shows the profile avatar with a switch-profile
badge linking to `/kids` — the parent-only "Who's watching?" picker.
On a kid-locked device without a parent session that link dead-ends at
`/login`, and profile switching is no longer wanted as a kid-facing
feature anyway. The avatar affordance should instead open a
kid-facing settings page where the child can personalize their own
profile — starting with the avatar.

## What Changes

- The header avatar in `app/kids/[profileId]/page.tsx` links to a new
  `/kids/<profileId>/settings` page instead of `/kids`. The
  kid-session variant — today a non-interactive badge — becomes the
  same link. The `UserSwitch` badge icon becomes a settings
  affordance.
- New settings page (kid-styled) shows the profile name and current
  avatar plus a preset emoji picker to change the avatar. Avatar
  only — the display name stays parent-managed.
- New server action `updateKidAvatar` in `app/actions/profiles.ts`,
  gated by `assertCanEditKidData` so it works for a matching kid
  session, a matching `activeProfileId` lock, or a managing parent.
- Avatar values are constrained to a shared preset emoji list,
  validated server-side; `profiles.avatar` stays a text column — no
  schema change or migration.
- No `proxy.ts` changes: `/kids/<id>/settings` is already covered by
  the existing `/kids/:path*` rules (kid sessions pass through on
  their own subtree; the lock cookie or a session gates the rest).

## Capabilities

### New Capabilities

- `kid-profile-settings`: kid-facing self-service profile settings —
  the settings route, its access rules, and avatar editing.

### Modified Capabilities

None. The change reuses the existing `auth-session` route/guard
rules and the `action-api-contract` kid-scope write gate
(`assertCanEditKidData`) without altering them.

## Impact

- Code: `app/kids/[profileId]/page.tsx` (header link + icon), new
  `app/kids/[profileId]/settings/` route with a client avatar-picker
  component, new `lib/kid-avatars.ts` preset list, new action in
  `app/actions/profiles.ts`.
- Whitelist-safety impact: none — the avatar is cosmetic and changes
  nothing about which videos a kid can see or watch.
- `openspec/config.yaml`: a pre-existing YAML bug (unquoted `:` inside
  list items) made the CLI ignore the whole file; fixed on this branch
  so project context/rules load again.
