# Design

Source: `docs/plans/architecture-refactor-plan.md` phase 5 +
`refactoring-plan.md` W7 (retired into this change). OVERALL.md
issues #9, #15; decision D9 (two-track contract — recommended).

## Error boundaries

Zero `error.tsx`/`not-found.tsx` exist today (only the Sentry
`app/global-error.tsx` root boundary). A DB hiccup, quota-exhausted
first-page search, or thrown action renders Next's stock screen —
jarring on a kid device.

- `app/error.tsx` — `"use client"` boundary with `reset()` retry,
  kid-safe chrome (big rounded card, friendly copy, link to `/` —
  proxy routes it correctly per device state).
- `app/not-found.tsx` — same chrome for 404s.
- `app/parent/dashboard/error.tsx` — retry card for first-page
  search/quota failures; page-N infinite scroll already has its
  own retry UI.
- `app/kids/[profileId]/not-found.tsx` — needed by the
  access-gates change's `notFound()`-under-kid-session path;
  whichever change lands first ships it, reusing ONE kid-safe
  error-card component across all four files.

## Two-track action error contract (D9)

Today: `void` + `console.log` (pinning, channels), `throw`
(playlists + all read/paging actions), `{ error }` state objects
(auth, profiles, songs). Recommended contract — already ~80% true:

- **Form/button actions that must surface failure** return
  `Promise<{ error?: string }>`; pin/unpin/approve convert (their
  `console.log`s become `{ error }` returns; dashboard cards
  surface it — additive, no flag day: card-side surfacing can land
  later).
- **Programmatic/paging actions** (`loadMore*`, playlist actions
  consumed by `.catch` client code) keep throwing — callers
  already handle rejection; don't churn them.
- Strip debug `console.log`s in `pinning.ts`/`invites.ts`.
- Document the contract in AGENTS.md's business-rules section.

## Risks

- Reuse ONE kid-safe error-card component across
  `error.tsx`/`not-found.tsx` rather than styling each separately.
- The `{ error }` additions are additive — no caller reads the
  return today, so surfacing can land in a follow-up.

## Verification

- `npm run typecheck && npm run lint`.
- Manual: pull `DATABASE_URL` on a running dev server → kid feed
  shows the friendly error card, not the stock screen; dashboard
  `error.tsx` retry recovers after restoring the env.
