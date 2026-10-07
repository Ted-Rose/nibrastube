# Plan: Kids Watch History

Feature branch prefix: `feature/` (e.g. `feature/kids-watch-history`).

## Goal

A **History** tab on the kids portal (`/kids/[profileId]`) that lists
everything a profile has watched, grouped by day — Today, Yesterday, and
older dates — scrollable top to bottom. Each day section shows the **last
4 videos** by default with a "Show all" expander, and a **date picker**
jumps to a specific day. Clicking an entry re-watches it through the
normal watch page (with resume position and history-ordered autoplay).

## What the production DB already holds

Queried the Aiven production DB directly (`.env` active `DATABASE_URL` is
the `ai_agent` user — it has **no SELECT** on app tables; the commented
`avnadmin` line above it works for read-only inspection):

| Table | Rows | Notes |
|---|---|---|
| `watch_progress` | 162 | 4 profiles, earliest 2026-09-24, latest 2026-10-07 |
| `video_reactions` | 3 | too new to be a data source |
| `whitelisted_videos` | 4363 | |
| `videos` | 5850 | |

Per profile (`watch_progress`): Rock 115 rows / 13 distinct days,
Fire 36 / 3d, Lion 10 / 4d, Beloved 1 / 1d.

**Key limitation:** `watch_progress` is one row per `(profile, video)` —
`watched_at` is only the **last** beacon's timestamp. A video watched on
both Monday and Wednesday appears only under Wednesday. A true per-day
history ("all videos watched on Oct 4") needs one row per
`(profile, video, day)` — which doesn't exist yet.

**Two ways to get there:**

- **Option A (rejected for v1):** group `watch_progress` by
  `watched_at::date`. Zero migration, works on existing data — but
  re-watched videos silently vanish from earlier days, and day boundaries
  land on UTC midnight (kids watching in the evening get mis-dated).
- **Option B (chosen):** new `watch_history` table, one row per
  `(profile, video, watched_on)` where `watched_on` is the **client-local
  date** reported by the same beacon payload that already feeds
  `watch_progress`. Re-watches appear under every day they happened;
  backfilling from `watch_progress` seeds ~2 weeks of history
  immediately.

## Facts established by codebase investigation

- **Feed plumbing is parameter-driven end to end** (same as reactions):
  `view` is a `KidsFeedParams` field parsed by `parseKidsFeedParams` and
  serialized by `kidsFeedQuery` (`lib/kids-feed.ts`). View-scoped params
  already exist — `channel` (channels only) and `list` (playlists only).
  A `date` param scoped to `view === "history"` follows the exact same
  guarded-parse pattern (`CHANNEL_ID_RE`, `PLAYLIST_ID_RE`).
- **The beacon already carries everything needed.**
  `watch-experience.tsx:243-250` POSTs `{profileId, videoId,
  positionSeconds, durationSeconds, completed, sentAt}` to
  `/api/watch-progress` on a ~10s throttle plus pagehide beacons. Adding
  one `day` field (client-local `YYYY-MM-DD`) requires a one-line client
  change; the server derives it from `sentAt` when absent, so old clients
  keep working.
- **Auth needs nothing new.** `/api/watch-progress` accepts
  `activeProfileId` cookie === profileId (kid-locked device) OR
  `getSession()` + `assertCanManageProfile`; the portal page itself is
  already gated by `canViewProfile`. History rows are per-profile app
  data, never YouTube data.
- **Row-shape precedent:** every feed query returns
  `{ video: feedVideoCols, progress, reaction }` (`getKidsVideos`,
  `getLikedVideos`, `getPlaylistVideos`). `getWatchHistory` returns the
  same shape plus `watchedOn` / `lastSeenAt`, so the watch page and card
  components reuse unchanged.
- **Composite-PK precedent:** `(profileId, videoId)` PK tables with
  cascade FKs are the established pattern; this one adds a third column
  (`watched_on`) to the PK.
- **Collapse UI must be a client component** — same precedent as
  `KidsVideoGrid`'s windowed rendering.
- **`date("...", { mode: "string" })`** in Drizzle keeps `watched_on` as
  a `YYYY-MM-DD` string — avoids the UTC-midnight `Date` conversion and
  makes day grouping/labels trivial.
- **`pg` returns `date` columns as strings** by default; equality against
  the `?date=` param is a plain string compare.

## Data model — one new table

`lib/db/schema.ts` (add `date` to the pg-core imports):

```ts
// One row per (profile, video, day): the kid-local date a video had any
// watch activity. Append-only-per-day; lastSeenAt tracks intra-day
// recency for ordering and "watched at 3:42 PM" labels.
export const watchHistory = pgTable(
  "watch_history",
  {
    profileId: uuid("profile_id")
      .references(() => profiles.id, { onDelete: "cascade" })
      .notNull(),
    videoId: text("video_id")
      .references(() => videos.id, { onDelete: "cascade" })
      .notNull(),
    watchedOn: date("watched_on", { mode: "string" }).notNull(), // YYYY-MM-DD
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull(),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.profileId, table.videoId, table.watchedOn],
    }),
  })
);
```

Then `npm run db:generate`, and **append a backfill statement to the
generated migration** before `npm run db:migrate`:

```sql
insert into watch_history (profile_id, video_id, watched_on, last_seen_at)
select profile_id, video_id, watched_at::date, watched_at
from watch_progress
on conflict do nothing;
```

Backfilled `watched_on` is the UTC date of the last beacon — an
approximation for old data (noted as accepted drift); new writes carry
the client-local day.

**Lifetime rules:** history rows survive unpinning (no FK to
`whitelisted_videos`, same as `watch_progress`/`video_reactions`). The
view inner-joins `whitelisted_videos`, so an unpinned video hides and
returns on re-pin — consistent with the Liked tab.

**Scale:** ~10–35 rows/day/profile at current usage → ~1k/month/profile
worst case. No partitioning or pruning needed; a retention job is listed
under future work.

## Files to create / modify

### 1. `app/api/watch-progress/route.ts` (modify)

Extend `bodySchema`:

```ts
day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), // client-local date
```

After the existing `watchProgress` upsert (still inside the whitelist
check), upsert the day row:

```ts
const watchedOn = body.day ?? sentAt.toISOString().slice(0, 10);
await db
  .insert(watchHistory)
  .values({
    profileId: body.profileId,
    videoId: body.videoId,
    watchedOn,
    lastSeenAt: sentAt,
  })
  .onConflictDoUpdate({
    target: [
      watchHistory.profileId,
      watchHistory.videoId,
      watchHistory.watchedOn,
    ],
    set: { lastSeenAt: sql`excluded.last_seen_at` },
    setWhere: lt(watchHistory.lastSeenAt, sentAt), // drop late beacons
  });
```

`body.day` is client-controlled — a kid could write arbitrary dates into
their *own* history; harmless at this trust level, noted in AGENTS.md
spirit (capability-URL model already accepted).

### 2. `components/watch-experience.tsx` (modify, one line)

In the `flush` payload (~line 243) add:

```ts
day: new Date().toLocaleDateString("en-CA"), // en-CA formats YYYY-MM-DD
```

### 3. `lib/kids-feed.ts` (modify)

- `KidsView` → `"videos" | "channels" | "liked" | "playlists" | "history"`.
- `KidsFeedParams` gains `date: string | null`.
- `parseKidsFeedParams`: accept `rawView === "history"`; parse `date`
  only when `view === "history"` against
  `/^\d{4}-\d{2}-\d{2}$/` (same guarded pattern as `channel`/`list`),
  else `null`.
- `kidsFeedQuery`: emit `date` only when `view === "history" && date`.
- New query (same `{ video, progress, reaction }` row shape plus the two
  history columns):

```ts
export async function getWatchHistory(
  profileId: string,
  { q, date }: { q?: string; date?: string } = {}
) {
  return db
    .select({
      video: feedVideoCols,
      progress: watchProgress,
      reaction: sql<VideoReaction | null>`${videoReactions.reaction}`,
      watchedOn: watchHistory.watchedOn,
      lastSeenAt: watchHistory.lastSeenAt,
    })
    .from(watchHistory)
    .innerJoin(videos, eq(videos.id, watchHistory.videoId))
    .innerJoin(
      whitelistedVideos, // hide unpinned; returns on re-pin
      and(
        eq(whitelistedVideos.profileId, watchHistory.profileId),
        eq(whitelistedVideos.videoId, watchHistory.videoId)
      )
    )
    .leftJoin(
      watchProgress,
      and(
        eq(watchProgress.profileId, watchHistory.profileId),
        eq(watchProgress.videoId, watchHistory.videoId)
      )
    )
    .leftJoin(
      videoReactions,
      and(
        eq(videoReactions.profileId, watchHistory.profileId),
        eq(videoReactions.videoId, watchHistory.videoId)
      )
    )
    .where(
      and(
        eq(watchHistory.profileId, profileId),
        date ? eq(watchHistory.watchedOn, date) : undefined,
        q ? ilike(videos.title, `%${q}%`) : undefined
      )
    )
    .orderBy(desc(watchHistory.watchedOn), desc(watchHistory.lastSeenAt));
}
```

Flat rows come back day-grouped already (order is `watchedOn` desc); the
client component buckets by `watchedOn` — no second query.

### 4. `components/history-view.tsx` (new, `"use client"`)

Receives `rows`, `profileId`, `feedQuery`. Client-side work only — the
server already sorted:

- Group rows into `Map<watchedOn, rows[]>` preserving order.
- Day section header: `Today` / `Yesterday` / formatted date
  (`new Date(watchedOn + "T12:00:00")` — noon avoids tz-shifted display),
  plus `N videos` count.
- Each section shows `rows.slice(0, expanded ? all : 4)`; when a day has
  >4 rows a pill button toggles between `Show all N` and `Show less`
  (state: `Set<string>` of expanded `watchedOn` keys).
- Row = compact horizontal link to
  `/kids/${profileId}/watch/${video.id}${feedQuery}`: 16:9 thumbnail
  (`w-32`/`w-40`), title (`line-clamp-2 font-bold`), `channelTitle`, and
  `watchedAt` time (`lastSeenAt` → `toLocaleTimeString([], {hour,
  minute})`). Kids-UI styling: `rounded-3xl bg-white shadow-sm` rows,
  `font-black` day headers.
- Reuse `LinkPendingSpinner` inside rows for tap feedback (portal-link
  precedent).

### 5. `components/history-date-picker.tsx` (new, `"use client"`)

Small client control rendered next to the "History" heading:
`<input type="date">` styled as a rounded pill, `value={feed.date ?? ""}`,
`max={today}`; `onChange` → `router.push`/`Link` to
`portalUrl({ date: v || null })` — same URL-param-update pattern as
`KidsSearch`/`KidsSortSelect`. When `feed.date` is set, render an
"All days" clear link beside it. Server-filtering (not client scroll)
keeps long-term row volume bounded.

### 6. `app/kids/[profileId]/page.tsx` (modify)

- Tab bar `grid-cols-4` → `grid-cols-5`; new tab linking
  `portalUrl({ view: "history", channel: null, list: null, date: null })`
  with `ClockCounterClockwise` (`@phosphor-icons/react/dist/ssr`),
  label **History**.
- `FeedContent`: when `view === "history"`,
  `rows = await getWatchHistory(profileId, { q: query, date: feed.date
  ?? undefined })`; heading `History` (or `History — <date>` when
  filtered) + `<HistoryDatePicker>`; body renders `<HistoryView>`
  instead of `KidsVideoGrid`.
- Empty states: `ClockCounterClockwise` icon; `query` → "No videos
  found!"; `feed.date` → "Nothing watched that day!"; default → "Watch a
  video and it'll show up here!"
- `KidsSortSelect` stays hidden (guarded by `showVideoGrid`, which
  history doesn't set — no change needed).
- `KidsSearch` still applies (`q` filters history titles); optionally add
  a `view === "history"` placeholder case.

### 7. `app/kids/[profileId]/watch/[videoId]/page.tsx` (modify, small)

Add a `feed.view === "history"` branch: `rows = await
getWatchHistory(profileId, { q: feed.q, date: feed.date ?? undefined })`,
and set `sequential = true` — history order (most-recent first) is
meaningful, so auto-advance walks the list rather than tier-picking. The
existing `-1` fallbacks work unchanged; `watchUrl`/`feedQuery` already
carry `view=history&date=` into and back out of the watch page.

## UX rules (decisions)

| Case | Behavior |
|---|---|
| Video watched Mon + re-watched Wed | Appears under **both** days (that's the point of the new table) |
| 10s beacons during playback | Upsert the same `(profile, video, day)` row; `lastSeenAt` tracks newest |
| Video un-pinned after watching | Hidden via inner join; reappears on re-pin; row itself survives |
| `?date=2026-10-05` | Shows only that day + "All days" clear link |
| `?date=` malformed / future | Regex guard → falls back to all-days view |
| Day with >4 videos | First 4 shown; "Show all N" expands in place |
| Missing `day` in beacon | Server falls back to `sentAt` UTC date (old clients keep working) |
| Backfilled rows | `watched_on` = UTC date of `watched_at` (approximation for pre-feature data) |
| Autoplay from a history entry | Sequential — continues through the history list |
| Who sees it | Anyone who can view `/kids/<id>` (kid-locked device or managing parent) — same gate as every other tab |

## Out of scope / future

- **Parent dashboard history view** ("what did the kids watch") — the
  table supports it; the UI is a separate surface.
- **Watch-time totals** (`secondsWatched` accumulation, screen-time
  stats) — beacons could accumulate deltas later; not needed for v1.
- **Retention/pruning** of very old history rows.
- **Clear-history action** (kid or parent) — trivial DELETE once wanted.
- Session-level granularity (distinct sittings within a day) — the
  per-day row deliberately collapses sittings; a separate events table
  can be added if ever needed.
- Live Pusher updates of the history tab — `router.refresh()` on the
  existing events is enough.

## Verification

1. `npm run typecheck` and `npm run lint` pass.
2. `npm run db:generate` → edit migration to append the backfill INSERT →
   `npm run db:migrate`; confirm `watch_history` exists and is seeded
   (expect ~162 rows matching `watch_progress`).
3. `npm run dev`, on a kid-locked profile (`/kids/{id}`):
   - Watch a video >10s → portal **History** tab → appears under "Today".
   - Watch a 5th distinct video → Today shows 4 + "Show all 5" → expands
     and collapses.
   - Manually set `?date=<yesterday>` (or use the picker after a second
     day exists) → only that day's rows; "All days" restores.
   - Click a history entry → watch page plays it (resume position
     applies), auto-advance continues down the history list, "Back"
     returns to the History tab.
   - Re-watch a video watched on a previous day → it shows under both
     days.
   - Unpin a history video → it leaves the view; re-pin → returns.
   - `?q=` filters history titles; `?sort=`/`?channel=` params are
     ignored/dropped cleanly in history view.
   - Old-client safety: POST to `/api/watch-progress` without `day` →
     row lands under UTC `sentAt` date, no 400.
