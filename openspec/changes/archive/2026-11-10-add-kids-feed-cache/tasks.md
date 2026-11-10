# Tasks

## 1. Cache infrastructure

- [x] 1.1 Add a feed-cache module (e.g. `lib/feed-cache.ts`)
  exporting `invalidateProfileFeed(profileId)` →
  `revalidateTag("feed:<profileId>")` plus the tag builder, so
  every mutation uses one helper. Verify: `npm run typecheck`.
- [x] 1.2 Wrap the shareable feed reads in `unstable_cache` with
  `revalidate: 600` and tags `["feed:<profileId>"]`: the
  whitelist+video(+channel) row query backing `getKidsVideos`,
  `getLikedVideos`, `getPlaylists`, channel/playlist tile reads —
  key must cover profileId + all params (view/sort/dir/type/
  min/max/cursor). Leave `getRecommendedVideos`,
  `canViewProfile`/`assertCanManageProfile`, and all `/parent/*`
  reads uncached. Verify: `npm run typecheck`.
- [x] 1.3 Split `watchProgress` out of the cached row query: a
  separate live query returns `Map<videoId, progress>` for the
  profile; the view layer merges it into cached rows so resume
  position and progress bars are never stale. Verify: feed still
  renders progress bars; typecheck passes.

## 2. Wire readers to the cache

- [x] 2.1 Update `app/kids/[profileId]/page.tsx` and
  `app/kids/[profileId]/_components/*` views to read through the
  cached functions + live progress overlay. Verify: kids feed
  renders all tabs/filters unchanged.
- [x] 2.2 Update `app/kids/[profileId]/watch/[videoId]/page.tsx`
  to build its queue from the cached feed read + live progress.
  Verify: watch page loads, resumes at the last position, and
  auto-advance order matches the feed.

## 3. Invalidation on mutations

- [x] 3.1 Add `invalidateProfileFeed(profileId)` calls to every
  mutation that alters feed contents: `app/actions/pinning.ts`
  (pin/unpin), `app/actions/channels.ts` (approve/un-approve),
  `app/actions/playlists.ts`, `app/actions/safety.ts`,
  `app/actions/profiles.ts` (avatar/name/profile delete),
  `app/api/video-reactions/route.ts`. Verify: grep shows the
  helper called beside each existing `revalidatePath` that
  touches a profile's feed. (safety.ts has no feed-content
  mutations — nothing to call there; refresh.ts + the
  video-errors playback-block route invalidate too since they
  also hide videos.)
- [x] 3.2 Invalidate `feed:<profileId>` in `lib/channel-sync.ts`
  (backfill/poll/syncAll) when pins are inserted. Verify: a sync
  that adds videos makes them appear on the next feed read.

## 4. Client-side latency

- [x] 4.1 Set `staleTimes = { dynamic: 300 }` in
  `next.config.mjs`. Verify: navigating back to a visited feed
  within 5 min issues no RSC fetch (Network tab).
- [x] 4.2 Warm the YouTube IFrame API on kids feed mount (call
  `ensureYouTubeAPI` once) and add `<link rel="preconnect">` for
  `https://www.youtube.com` + `https://i.ytimg.com` in the kids
  layout. Verify: watch page mounts with `window.YT` already
  present.
- [x] 4.3 Add `router.prefetch(href)` on video-card
  `onPointerDown` for watch links. Verify: tapping a card shows a
  shorter wait to first paint (observe in dev or via timing log).

## 5. Verification

- [x] 5.1 Run `npm run typecheck` and `npm run lint` — both clean.
- [x] 5.2 Manual smoke (dev server): unpin a video in the parent
  dashboard, confirm it is gone from the kids feed on the next
  read; confirm a liked video appears in the Liked tab
  immediately; confirm resume position is correct after reload.
  Record findings in the PR body.

## Workflow follow-up

- No user-run commands needed (no schema change; `unstable_cache`
  needs no migration).
- Archive the change after review requirements are satisfied.
