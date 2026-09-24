# Plan: Watch History ("Resume Progress" + watched-indicator bar)

**Depends on `docs/video-duration-plan.md`** — implement that first. It
populates `videos.duration_seconds`, which this plan uses for the progress
bar and resume threshold.

Record, per kid profile, how far each video was watched. Flush the position to
the server on pause, video end, autoplay-advance, leaving the watch view, and
app/tab close. Render a red progress bar under each thumbnail in the kids grid
(YouTube-style) and resume playback where the kid left off.

## Current state (relevant code)

- Player: `components/watch-experience.tsx` — a single `window.YT.Player`
  iframe; `onStateChange` handles `PLAYING`/`ENDED`; a 500ms `tick` interval
  already polls `getCurrentTime()`/`getDuration()`/`getVideoData()` for
  end-of-video detection, Shorts loop wrap, and whitelist snap-back.
- Auto-advance loads the next video into the SAME player via
  `loadVideoById` + `history.replaceState` — no navigation, so per-video
  flush must happen inside `advance()`, not just on unmount.
- Kids grid: `app/kids/[profileId]/page.tsx` — thumbnail cards at lines 113-131.
- Server write pattern: server actions in `app/actions/*` (need `getSession` +
  `assertCanManageProfile`), and API routes in `app/api/*` (see
  `api/sync-channels/route.ts`).
- `videos.duration_seconds` is populated by the prerequisite plan
  (`docs/video-duration-plan.md`) via the YouTube `contentDetails` part.
  Duration lives on `videos`, not duplicated onto each progress row.
- Auth model: `/kids/**` pages render without a session (proxy.ts only gates
  `/parent` and cross-profile access via the `activeProfileId` cookie). The
  JWT session also expires after 2h — a kid watching longer than that would
  silently lose beacons if the endpoint required a session.

## Decisions

- **One row per (profile, video)** — upsert, latest position wins. Not an
  append-only event log (that's a possible future extension for the parent
  dashboard, not needed for progress bar/resume).
- **API route + `sendBeacon`/`fetch keepalive`, NOT a server action** —
  server actions can't be reliably invoked during `pagehide`/unload. A plain
  `POST /api/watch-progress` accepting a small JSON body works with both
  `navigator.sendBeacon` (unload path) and throttled `fetch` (periodic path).
- **Duration stays normalized on `videos`** — the flush payload still sends
  `durationSeconds` (the player knows it for free), but the endpoint only uses
  it to lazily repair `videos` rows that predate the duration fix; it is NOT
  stored on `watch_progress`.
- **Authorization**: accept the write only if (a) the video is whitelisted for
  that profile, and (b) the `activeProfileId` cookie matches `profileId` OR a
  valid session can manage the profile. Matches the existing trust model
  without requiring a live JWT mid-viewing.
- **Periodic flush every ~10s while PLAYING** — covers swipe-kill / crash
  where no lifecycle event fires (common on mobile PWA). One upsert is cheap.

## Design overview

```
WatchExperience (client)
  └─ 500ms tick already reads position/duration ─> keep in a ref
  └─ flush() sends {profileId, videoId, positionSeconds,
                    durationSeconds, completed, sentAt}
       ├─ every ~10s while PLAYING        → fetch keepalive (throttled)
       ├─ on PAUSED                        → fetch keepalive
       ├─ on ENDED / advance() to next vid → fetch keepalive (completed=true)
       ├─ unmount (Back/Home navigation)   → sendBeacon
       ├─ pagehide / visibilitychange=hidden → sendBeacon
       └─ whitelist snap-back              → flush, then reload approved vid
             │
             ▼
   POST /api/watch-progress
       ├─ zod-validate body
       ├─ auth: activeProfileId cookie == profileId, else session+manage check
       ├─ verify (profileId, videoId) exists in whitelisted_videos
       ├─ lazily set videos.duration_seconds if still NULL
       └─ upsert watch_progress (only if sentAt > stored watchedAt)

KidsPortalPage (server)
  └─ SELECT watch_progress WHERE profileId AND videoId IN (pinned ids)
       └─ thumbnail card: red bar width = position/duration %
```

## 1. Schema change (`lib/db/schema.ts`)

New table, one migration via `npm run db:generate` + `npm run db:migrate`:

```ts
export const watchProgress = pgTable(
  "watch_progress",
  {
    profileId: uuid("profile_id")
      .references(() => profiles.id, { onDelete: "cascade" })
      .notNull(),
    videoId: text("video_id")
      .references(() => videos.id, { onDelete: "cascade" })
      .notNull(),
    positionSeconds: integer("position_seconds").default(0).notNull(),
    completed: boolean("completed").default(false).notNull(), // >= ~95% or ENDED
    watchedAt: timestamp("watched_at").defaultNow().notNull(), // last flush time
  },
  (table) => ({
    pk: primaryKey({ columns: [table.profileId, table.videoId] }),
  })
);
```

Cascade deletes mean unpinning/cleanup stays free: deleting a profile or a
`videos` row clears its progress rows. (Unpinning a video does NOT delete the
`videos` row today, so progress survives an unpin/re-pin — harmless and
arguably desirable.)

## 2. API route: `app/api/watch-progress/route.ts`

```ts
const bodySchema = z.object({
  profileId: z.string().uuid(),
  videoId: z.string().min(1),
  positionSeconds: z.number().int().min(0),
  durationSeconds: z.number().int().min(0).nullable(),
  completed: z.boolean(),
  sentAt: z.number(), // client epoch ms — guards against out-of-order beacons
});

export async function POST(request: NextRequest) {
  const body = bodySchema.parse(await request.json()); // wrap in try/catch → 400

  // Auth: device locked to this profile, or a managing parent session
  const activeProfileId = (await cookies()).get("activeProfileId")?.value;
  if (activeProfileId !== body.profileId) {
    const session = await getSession();
    await assertCanManageProfile(session, body.profileId); // throws → 403
  }

  // Only track whitelisted content
  const approved = await db.query.whitelistedVideos.findFirst({
    where: and(
      eq(whitelistedVideos.profileId, body.profileId),
      eq(whitelistedVideos.videoId, body.videoId)
    ),
  });
  if (!approved) return NextResponse.json({ ok: false }, { status: 403 });

  // Lazily repair videos rows missing duration (pre-duration-fix pins)
  if (body.durationSeconds) {
    await db
      .update(videos)
      .set({ durationSeconds: body.durationSeconds })
      .where(and(eq(videos.id, body.videoId), isNull(videos.durationSeconds)));
  }

  await db
    .insert(watchProgress)
    .values({
      profileId: body.profileId,
      videoId: body.videoId,
      positionSeconds: body.positionSeconds,
      completed: body.completed,
      watchedAt: new Date(body.sentAt),
    })
    .onConflictDoUpdate({
      target: [watchProgress.profileId, watchProgress.videoId],
      set: {
        positionSeconds: sql`excluded.position_seconds`,
        completed: sql`excluded.completed`,
        watchedAt: sql`excluded.watched_at`,
      },
      // Drop late/out-of-order beacons (e.g. periodic fetch landing after
      // a pagehide beacon): only apply if the payload is newer.
      setWhere: lt(watchProgress.watchedAt, new Date(body.sentAt)),
    });

  return NextResponse.json({ ok: true });
}
```

`request.json()` parses the body regardless of content-type, so a
`sendBeacon` Blob typed `application/json` (or even `text/plain`) works.

## 3. Client: extend `components/watch-experience.tsx`

The existing 500ms tick already samples position — add a `latestRef` it keeps
fresh, plus a `flush(reason)` helper:

```ts
const latestRef = useRef({ videoId: "", position: 0, duration: 0 });
const lastSentRef = useRef(0);

function flush(useBeacon = false) {
  const { videoId, position, duration } = latestRef.current;
  if (!videoId || duration <= 0) return;
  const payload = JSON.stringify({
    profileId, videoId,
    positionSeconds: Math.floor(position),
    durationSeconds: Math.floor(duration),
    completed: position >= duration * 0.95,
    sentAt: Date.now(),
  });
  if (useBeacon && navigator.sendBeacon) {
    navigator.sendBeacon("/api/watch-progress",
      new Blob([payload], { type: "application/json" }));
  } else {
    fetch("/api/watch-progress", {
      method: "POST", body: payload, keepalive: true,
      headers: { "Content-Type": "application/json" },
    }).catch(() => {});
  }
}
```

Wire the triggers:

- **Tick (500ms)**: update `latestRef` only when
  `getVideoData().video_id === playlist[indexRef.current].id` (ignores the
  whitelist-snapback rogue video). If state is `PLAYING` and
  `Date.now() - lastSentRef > 10_000` and position moved >2s → `flush()`.
- **`onStateChange`**: `PAUSED` → `flush()`; `ENDED` → set position=duration,
  `flush()`, then existing `advance()`.
- **`advance()`**: `flush()` BEFORE `loadVideoById` (this is the autoplay
  transition the requirements call out — the old video's position would
  otherwise be lost since the same player gets reused).
- **Whitelist snap-back branch in tick**: `flush()` before reloading the
  approved video.
- **`pagehide` + `visibilitychange === "hidden"`**: `flush(useBeacon: true)`.
  `pagehide` is the reliable unload event on mobile; `beforeunload` is not.
- **Effect cleanup (unmount)**: `flush(useBeacon: true)` — covers "Back to
  Videos" / House navigation and route changes.
- **YT type additions**: `PlayerState` needs `PAUSED` and `BUFFERING`;
  `loadVideoById` needs the object form for resume (see §5).

Keep the flush logic in the component (it needs player/profile context); if it
grows, extract `flush` into `lib/watch-progress.ts` as a pure function taking
`(profileId, sample)`.

## 4. Progress bar in the kids grid (`app/kids/[profileId]/page.tsx`)

Replace the two-step "fetch pins → fetch videos" with a single joined query —
one round trip, `progress` comes along for free via `LEFT JOIN`:

```ts
const rows = await db
  .select({ video: videos, progress: watchProgress })
  .from(whitelistedVideos)
  .innerJoin(videos, eq(videos.id, whitelistedVideos.videoId))
  .leftJoin(
    watchProgress,
    and(
      eq(watchProgress.profileId, whitelistedVideos.profileId),
      eq(watchProgress.videoId, whitelistedVideos.videoId)
    )
  )
  .where(
    and(
      eq(whitelistedVideos.profileId, profileId),
      query ? ilike(videos.title, `%${query}%`) : undefined
    )
  );
// rows: { video, progress | null }[]
```

In the card, compute the percentage from the video's own duration:

```tsx
const pct = !progress
  ? 0
  : progress.completed || !video.durationSeconds
    ? (progress.completed ? 100 : 0)
    : Math.min(100, Math.round((progress.positionSeconds / video.durationSeconds) * 100));
```

In the thumbnail `div.relative.aspect-video` (line ~116), append:

```tsx
{pct > 0 && (
  <div className="absolute bottom-0 left-0 h-1.5 bg-red-600"
       style={{ width: `${pct}%` }} />
)}
```

`router.refresh()` from `PusherListener` isn't needed here — progress is read
on each page load, which is when the kid returns to the grid anyway.

## 5. Resume playback (natural byproduct)

The watch page (`app/kids/[profileId]/watch/[videoId]/page.tsx`) uses the same
joined query as §4 (whitelisted → videos → watch_progress), which collapses
its existing two-step `approved` + `videoRows` fetch into one round trip and
yields `{ video, progress }` per playlist item. Compute `startSeconds`
**server-side**:

```ts
// per joined { video, progress } row
const duration = video.durationSeconds ?? 0;
const startSeconds =
  progress && !progress.completed && duration > 0 &&
  progress.positionSeconds < duration - 10
    ? progress.positionSeconds
    : 0; // completed or nearly-done videos restart at 0, like YouTube
```

- Initial mount: `playerVars.start = Math.floor(startSeconds)`.
- `advance()`: `loadVideoById({ videoId, startSeconds })` — the object form.

## 6. Optional follow-ups (not in scope, noted for later)

- **Parent dashboard**: `watch_progress.watchedAt` + `completed` answers the
  PRD's "view what each kid is watching" — add a "Recently watched" section or
  a small progress bar on the Approved Videos sidebar items.
- **Offline queue**: if the beacon/fetch fails (PWA offline), stash the
  payload in `localStorage` and flush on next watch-page mount.

## Edge cases & risks

| Case | Handling |
|---|---|
| Shorts loop (no ENDED) | tick already detects wrap → `advance()` → flush fires there |
| Rogue video via "More videos" | `latestRef` only updates when loaded id == current playlist id; snap-back flushes approved vid's position |
| Out-of-order beacons | `sentAt` + `setWhere` guard; position can never be overwritten by an older sample |
| Kid rewinds | position regressions are fine — latest `sentAt` wins, not max position |
| Session expired mid-watch | endpoint accepts `activeProfileId` cookie (7d/24h lifetime), not just JWT |
| Beacon fails (offline/kill) | periodic 10s flush caps loss at ~10s; optional localStorage queue closes the rest |
| Migration order | `npm run db:generate` → `npm run db:migrate` (scripts already exist) |

## Task breakdown

1. Add `watchProgress` table to `lib/db/schema.ts`; `db:generate` + `db:migrate`.
2. Create `app/api/watch-progress/route.ts` (zod validate, cookie/session auth,
   whitelist check, guarded upsert).
3. Extend `components/watch-experience.tsx`: `latestRef`, `flush()`, triggers
   (tick throttle, PAUSED/ENDED, advance, snap-back, pagehide, visibilitychange,
   unmount), YT type additions.
4. Kids grid: query progress + red bar on thumbnails.
5. Watch page: fetch playlist progress → `startSeconds` → resume.
6. Verify: `npm run typecheck`, `npm run lint`, manual test — watch, pause,
   exit mid-video, autoplay through ENDED, kill tab; confirm bar + resume.
