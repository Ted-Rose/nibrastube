# Design

## Context

See proposal.md — Why. Constraints shaping the approach:

- `swipeEnabled` is the established pattern: `profiles` boolean →
  `setSwipeEnabled` action (parent session + `requireParentUnlocked`
  + `assertCanManageProfile`) → `SwipeToggle` optimistic switch on
  the `/parent/profiles` card → prop drilled from the watch page
  server component into `WatchExperience`.
- `main` currently has autoplay fully removed (PR #78): all three
  `useYouTubePlayer` surfaces load paused.
- The YT IFrame API distinguishes `loadVideoById` (load+play) from
  `cueVideoById` (load, stay paused) — both accept
  `videoId`/`startSeconds`/`endSeconds`.
- Plays not initiated via the player's native button do not count
  toward YouTube view count or watch history — the product point of
  per-kid toggles is letting the parent choose that trade-off.

## Goals / Non-Goals

**Goals:**

- Per-kid `autoplayOnOpen` / `autoplayOnNext` columns, default off.
- Parent toggles on the existing Manage Kids card.
- Watch page honors both prefs; manual nav always plays.

**Non-Goals:**

- `/songs` overlay and dashboard preview autoplay — no profile
  context there; they stay manual.
- Any change to swipe behavior.
- History reporting UI (watch_progress already tracks it).

## Decisions

### D1: Mirror the swipe toggle, don't generalize it

Two columns + one new action `setAutoplayEnabled` carrying
`{profileId, field, enabled}` (field ∈ `open`/`next`) rather than a
generic key/value settings table — matches the codebase's
column-per-boolean style and keeps the action trivially typed.
Alternative (a single `setPlaybackPrefs` writing both booleans)
rejected: each switch row should persist independently.

### D2: `cueVideoById` for suppressed auto-advance

When `autoplayOnNext` is off, ENDED-driven advance uses
`cueVideoById` — same queue position/segment window, just paused.
User-initiated nav (swipe, explicit controls) keeps `loadVideoById`.
Alternative (load then immediate `pauseVideo()`) rejected: a
play-then-pause still counts as a programmatic start attempt and
causes an audible blip.

### D3: `autoplay` as a hook option, default off

`useYouTubePlayer({ autoplay })` → `playerVars.autoplay =
autoplay ? 1 : 0`; callers that pass nothing stay manual —
`/songs` and the dashboard preview need no change.

### D4: Migration applied by the user, before deploy

`npm run db:generate` produces the migration file; the agent MUST
NOT run `npm run db:migrate` (default DATABASE_URL is the ai_agent
role) — it reports the avnadmin command. The columns are
`NOT NULL DEFAULT false`, so old code tolerates them, but new code
selecting them breaks profile reads until the migration lands —
the user applies it before or with the merge deploy.

## Risks / Trade-offs

- **Deploy-order window** → merging before the migration lands
  500s every profile read; call it out in the PR body and report.
- **Recreated player paths** (Pusher playlist change) reuse the
  same playerVars — they inherit `autoplayOnOpen`, consistent with
  "keep watching" intent; swipe-recreated player keeps playing
  because it's user-initiated.
- **History caveat surfaces twice** (spec + PR body): an enabled
  toggle silently removes that kid's plays from YouTube history —
  the toggle descriptions should hint at this.

## Migration Plan

1. `npm run db:generate` → commit the generated migration.
2. User runs `npm run db:migrate` with the avnadmin DATABASE_URL
   (reported by the implementer, not run).
3. Merge deploys code that reads the new columns — safe once
   step 2 landed; columns' defaults also keep pre-toggle behavior
   identical to today.
