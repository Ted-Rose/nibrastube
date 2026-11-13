# Proposal

## Why

YouTube only counts a play toward view count — and therefore watch
history — when playback is *initiated via the player's own native
play button*. NibrasTube's `autoplay: 1` made every play
programmatic, so nothing ever reached YouTube history (verified:
signed-in manual playback on `youtube.com` records; app autoplay
does not). Autoplay was therefore removed globally (PR #78), but
that made playback manual for everyone, including parents who may
prefer convenience over history for some kids. The parent needs a
per-kid choice.

## What Changes

- Two new per-profile booleans on `profiles`, both default `false`
  (history-friendly default):
  - `autoplayOnOpen` — video starts by itself when the watch page
    opens.
  - `autoplayOnNext` — when the current video ends, the next video
    starts by itself.
- Parent-facing toggles on each kid's card in
  `/parent/profiles` (the same Manage Kids card that hosts
  "Swipe to change videos"), mirroring the `SwipeToggle` pattern:
  optimistic switch, zod-validated server action gated by parent
  session + `requireParentUnlocked` + `assertCanManageProfile`.
- `useYouTubePlayer` gains an `autoplay` option wired to
  `playerVars.autoplay`; `WatchExperience` receives both prefs from
  the watch page.
- Automatic advance (ENDED-driven `loadVideoById`) respects
  `autoplayOnNext`: disabled → `cueVideoById` so the next video
  loads paused; user-initiated navigation (swipe, back/next taps)
  always plays.
- Other player surfaces (`/songs` overlay, dashboard preview)
  keep current manual-play behavior — no profile context there.
- Requires a drizzle migration (`npm run db:generate`; the apply
  step is the user's avnadmin command — see tasks).

## Capabilities

### New Capabilities

- `kid-playback-settings`: parent-managed, per-kid playback
  behavior — which transitions may start playing without a tap on
  the YouTube player, chosen per profile.

### Modified Capabilities

(none)

## Impact

- `lib/db/schema.ts` — two `profiles` columns + generated
  migration (apply order matters: columns must exist in prod
  before the code ships, or profile reads 500).
- `app/actions/profiles.ts` — new validated action.
- `app/parent/profiles/page.tsx` + new toggle component.
- `components/player-hooks.ts`, `components/watch-experience.tsx`,
  `lib/yt-player.ts` (cueVideoById typing),
  `app/kids/[profileId]/watch/[videoId]/page.tsx` (prop drilling).
- YouTube watch history side-effect: any play started without a
  native tap does not count — enabling a toggle trades history for
  convenience, per kid.
