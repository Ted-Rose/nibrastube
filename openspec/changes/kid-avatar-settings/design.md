# Design

## Context

The kids portal header in `app/kids/[profileId]/page.tsx` renders the
profile avatar two ways: a plain badge for kid sessions, and a
`Link href="/kids"` with a `UserSwitch` badge for everyone else.
`/kids` is the parent-gated picker. Kid-scope writes elsewhere
(playlists, reactions, watch progress) already use
`assertCanEditKidData` in `lib/profiles.ts`, which accepts a matching
kid session, a matching `activeProfileId` lock, or a managing parent
— exactly the audience the settings page serves.

## Goals / Non-Goals

**Goals:**

- One avatar affordance in the header, one destination
  (`/kids/<profileId>/settings`) for all three viewer kinds.
- A kid-styled settings page that fits the existing big-rounded-card
  visual language and works without a session on locked devices.
- A server-side-validated preset emoji set so stored avatars stay
  render-safe short strings.

**Non-Goals:**

- Name or credential editing (name stays parent-managed; kid
  credentials stay in `/parent/profiles`).
- Image/URL avatars — the picker is preset emoji only, though the
  column keeps accepting other strings for parent-set values.
- Profile switching — `/kids` remains reachable through the parent
  gate; this change only removes the header shortcut.

## Decisions

- **New page, not a modal.** `app/kids/[profileId]/settings/page.tsx`
  as a server component matches the app's pattern (server components
  + `<form action>` mutations), needs no `proxy.ts` change (the
  `/kids/<id>/*` rules already cover it), and leaves room for future
  settings. Alternative considered: a client modal on the feed —
  rejected, it adds client weight to the hot feed page for a rare
  action.
- **`assertCanEditKidData` as the write guard.** Same gate as other
  kid-scope writes; `requireParentUnlocked` would lock out the exact
  audience (kids) the feature is for. Alternative: a bespoke cookie
  check — rejected, duplicates an audited helper.
- **Preset list in `lib/kid-avatars.ts`.** Shared import between the
  client picker (render the grid) and the server action (validate) so
  the allow-list has one source. A curated ~30 emoji set covers
  variety without a free-text input.
- **Client picker component + server action via `useActionState`.**
  Selected-emoji state lives in a small `"use client"` component in
  the settings route; the form posts the emoji as a hidden field.
  After save, `revalidatePath` on the profile's pages and the user
  stays put with a saved state — no redirect, so they can pick again.
- **Badge icon: `Gear`.** The corner badge swaps `UserSwitch` for a
  `Gear` (SSR phosphor import) and the kid-session badge becomes the
  same `Link` — one code path for both branches.

## Risks / Trade-offs

- Locked devices can change the avatar without any session → accepted:
  the cookie already grants full kid-scope writes (playlists,
  reactions) under the capability-URL model documented in AGENTS.md.
- Kid session JWT doesn't carry the avatar → header re-renders pick
  up the DB value via `revalidatePath`; no token refresh needed.
- Parents lose the one-tap profile switch from the feed → intended;
  the picker remains through the parent gate/PIN flow.
