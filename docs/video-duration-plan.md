# Plan: Populate `videos.duration` (total video length)

Prerequisite for `docs/video-history-plan.md` — the watched-progress bar and
resume logic need each video's total duration. Land this first so all future
pins arrive with duration populated.

## Current state

- `videos.duration` is a `text` column that is **never written and never
  read**. `getVideoDetails` (used by `pinVideo`) fetches only `part=snippet`;
  `getVideosBatch` (used by channel sync) fetches `part=snippet,status`.
- YouTube returns duration under `contentDetails.duration` as ISO 8601
  (`PT1H2M3S`, `PT45S`, `PT10M`). Adding the part costs no extra quota — same
  request, same quota unit.
- Product is not live. Existing rows all have `duration = NULL`, so a column
  change loses nothing and no data wipe is required (see "Backfill" below).

## Changes

### 1. Schema (`lib/db/schema.ts`)

Replace the dead text column with integer seconds:

```ts
durationSeconds: integer("duration_seconds"), // total length; null if API didn't return it
```

`npm run db:generate` produces drop+add column statements; every existing
value is NULL anyway, so nothing is lost. Nullable because the API can omit
`contentDetails` (e.g. some Shorts/private edge cases).

### 2. `lib/youtube.ts`

- Add `"contentDetails"` to the `part` param in both `getVideoDetails` and
  `getVideosBatch`.
- Add a small ISO 8601 parser (no dependency needed):

```ts
// YouTube returns ISO 8601 durations: PT1H2M3S / PT10M / PT45S
export function parseIsoDuration(iso?: string): number | null {
  const m = iso ? /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso) : null;
  if (!m) return null;
  return +(m[1] ?? 0) * 3600 + +(m[2] ?? 0) * 60 + +(m[3] ?? 0);
}
```

- Extend `YTSnippet`-adjacent types with `contentDetails?: { duration?: string }`
  and add `durationSeconds: number | null` to `YouTubeVideo` /
  `FullVideoDetails`, populated via `parseIsoDuration(item.contentDetails?.duration)`.

### 3. `app/actions/pinning.ts`

In `pinVideo`, include `durationSeconds: details.durationSeconds` in the
`videos` insert.

### 4. `lib/channel-sync.ts`

In `upsertVideosAndWhitelist`:

- Add `durationSeconds: v.durationSeconds` to the inserted values.
- Add `durationSeconds: sql`excluded.duration_seconds`` to the
  `onConflictDoUpdate.set` clause.

The second line is what makes backfill free: every daily sync rewrites the
`videos` rows it touches, so all channel-sourced videos pick up duration on
the next sync run.

### 5. Lazy write in `POST /api/watch-progress` (from the history plan)

The flush payload still carries `durationSeconds` (the player knows it for
free). Instead of storing it on `watch_progress`, the endpoint lazily repairs
pre-fix rows:

```ts
if (body.durationSeconds) {
  await db
    .update(videos)
    .set({ durationSeconds: body.durationSeconds })
    .where(and(eq(videos.id, body.videoId), isNull(videos.durationSeconds)));
}
```

This covers manually-pinned videos from before the fix the first time they're
watched.

## Backfill

Not needed:

- The column is all-NULL today — the type change itself loses nothing.
- Channel-sourced videos self-heal via the next daily sync (§4 upsert).
- Manually pinned videos self-heal on first watch (§5) or re-pin.
- `truncate videos cascade` is possible but unnecessary — it would also wipe
  `whitelisted_videos` pins, which the upsert approach preserves.

## Task breakdown

1. Schema: `duration text` → `durationSeconds integer`; `db:generate` +
   `db:migrate`.
2. `lib/youtube.ts`: `contentDetails` part in `getVideoDetails` +
   `getVideosBatch`, `parseIsoDuration`, interface fields.
3. `pinVideo` + `upsertVideosAndWhitelist`: write `durationSeconds` (insert +
   upsert-set).
4. Verify: `npm run typecheck`, `npm run lint`; pin a video and approve a
   channel, confirm `duration_seconds` is populated in the DB.

## Unlocks later (not in scope)

- Duration badges on kids/parent thumbnails.
- `watch_progress` uses `videos.duration_seconds` for the progress bar and
  resume threshold — see `docs/video-history-plan.md`.
