# Tasks

## 1. Unified kid-write gate

- [ ] 1.1 Extract `kidWriteGate(profileId)` in `lib/profiles.ts`
      per `design.md` §3.1; wire `assertCanEditKidData` to delegate
- [ ] 1.2 Rewire `app/api/watch-progress/route.ts` and
      `app/api/video-reactions/route.ts` to the gate (failure →
      JSON 403), gaining the profile-existence check

## 2. Boundary validation

- [ ] 2.1 `z.uuid()` inside `assertCanManageProfile` +
      `kidWriteGate`
- [ ] 2.2 New `getString(formData, key)` helper; apply in
      `auth.ts`, `profiles.ts`, `invites.ts`, `safety.ts` where raw
      entries are cast/trimmed; `z.uuid()` on
      `createInviteAction`'s `profileId`

## 3. Parent backstop + decrypt dedup

- [ ] 3.1 `app/parent/layout.tsx`: `isParentUnlockedCookie` check →
      `redirect("/kids?gate=1")`
- [ ] 3.2 `updateSession(request, session?)` skips the second
      `jwtVerify`; `requireParentUnlocked(session?)` accepts an
      optional session
- [ ] 3.3 `decrypt` requires `typeof user.email === "string"`

## 4. Deleted-profile edges

- [ ] 4.1 Kid session + `canViewProfile` failure → `notFound()` on
      the kids feed + watch pages; `assertCanEditKidData` swaps its
      `redirect("/kids")` for the gate result
- [ ] 4.2 `profileExists` try/catch → treat errors as "exists";
      evict expired cache hits
- [ ] 4.3 Existence-probe the `activeProfileId` lock on the `/`
      redirect and the rule-2 cookie match; miss → delete cookie
- [ ] 4.4 `startsWith("/parent")` → exact-or-`"/parent/"` prefix
- [ ] 4.5 Ship `app/kids/[profileId]/not-found.tsx` (shared
      kid-safe error card)
- [ ] 4.6 Move `assertDashboardReader` to `lib/profiles.ts`;
      import from `search.ts` + `channel-videos.ts`

## 5. Verification

- [ ] 5.1 `npm run typecheck && npm run lint`
- [ ] 5.2 Manual on port 3100: locked-device playlist add +
      reaction + beacon work; crafted `activeProfileId=foo` → 403
      not 500; `/parent/dashboard` → PIN gate without unlock;
      deleted profile under kid session → kid-safe 404

## Hand-off (user-run)

None.
