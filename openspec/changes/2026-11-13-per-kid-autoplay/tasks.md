# Tasks

## 1. Schema + migration

- [ ] 1.1 `lib/db/schema.ts`: add `autoplayOnOpen` and
      `autoplayOnNext` — `boolean(...).default(false).notNull()`,
      comment matching the `swipeEnabled` style (per-kid autoplay:
      first-open and end-of-video advance).
- [ ] 1.2 `npm run db:generate` → commit the generated migration.
      Do NOT run `npm run db:migrate` — report the avnadmin
      command to the user instead (deploy-order: migration must
      land before/with the code deploy).

## 2. Server action

- [ ] 2.1 `app/actions/profiles.ts`: add `setAutoplayEnabled` —
      zod `{profileId: uuid, field: enum("open"|"next"),
      enabled: boolean}`, gated by parent session +
      `requireParentUnlocked` + `assertCanManageProfile`; writes
      the matching column and revalidates `/parent/profiles`,
      mirroring `setSwipeEnabled`.

## 3. Parent UI toggles

- [ ] 3.1 New client component (e.g.
      `components/profile-autoplay-toggles.tsx`) modeled on
      `SwipeToggle` — two optimistic switch rows:
      - "Autoplay on open" — starts the video by itself when the
        watch page opens.
      - "Autoplay next" — starts the next video by itself when the
        current one ends.
      Descriptions should hint that "off" keeps plays eligible for
      YouTube watch history.
- [ ] 3.2 Mount the component on each profile card in
      `app/parent/profiles/page.tsx` next to `SwipeToggle` (both
      card variants — manageable and read-only).

## 4. Player wiring

- [ ] 4.1 `lib/yt-player.ts`: add `cueVideoById` (same arg shape as
      `loadVideoById`) to the `YTPlayer` interface.
- [ ] 4.2 `components/player-hooks.ts`: add an `autoplay?: boolean`
      option → `playerVars.autoplay = autoplay ? 1 : 0` (absent =
      manual play, unchanged for `/songs` and dashboard preview).
- [ ] 4.3 `components/watch-experience.tsx`: accept
      `autoplayOnOpen`/`autoplayOnNext` props; pass
      `autoplay: autoplayOnOpen` to the hook; ENDED-driven advance
      uses `cueVideoById` when `autoplayOnNext` is off and
      `loadVideoById` when on; user-initiated nav stays on
      `loadVideoById`.
- [ ] 4.4 `app/kids/[profileId]/watch/[videoId]/page.tsx`: pass
      the two profile columns through as props (same pattern as
      `swipeEnabled`).

## 5. Validation

- [ ] 5.1 `openspec validate --all --strict`
- [ ] 5.2 `npm run typecheck && npm run lint`
- [ ] 5.3 Manual note for the PR body: on dev :3100, toggling a
      kid's prefs changes watch-page behavior accordingly
      (paused vs auto-start on open; paused vs auto-start after
      ENDED; swipe always plays).
