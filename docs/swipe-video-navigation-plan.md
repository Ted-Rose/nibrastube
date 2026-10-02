# Plan: Swipe-to-Switch Video Navigation

Feature branch prefix: `feature/` (e.g. `feature/swipe-video-navigation`).

## Goal

Let a kid switch videos on the watch page with touch gestures — **swipe
right** or **swipe up** (bottom→top) for the *next* video, **swipe left**
or **swipe down** (top→bottom) for the *previous* video. The capability is
**opt-in per profile**: a parent toggles it on `/parent/profiles`, default
**off**.

Until the kid opts out, every swipe shows a confirmation popup — "Switch
to another video?" with a **"Don't ask me again"** checkbox. Once checked
and confirmed, swipes switch immediately.

## Facts established by codebase investigation

- `WatchExperience` (`components/watch-experience.tsx`) already swaps
  videos **in the same player** via `playerRef.current.loadVideoById` —
  no navigation, fullscreen preserved, URL updated with
  `history.replaceState`. Swipe "next" should reuse this machinery, not
  route to a new page.
- The `advance()` function is currently scoped inside the main
  `useEffect` and always calls `pickNextIndex` (`lib/autoplay.ts`):
  next *unwatched* video, then *started*, then plain sequential wrap.
- The `playlist` prop mirrors the grid the kid came from (channel filter,
  search, sort) and is already fully whitelisted — any index is safe to
  load.
- The YouTube iframe is **cross-origin**: touch events starting inside
  the player never reach our document. Gestures can only be captured on
  page chrome (header/footer/padding) and on transparent overlay zones.
  Full-surface capture is impossible without blocking YouTube's own
  controls — see "Gesture capture zones" below.
- In **native fullscreen** only descendants of `document.fullscreenElement`
  render. `FullscreenPlayer` requests fullscreen on its wrapper div, so
  both the confirm dialog and the edge swipe zones **must be rendered as
  children of `<FullscreenPlayer>`**, not as a page-level portal/overlay.
  (The existing "exit fullscreen" X button works this way already.)
- React `onTouch*` handlers are passive on move — use CSS
  `touch-action: none` on the swipe zones so scroll/pull-to-refresh
  doesn't steal the gesture.
- `components/ui/` has only button/card/input/label — no dialog,
  checkbox, or switch primitives. Build the modal from `Card` + `Button`
  like `ParentalGate`, and use a plain `<input type="checkbox">` with
  `Label`. For the parent-side toggle, a small client component wrapping
  a server action (see below).
- localStorage precedent exists: `daily-sync-ping.tsx` stores a per-day
  flag. The "don't ask again" opt-out follows the same pattern, keyed by
  profile.
- Schema precedent for a profile flag: `profiles` is a small table; a
  `boolean ... default(false).notNull()` column + `npm run db:generate`
  is the established flow.

## Data model — one schema change

`lib/db/schema.ts`, `profiles` table:

```ts
swipeEnabled: boolean("swipe_enabled").default(false).notNull(),
```

Then `npm run db:generate` (commit the generated `drizzle/` files) and
`npm run db:migrate`.

## Files to create / modify

### 1. `app/actions/profiles.ts` (modify)

New server action, following the file's existing conventions:

```ts
const swipeSchema = z.object({
  profileId: z.string().uuid(),
  enabled: z.boolean(),
});

export async function setSwipeEnabled(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) return;
  const parsed = swipeSchema.safeParse({
    profileId: formData.get("profileId"),
    enabled: formData.get("enabled") === "true",
  });
  if (!parsed.success) return;
  // Owners AND shared-access editors may toggle — use
  // assertCanManageProfile (lib/profiles.ts), not a parentId-only check.
  await assertCanManageProfile(session, parsed.data.profileId);
  await db
    .update(profiles)
    .set({ swipeEnabled: parsed.data.enabled })
    .where(eq(profiles.id, parsed.data.profileId));
  revalidatePath("/parent/profiles");
}
```

### 2. `components/profile-swipe-toggle.tsx` (new, client)

A switch-style toggle for the profile card on `/parent/profiles` (that
page is a Server Component, so the interactive bit must be a client
component). Props: `{ profileId: string; enabled: boolean }`.

- Render a `<form action={...}>`-free approach: a `Button` styled as a
  switch/track that calls `setSwipeEnabled` inside `startTransition`
  (server actions are callable from client components when imported),
  plus `router.refresh()` or rely on `revalidatePath`.
- Label copy: **"Swipe to change videos"** with a short helper line, e.g.
  "Kid can swipe right/up for the next video, left/down to go back."
- Disabled/pending state while the transition runs (`useTransition`).

### 3. `app/parent/profiles/page.tsx` (modify, small)

Inside each profile `Card`, add a row (suggest above the "Share Access"
block):

```tsx
<SwipeToggle profileId={profile.id} enabled={profile.swipeEnabled} />
```

### 4. `app/kids/[profileId]/watch/[videoId]/page.tsx` (modify, one line)

The page already fetches `profile` — pass the flag through:

```tsx
<WatchExperience ... swipeEnabled={profile.swipeEnabled} />
```

### 5. `components/watch-experience.tsx` (modify — the bulk of the work)

New prop: `swipeEnabled: boolean`.

#### a) Refactor `advance()` into a parameterized `goTo(nextIndex)`

Today `advance()` (lines ~162-205) does: flush → update outgoing status →
`pickNextIndex` → set index → `loadVideoById` → `replaceState`. Extract it
so the index-picking step is injectable:

```ts
const goTo = (next: number) => {
  // existing flush + status bookkeeping, then:
  navStackRef.current.push(indexRef.current); // NEW: history for "back"
  indexRef.current = next;
  setIndex(next);
  playerRef.current?.loadVideoById({ ...same as today });
  window.history.replaceState(null, "", `/kids/${profileId}/watch/...`);
};
const advance = () => {
  if (advancingRef.current) return;
  advancingRef.current = true;
  goTo(pickNextIndex(playlist.length, indexRef.current, statusAt));
};
```

#### b) `goBack()` — previous video

"Previous" should mean **the video the kid just came from**, not blindly
index−1 — more intuitive, and autoplay-advanced videos are also
back-reachable. Keep `navStackRef = useRef<number[]>([])`; every `goTo`
pushes the outgoing index.

```ts
const goBack = () => {
  if (advancingRef.current) return;
  advancingRef.current = true;
  flush();
  const prev =
    navStackRef.current.pop() ??                    // just-watched video
    (indexRef.current - 1 + playlist.length) % playlist.length; // fallback
  // skip stack entries pointing past a shrunk playlist / same video
  ...same load + replaceState as goTo...
};
```

Also skip stack entries whose index is out of bounds after a mid-session
playlist shrink (Pusher refresh) — pop until valid or fall back.

> Open question to resolve during implementation (pick one, keep it
> simple): swipe-next uses `pickNextIndex` (skips watched, consistent
> with autoplay — recommended) vs. strict `index+1`. Either way `goBack`
> uses the history stack.

#### c) Gesture detection

Single-touch swipe classification, implemented once in a small helper
(`lib/gestures.ts` or inline — a pure function is easier to eyeball):

```ts
// returns "next" | "prev" | null
// dx > TH → next; dx < -TH → prev; dy < -TH (up) → next; dy > TH → prev
// TH ≈ 60px; require |axis| > 1.3× the other axis; ignore multi-touch
```

Wire with `onTouchStart/onTouchMove/onTouchEnd` on the zones below. Track
`startX/startY/time` in refs; ignore when a second touch joins, when the
confirm dialog is open, or when `swipeEnabled` is false.

#### d) Gesture capture zones (the iframe constraint)

Touches on the player iframe never reach us, so capture on:

1. **Page chrome** — attach the handlers to the outermost watch-page div
   (header, paddings, footer are all swipeable).
2. **Edge strips over the player** — two absolutely positioned,
   transparent, `touch-action: none` divs inside `<FullscreenPlayer>`,
   ~28px wide, full height, left and right edges. They catch swipes that
   start at the screen edge even over the video, while leaving the center
   and the YouTube control bar (bottom) reachable. Only render them when
   `swipeEnabled` so the feature is truly zero-cost when off.

Known limitations to accept (document in code comments):

- A swipe starting on the *center* of the video can't be detected —
  unavoidable without blocking YouTube controls.
- On iOS Safari (non-PWA), very-edge swipes compete with the browser
  back gesture; in the installed PWA / native fullscreen this isn't an
  issue.

#### e) Confirm dialog state + flow

```ts
const [pendingSwipe, setPendingSwipe] = useState<"next" | "prev" | null>(null);
```

On a classified swipe:

- `swipeEnabled` false → ignore entirely.
- `localStorage["nibrastube-swipe-no-confirm:" + profileId] === "1"`
  → execute `advance()`/`goBack()` immediately.
- Else → `setPendingSwipe(dir)`, and `pauseVideo()` (add `pauseVideo()`
  to the `YTPlayer` interface — it's part of the IFrame API) so the
  video doesn't keep playing under the modal.

Dialog confirm → run the pending direction; if the checkbox was checked,
`localStorage.setItem(key, "1")`. Cancel → `setPendingSwipe(null)` and
`playVideo()`.

> Alternative considered: persist the opt-out in the DB (profile column
> written via an `activeProfileId`-authorized action like
> `/api/watch-progress`). localStorage chosen instead — simpler, matches
> `daily-sync-ping` precedent, and per-device is arguably correct for a
> kid's own preference. Revisit only if parents ask for cross-device sync.

### 6. `components/swipe-confirm-dialog.tsx` (new, client)

Rendered **inside `<FullscreenPlayer>`** (critical for native
fullscreen) as an `absolute inset-0 z-50` overlay when `pendingSwipe` is
set. Kids-UI style: `rounded-[32px]` card, `font-black`, big buttons,
matching `ParentalGate`'s look.

Contents:

- Title: "Switch video?" — optionally show the target video's title
  (pass `playlist[targetIndex].title` — the component knows the pending
  direction and can compute the same index `advance`/`goBack` would).
- Checkbox row: `<input type="checkbox" id="dont-ask">` + `<Label>`
  "Don't ask me again".
- Two big buttons: **"Keep watching"** (primary-ish, default focus —
  safest for accidental swipes) and **"Yes, switch"**.

### 7. `YTPlayer` interface (`watch-experience.tsx`, top)

Add `pauseVideo(): void` and `playVideo(): void` to the existing
interface — both are standard IFrame API methods.

## UX rules (decisions)

| Case | Behavior |
|---|---|
| `swipeEnabled` off (default) | No zones, no handlers — gestures do nothing |
| Swipe right / swipe up | Next video (`pickNextIndex` — same pick autoplay would make) |
| Swipe left / swipe down | Previous video (navigation history stack, fallback index−1) |
| First swipes | Confirm dialog each time until "Don't ask me again" is checked+confirmed |
| Playlist length ≤ 1 | Swipe is a no-op |
| Swipe while dialog open | Ignored (state machine: one pending swipe max) |
| Mid-swipe playlist refresh | Existing clamp/status logic already handles shrink/reorder |
| Desktop (no touch) | Feature is touch-only; mouse-drag swipe is out of scope |
| Resume position | Reuses `loadVideoById` + `startSeconds` — a revisited video resumes where it left off unless completed this session (`completedRef`) |

## Out of scope / future

- Visible swipe animation (slide-over preview of the next video). v1 is a
  simple instantaneous switch — the video titles in the header already
  change, giving feedback.
- Own transport controls (`controls: 0`) to enable full-surface swipe
  capture — big build, revisit only if edge zones test poorly.
- Mouse/trackpad swipe support.

## Verification

1. `npm run typecheck` and `npm run lint` must pass.
2. `npm run db:generate` + `npm run db:migrate`; confirm the `swipe_enabled`
   column exists and defaults to false for existing profiles.
3. `npm run dev`, then manual (ideally a real touch device or Chrome
   DevTools device emulation):
   - `/parent/profiles` → toggle appears on each kid card, persists on
     reload, shared-access parent can toggle it too.
   - Swipe off: gestures on the watch page do nothing.
   - Swipe on: swipe right on the page header/footer → confirm dialog,
     video pauses; "Keep watching" resumes same video; "Yes, switch"
     advances and URL updates; checkbox checked → subsequent swipes skip
     the dialog.
   - Swipe left/down returns to the just-watched video and resumes its
     position.
   - Repeat in fullscreen (the auto-requested native fullscreen AND the
     iOS pseudo-fullscreen path) — dialog and edge zones must still work.
   - Edge zones: swipe starting on the left/right edge of the player
     triggers; YouTube play/pause tap in the center still works.
   - Incognito/`activeProfileId` mismatch still redirects — no auth
     surface changes expected, but smoke-test it.
