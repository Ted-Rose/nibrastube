# Review: Kids feed queries & portal UI

## Summary

This unit is in good shape: the whitelist + `suitableVideo` 18+ floor
and the `type`/`?min=`/`?max=` filters are applied uniformly across
every video-returning query, the For-You ranking is carefully thought
out with a stable (day-seeded) ordering that makes offset paging safe,
and the client components show unusually careful edge-case handling
(dedup, reset-on-refresh, pending-search subscriptions, transform-only
header collapse). The main risks are a stale in-flight page race in
`KidsVideoGrid`, the unbounded watch-history query, and the doubled
For-You ranking cost on the home feed — none are urgent, all are worth
scheduling.

## Strengths

- **`suitableVideo` coverage is complete.** Every video-returning
  query ANDs it: `getKidsVideos` (lib/kids-feed.ts:315),
  `getContinueWatching` (:368), `getNewForYou` (:431),
  `getLikedVideos` (:494), `getWatchHistory` (:559),
  `getRecommendedVideos` (:749), `getKidsChannels` (:810),
  `getPlaylistVideos` (:986), and `getPlaylists` correctly puts it in
  the LEFT JOIN's ON clause (:917-920) so a restricted item drops from
  `videoCount`/`coverThumbnail` without dropping the playlist row.
- **`typeFilter`/`lenFilter` coverage is complete** on every listing
  surface including the watch-page autoplay queue
  (app/kids/[profileId]/watch/[videoId]/page.tsx:69-108), and
  `getKidsChannels` correctly drops 0-count approved-channel tiles
  under any filter (lib/kids-feed.ts:849).
- **`getRecommendedVideos` is solid engineering**: both CTEs NULL-safe
  (`coalesce`, `case when NULL → else`), affinity squashed into 0–40
  so discovery can't be permanently outscored, `withinChannel`
  round-robin penalty, and the `publishedAt desc nulls last` +
  `md5(id || current_date)` tiebreak chain gives a deterministic total
  order — offset paging can't dupe/skip within a day
  (lib/kids-feed.ts:694-768). Window functions in ORDER BY are
  evaluated pre-LIMIT, so `rn`/`withinChannel` are correct.
- **`parseKidsFeedParams` is genuinely defensive** — `isCalendarDate`
  round-trips through `Date` to reject `2026-02-30` before Postgres
  can 500 on it (lib/kids-feed.ts:96-100), and channel/list/date
  params are scoped to the views they belong to so a stale `?channel=`
  on `view=videos` can't leak in.
- **Single URL builder** (`kidsPortalUrl`/`kidsFeedQuery`) means tabs,
  sort chips, type/length filters, drill-ins, back links, shelf
  see-alls and watch hrefs all preserve each other's params; client
  controls (`KidsSearch`, `KidsLengthFilter`, `HistoryDatePicker`)
  rebuild from live `useSearchParams()` so they can't drop params
  either.
- **Authorization is consistent**: the page and both `loadMore*`
  actions gate on `canViewProfile`, and the access check runs before
  the profile-existence check so 404-vs-redirect can't probe UUIDs
  (page.tsx:55-66, app/actions/kids-feed.ts:31-35).
- **`feedVideoCols`** (lib/kids-feed.ts:218-225) trims the ~9 KB/row
  `description`/`tags`/`raw` columns — the right fix for 2k-row feeds.
- **`getPlaylists` is `cache()`-wrapped** so the shelves + grid + ⋮
  menu share one query per request (lib/kids-feed.ts:887).
- **`home-shelves.tsx` autoplay context is correct per shelf**: home
  feed for continue/new, `view=foryou`/`shorts`/`liked` for the rest
  (:85-90); shelf collapse rules under `type=` are explicit (:44-59).
- **Client split is well done**: `KidsVideoGrid` windows + dedups +
  resets on new `rows` identity; `KidsSearch`'s `pendingSubs` queue
  distinguishes "my own navigation committed" from "external commit —
  adopt" (kids-search.tsx:61-70); `KidsHeader` collapses via transform
  only (no layout oscillation) with `inert` + focus guards;
  `drag-scroll.tsx` is window-delegated with pointer-capture and a
  drag→click suppressor.

## Issues

1. **med — kids-video-grid.tsx:60-79 — stale in-flight page pollutes a
   refreshed feed.** `fetchNext`'s `.then` is not invalidated by the
   reset-on-refresh block (:50-58): if a `loadMore` request is in
   flight when `router.refresh()` (pusher event) or a navigation swaps
   in new `initialRows`, the old page still resolves —
   `setRows(prev => [...prev, ...filtered])` appends old-filter rows to
   the NEW feed and `setOffset(o => o + page.length)` corrupts the
   offset for all subsequent pages. A `.catch` on the stale request
   would also wrongly `setExhausted(true)` the new feed. Rows are
   still whitelist+suitable, so the safety invariant holds, but e.g.
   switching to `type=shorts` mid-fetch can append long videos.
   **Fix:** keep a `genRef`/`loadMoreRef`; stamp each call and drop
   resolutions whose generation no longer matches (or abort via
   comparing the `loadMore` closure captured at call time).

2. **med — lib/kids-feed.ts:509-567 — `getWatchHistory` is unbounded.**
   It returns every (video, day) row ever recorded; both the History
   view and the watch page (`view=history` queue, watch page
   :77-85) pull the whole set on every render. History only grows.
   **Fix:** add a LIMIT or a rolling-day window (e.g. last N days) —
   the `?date=` picker already covers deep history.

3. **med — home-shelves.tsx:42-59 — the ranked query runs twice per
   home render.** On the default view, `getRecommendedVideos` executes
   once with `type` (Picked) and once with `type:"shorts"` (Shorts) —
   two copies of the codebase's heaviest query (2 CTE scans +
   2-window sort over the full whitelist), on every home load and
   every pusher-driven refresh, on a 3-connection pool shared with 4
   more queries. The two rankings genuinely differ (windows computed
   over different filtered sets), so they can't trivially share —
   consider computing `rank`/`withinChannel` once in an inner subquery
   and serving both lists from it, or accept the cost but note it.
   With ~2k whitelists and remote Neon this is likely the
   largest single contributor to home-page latency.

4. **low — lib/kids-feed.ts:124-130 — `?date=` "today" is computed in
   the server's TZ while `watchedOn` is written from the client's
   TZ** (app/api/watch-progress/route.ts:103 takes `body.day` from the
   device). A kid ahead of the server clock gets their own "today"
   rejected (`rawDate <= today` fails) and silently falls back to the
   all-days view; `HistoryDatePicker`'s `max` (:17) uses client time,
   so the picker itself permits that date. **Fix:** drop the future
   check (impossible dates are already rejected by `isCalendarDate`,
   and a future date just renders "Nothing watched that day!") or
   allow `today + 1`.

5. **low — lib/kids-feed.ts:140-143 — inverted `?min=`/`?max=` not
   normalized.** `?min=600&max=60` yields an impossible band → empty
   grid with the nonsensical "No videos between 10 minutes and 1
   minutes yet!". The slider UI only ever writes sane pairs; this is
   hand-edited-URL territory, but one `if (min > max) swap` in
   `parseKidsFeedParams` fixes it for every view at once.

6. **low — _components/shorts-view.tsx:38-60 — `?min=`/`?max=` apply
   invisibly on the Shorts view.** `feed.minLen/maxLen` filter the
   query and are forwarded to `loadMoreShorts`, but the view renders
   no `KidsLengthFilter` and its empty state offers only "Clear
   search"/"Find videos" — no "Show everything". Carried-over length
   params are thus unclearable here. **Fix:** add the filter to the
   header or add the same filtered-empty-state action other views use.

7. **low — kids-video-grid.tsx:77 — a transient `loadMore` failure
   permanently ends the feed.** `.catch(() => setExhausted(true))`
   hides the "Show more" button entirely; a flaky network blip needs a
   full refresh to recover. **Fix:** keep the sentinel/button rendered
   in a "Retry" state on error.

8. **low — needless sequential `await`s.** `videos-view.tsx:90-101`,
   `foryou-view.tsx:30-38`, `liked-view.tsx:30-38`,
   `shorts-view.tsx:27-35` and `getKidsChannels`'s grouped→approved
   pair (lib/kids-feed.ts:797-822) each serialize two independent
   queries — an extra remote-Neon round trip each. `Promise.all` them;
   pool max 3 has headroom.

9. **low — lib/kids-feed.ts:818-831 — `getKidsChannels` over-fetches.**
   The `approved` query selects the full `channels` row (incl. the
   multi-KB `raw` JSONB) per approved channel, then a third query
   re-fetches thumbnails for all ids. Select only
   `id`/`title`/`thumbnail`, and only hit the registry for grouped ids
   absent from `approved`.

10. **low — magic-number coupling on the page size.**
    `foryou-view.tsx:110` and `shorts-view.tsx:73` bind `loadMore`
    only when `rows.length === 60` — a literal copy of
    `getRecommendedVideos`' default `limit = 60`
    (lib/kids-feed.ts:615). Export a `FOR_YOU_PAGE_SIZE` constant and
    use it in all three places (also the first-page `limit` argument).

11. **low — `watchStatus` comment overclaims** (lib/kids-feed.ts:236-244).
    It says "same tiers" as the SQL `statusRank`, but `statusRank`
    includes `reaction = 'dislike' → 2` (:269-273) and `watchStatus`
    doesn't. `watch-experience.tsx:144-150` compensates at pick time
    via `reactionsRef`, so behavior is right — but the mirror isn't a
    mirror; either include the reaction tier (the function signature
    would need the reaction row) or fix the comment.

12. **low — schema.ts:251-258 — `playlists.profileId` is unindexed.**
    `getPlaylists` filters on it every request (several times per
    home render before `cache()` dedupes within a request). Harmless
    at current row counts; add an index when generating the next
    migration anyway.

13. **nit — page.tsx:150-162 — style drift.** The parent-session
    profile link block is written in an older unformatted style
    (unsorted class order, `w-11 h-11`, odd indentation) vs the
    kid-session sibling (:131-138), and lines 104/123/148/150/152/155
    exceed the repo's 79-char rule. Re-run prettier on the file.

14. **nit — history-date-picker.tsx:32 — `router.push` vs `replace`.**
    Every other param-rewriting control (`KidsSearch`,
    `KidsLengthFilter`) uses `router.replace`; date picks accumulate
    history entries, so Back steps through each picked day. May be
    deliberate; flagging for consistency.

15. **nit — kids-search.tsx:51-53 — `urlRef` updates in a passive
    effect.** A debounced `navigate` firing between a param commit
    (e.g. a sort chip) and the effect rebuilds the URL from stale
    `searchParams`, clobbering the just-committed filter. Tiny window;
    assign `urlRef.current` during render instead to close it.

16. **nit — `getPlaylists` fetched on empty-result paths too.**
    `videos-view.tsx:101`, `foryou-view.tsx:38`, `liked-view.tsx:38`,
    `shorts-view.tsx:35` all await it unconditionally even though the
    provider only renders when `rows.length > 0` — one wasted query on
    every empty state. (`cache()` already makes the home-layout call
    free.)

17. **nit — `parseKidsFeedParams` doesn't trim `q`**
    (lib/kids-feed.ts:154). `KidsSearch` trims before navigating, but
    a hand-edited `?q=+` produces `Results for "  "` and an
    `ilike '%  %'` scan. Trim in the parser — one place, all callers.

18. **nit — `?view=shorts&type=videos` survives in the URL.** The
    shorts feed forces `type:"shorts"` on the query (shorts-view.tsx:30)
    and the watch page coerces the same way
    (watch/[videoId]/page.tsx:49), but `kidsFeedQuery` keeps emitting
    `type=videos` — harmless and self-consistent, just untidy.

## Refactor suggestions

1. **Add a staleness guard to `KidsVideoGrid.fetchNext`** (issue 1) —
   highest-value correctness fix in the unit.
2. **Bound `getWatchHistory`** (issue 2) — the only query whose result
   set grows without limit.
3. **Hoist the For-You ranking into an inner subquery** computing
   `affinityScore`/`flatScore`/`rank`/`withinChannel` once, letting a
   future caller reuse it — and evaluate whether the Shorts shelf can
   be served from the same ranked result (issue 3). Even if the two
   queries must stay separate, the `channel_affinity`/`channel_flags`
   CTE scans are identical and could be hoisted.
4. **Normalize params once in `parseKidsFeedParams`** (issues 4, 5,
   17): trim `q`, swap inverted min/max, drop or relax the
   server-TZ future-date check.
5. **Parallelize the independent awaits and slim `getKidsChannels`**
   (issues 8, 9) — cheap wins on the remotest latency path.
6. **Export `FOR_YOU_PAGE_SIZE`** and use it for the view's first-page
   `limit`, the `=== 60` checks, and the grid's page-size coupling
   (issue 10).
7. **Deduplicate the UUID regex** — `page.tsx:46-47` re-declares
   `PLAYLIST_ID_RE` (lib/kids-feed.ts:89-90); export one
   `PROFILE_ID_RE`/`UUID_RE`.
8. **Unify `watchStatus`/`statusRank` tiers** or fix the doc comment
   (issue 11).
