# Tasks

## 1. Error boundaries

- [ ] 1.1 `app/error.tsx` (`"use client"`, `reset()`) +
      `app/not-found.tsx` — shared kid-safe error-card component
- [ ] 1.2 `app/parent/dashboard/error.tsx` — first-page retry card
- [ ] 1.3 `app/kids/[profileId]/not-found.tsx` — only if the
      access-gates change hasn't shipped it (same component)

## 2. Two-track error contract

- [ ] 2.1 Convert `pinVideo`/`unpinVideo`/`approveChannel` (and
      their siblings) to return `Promise<{ error?: string }>` —
      `console.log` sites become `{ error }` returns
- [ ] 2.2 Strip the debug `console.log`s in `pinning.ts` and
      `invites.ts`
- [ ] 2.3 Document the two-track contract in AGENTS.md

## 3. Verification

- [ ] 3.1 `npm run typecheck && npm run lint`
- [ ] 3.2 Manual: pull `DATABASE_URL` on dev → friendly kid card
      not the stock screen; dashboard retry recovers on restore

## Hand-off (user-run)

None.
