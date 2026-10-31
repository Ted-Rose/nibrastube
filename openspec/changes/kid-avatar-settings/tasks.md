# Tasks

## 1. Repo tooling fix (already applied on this branch)

- [x] 1.1 Quote the `:`-bearing list items in `openspec/config.yaml`
      (proposal rule + apply guidance) and verify
      `openspec status --change kid-avatar-settings` runs with no
      parse warning

## 2. Preset list + server action

- [ ] 2.1 Add `lib/kid-avatars.ts` exporting `KID_AVATARS` (~30
      curated emoji) and verify `npm run typecheck` passes
- [ ] 2.2 Add `updateKidAvatar` to `app/actions/profiles.ts`:
      `assertCanEditKidData` guard, preset-list validation,
      `revalidatePath` on `/kids/<id>` pages; verify a non-preset
      value returns `{ error }` without writing

## 3. Settings page

- [ ] 3.1 Create `app/kids/[profileId]/settings/page.tsx` (uuid +
      `canViewProfile` checks mirroring the feed page, `notFound` on
      missing profile, kid-styled card with name + current avatar) —
      verify it renders for a locked device and a kid session
- [ ] 3.2 Add the client avatar-picker component under the settings
      route (emoji grid from `KID_AVATARS`, selected state, hidden
      input + submit via `useActionState` on `updateKidAvatar`,
      saved/error feedback) — verify picking an emoji persists and
      the header shows it after navigation

## 4. Header link

- [ ] 4.1 In `app/kids/[profileId]/page.tsx` repoint the avatar to
      `/kids/<id>/settings`, swap `UserSwitch` for `Gear`, make the
      kid-session badge the same `Link` (drop `prefetch={false}` —
      the destination is no longer a conditional redirect) — verify
      both viewer kinds land on the settings page

## 5. Verification

- [ ] 5.1 Run `npm run typecheck` and `npm run lint` — both clean
- [ ] 5.2 `awk 'length > 79 {print FILENAME":"NR}'` on every touched
      file — no violations
- [ ] 5.3 Manual run on localhost:3100 — walk locked-device and
      kid-session flows end to end; update AGENTS.md layout entries
      for the new route/lib file

## Workflow follow-up

- Open a draft PR against `Ted-Rose/nibrastube` with a UI
  verification section (rule 7).
- Archive the change after merge per the openspec-archive-change
  workflow.
