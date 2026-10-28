# Plan: Fix feed-memory writes leaking across ?type= / filter changes

**Status: not implemented**

Feature branch: `feature/feed-type-bug`.

## Goal

On a kids feed, switching the type filter (or any feedQuery param —
sort, dir, min/max, q) must never corrupt the OTHER feed's
sessionStorage snapshot nor seed the NEW feed's entry with data the
new feed never produced. Confirmed today: tapping "Videos" rewrites
the all-type snapshot with `scrollY:0, anchor:null` and writes a
stale `scrollY` under the `?type=videos` key. On paged grids the same
race can store a whole `rows[]` array under the wrong key, and the
mount-restore then renders it verbatim — matching the reported
"filtered feed keeps showing the previous list".

## Root cause

`useFeedSaver` (`lib/feed-memory.ts:293-316`) mounts ONE scroll
listener with `[]` deps for the component's whole lifetime:

- `writeRef.current` is swapped to the latest render's `saveSnapshot`
  on EVERY commit (`feed-memory.ts:295-297`), while `lastY` is
  captured at scroll-EVENT time inside the once-mounted listener
  (`feed-memory.ts:299-308`).
- `saveSnapshot` (`components/kids-video-grid.tsx:74-88`) builds the
  storage key at call time from the current `feedQuery` prop, and
  reads `anchorRef.current` at call time too.

Across an in-place `feedQuery` change (verified: `KidsVideoGrid` is
NOT remounted on `?type=` nav — same DOM elements, same instance),
two confirmed misfires follow:

1. **Pending 400 ms-throttled scroll write lands under the wrong
   key.** A scroll on feed A arms `timer`; if the nav commits before
   it fires, `writeRef.current` is already feed B's closure → the
   write is stored under B's key carrying A's `scrollY` (observed:
   `&type=videos` entry written with `y≈3993` scrolled on the
   all-type feed). If it fires before the commit, it lands under A's
   key with a `scrollY` observed DURING the transition — including
   the nav's scroll-to-0 (`scroll={false}` on the filter links does
   not stop the browser clamping scroll while the incoming tree
   mounts). Observed: `?view=channels&channel=X`'s snapshot went from
   `y=4146, anchor=<videoId>` to `y=0, anchor=null` immediately after
   tapping "Videos" — the saved position for that feed is destroyed.
2. **The unmount flush has the same staleness**
   (`feed-memory.ts:310-314`): `writeRef.current(lastY)` uses `lastY`
   observed after the outgoing feed's DOM was already gone (watch
   page mounted → scroll reset → `lastY=0`), overwriting the real
   saved `scrollY`.

How that produces the reported UI:

- **Paged grids** (`loadMore` — For-You `?view=foryou`, Shorts
  `?view=shorts`): snapshots store full `rows` (kids-video-grid.tsx:86)
  and the mount restore renders them VERBATIM via `patchRows`
  (kids-video-grid.tsx:108-115) — a stale `rows` write under a fresh
  `?type=` key displays the old feed's list on next mount.
- **Non-paged grids** (channel drill-in, liked, playlist): `orderIds`
  is self-healing (`reorderRows` ⊆ fresh rows, kids-video-grid.tsx:119),
  but polluted `scrollY`/`anchorVideoId`/`visible`/`offset` still
  corrupt position+depth restore.
- Verified clean-session behavior: `?type=videos` correctly renders
  0 shorts (in-place reset at kids-video-grid.tsx:157-164 fires and
  server rows are filtered — vids∩shorts = 0 via SSR diff). The
  report's all-type list therefore requires either a polluted
  snapshot under the new key or `snap.rows` on a paged surface —
  both sealed by this fix.

## Fix design

Key the saver's listener to the feed it belongs to — a `feedQuery`
change runs the old listener's cleanup BEFORE `writeRef` is updated,
so no write can outlive its feed or land under the next feed's key.

`lib/feed-memory.ts` — `useFeedSaver(write, key)`:

```ts
useEffect(() => {
  writeRef.current = write;            // unchanged, every render
});
useEffect(() => {
  let lastY = window.scrollY;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const onScroll = () => { /* unchanged: lastY = window.scrollY;
                              arm 400ms write */ };
  window.addEventListener("scroll", onScroll, { passive: true });
  return () => {
    window.removeEventListener("scroll", onScroll);
    if (timer !== null) clearTimeout(timer);  // pending write dies
    // Runs in the DESTRUCTION phase — writeRef still holds THIS
    // feed's saveSnapshot, so the flush lands under THIS feed's key.
    // lastY === 0 is a nav-clamp artifact (or a true top-of-feed
    // position — restoring that is a no-op anyway): don't let it
    // clobber the last real scrollY.
    if (lastY > 0) writeRef.current(lastY);
  };
}, [key]);
```

Why this is the smallest correct fix:

- `feedQuery` prop change → cleanup cancels the armed write before
  `writeRef` swaps → nothing can be written under the new key by the
  old feed's machinery.
- The cleanup flush still preserves "last scroll before unmount"
  (feed→watch, tab switch) and now lands under the OUTGOING key,
  because React runs effect cleanups (destruction) before the
  every-render `writeRef` update (creation) within a commit.
- `lastY > 0` guard kills the confirmed `y=0` clobber — scroll-to-0
  observed during a nav reset can no longer erase the saved anchor
  position (and a genuine top-of-feed exit needs no restore).
- Callers pass `feedQuery` as `key`:
  `useFeedSaver(saveSnapshot, feedQuery)` at
  `components/kids-video-grid.tsx:89` and
  `components/history-view.tsx:62`.

Optional hardening (same PR, tiny): in `saveSnapshot`, skip the write
when `scrollY === 0 && anchorRef.current === null` — a snapshot whose
only information is "top of feed" is a no-op restore anyway.

Out of scope (noticed, deliberately not fixed): the `?type=` nav
scrolls to top despite `scroll={false}` — acceptable for a new feed;
and `fetchNext`'s stale in-flight `loadMore` page (review issue 1 in
`docs/reviews/kids-portal-feed.md`) — separate change.

## Files touched

- `lib/feed-memory.ts` — `useFeedSaver(write, key)`: key the scroll
  effect, cancel pending writes on key change, guard `lastY > 0` on
  the flush.
- `components/kids-video-grid.tsx` — pass `feedQuery` at
  `useFeedSaver(saveSnapshot, feedQuery)` (line ~89).
- `components/history-view.tsx` — same call-site update (line ~62).
- `AGENTS.md` — one line under "Kids feed memory" noting snapshots
  are keyed/lifetime-bound to `feedQuery`.

## Verification

`npm run typecheck && npm run lint`. Manual UI walkthrough on :3100
(tester@example.com / password, PIN 0000 — or set the
`activeProfileId` cookie to the profile UUID):

Reproduce the bug (before the fix):

1. Profile → Channels tab → open a channel with both shorts and
   long-form (devtools → sessionStorage watch `nt:feed:*`).
2. Scroll ~2 screens, tap a card → watch → Back. Order/scroll
   restored; `nt:feed:...:?view=channels&channel=X` holds
   `scrollY>0, anchor=<id>`.
3. Tap "Videos": list filters (no shorts). THEN inspect the all-type
   entry — BUG: `scrollY` is now `0`, `anchor` is null.
4. Throttle network (or scroll while the nav is pending) and re-do:
   BUG: a `...&type=videos` entry appears carrying the all-type
   `scrollY` before the filtered feed was ever scrolled.

After the fix:

5. Repeat 1–4: the all-type entry keeps its real `scrollY`/anchor
   after every filter switch; no `&type=videos` entry exists until
   the filtered feed is actually scrolled/left; both "Videos" and
   "Shorts" show only matching cards.
6. Videos → tap card → watch → Back → scroll/anchor still restored
   (the feature's core path must not regress).
7. Same on `?view=foryou` (paged grid — `rows` snapshots): filter
   switch must never leave a `rows` array under the next feed's key.
8. `?type=videos` → tap a card → back → returns scrolled to the
   tapped card on the FILTERED feed.
