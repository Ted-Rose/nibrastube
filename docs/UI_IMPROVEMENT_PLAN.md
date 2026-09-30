# UI Improvement Plan — Mobile & Narrow Viewports

Audit performed by running the app locally and screenshotting every page in
headless Chrome (CDP) at 320, 390, and 768 px, plus measuring
`document.documentElement.scrollWidth` vs viewport width to detect horizontal
overflow empirically.

## Measured results

| Page                              | 390 px          | 320 px          | Notes |
|-----------------------------------|-----------------|-----------------|-------|
| `/` landing                       | clipped (421 px content, hidden by `overflow-x-hidden`) | clipped | "Get Started" unreachable |
| `/login`, `/signup`               | OK              | OK              |       |
| `/kids` (profile picker)          | OK              | OK              |       |
| `/kids/[id]` portal               | **overflow → 587 px** | **overflow → 587 px** | sort select + header |
| `/kids/[id]?view=channels`        | OK (sort hidden)| —               | proves sort row is the culprit |
| `/kids/[id]/watch/[videoId]`      | **overflow → 532 px** | —          | header title row |
| `/parent/dashboard`               | OK              | OK              | but search is buried (see below) |
| `/parent/profiles`                | OK              | **overflow → 331 px** | header buttons |
| `/invite/[token]`                 | OK              | OK              |       |

---

## Confirmed issues by page

### 1. Kids portal — `app/kids/[profileId]/page.tsx` (worst offender)

**1a. Tab row overflows horizontally.**
The row `flex items-center gap-4 mb-8` contains two pills
(`px-6 py-3 text-xl font-black` ≈ 150 px each) plus `KidsSortSelect`
(214 px) pinned by `ml-auto`. Total ≈ 560 px — the page scrolls sideways.
The sort select is unreachable without horizontal scrolling.

**1b. Sticky header can't shrink on small phones.**
House icon (~48 px) + `flex-1` search input (intrinsic `<input>` min-width
≈ 170 px) + avatar link (~60–170 px) exceed 320 px; the avatar is pushed
off-screen at 320 px and the search placeholder is clipped at 390 px.

**1c. Fixed "Parent Settings" gate (`bottom-6 right-6`) overlaps the video
grid** — seen covering the last card at 768 px. No safe-area inset handling
for the PWA/APK either.

**1d. Cards are single-column below `sm`** — fine for toddlers, but at
390 px two smaller columns would fit and reduce scrolling (optional).

### 2. Watch page — `components/watch-experience.tsx`

**2a. Header overflows (532 px).** `flex-1 text-center px-4` wrapping the
`<h1 className="truncate max-w-2xl">` has no `min-w-0`, so the title can't
shrink; "Back to Videos" (with text label) + House button are fixed width.
Because `FullscreenerPlayer`'s container is `w-full`, the player also
renders 532 px wide — the video itself hangs off-screen.

**2b. Vertical space.** Header (~76 px) + footer (~150 px, `p-8`) leave the
`aspect-video` player little room on a phone held portrait; the
auto-fullscreen/pseudo-fullscreen mitigates this, but the non-fullscreen
fallback is cramped.

### 3. Parent dashboard — `app/parent/dashboard/page.tsx`

**3a. Mobile ordering inverts the information hierarchy.** DOM order is:
Select Kid → Approved Videos (max-h-400 scroll list) → Approved Channels →
*then* the search card. On a phone the parent scrolls past two entire lists
to reach the page's primary action (search YouTube).

**3b. Touch targets too small.** The `base-mira` Button default is `h-7`
(28 px) — below the 44 px iOS / 48 px Android guideline. Applies to Manage
Kids / Kids Corner / Logout, tab toggles, and the tiny `h-8 w-8` delete
icons.

**3c. Hover-only destructive actions are invisible on touch.**
`opacity-0 group-hover:opacity-100` on the unpin/unapprove Trash buttons
means they never appear on a phone — the feature is undiscoverable.

**3d. No shared parent nav.** Dashboard and profiles each hand-roll a
header with a different button arrangement (`Logout` as a bare ghost
button, etc.).

### 4. Manage Kids — `app/parent/profiles/page.tsx`

**4a. Header overflows at 320 px** (`sw=331`): `flex justify-between` with
no wrap — "Back to Dashboard" + "Logout" squeeze the `text-4xl` title.

**4b. Share-access form is cramped**: `h-9 text-xs` input + `h-9 px-3`
Invite button; pending/shared chips use `text-[10px]` with
`max-w-[150px]` truncation.

### 5. Landing — `app/page.tsx`

**5a. Nav overflows but is *clipped*, not scrollable** (`overflow-x-hidden`
on the root): "Get Started" (`px-8 py-6 text-lg`) renders to x=421 at
390 px — partially cut off. At 320 px roughly half the button is gone.

**5b. Hero headline `text-6xl`** is okay at 390 but tight at 320;
`py-32`/`pt-16` sections create long scrolls.

### 6. Global

**6a. No safe-area support.** `viewport` lacks `viewportFit: "cover"` and
no `env(safe-area-inset-*)` padding — the fixed gate button and watch
header sit under the iPhone home indicator/notch when installed as PWA or
wrapped in Capacitor.

**6b. Two unrelated visual languages.** Parent pages use small `base-mira`
defaults (h-7, text-xs, radius-md), kids pages use giant rounded-3xl/
font-black styling. Not a defect per se, but shared components (Card,
Button) get heavy per-use overrides — a `size="touch"` variant would help.

**6c. Form buttons have no pending state** — login/signup/pin buttons give
no feedback while the server action runs (kids tap repeatedly).

---

## Proposed redesign — by priority

### P0 — Stop the bleeding (pure CSS/class fixes, no new components)

1. **Kids portal tab row** (`app/kids/[profileId]/page.tsx`):
   - Make the tabs a full-width segmented control that never overflows:
     wrap the two pills in `grid grid-cols-2` inside a
     `bg-white rounded-full p-1` container (modern segmented style), and
     drop `text-xl px-6` → `text-base sm:text-xl`, `px-4 sm:px-6`.
   - Move `KidsSortSelect` out of the tab row: full-width second row on
     mobile (`w-full sm:w-auto`), or replace with a compact icon button
     (`ArrowsDownUp`) opening a small menu — native `<select>` already
     renders a system picker on mobile, so a smaller pill
     (`h-10 text-sm pr-10`) is enough.
   - Alternative worth considering: a **bottom tab bar** on mobile
     (`fixed bottom-0`, safe-area padded) with Videos | Channels — more
     app-like for the PWA/APK, top header keeps only search + avatar.

2. **Kids portal header**: two rows below `sm` —
   row 1: House icon + NibrasTube wordmark + profile avatar;
   row 2: full-width search (`w-full`). At `sm+` keep the current
   single-row layout. Add `min-w-0` to the search wrapper.

3. **Watch page header** (`components/watch-experience.tsx`):
   - Add `min-w-0` to the title wrapper (`flex-1 min-w-0 text-center px-2`).
   - `max-w-2xl` → `max-w-full` (the clamp belongs to the flex parent).
   - Shrink the back button on mobile: hide "Back to Videos" text below
     `sm` (icon-only), reduce `px-6` → `px-3 sm:px-6`.
   - Shrink footer padding `p-8` → `p-4 sm:p-8` and avatar `w-16` →
     `w-12 sm:w-16` to reclaim vertical space.

4. **Landing nav**: `px-6` → `px-4 sm:px-6`, `py-8` → `py-4 sm:py-8`;
   "Get Started" → `px-5 py-3 text-base sm:px-8 sm:py-6 sm:text-lg`;
   hide the "Log in" ghost button below `sm` (reachable via the signup
   page) or collapse both into a compact icon menu.

5. **Profiles header**: add `flex-wrap` and let buttons drop below the
   title (`flex flex-wrap items-center justify-between gap-3`); bump the
   invite input/button to `h-10 text-sm`.

6. **Hover-only actions**: change `opacity-0 group-hover:opacity-100` to
   `opacity-100 md:opacity-0 md:group-hover:opacity-100` (dashboard unpin /
   unapprove buttons) — always visible on touch, still tidy on desktop.

7. **Safe areas**: `export const viewport` in `app/layout.tsx` → add
   `viewportFit: "cover"`; pad fixed/edge elements with
   `pb-[env(safe-area-inset-bottom)]` / `pr-[env(safe-area-inset-right)]`
   on the gate button wrapper and watch header/footer.

### P1 — Structural improvements (new components)

8. **Shared parent layout**: create `app/parent/layout.tsx` with a
   `ParentNav` server component — logo, links (Dashboard, Manage Kids),
   and a user menu (avatar dropdown via `@base-ui/react` Menu: Profile,
   Logout). Removes the duplicated per-page headers; on mobile the nav
   collapses to logo + hamburger/menu icon. Eliminates issues 3d and 4a
   at once.

9. **Dashboard mobile ordering**: render the search card first in DOM and
   use `lg:order-*` / `lg:col-span-*` to place the sidebar visually second
   on mobile — or convert the sidebar into collapsible `<details>`
   sections ("Approved videos (4)", "Approved channels (0)") so the lists
   don't push search down.

10. **Touch-sized controls**: add a `touch` size to the Button cva
    (`h-11 px-4 text-base`) and use it for parent-facing actions, or at
    minimum bump existing buttons to `size="lg"` + `h-11`. Kids' UI is
    already oversized; parent UI needs it.

11. **Pending states**: wrap submit buttons in a small `SubmitButton`
    client component using `useFormStatus()` → `disabled` + `SpinnerGap`
    while the action runs (login, signup, pin, approve, invite, create
    profile).

### P2 — Polish

12. Landing hero `text-6xl` → `text-5xl sm:text-6xl`, section padding
    `py-32` → `py-16 sm:py-32`; consider `border-8` → `border-4` on the
    hero card on mobile.
13. Kids video grid `grid-cols-1 sm:grid-cols-2` → optionally
    `grid-cols-2` already at ~400 px with reduced padding, or keep 1-col
    (deliberate toddler-friendly choice — decide with real device testing).
14. Replace `KidsFooterGate`'s floating button with a subtle inline
    footer row ("Parent Settings" link at the bottom of the page) so it
    never overlaps grid content.
15. Normalize `html, body { overflow-x: clip }` guard in globals.css as a
    last line of defense, but fix layouts properly rather than relying on
    it (the landing page shows how clipping *hides* broken UI instead of
    revealing it).
16. Dark mode: `ThemeProvider` + `.dark` tokens exist but nothing toggles
    them and kids pages hardcode `bg-slate-50`/`text-slate-900` — either
    wire up a toggle in the parent nav or remove the dead theming to avoid
    a half-dark UI later.

---

## Verification

After each change, re-run the overflow audit (headless Chrome CDP or
Playwright) at 320/390/768 px asserting
`document.documentElement.scrollWidth <= innerWidth` on:

- `/`, `/login`, `/signup`
- `/kids`, `/kids/[profileId]` (+ `?view=channels`, `?view=channels&channel=X`)
- `/kids/[profileId]/watch/[videoId]`
- `/parent/dashboard`, `/parent/profiles`

…plus manual tap-through on a real phone or device emulation:
parent PIN gate, sort select, search submit, pin/unpin, watch →
auto-advance → back.
