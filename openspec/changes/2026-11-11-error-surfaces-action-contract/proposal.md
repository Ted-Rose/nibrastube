# Proposal

## Why

Distilled from `docs/plans/architecture-refactor-plan.md` phase 5
(master plan W7; OVERALL #9, #15) — still open on `main`: apart
from the Sentry `global-error.tsx` boundary, zero
`error.tsx`/`not-found.tsx` files exist, so a Neon hiccup, a
quota-exhausted page-1 search, or a thrown action renders Next's
stock error screen on a kid device — while page-N infinite scroll
gets graceful retry UI. Server actions also carry four different
failure contracts (`void` + `console.log`, `throw`, `{ error }`,
throw-for-reads) and a handful of debug `console.log`s remain.

## What Changes

- `app/error.tsx` (`"use client"`, `reset()` retry) +
  `app/not-found.tsx` — kid-safe chrome: big rounded card,
  friendly copy, link to `/` (proxy routes correctly per device
  state).
- `app/parent/dashboard/error.tsx` — retry card for first-page
  search/quota failures (page-N paging already has its own retry
  UI).
- `app/kids/[profileId]/not-found.tsx` — shared kid-safe card;
  pulled forward into the access-gates change if it lands first
  (the `notFound()` path under a kid session needs it the same
  release).
- Two-track server-action error contract, documented in AGENTS.md:
  form/button actions that must surface failure return
  `Promise<{ error?: string }>` (pin/unpin/approve-channel
  convert — their `console.log`s become `{ error }` returns);
  programmatic/paging actions keep throwing (callers `.catch`
  already). Decision D9 from the master plan — recommended as-is.
- Strip debug `console.log`s in `pinning.ts` and `invites.ts`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `action-api-contract`: documents the two-track server-action
  error contract (`{ error }` for form-surfaced actions, throw for
  paging/programmatic) as the requirement.

## Impact

- Whitelist safety: **UX only** — friendlier failure surfaces; no
  access-rule change. The kids not-found card is the one surface a
  kid might see.
- Code: new `app/error.tsx`, `app/not-found.tsx`,
  `app/parent/dashboard/error.tsx`,
  `app/kids/[profileId]/not-found.tsx`,
  `app/actions/{pinning,channels,invites}.ts`, AGENTS.md contract
  note.
- Verify with `npm run typecheck`, `npm run lint` + a DB-outage
  manual check.
