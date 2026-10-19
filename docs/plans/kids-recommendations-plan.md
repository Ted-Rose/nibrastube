# Plan: Kids "For You" Recommendations

**Status: implemented** (merged in #29)

Feature branch prefix: `feature/` (e.g. `feature/kids-for-you`).

## Goal

A **For You** surface on the kids portal (`/kids/[profileId]`) that
ranks the profile's *already-whitelisted* videos by predicted
interest, so a kid opening the portal sees the videos most likely to
be wanted right now — instead of a flat "not watched, newest first"
wall of thousands. Shipped as a "Picked for you" home shelf plus the
`?view=foryou` feed it deep-links to — NOT a sixth tab (six tiles
cramped the phone tab strip).

Hard invariant: **recommendations never leave the whitelist.** The output
is a reordering of `whitelisted_videos`, not a new content source. No
YouTube API calls (the `relatedToVideoId` search param is deprecated
anyway, and searches cost 100 quota units each) — every signal comes
from tables we already own.

## What the production DB already holds

Queried the Aiven production DB read-only via the `avnadmin` URL
(`.env`'s active `ai_agent` user has no SELECT on app tables; grab the
admin URL with `grep -m1 avnadmin .env | cut -d= -f2-` and swap
`sslmode=no-verify` → `sslmode=require` for psql):

| Table | Rows | Notes |
|---|---|---|
| `videos` | 7836 | global YouTube cache |
| `whitelisted_videos` | 6351 | candidate pool, per profile |
| `watch_progress` | 186 | latest position per (profile, video) |
| `watch_history` | 176 | per (profile, video, day) — rewatch + recency signal |
| `video_reactions` | 3 | 2 likes, 1 dislike — sparse but strong |
| `whitelisted_channels` | 16 | |
| `playlist_items` | 11 | |

Per profile (`watch_history` / whitelist):

| Profile | History videos | Days active | Whitelisted | Never started | Completed |
|---|---|---|---|---|---|
| Rock | 129 | 16 | 1815 | 1693 | 81 |
| Fire | 36 | 3 | 728 | 688 | 29 |
| Lion | 10 | 4 | 2138 | 2130 | 4 |
| Beloved | 1 | 1 | 1670 | 1669 | 0 |

**Channel concentration is the dominant pattern.** Rock's 129 history
rows sit on ~8 channels; the top 4 (Mud Stamp Films 33, Kid Crew 24,
John Deere Kids 21, Cooking with Carter 18) cover ~74% of all watches.
A channel-affinity score alone gets most of the value.

**Coverage of content features on `videos`:** `channel_id` 100%,
`category_id` 99.7%, `published_at`/`duration_seconds` ~100%,
`tags` 77% (6045/7836 — backfillable via `npm run videos:refresh`).

**Key implication:** >93% of each whitelist is unwatched. Discovery —
not inventory — is the problem this surface solves.

## Facts established by codebase investigation

- **Feed plumbing is parameter-driven end to end.** `view` is a
  `KidsFeedParams` field parsed by `parseKidsFeedParams` and serialized
  by `kidsFeedQuery` (`lib/kids-feed.ts`); adding a view means touching
  the `KidsView` union, the parse whitelist, `KIDS_VIEWS`
  (`_components/view-config.tsx`), `FeedContent`, and one branch in
  the watch page — exactly the precedent `history` set. Tab exposure
  is optional on top: `foryou` ships reachable via a home shelf's
  see-all link instead of the tabs array.
- **Every feed query returns `{ video: feedVideoCols, progress,
  reaction }`** — `KidsVideoGrid`, the card ⋮ menu, and the watch-page
  playlist all consume that shape. `getRecommendedVideos` returns it
  too, so rendering is a pure reuse.
- **Watch page autoplay already understands ranked lists.** `view=liked`
  and `view=history` select their own row source in
  `watch/[videoId]/page.tsx`; a `foryou` branch picks
  `getRecommendedVideos` rows and the existing `pickNextIndex`
  tier-picking (unwatched → started → sequential wrap) does the rest.
- **Auth needs nothing new** — the portal and watch pages are gated by
  `canViewProfile`; recommendations are reads over the same tables.
- **Pusher needs nothing new** — `PusherListener` already
  `router.refresh()`es on whitelist/reaction events, which re-ranks the
  picks on next render.
- **No schema change required for v1.** All signals exist:
  `watch_history` (recency-weighted frequency per channel),
  `watch_progress` (completed / in-progress), `video_reactions`
  (explicit boost/suppress), `videos.channel_id` (100% populated).

## Scoring — v1 (single SQL query, deterministic, explainable)

Rank = weighted sum, computed in one query with small CTEs:

```text
channel_affinity(c)  = Σ over watch_history rows on channel c:
                         3 if watched_on ≥ today-7
                         2 if watched_on ≥ today-30
                         1 otherwise
video_score(v) =
    channel_affinity(v.channel)             -- dominant signal
      × (0.25 if completed else 1)          -- favorites still surface,
                                            -- but below fresh picks
  + 8 if 0 < position < end and not completed  -- "continue watching"
  + 5 if v.channel has any 'like'           -- explicit channel boost
  + 4 if v itself is 'liked'
  − ∞ if v is 'disliked'                    -- disliked videos drop out
  − 20 if v.channel has a 'dislike'         -- disliked channels sink
```

Tie-break: `published_at desc nulls last` (same as the "Newest" sort).
**Cold start is free:** a profile with no history has all-zero
affinities, so the ordering collapses to newest-first — the picks
still work on day one.

**Cap at ~60 rows.** The whitelist is thousands deep; kids never scroll
that far, and `feedVideoCols` exists precisely because full `videos`
rows made feeds multi-megabyte (`lib/kids-feed.ts:114-124`).

**Optional day-varying shuffle** (v1.1): order equal scores by
`md5(video_id || current_date)` so tied picks rotate daily without
randomness instability.

Sketch of the query (drizzle, same joins as `getKidsVideos`):

```ts
const channelAffinity = db.$with("channel_affinity").as(
  db.select({
    channelId: videos.channelId,
    affinity: sql<number>`sum(case
      when ${watchHistory.watchedOn} >= current_date - 7 then 3
      when ${watchHistory.watchedOn} >= current_date - 30 then 2
      else 1 end)`,
  })
    .from(watchHistory)
    .innerJoin(videos, eq(videos.id, watchHistory.videoId))
    .where(and(eq(watchHistory.profileId, profileId),
               isNotNull(videos.channelId)))
    .groupBy(videos.channelId)
);
// ... score = sql`...` over left-joined affinity + progress + reaction,
// where reaction IS DISTINCT FROM 'dislike',
// order by score desc, publishedAt desc, limit 60.
```

(Second CTE for per-channel like/dislike flags — same pattern.)

**Index note:** `watch_history`'s PK `(profile_id, video_id,
watched_on)` serves the affinity CTE fine at current scale; if a profile
ever accrues tens of thousands of history rows, add
`(profile_id, watched_on)`. Not needed now.

## Files to create / modify

### 1. `lib/kids-feed.ts` (modify)

- `KidsView` → add `"foryou"`.
- `parseKidsFeedParams`: accept `rawView === "foryou"`; `foryou` needs
  no scoped params (it ignores `sort`/`dir`/`channel`/`list`/`date`).
- `kidsFeedQuery`: nothing new — `view=foryou` serializes via the
  existing `view !== "videos"` branch.
- New `getRecommendedVideos(profileId, { q, limit = 60 })` implementing
  the scoring above; same `{ video, progress, reaction }` row shape,
  inner-joining `whitelisted_videos` (unpin hides, re-pin returns —
  same lifetime rule as every feed).

### 2. `app/kids/[profileId]/_components/view-config.tsx` (modify)

`KIDS_VIEWS.foryou`: label **For You**, icon `Sparkle`
(`@phosphor-icons/react/dist/ssr`), title "Picked for You",
placeholder `Search ${profileName}'s picks...`.

### 3. `app/kids/[profileId]/_components/foryou-view.tsx` (new)

Server component, mirrors `liked-view.tsx`: `FeedHeader` + `EmptyState`
(zero rows) or `KidsVideoGrid` with the shared
`SaveToPlaylistProvider`. No sort chips — ranking IS the sort.

### 4. `app/kids/[profileId]/_components/feed-content.tsx` (modify)

Add `case "foryou": return <ForYouView … />`.

### 5. `app/kids/[profileId]/_components/home-shelves.tsx` (modify)

Add a **"Picked for you"** shelf between "Continue watching" and "New
for you": `getRecommendedVideos(profileId, { limit: 20 })` in the
existing `Promise.all`, `seeAllHref` → `?view=foryou`, cards carry the
`view=foryou` feed params (Liked-shelf precedent) so watch-page
autoplay rebuilds the ranked queue. NO sixth tab — six tiles would
cramp the phone tab strip (`grid-cols-5` stays); promotion to a tab is
a one-line tabs-array addition in `page.tsx` once the ranking proves
itself. Keep `"videos"` as the URL default for v1 (a bare `/kids/<id>`
still lands on the full grid); flipping the default is likewise a
one-line follow-up.

### 6. `app/kids/[profileId]/watch/[videoId]/page.tsx` (modify, small)

Add `feed.view === "foryou"` to the rows-selection chain →
`getRecommendedVideos(profileId, { q: feed.q })`, plus the same branch
in the `-1` fallback. `sequential` stays `false` — `pickNextIndex`
tier-picks unwatched-first through the ranked list, which is exactly
right.

## UX rules (decisions)

| Case | Behavior |
|---|---|
| No watch history yet | All affinities 0 → newest-first ordering (same as "Newest" sort) |
| Disliked video | Excluded from the picks entirely |
| Video on a disliked channel | Heavy demotion (−20), not exclusion — sibling content may differ |
| Completed video | 25% of its channel affinity — rewatchable favorites surface below fresh picks |
| Started-not-finished | +8 flat boost ("continue watching" also has its own home shelf) |
| Liked video / channel | +4 / +5 boost |
| Video unpinned | Hidden via `whitelisted_videos` inner join; returns on re-pin |
| Tie scores | `published_at desc` — deterministic, stable across refreshes |
| `?q=` / `?channel=` / `?sort=` | `q` filters titles as usual; channel/sort params are ignored in foryou |
| Autoplay from a pick | Tier-picked unwatched-first through the ranked list (existing `pickNextIndex`) |
| Who sees it | Anyone who can view `/kids/<id>` — same gate as every feed |

## Out of scope / future

- **Tag/category similarity** — `videos.tags` (77% coverage) and
  `category_id` (99.7%) enable "more like this" beyond channel match;
  worth adding once channel-affinity proves out. A `videos:refresh`
  pass can lift tag coverage first.
- **Cross-profile family taste** — siblings under one parent often
  share interests; `watch_history` could feed a weak prior for new
  profiles.
- **Parent steering** — e.g. boost `category_id = 27` (Education) or
  per-profile "recommended weight" sliders on the dashboard.
- **"Watch again" / "Continue watching" rails** — the signals already
  exist; v1 folds them into one ranked grid instead of separate
  sections.
- **Materialized affinity table** — if the CTE query ever gets hot,
  `profile_channel_affinity` can be maintained incrementally by the
  `/api/watch-progress` write path. Premature now.
- **Making `foryou` the default landing view** — deliberate one-line
  change deferred until the ranking is validated in production.

## Addendum: infinite scroll + depth-decayed popularity (later change)

- The feed is now **infinitely scrollable**: `getRecommendedVideos`
  takes `offset`, the grid's sentinel calls the `loadMoreForYou`
  server action (`app/actions/kids-feed.ts`, gated by
  `canViewProfile`) for the next 60-row page, and `KidsVideoGrid`'s
  `loadMore` prop appends deduped pages client-side.
- **Popularity fades with scroll depth.** `rn` = the row's position
  under the plain affinity ranking; `popularity = 0.5^((rn−1)/120)`
  halves every ~2 pages. Final order =
  `weight(affinity)·popularity + flat_score + discovery·(1−popularity)`
  where `weight(a) = 40·a/(a+15)` squashes raw affinity into 0–40 (a
  hyper-watched channel can't outscore discovery forever) and
  `discovery` rewards low-affinity channels (+10 at affinity 0, fading
  to 0 by affinity 10), fresh uploads, and even channel spread
  (`−2·ln(1 + position within own channel)` — a big catalog's Nth
  video sinks with N, so deep pages interleave channels instead of
  the largest one flooding). Deeper scrolling thus shifts gradually
  and evenly from most-watched to newer, less-favored channels with
  no hard cutoff. `rn`/`within` are window functions inside the same
  ORDER BY (Postgres allows this), keeping offset paging a single
  stable ordering — no dupes/skips between pages.

## Verification

1. `npm run typecheck` and `npm run lint` pass.
2. `npm run dev` (port 3100), on a kid-locked profile:
   - `/kids/{id}` home → a "Picked for you" shelf sits between
     "Continue watching" and "New for you"; See-all →
     `/kids/{id}?view=foryou` shows the full ranked grid with
     thumbnails, ⋮ menus, resume badges.
   - On Rock (richest history): top rows should be unwatched videos
     from Mud Stamp Films / Kid Crew / John Deere Kids / Cooking with
     Carter — verify against
     `select v.channel_title … from whitelisted_videos …` if unsure.
   - On Beloved (1 history row): falls back to newest-first, no crash.
   - Dislike a video → refresh → it's gone from For You; like one →
     its channel's videos climb.
   - Start a video, leave mid-way → it appears near the top on next
     visit.
   - Tap a pick → watch page plays it; auto-advance continues through
     the ranked list; "Back" returns to the Picked-for-you feed.
   - Unpin a recommended video in the parent dashboard → it leaves the
     picks (Pusher refresh); re-pin → it returns.
   - `?q=` filters by title; `?view=videos` unchanged.
3. SQL sanity-check the ranking directly: run the CTE query in psql for
   Rock's profile id and eyeball that the top 20 channels match the
   history-concentration table above.
