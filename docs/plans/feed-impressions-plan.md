# Plan: Scroll-past impression downranking ("shown but ignored")

**Status: not implemented**

Feature branch: `feature/feed-impressions`.

## Goal

When a kid scrolls over a video card in any video feed — the
All-videos tab, the For You feed, the Shorts feed, or a channel
drill-in — without tapping it, that video should gradually lose
recommendation priority so videos never yet shown to the kid surface
instead. "Shown but ignored" is a weak negative signal: weaker than a
dislike, stronger than nothing. The signal must persist across
sessions and devices, decay over time, and never reorder a feed out
from under the kid mid-browse.

Hard invariants preserved:

- **Whitelist stays absolute** — impressions only ever reorder rows
  inside `whitelisted_videos`; they can neither surface unapproved
  content nor hide an approved video outright.
- **`suitableVideo` floor untouched** — the penalty lives inside
  queries that already AND the 18+ floor; it cannot resurrect a
  blocked row.
- **Deterministic ORDER BY for offset paging** — the penalty is a
  column-derived term; the existing `published_at desc, md5(id ||
  current_date)` tie-breaks still close every ordering.

## Current behavior (why it needs this)

- `getRecommendedVideos` (`lib/kids-feed.ts:616-774`) ranks by watch
  taste only: `channel_affinity` CTE → `affinityScore`, `flatScore`
  (in-progress +8, channel-like +5, like +4, channel-dislike −20),
  the depth blend `affinityWeight·popularity + flatScore +
  discovery·(1−popularity)` (lines 688-721, 765-771). A video the kid
  has scrolled past fifty times scores identically to one never
  shown — the tail recycles the same ignored cards at the top of
  every visit.
- `getKidsVideos` (`lib/kids-feed.ts:248-323`) — All-videos and the
  channel drill-in — sorts `status` (default) by `statusRank` tier
  then `published_at desc`. Within tier 0 (unwatched, ~93% of the
  whitelist) order is purely upload-recency; ignored cards never
  sink.
- No impression state exists anywhere. `videos`/`watch_progress`/
  `watch_history`/`video_reactions` only record what the kid
  *tapped*.

## Decisions

### 1. What counts as an impression

A card is "seen" when it is **≥50% visible for ≥1 continuous
second** — measured with `IntersectionObserver` (`threshold: 0.5`)
plus a per-element 1s timer that fires only if the intersection
holds. Fast scroll-bys (<50% or <1s) record nothing. Deduped to
**one counted impression per (profile, video) per kid-local day** —
a card scrolled past five times in one sitting is not 5× as ignored
as once (window remounts and scroll churn would inflate it), and
per-day granularity bounds write volume the way `watch_history`'s
per-day row does. Re-showings on later days, in other feeds, or on
other devices **accumulate** into `seen_days` — repetition across
time is exactly the signal.

### 2. Storage: new Postgres table (chosen over client-only)

```ts
export const videoImpressions = pgTable(
  "video_impressions",
  {
    profileId: uuid("profile_id")
      .references(() => profiles.id, { onDelete: "cascade" })
      .notNull(),
    videoId: text("video_id")
      .references(() => videos.id, { onDelete: "cascade" })
      .notNull(),
    // Days this card was shown ≥1s without a tap — the upsert below
    // increments it at most once per kid-local day.
    seenDays: integer("seen_days").default(1).notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull(), // server-now of the last accepted write
    // Kid-local YYYY-MM-DD of that write — the per-day dedup key
    // (same client-controlled trust posture as watch_history.day).
    lastSeenOn: date("last_seen_on", { mode: "string" }).notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.profileId, table.videoId] }),
  })
);
```

Why server-side: the penalty must be **joinable in SQL** — the
ranking is computed inside Postgres (`getRecommendedVideos` runs
window functions in ORDER BY), so a client-only store cannot
participate without shipping penalty data back up in every feed
request and abandoning the single-query design. Server storage also
survives Android-WebView process kills (sessionStorage does not),
shares the signal across a family's devices under the same profile,
and matches the established precedent: every per-kid signal
(`watch_progress`, `watch_history`, `video_reactions`) lives in
Postgres with a `(profile_id, video_id)` PK and cascade deletes —
this table mirrors `video_reactions` shape-for-shape plus the
`watch_history` day column. One row per (profile, video) keeps the
join fan-out-free by construction. No extra index: the PK serves
both the upsert and the feed joins; volume is tiny (≤1 write/row/
day).

### 3. Transport: batched client POST to a new API route

New `POST /api/impressions`, payload:

```ts
{
  profileId: string;        // uuid
  videoIds: string[];       // 1..500 ids, client-deduped
  sentAt: number;           // client epoch ms, clamped to server now
  day: string;              // kid-local YYYY-MM-DD (z.iso.date)
}
```

- **Client batching** mirrors `useProgressFlush`
  (`components/player-hooks.ts:193-261`): a per-profile pending
  queue flushed on a ~15s interval (only when non-empty), on
  `visibilitychange`→hidden, on `pagehide`, and on grid unmount —
  `navigator.sendBeacon` for unload paths, `fetch(keepalive)`
  otherwise. Client-side dedup lives in sessionStorage
  (`nt:imp:<profileId>` → `{ day, ids: string[] }`): ids already
  flushed today are never re-queued; fails open to plain re-sends
  the server dedupes anyway.
- **API route over server action**: sendBeacon can't invoke server
  actions, and the unload-path flush is the important one (kids
  close the app mid-scroll). Same reasoning as watch-progress.
- **Auth** copies `app/api/watch-progress/route.ts:30-47` verbatim:
  signed session wins — a kid session may only write its own
  profileId; otherwise the `activeProfileId` cookie must match
  (kid-locked devices carry no session), else
  `assertCanManageProfile`. Do NOT use `canViewProfile` — this is a
  write, so it takes the watch-progress gate, not the read gate.
- **Whitelist + suitability filter, not a 403**: a batch mixes ids
  from cards mounted earlier; one unpin mid-scroll must not fail 200
  ids. The route selects the subset of `videoIds` present in
  `whitelisted_videos` for the profile AND matching `suitableVideo`,
  upserts only those, returns `{ ok: true }`. Non-whitelisted ids
  are silently dropped (same spirit as the single-video 403, scaled
  to a batch).
- **Idempotent upsert** — the per-day dedup and late-beacon guard
  combined:

  ```sql
  insert ... on conflict (profile_id, video_id) do update set
    seen_days    = least(30, video_impressions.seen_days + 1),
    last_seen_at = excluded.last_seen_at,
    last_seen_on = excluded.last_seen_on
  where video_impressions.last_seen_on < excluded.last_seen_on
  ```

  `setWhere` drops same-day repeats AND out-of-order beacons in one
  clause (the `watch_history` `setWhere: lt(lastSeenAt, sentAt)`
  precedent, on the day column); `least(30, …)` caps the counter so
  `ln(1+seen_days)` stays bounded and a year of scroll-bys can't
  grow an unbounded penalty.
- **No `revalidatePath`, no Pusher.** Impression writes must be
  silent — a `router.refresh()` per flush would re-render the grid
  under the kid constantly. Ranking picks the rows up on the next
  natural render.
- **Opportunistic pruning**: same handler deletes the profile's rows
  with `last_seen_on < current_date - 45` once per flush (guarded by
  pending length; ~45d matches the decay horizon below). Keeps the
  table bounded without a cron.

### 4. Ranking integration

One shared fragment, defined module-level in `lib/kids-feed.ts`
beside `typeFilter`/`lenFilter` — lazily evaluated against the
joined aliases like `suitableVideo`:

```ts
// "Shown but ignored" penalty — decays to ~0 over ~6 weeks without
// a fresh impression, and is masked entirely once the kid actually
// watches the video (a tap wins over any amount of scroll-past).
const impressionPenalty = sql<number>`
  case
    when ${watchProgress.positionSeconds} > 0
      or coalesce(${watchProgress.completed}, false) then 0
    else least(12,
      4.0 * ln(1 + coalesce(${videoImpressions.seenDays}, 0)))
      * power(0.5,
          greatest(0,
            current_date - ${videoImpressions.lastSeenOn}) / 14.0)
  end`;
```

Both queries add

```ts
.leftJoin(
  videoImpressions,
  and(
    eq(videoImpressions.profileId, whitelistedVideos.profileId),
    eq(videoImpressions.videoId, whitelistedVideos.videoId)
  )
)
```

— a PK join, so at most one row per video: no fan-out, NULL-safe
via `coalesce(seen_days, 0) → ln(1+0) = 0`.

**`getRecommendedVideos` (For You + Shorts):** the penalty joins
`flatScore` as an explicit kid signal applied at every depth —
subtract it in the final ORDER BY expression:

```ts
.orderBy(
  sql`${affinityWeight} * ${popularity}
      + ${flatScore}
      - ${impressionPenalty}
      + ${discovery} * (1 - ${popularity}) desc`,
  ...
)
```

Deliberately **NOT** inside `flatScore`/`rn` (the window ordering at
lines 699-702): `rn`/`popularity` is the scroll-depth dial computed
under pure watch taste. Folding the penalty into `rn` would let a
sinking row's popularity fall, growing its `discovery·(1−popularity)`
term — for a low-affinity channel that discovery slack (up to +10)
would partially re-float the very card being penalized. As a
separate additive term −N means −N at every depth, exactly like the
channel-dislike −20 already in `flatScore` semantics.

**`getKidsVideos` (All-videos + channel drill-in):** fold into the
default `sort=status` ordering only — a secondary key inside each
statusRank tier, before `published_at`:

```ts
sort === "status"
  ? dir === "asc"
    ? [asc(statusRank), asc(impressionPenalty), newestFirst]
    : [desc(statusRank), asc(impressionPenalty), newestFirst]
  : ... // sort=age / sort=added unchanged
```

The mask makes this a no-op outside tier 0 (started/watched rows
have `position > 0` or `completed` → penalty 0), so tier semantics
and the `watchStatus()` JS mirror (`lib/kids-feed.ts:238-244`, which
`pickNextIndex` tier-picks on) stay untouched — only the *within*
tier-0 order changes, from flat newest-first to "never-shown first,
repeatedly-ignored last". Explicit kid-chosen sorts (`age`,
`added`) stay literal: a deliberate "Newest" request means newest —
the downranking is a default-sort feature, not an override. The
channel drill-in inherits this for free (same function, same
params).

**Untouched feeds** — `getContinueWatching`, `getNewForYou`,
`getLikedVideos`, `getWatchHistory`, `getPlaylistVideos`: these are
membership shelves/tabs (started, recently pinned, liked, watched,
kid-curated) where an ignore-penalty is meaningless or hostile.
Cards rendered there still *record* impressions (the hook lives in
the shared grid), which only ever affect the two ranking surfaces.

### 5. Guardrails

- **Decay**: `power(0.5, days_since_last_seen / 14)` halves the
  penalty every 14 days — ~6 weeks of not-shown ≈ full forgiveness;
  the 45-day prune deletes truly dead rows.
- **Cap**: `least(12, …)` — deliberately below the channel-dislike
  −20, so "ignored" can never outweigh explicit hate; a max-strength
  penalty (−12) can't fully bury a hyper-affinity channel
  (`affinityWeight` up to 40) either.
- **Tap wins**: any `watch_progress` row with `position > 0` (or
  `completed`) masks the penalty to 0 — no write-path coupling
  needed; watch-progress already lands via flush on tap→play.
- **Never surfaces non-whitelisted content**: the penalty subtracts
  inside queries that inner-join `whitelisted_videos` — it only
  sinks, never lifts, and only within the approved pool.
- **Can't fight suitability/dislikes**: `suitableVideo` is ANDed in
  the same WHERE; disliked rows are already excluded from For
  You (line 756) and sit in statusRank tier 2 where the masked
  penalty can't move them.
- **Deterministic paging**: the term is a pure function of joined
  columns; existing tie-breaks (`published_at`, daily `md5`) still
  resolve equal scores → offset paging can't dupe/skip.

### 6. `lib/feed-memory.ts` interactions

- **Snapshot re-display DOES count as impressions.** A restored
  snapshot re-renders the same cards; if the kid scrolls past them a
  second time, that second non-tap is real signal — arguably the
  strongest kind ("shown twice, ignored twice"). The observer
  doesn't care how the rows were produced.
- **Frozen order staleness is accepted — NO client-side demotion.**
  A video that crosses a penalty threshold stays put in the restored
  order for up to the 2h TTL. Adding a client-side demotion would
  violate the feed-memory contract itself: cards must never reorder
  under the kid mid-browse, and a row sinking while it's on screen
  is worse than 2h of staleness. The stale window is bounded (2h
  TTL + same-day guard), and any deliberate sort/filter/tab change
  is a different snapshot key → fresh penalized order. Documented
  accepted tradeoff.
- **No piggybacking on `useFeedSaver`.** Its ~400ms scroll throttle
  drives sessionStorage writes; impressions need an Intersection-
  Observer + network queue with different lifecycle (interval +
  pagehide). Two concerns, two mechanisms — the impression module
  stands alone.

### 7. Do shelf impressions count? — No (v1)

`components/video-shelf.tsx` cards ("Picked for you", "Shorts", "New
for you", "Continue watching") are excluded. They render
server-side outside `KidsVideoGrid`'s client boundary and windowed
mount lifecycle the observer piggybacks on; a shelf card and the
grid card for the same video would double-count exposure on the
home screen; and shelf content is mostly membership-based
(continue-watching, new-pins) where ignore-signal is noise. Grid
impressions alone cover every feed surface in scope. Revisit if
shelf-scrolling proves to be where kids actually browse.

## Edge cases

- **Fresh pin, 0 impressions** — penalty 0 → ranks normally; the
  "New for you" shelf + discovery fresh-upload bonus still lift it.
- **Kid scrolls fast past a card** — <50% or <1s → nothing
  recorded.
- **Snapshot-restored card re-displayed** — counts again the next
  day (per-day dedup) — repeated exposure is the signal.
- **Autoplay queue** — rebuilt from feed params at watch-page load
  → inherits current penalties; a mid-session queue is unaffected.
  Intended.
- **Multiple kids, one device** — PK is per (profile, video); the
  client seen-set key embeds profileId; snapshot keys already do.
- **Write spam** — per-day upsert is idempotent; batch caps at 500
  ids; non-whitelisted ids are filtered out; the payload is bare
  ids — no PII.
- **Video unpinned after impressions** — the row lingers but the
  inner join makes it inert; the 45-day prune or the `videos` FK
  cascade cleans it.
- **Liked-but-unwatched video scrolled past** — rare; the penalty
  can apply but the +4 like and the eventual watch mask dominate.
  Accepted.
- **Clock skew** — `day` is client-controlled like
  `watch_history.day` — a kid can only inflate their own
  ignore-count; `sentAt` clamps to server-now for `last_seen_at`.
- **Storage disabled / old client** — the seen-set dedup fails open
  → the server's per-day dedup is still correct; the JS-free SSR
  render is unchanged.

## Files to create / modify

1. `lib/db/schema.ts` — `videoImpressions` table (shape in §2).
2. `drizzle/00NN_*.sql` + `drizzle/meta/` — `npm run db:generate`
   output, committed. `.env` points at production Neon, so the plan
   stops at files+generate; the user runs `npm run db:migrate`
   (`DATABASE_URL_UNPOOLED`). NEVER `drizzle-kit push`.
3. `app/api/impressions/route.ts` — NEW: zod body, watch-progress
   auth gate, whitelisted+suitable id filter, idempotent upsert,
   45-day prune. No revalidate/pusher.
4. `lib/feed-impressions.ts` — NEW client module: per-day seen-set
   (`nt:imp:<profileId>` sessionStorage), pending queue, flush
   (beacon/interval/visibility/pagehide), and
   `useImpressionObserver(containerRef, profileId)` — one
   `IntersectionObserver` (`threshold: 0.5`) + per-element 1s timers
   over `[data-feed-anchor]` descendants; re-queries on window
   growth (`observer.observe` is idempotent), unobserve once
   recorded, disconnect+flush on cleanup.
5. `components/kids-video-grid.tsx` — `ref` on the grid div + the
   hook call. `VideoCard` unchanged — grid cards already carry
   `data-feed-anchor={video.id}` via `vt`.
6. `lib/kids-feed.ts` — `impressionPenalty` fragment,
   `videoImpressions` leftJoin + ORDER BY changes in
   `getRecommendedVideos` and `getKidsVideos` (§4), scoring-comment
   update above `getRecommendedVideos`.
7. `AGENTS.md` — data-model bullet + a business-rules line
   (impression writes gated like watch-progress; silent writes —
   no revalidate).
8. `docs/recommendation-algorithm.md` — sync the formula section
   (AGENTS.md rule: it MUST stay in sync with `lib/kids-feed.ts`;
   another agent is authoring it — update whatever exists, or note
   the penalty there when it lands).

## Implementation steps

1. Schema: add `videoImpressions` → `npm run db:generate` → commit
   migration; hand `npm run db:migrate` to the user.
2. `app/api/impressions/route.ts` + zod schema; verify auth paths
   manually (kid session, `activeProfileId` lock, parent session).
3. `lib/feed-impressions.ts` hook + queue; wire into
   `KidsVideoGrid`.
4. `lib/kids-feed.ts` penalty + joins + ORDER BY in both queries.
5. Doc updates (AGENTS.md, recommendation-algorithm.md).
6. `npm run typecheck && npm run lint`.

## Verification

`npm run typecheck && npm run lint`. Then manual on :3100:

1. `npm run db:migrate` (production Neon — confirm the table exists:
   `\d video_impressions`).
2. Kid feed → scroll slowly over ~10 cards, pause ≥1s each →
   `select * from video_impressions where profile_id = '<id>'`
   shows those ids, `seen_days = 1`.
3. Same-day re-scroll → `seen_days` unchanged (dedup works).
   Backdate `last_seen_on` by a day in psql → re-scroll → count
   increments.
4. Re-rank check — **2h snapshot caveat**: the same `feedQuery`
   restores the frozen order, so to *see* the downrank flip a sort
   chip, change a filter (`?type=`/`?min=`), or use
   incognito/cleared sessionStorage → previously ignored cards sit
   lower; never-shown cards rise.
5. Tap an ignored card, watch a few seconds → next fresh ranking
   un-sinks it (progress mask).
6. Insert an impression for a disliked / 18+ video directly → it
   stays excluded/blocked.
7. For You "Show more" → pages 2+ contain no dupes/skips
   (deterministic ordering still holds).
8. DevTools offline mid-scroll → no console spam; flush failures
   are silent.

## Open questions / tuning knobs

- Constants `4.0` (penalty scale), `12` (cap), `14` (decay
  half-life days), `30` (seen_days cap), `45` (prune horizon) are
  first-guess — eyeball against real profiles after a week of data.
- Should a tapped-but-abandoned (<10s watch, no progress flush yet)
  card still escape the penalty? Current mask needs a progress row;
  the unmount flush usually lands one, but a load-time bail may not
  — acceptable, or record a `dismissed` flag later.
- Shelf impressions (§7) and parent-dashboard visibility into
  "most ignored" content are future work candidates.
