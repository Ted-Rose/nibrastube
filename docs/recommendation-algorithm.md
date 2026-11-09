# Kids recommendation algorithm

How the "For You" ranking works today. One SQL query —
`getRecommendedVideos` in `lib/kids-feed.ts` (~lines 722-899) —
reorders the profile's `whitelisted_videos` by predicted interest.
The whitelist is absolute: the ranking never adds content, it only
sorts what a parent already approved. All signals come from tables
we own; there are no YouTube API calls in the ranking path.

## Surfaces

Every place the ranking feeds UI:

- **"Picked for you" home shelf** (`home-shelves.tsx`) —
  `getRecommendedVideos({ limit: 20 })`, sitting between "Continue
  watching" and "New for you"; See-all -> `?view=foryou`. Skipped
  under `?type=shorts` (the Shorts shelf covers it). Cards carry
  the `view=foryou` feed params so the watch page rebuilds the
  ranked queue.
- **`?view=foryou` feed** (`foryou-view.tsx`) — first page is
  `FOR_YOU_PAGE_SIZE` = 60 rows; the grid's sentinel calls the
  `loadMoreForYou` server action (`app/actions/kids-feed.ts`,
  gated by `canViewProfile`) for each next offset page, passing
  back page 1's `asOf` epoch (see "Determinism & paging"). No sort
  chips — the ranking IS the sort; `?type=`/`?min=`/`?max=`/`?q=`
  still filter.
- **`?view=shorts` feed** (`shorts-view.tsx`) — the same query
  with `type: "shorts"`, paged by `loadMoreShorts`. The same call
  at `limit: 20` also feeds the "Shorts" home shelf.
- **Watch-page autoplay queue** — `watch/[videoId]/page.tsx`
  re-parses the clicked card's href feed params; for `foryou` /
  `shorts` it re-runs `getRecommendedVideos` (first page only, so
  autoplay sees the top 60 ranked rows) and `WatchExperience`
  advances via `pickNextIndex` (`lib/autoplay.ts`): the first
  unwatched video cyclically after the current, then a
  started-not-finished one, else sequential wrap so the player
  loops instead of exiting to the portal. Disliked and
  unplayable/skipped videos count as tier-2 ("watched") in
  `statusAt`, so autoplay avoids re-picking them.

Every other tab is a mechanical sort over the same whitelist —
**not** personalized ranking:

- `?view=videos` and channel drill-in (`?view=channels&channel=`)
  — `getKidsVideos` ordered by `sort=status` (a statusRank CASE:
  0 new, 1 started, 2 watched-or-disliked — with the impression
  penalty ascending *inside* each tier, so repeatedly-ignored
  new videos sink below never-shown ones), `sort=added`
  (`pinned_at`), or `sort=age` (`published_at`). The penalty is
  masked to 0 on started/watched rows; explicit sorts stay
  literal — only the default `status` sort applies it.
- `?view=liked` — `getLikedVideos`, `reactedAt desc`.
- `?view=playlists` — `getPlaylistVideos`, kid-defined position.
- `?view=history` — `getWatchHistory`, day then lastSeenAt desc.
- "Continue watching" / "New for you" shelves —
  `getContinueWatching` (`watchedAt` desc) / `getNewForYou`
  (pin-day then `publishedAt` desc).

## Signals

Which tables feed which term:

- `watch_history.watched_on` (one row per profile+video+day) ->
  `channel_affinity` CTE: affinityScore and the discovery slack.
- `watch_progress.position_seconds` / `completed` -> the +8
  in-progress flat boost, the WHERE completed exclusion, and the
  impression-penalty mask (once watched, penalty -> 0).
- `video_reactions.reaction` -> `channel_flags` CTE (+5/-20), the
  +4 video-like boost, and the WHERE dislike exclusion.
- `video_impressions.seen_days` / `last_seen_on` /
  `last_seen_at` -> `impressionPenalty`: the "shown but ignored"
  downrank (see the formula below).
- `videos.channel_id` / `published_at` / `is_short` /
  `duration_seconds` -> affinity grouping, freshness bonus,
  small-catalog bonus, the type/length filters, and the
  tie-break.
- `whitelisted_videos (profile_id, video_id)` -> the candidate
  pool itself (inner join).

How those rows get written:

- `/api/watch-progress/route.ts` — the watch page POSTs
  `{profileId, videoId, positionSeconds, durationSeconds,
  completed, sentAt, day}` via `useProgressFlush`
  (`components/player-hooks.ts`): a keepalive fetch every ~10s
  while playing (the 500ms tick only sends when position moved
  >2s), plus `sendBeacon` on pause, pagehide, and unmount. The
  route upserts one `watch_progress` row per (profile, video) —
  `setWhere watchedAt < sentAt` drops out-of-order beacons — and
  upserts one `watch_history` row per (profile, video,
  client-local day). Writes only land for whitelisted +
  `suitableVideo` videos.
- `/api/video-reactions/route.ts` — the watch page's thumbs
  up/down upserts one `video_reactions` row per (profile, video);
  `reaction: null` deletes it. Fires a Pusher `video-reacted`
  event plus `revalidatePath("/kids/<id>")`. Same whitelist +
  suitability gate.
- `/api/impressions/route.ts` — `KidsVideoGrid` cards held >=50%
  visible for >=1s queue per profile
  (`lib/feed-impressions.ts`, sessionStorage seen-set
  `nt:imp:<profileId>`) and flush every ~15s / on hidden /
  pagehide / unmount. Upserts one `video_impressions` row per
  (profile, video): `seen_days` +1 at most once per kid-local
  `last_seen_on` (capped at 30), `last_seen_at` = server time.
  Writes are **silent** — no `revalidatePath`, no Pusher: a
  refresh per flush would reshuffle the grid under the kid.
  Same whitelist + suitability gate. Rows unseen for 45 days
  are pruned on write. Shelf cards don't record impressions.

## The formula

All inside `getRecommendedVideos` — one query, two CTEs:

```text
channel_affinity: per watch_history row on a channel, summed —
    3 if watched_on >= current_date - 7
    2 if watched_on >= current_date - 30
    else 1                     -- history never fully decays
channel_flags:    bool_or(reaction='like' / 'dislike') per channel

affinityScore = coalesce(affinity, 0)
flatScore     = + 8 if in-progress (0 < position < duration,
                  not completed)
              + 5 if the channel has any 'like'
              + 4 if this video is 'liked'
              - 20 if the channel has any 'dislike'
WHERE not coalesce(completed, false)  -- finished videos out
  AND reaction IS DISTINCT FROM 'dislike'  -- disliked videos out

effDays         = max(0, seen_days
                  - (1 if last_seen_at > asOf else 0))
impressionPenalty = 0 if position > 0 or completed   -- watched
                  else min(12, 4 * ln(1 + effDays))
                       * 0.5 ^ (days since last_seen_on / 14)

rn          = row_number() over (order by affinityScore+flatScore
              desc, publishedAt desc nulls last,
              md5(id || current_date))
popularity  = 0.5 ^ ((rn - 1) / 60)       -- halves every page
weight      = 40 * affinityScore / (affinityScore + 15)  -- 0..40
within      = row_number() over (partition by channelId
              order by publishedAt desc, md5(id || current_date))
channelSize = count(*) over (partition by channelId)
discovery   = 10 - least(10, affinity)    -- slack for unwatched
              + 4 if publishedAt >= current_date - 30
              + 2 if publishedAt >= current_date - 90
              + 10 / sqrt(channelSize)    -- small catalogs float
              - 3 * ln(1 + within)        -- round-robin penalty

ORDER BY  weight * popularity + flatScore
            - impressionPenalty
            + discovery * (1 - popularity)  DESC,
          publishedAt DESC NULLS LAST,
          md5(id || current_date)
LIMIT / OFFSET for paging
```

In words:

- **Depth crossfade.** `popularity` is 1 on the top row and halves
  every ~60 rows (~1 page). Near the top `weight * popularity`
  dominates — most-watched channels first; deeper down
  `discovery * (1 - popularity)` takes over — fresh, unexplored
  channels mix in. Per-row and exponential, so there is no hard
  cutoff.
- **"Shown but ignored" penalty.** A card the kid has scrolled
  past on `seenDays` distinct days sinks by
  `min(12, 4·ln(1+effDays))`, decaying with a 14-day half-life
  since it was last seen — so it reorders but never hides, and
  forgives after a couple of weeks off-screen. It's a separate
  additive term, deliberately NOT folded into `rn`: that would
  lower a sinking row's `popularity`, grow its discovery slack,
  and partially re-float the very card being penalized. As its
  own term, −N means −N at every depth. Once the video is
  started the penalty masks to 0 — progress is the strongest
  signal it wasn't really "ignored".
- **Bounded affinity.** Raw affinity is unbounded — a
  hyper-watched channel would outscore discovery at any depth —
  so `40a/(a+15)` squashes it into 0-40 (a=15 -> 20, a=45 -> 30).
  More watching still helps, with diminishing returns.
- **Discovery slack.** `10 - min(10, affinity)` gives
  never-watched channels a +10 exploration budget, fading to 0 by
  affinity 10; +4/+2 rewards uploads from the last 30/90 days.
- **Small-catalog bonus.** `+10/sqrt(channelSize)` — a channel
  with only a few whitelisted videos outranks the deep tail of
  a backfilled giant at depth.
- **Round-robin.** `-3 * ln(1 + within)` sinks a channel's Nth
  video with N, so the biggest catalog can't flood consecutive
  pages — deep pages interleave every channel's videos evenly.
- **Flat signals apply at every depth** — a started video stays
  boosted even far down the feed; a disliked channel sinks
  everywhere at once.
- **Cold start.** No history -> all affinities 0 -> the ordering
  collapses to newest-first; the tab works on day one.

## Determinism & paging invariants

- The `rn` and `within` window functions live **inside the same
  ORDER BY** (Postgres allows window functions there): offset
  paging walks one stable ordering — `loadMoreForYou` pages can
  neither duplicate nor skip rows. The grid additionally dedupes
  appended pages by video id against mid-scroll whitelist edits.
- Ties break `publishedAt desc nulls last`, then
  `md5(id || current_date)` — a deterministic daily shuffle, so
  equal-scored picks rotate day to day but never reshuffle on
  refresh.
- **Feed epoch.** For You / Shorts rank impressions "as of" the
  server time page 1 was rendered (`epoch` prop on
  `KidsVideoGrid` via `newFeedEpoch()`); `loadMoreForYou` /
  `loadMoreShorts` pass it back and `clampFeedEpoch` validates
  (finite, <= now, <= 24 h old, else now). A row whose
  `last_seen_at` is after the epoch gets `seen_days - 1`, so the
  kid's own in-session impressions never reshuffle the open feed
  — OFFSET paging would otherwise dupe/skip rows as flushed
  impressions sink page-1 cards mid-scroll. `last_seen_at` is
  server time (never the client clock); `day` is clamped to
  server UTC date ±1. Accepted drift: the decay factor keys off
  `last_seen_on`, so a row re-seen on a new day mid-session
  nudges slightly (<= ~12·(1 − 0.5^(d/14))). Callers without
  an epoch (shelves, watch-page queue) pass no `asOf` = "now",
  no discount.
- `current_date` drives the recency tiers, the freshness bonus,
  and the md5 seed — **never wrap this query in `unstable_cache`
  or "use cache"**: that would freeze the daily re-rank.

## feed-memory interaction

`lib/feed-memory.ts` freezes feed order client-side so leaving to
watch a video and coming back (or a Pusher-driven
`router.refresh()`) never reorders the grid under the kid.
Snapshots live in sessionStorage at
`nt:feed:<profile>:<feedQuery>` — the full query string means every
view/sort/filter/search gets its own key — and are only honored
within `TTL_MS` = 2 h AND on the same local day (the md5 seed
reseeds daily, so yesterday's ranking must not restore). Cap:
20 snapshots, oldest evicted.

Two merge shapes in `components/kids-video-grid.tsx`:

- **Non-paged grids** snapshot `orderIds` only; `reorderRows`
  re-sorts the fresh full list to the saved order — unpinned ids
  drop out instantly, genuinely new ids append at the end in
  server order. Row data is always fresh.
- **Paged grids** (For You, Shorts — `loadMore` set) snapshot the
  full `rows` because pages 2+ can't be refetched for free;
  `patchRows` keeps the frozen order verbatim while patching
  video/progress/reaction fields in place for ids the fresh first
  page knows; unseen fresh ids append. The snapshot also carries
  the feed's `epoch` — a paged snapshot without one is rejected —
  so restored feeds keep ranking against the same impression
  state. Accepted tradeoff: a video unpinned since the snapshot
  can linger in snapshot-only pages until TTL or a feed-key
  change — the watch page's whitelist check still blocks
  playback.

Consequence, stated plainly: a just-watched video does NOT demote
itself mid-session, and any server-side ranking change — including
the rank shift caused by the kid's own just-written watch signals —
only becomes visible when the snapshot expires, the day rolls
over, or the feed key changes (sort/filter/search/tab). This is
deliberate: the freeze is the entire point of feed memory. It
delays the ranking's reaction to new signals by up to 2 h; it
does not corrupt it.

## Invariants

- **Whitelist-absolute.** Every feed query `innerJoin`s
  `whitelisted_videos` — ranking only reorders approved content,
  never adds any. Unpin -> hidden everywhere; re-pin -> returns
  (playlist items return at their old position).
- **18+ floor.** `suitableVideo` (`lib/video-suitability.ts` —
  `age_restricted IS DISTINCT FROM true`) is ANDed into every
  video-returning query AND both write routes; a parent pin on an
  age-restricted video is inert on every kids surface.
- **Dislike suppression.** Disliked videos are excluded from the
  For-You feed entirely (WHERE clause); a disliked channel takes
  -20 on every row everywhere in the feed.
- **Per-profile signals.** `watch_history`, `watch_progress`,
  `video_reactions`, and `video_impressions` all key on
  `profileId` — one kid's watches never steer a sibling's feed.
- **Impressions never hide.** The penalty only reorders For
  You/Shorts and the default `sort=status` of
  All-videos/channel drill-in — capped at 12 and masked once
  watched, it never lifts a row above watched-channel favorites
  it can't outscore, and never filters anything out.

## Changing the algorithm

The whole formula lives in `getRecommendedVideos`
(`lib/kids-feed.ts`, ~lines 722-899). Constants:

| Knob | Value | Effect |
|---|---|---|
| `FOR_YOU_PAGE_SIZE` | 60 | first page + loadMore page size |
| Recency tiers | 3 / 2 / 1 at <=7d / <=30d / older | watch recency weight |
| In-progress flat | +8 | "continue watching" boost |
| Channel like / video like | +5 / +4 | explicit approval |
| Channel dislike | -20 | channel suppression (not exclusion) |
| Impression penalty | min(12, 4·ln(1+d)) · 0.5^(since/14) | scroll-past downrank |
| `MAX_EPOCH_AGE_MS` | 24 h | oldest accepted feed epoch for loadMore |
| `seenDays` cap | 30 | per-(profile, video) impression counter ceiling |
| Popularity half-life | 60 rows | depth where discovery takes over |
| Affinity squash | 40 * a / (a + 15) | bounded 0-40 weight |
| Discovery slack | +10 fading to 0 by affinity 10 | exploration budget |
| Freshness | +4 <=30d, +2 <=90d | recent-upload bonus |
| Small-catalog | +10 / sqrt(channelSize) | tiny channels float at depth |
| Round-robin | -3 * ln(1 + n) | per-channel spacing in the tail |
| Tie shuffle | md5(id \|\| current_date) | deterministic daily rotation |

Safe-change rules:

- Keep ORDER BY deterministic and stable — `loadMore` is offset
  paging, so any nondeterminism duplicates or skips rows between
  pages. Keep the epoch plumbing: any new mid-session mutable
  signal must also be evaluated "as of" `asOf`, or paged feeds
  will reshuffle under the kid.
- New signals must come from tables we own (`watch_*`,
  `video_reactions`, `videos`, `whitelisted_*`) — never add
  YouTube API calls to the ranking path.
- Anything `current_date`-dependent must stay uncached — no
  `unstable_cache` / "use cache" on this query.
- Keep the `{ video, progress, reaction }` row shape — the grid,
  card menus, and the watch-page autoplay queue all consume it.
- Update this doc when the formula changes.

## Related

- `lib/kids-feed.ts` — all feed queries including the ranking
- `lib/feed-impressions.ts` — grid-card impression observer +
  flush queue
- `app/api/impressions/route.ts` — impression upsert endpoint
- `lib/feed-memory.ts` — sessionStorage snapshots + merge helpers
- `lib/autoplay.ts` — `pickNextIndex` autoplay picking
