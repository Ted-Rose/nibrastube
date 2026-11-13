# Review: Watch page, player & progress/reaction writes

## Summary

Overall health: good (~8/10). The whitelist contract is enforced in
depth — server-side queue reconstruction with progressive fallbacks,
a 500 ms rogue-video snapback in the player, and
whitelist+`suitableVideo` inner-join gates on both write APIs — and
the ~800-line `watch-experience.tsx` shows real care for lifecycle
edge cases (StrictMode remounts, beacon flushes, nav history). The
main risks are a deadlock when a whitelisted video can't play in the
embed (no `onError` handler), For-You/Shorts queue fidelity dropping
past row 60, and triplicated kid-write auth across the two routes.

## Strengths

- **Whitelist enforced at three independent layers.** The page only
  renders when `currentIndex !== -1` after three progressively wider
  queue rebuilds (`page.tsx:109-153`), so unapproved/unpinned/18+
  videoIds redirect back to the feed with context preserved; the
  player's tick snaps rogue "More videos" embeds back to the approved
  entry within 500 ms (`watch-experience.tsx:402-429`); and both API
  routes inner-join `whitelisted_videos` + `suitableVideo` before
  writing (`watch-progress/route.ts:51-64`,
  `video-reactions/route.ts:48-61`). The 18+ floor is therefore inert
  on every surface, per the contract.
- **Queue reconstruction is faithful and degrades safely.** Each view
  maps to the same query the feed used — playlists keep
  `playlistItems` order, history is dedup'd most-recent-first
  (`page.tsx:54-68`), `videos`/`channels` reuse `getKidsVideos` with
  the same q/channel/sort/type/len filters, For-You/Shorts reuse
  `getRecommendedVideos`. Misses first widen filters
  (`page.tsx:111-129`), then degrade to the all-approved list for
  queues that can vanish (`page.tsx:131-144`) — a stale link never
  bounces when it doesn't have to.
- **Beacon ordering done right.** `sentAt` is clamped to server time
  (`watch-progress/route.ts:66-68`) and both upserts carry
  `setWhere: lt(existing, sentAt)` so a periodic fetch can't clobber
  a later pagehide beacon (`route.ts:96,119`). `z.iso.date()` keeps
  impossible dates from reaching Postgres (`route.ts:18-20`).
- **Flush coverage is thorough.** Pause event, ENDED, 10 s playing
  tick (for swipe-kills), `pagehide` + `visibilitychange` beacons,
  unmount cleanup, and a pre-`loadVideoById` flush in `goTo` so the
  outgoing video's position is never lost
  (`watch-experience.tsx:203-230,370-388,452-486`). `completed` ≥95%
  is computed from the live sample; ENDED forces position=duration
  first (`:382-385`).
- **Player lifecycle is defensively correct.** The ref is published
  only in `onReady` (`:353-369` — the comment documents the
  "getVideoData is not a function" bug this fixed), a consumed mount
  node is replaced (`:322-329`), a `goTo` during init is caught up in
  `onReady` (`:360-368`), and cleanup destroys even a never-ready
  player (`:480-485`).
- **Nice small pieces.** `pickNextIndex`/`classifySwipe` are pure and
  testable (`lib/autoplay.ts`, `lib/gestures.ts`); `loadedVideoId`
  has a `getVideoUrl` fallback for widget builds lacking
  `getVideoData` (`lib/yt-player.ts:56-67`); the swipe-back nav stack
  stores ids, not indices (`:101-105`); the dialog defaults focus to
  the safe choice (`swipe-confirm-dialog.tsx:60-68`); `loading.tsx`
  continues the `video-<id>` view-transition morph with a real
  thumbnail.

## Issues

1. **Med — unplayable video deadlocks autoplay AND swipe nav.**
   `advance()`/`goBack()` set `advancingRef = true`
   (`watch-experience.tsx:276,288`) and only a `PLAYING` state change
   releases it (`:371-373`). No `onError` event is registered on the
   player (`:352-389`), so a whitelisted video that can't play in the
   embed (deleted/private/embedding-disabled on YouTube — the local
   `videos` row is a cache) never emits PLAYING: autoplay stalls,
   `handleSwipe` early-returns (`:515`), and the confirm dialog can
   open but its nav calls are equally blocked (`:560-561` → `advance`
   → `:275` guard). The kid's only escape is the Back link. Fix:
   register `events.onError` → push a skip status and retry `advance`
   (and/or a ~15 s watchdog releasing `advancingRef` if no PLAYING
   follows a `goTo`); skipping is safe because `pickNextIndex` never
   re-picks status-2 entries until the wrap fallback.
2. **Med — For-You/Shorts watch queue silently caps at 60 rows.**
   `getRecommendedVideos` defaults `limit = 60`
   (`lib/kids-feed.ts:615`) but both feeds page infinitely via
   `loadMoreForYou`/`loadMoreShorts` (`app/actions/kids-feed.ts:23-66`
   — same `offset` param exists). A card tapped at depth >60 misses
   both the filtered query and the retry (`page.tsx:86-92,118-121`),
   then the second fallback rebuilds the *all-videos* queue
   (`page.tsx:138-143`) — the video plays (whitelist intact) but the
   kid is dumped into a differently ordered, mixed-type queue; a
   tapped deep Short autoplay-advances into long-form. Fix: rebuild
   the foryou/shorts queue with a larger limit (the ranking is
   day-stable via the `md5(id||current_date)` seed, so deeper slices
   are deterministic), or carry the card's offset in the watch href
   and page the queue query to it.
3. **Med — kid-write auth triplicated with divergent semantics.**
   `watch-progress/route.ts:34-47` and `video-reactions/route.ts:30-43`
   copy the `isKidSession → activeProfileId → assertCanManageProfile`
   chain verbatim, while `lib/profiles.ts:49-68`
   (`assertCanEditKidData`, used by `app/actions/playlists.ts`)
   re-implements it with different failure modes (throws; additionally
   checks profile existence and `redirect("/kids")`s — a `redirect()`
   from a route handler yields a 307 HTML response to a beacon, not a
   JSON 403). Today the divergence is harmless — the whitelist
   inner-join already returns 403 for a deleted profile's stale kid
   JWT — but three copies of a security gate will drift. (Also flagged
   as architecture.md issue 3.) Fix: extract
   `kidWriteGate(profileId): Promise<NextResponse | null>` (null =
   allowed) in `lib/profiles.ts` or a new `lib/api-auth.ts`, returning
   the `{ok:false}` response to send; use it in both routes.
4. **Low — revisited videos lose their live resume position.**
   `goTo` loads the target with `playlist[next].startSeconds`
   (`watch-experience.tsx:261-266`) — the page-load snapshot — unless
   the video is in `completedRef`. A kid who scrubs to 5:00, swipes
   next, then swipes back restarts near the stale snapshot even though
   the true position was flushed in `goTo` (`:238`). Fix: keep a
   `Map<string, number>` of live positions — write `latestRef`'s
   sample into it on every `goTo`, and prefer it over
   `playlist[next].startSeconds` when loading.
5. **Low — mid-session unpin doesn't interrupt playback.**
   `PusherListener` is mounted only on the feed page
   (`app/kids/[profileId]/page.tsx:95`), so the watch page's playlist
   prop can never change mid-session — the effect's whole
   shrink/reorder-merge machinery (`watch-experience.tsx:156-199`) is
   unreachable, and a parent unpinning the currently-playing video
   leaves it playing to the end (progress writes then 403 silently).
   Decide: mount the listener on the watch route (the page +
   merge code already handle the shrink → server redirect out), or
   document as an accepted revocation delay.
6. **Low — `day` client field can mint arbitrary history dates; the
   `en-CA` trick is brittle.** `z.iso.date()` validates shape only
   (`watch-progress/route.ts:20,103`); a forged `day` writes
   `watch_history` rows for any date (kid-own scope — the comment
   accepts this). Separately, `toLocaleDateString("en-CA")`
   (`watch-experience.tsx:215`) relies on ICU returning ISO — a
   browser that doesn't makes every flush 400 and silently drops
   progress. Fix: clamp `|day − server date| ≤ 2` server-side (fall
   back to `sentAt`), and build `day` from
   `getFullYear()/getMonth()/getDate()` instead of the locale hack.
7. **Low — `completed` is last-write-wins, so re-watching un-watches.**
   A completed video re-played to 20% and paused overwrites
   `completed=true` with `false` on the newer `sentAt`
   (`watch-progress/route.ts:84-96`) — it drops out of the "watched"
   tier on the feed until re-finished. Arguably intended (correct
   resume point, "continue watching" honesty) — flagging for a
   decision: if "watched" should be sticky for parents, set
   `completed: sql`${watchProgress.completed} or excluded.completed``.
8. **Low — rogue-video snapback is reactive, with a ≤500 ms exposure
   window.** A tapped suggestion plays unapproved audio/video until
   the next tick catches `loadedId ∉ approvedIds`
   (`watch-experience.tsx:417-429`); `rel=0`/`iv_load_policy=3`/
   `modestbranding` (`:336-342`) reduce but can't remove the
   pause/end-screen overlays (YouTube exposes no param). Consider a
   shorter snapback interval, or transparent blocker zones over known
   suggestion regions — at minimum, document the window as the
   accepted mitigation.
9. **Low — `watchedAt`/`lastSeenAt` store the clamped client clock.**
   `sentAt` orders both upserts (`route.ts:85,96`); a device with a
   behind-clock always loses to other devices and skews
   "Continue watching" ordering (`lib/kids-feed.ts:379`). Single
   kid-locked devices are unaffected. If cross-device ordering ever
   matters, add a separate `client_sent_at` for the guard and keep
   `watched_at` on server `now()`.
10. **Low — a failed periodic flush still consumes the send budget.**
    `flush()` sets `lastSentRef`/`lastSentPositionRef` before the
    fetch resolves, and `.catch(() => {})` swallows failure
    (`watch-experience.tsx:206-207,228`) — a transient network error
    suppresses the next flush until the playhead moves >2 s further.
    Fix: update the sent markers only on success for the fetch path
    (beacon path can stay fire-and-forget).
11. **Low — latent: any future `router.refresh()` on this route
    recreates the iframe.** The giant effect tears down and rebuilds
    the player on `playlist` prop identity change
    (`watch-experience.tsx:156-199,473-496`). Nothing mounts
    `PusherListener`/calls `router.refresh()` on the watch route
    today, but the kid's own reaction tap already triggers
    `video-reacted` on `profile-<id>` + `revalidatePath`
    (`video-reactions/route.ts:82-87`) — if a listener is ever added
    to a shared layout, every like tap (and every pin event) would
    visibly reload the iframe. Guard by stabilizing the playlist prop
    via a content signature (id+status+reaction sequence) before
    handing it to the effect.
12. **Low — YouTube API load failure = permanent black box.**
    If `iframe_api` fails to load (offline, CSP, blocked domain),
    `ensureYouTubeAPI`'s callback never fires (`lib/yt-player.ts:73-92`)
    and the page shows a dead player area forever. Add a load timeout
    → error state ("can't reach YouTube") with a retry/back affordance.
13. **Low — full whitelist serialized as the queue.** `getKidsVideos`
    has no limit and `playlist` is built from every row
    (`page.tsx:100-108,155-172`) — a ~2k-video profile ships ~300 KB
    of props per watch-page load, and the For-You/Shorts equivalent is
    capped at 60 for the same reason (see issue 2). Consider a bounded
    queue window around `currentIndex` for the unbounded views.
14. **Low — `watch_progress` + `watch_history` writes aren't
    transactional.** Two sequential awaits (`route.ts:78-120`): a
    failure between them leaves progress without a history row (or a
    second failure loses the history write). Wrap both in
    `db.transaction`.
15. **Low — `SwipeConfirmDialog` has no Escape/outside-tap cancel.**
    Only the two buttons dismiss it (`swipe-confirm-dialog.tsx:60-77`);
    `autoFocus` gives a keyboard path to "Keep watching", and Esc in
    native fullscreen exits fullscreen instead, so impact is small —
    an Escape/`pointerdown`-on-backdrop cancel is a cheap a11y win.
16. **Low — `react()` targets the player-loaded video, which lags the
    title by ≤500 ms.** `latestRef.current.videoId` only updates on
    the tick (`watch-experience.tsx:438-439`), so a reaction tapped in
    the window after `advance()` writes to the *outgoing* video while
    the header already shows the new title (`:616-619` documents the
    intent — write what plays). Cheap improvement: set
    `latestRef.current.videoId`/`setActiveVideoId` to the just-loaded
    id inside `goTo` (`:261-266`) and let the tick confirm.
17. **Info — `formatDuration` misformats negative input.**
    `seconds = -5` yields `"-0:-5"` (`lib/format.ts:5-14`); only
    reachable via corrupted `duration_seconds`. A `total < 0` → null
    guard closes it.

## Refactor suggestions

1. **Extract a shared `useYouTubePlayer` hook.** Three surfaces
   (`watch-experience.tsx`, `song-player-overlay.tsx`,
   `video-preview-overlay.tsx`) re-implement
   `ensureYouTubeAPI → mount-node → onReady ref-publish → destroy`;
   `watch-experience.tsx` alone is ~340 effect lines over ~15 refs.
   A hook returning `{ playerRef, mountEl }` plus separate
   `useProgressFlush(profileId, latestRef)` and `useNavStack` hooks
   would cut this file in half and fix the lifecycle in one place.
2. **Extract `kidWriteGate(profileId)`** (issue 3) — one
   implementation returning `NextResponse | null` for the two API
   routes; keep `assertCanEditKidData` for server actions (it throws),
   and have both delegate to a shared policy core.
3. **Add the `onError` → skip-forward path** (issue 1) — pairs
   naturally with a "dead video" skip set so `pickNextIndex`/`goBack`
   never reselect the failed entry in-session.
4. **Fix For-You/Shorts queue depth** (issue 2) — simplest form is a
   higher `limit` on the queue rebuild; the URL-carried-offset variant
   additionally preserves exact position.
5. **Keep a live-position map for revisit resume** (issue 4) — small
   `Map` write in `goTo`, read at `loadVideoById` time.
6. **Wrap the two upserts in `db.transaction`** (issue 14) and clamp
   `day` server-side (issue 6) in the same pass on
   `watch-progress/route.ts`.
7. **Stabilize the playlist prop before the mega-effect** (issue 11) —
   `useMemo` on a content signature makes the playlist-identity
   teardown fire only on real changes, future-proofing listener
   mounts.
8. **Decide sticky-vs-reset `completed`** (issue 7) — if sticky is
   chosen, one `sql` fragment in the upsert; either way, encode the
   choice in the AGENTS.md contract line "completed ≥95%".
