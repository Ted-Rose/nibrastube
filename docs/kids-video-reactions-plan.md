# Plan: Kids Video Reactions (Like / Dislike + "Liked" tab)

Feature branch prefix: `feature/` (e.g. `feature/kids-video-reactions`).

## Goal

Let a kid react to the video they're watching with **thumb up** / **thumb
down**, and add a **Liked** tab to the kids portal (`/kids/[profileId]`)
showing everything they've liked, newest reaction first — a favorites
shelf the kid controls themselves.

Reactions are per-profile app data (like `watch_progress`); they never
touch YouTube. Whitelist stays absolute — a kid can only react to a
video that's currently approved for their profile.

## Facts established by codebase investigation

- **Feed plumbing is already parameter-driven end to end.** `view` is a
  `KidsFeedParams` field parsed by `parseKidsFeedParams` and serialized
  by `kidsFeedQuery` (`lib/kids-feed.ts`). The portal page builds the
  grid from it, `watchUrl()` embeds it in every card href, the watch
  page rebuilds the playlist from the same params, and `returnQuery`
  carries it back. Adding a third view (`"liked"`) automatically gets
  tab state, watch-page playlist context, and back-navigation for free.
- **The watch page already mirrors the grid.** `watch/[videoId]/page.tsx`
  calls `getKidsVideos` with the feed params, finds `currentIndex`, and
  hands `{id, title, startSeconds, status}` items to `WatchExperience`.
  For `view === "liked"` it just swaps the data source — same shape.
- **`WatchExperience` keeps per-video client state in `statusRef`** (a
  `Map<videoId, WatchStatus>` merged against the playlist prop on
  refresh). Reactions need the identical treatment: a `Map` of
  `videoId → reaction` seeded from playlist items, updated optimistically
  on tap, merged (not replaced) when Pusher refreshes the playlist.
- **Fullscreen constraint (from the swipe plan):** in *native* fullscreen
  only descendants of `document.fullscreenElement` render —
  `FullscreenPlayer` requests fullscreen on its wrapper div, and the
  watch page auto-enters fullscreen on load. Buttons in the page's
  bottom control bar would be invisible most of the time, so the
  thumb buttons **must render inside `<FullscreenPlayer>`** as an
  absolutely positioned overlay (same technique as the exit-fullscreen
  X button at `fullscreen-player.tsx:83-95`). The YouTube iframe is
  cross-origin — we cannot put buttons inside its control bar; an
  overlay *above* it is the only option.
- **Auth for kid-driven writes already exists.** `app/api/watch-progress`
  accepts a write when `activeProfileId` cookie === profileId (kid-locked
  device, no session) OR `getSession()` + `assertCanManageProfile`
  succeeds (parent). Server actions can `await cookies()` the same way —
  no new auth machinery needed.
- **Reactions don't need beacons.** Unlike watch position (flushed on
  pagehide/unload), a reaction is a deliberate tap — a server action is
  the codebase's default for mutations (`app/actions/*.ts`) and needs no
  `sendBeacon`/`keepalive` plumbing.
- **Schema precedent:** `(profileId, videoId)` composite PK tables with
  cascade FKs to `profiles` and `videos` are the established pattern
  (`watch_progress`, `channel_video_exclusions`).
- **Pusher precedent:** `pusher-listener.tsx` binds `video-pinned` /
  `video-unpinned` → `router.refresh()` on the portal page. Adding a
  `video-reacted` bind is one line per side.
- `components/ui/` has only button/card/input/label — build the reaction
  buttons as plain styled `<button>`s in kids-UI style (big, round,
  `font-black` icon-only is fine — icons are self-explanatory).

## Data model — one new table

`lib/db/schema.ts`:

```ts
// Kid reactions per (profile, video): one row, latest wins.
// "like" | "dislike" — text column leaves room for more reactions later.
export const videoReactions = pgTable(
  "video_reactions",
  {
    profileId: uuid("profile_id")
      .references(() => profiles.id, { onDelete: "cascade" })
      .notNull(),
    videoId: text("video_id")
      .references(() => videos.id, { onDelete: "cascade" })
      .notNull(),
    reaction: text("reaction").notNull(), // "like" | "dislike"
    reactedAt: timestamp("reacted_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.profileId, table.videoId] }),
  })
);
```

Then `npm run db:generate` (commit the generated `drizzle/` files) and
`npm run db:migrate`.

**Lifetime rules:** reaction rows survive unpinning (same as
`watch_progress` — no FK to `whitelisted_videos`). The Liked tab only
shows still-whitelisted rows via inner join, so an unpinned favorite
disappears but silently returns if the parent re-pins it.

## Files to create / modify

### 1. `app/actions/reactions.ts` (new)

```ts
"use server";

const reactionSchema = z.object({
  profileId: z.string().uuid(),
  videoId: z.string().min(1),
  reaction: z.enum(["like", "dislike"]).nullable(), // null = clear
});

export async function setVideoReaction(input: unknown) {
  const parsed = reactionSchema.safeParse(input);
  if (!parsed.success) return;
  const { profileId, videoId, reaction } = parsed.data;

  // Dual auth, mirroring /api/watch-progress: kid-locked device OR
  // managing parent session.
  const activeProfileId = (await cookies()).get("activeProfileId")?.value;
  if (activeProfileId !== profileId) {
    const session = await getSession();
    await assertCanManageProfile(session, profileId);
  }

  // Whitelist is absolute — reactions only on approved videos.
  const approved = await db.query.whitelistedVideos.findFirst({
    where: and(
      eq(whitelistedVideos.profileId, profileId),
      eq(whitelistedVideos.videoId, videoId)
    ),
  });
  if (!approved) return;

  if (reaction === null) {
    await db.delete(videoReactions).where(
      and(eq(videoReactions.profileId, profileId),
          eq(videoReactions.videoId, videoId))
    );
  } else {
    await db.insert(videoReactions)
      .values({ profileId, videoId, reaction })
      .onConflictDoUpdate({
        target: [videoReactions.profileId, videoReactions.videoId],
        set: { reaction: sql`excluded.reaction`,
               reactedAt: sql`now()` },
      });
  }

  const { pusherServer } = await import("@/lib/pusher");
  await pusherServer.trigger(`profile-${profileId}`, "video-reacted", { videoId });

  revalidatePath(`/kids/${profileId}`);
}
```

`revalidatePath` refreshes the portal's Liked tab; the Pusher event keeps
a second kid device in sync (optional but one line — include it).

### 2. `lib/kids-feed.ts` (modify)

- `KidsView` → `"videos" | "channels" | "liked"`;
  `parseKidsFeedParams` accepts `"liked"`; `kidsFeedQuery` emits
  `view=liked`. `channel` stays channels-view-only (already guarded).
- `getKidsVideos`: add a `leftJoin(videoReactions, …)` on
  (profileId, videoId), select it as `reaction`, and fold dislike into
  `statusRank` so a disliked video sorts/plays like a watched one:

  ```ts
  const statusRank = sql<number>`case
    when ${videoReactions.reaction} = 'dislike' then 2
    when ${watchProgress.completed} then 2
    when ${watchProgress.positionSeconds} > 0 then 1
    else 0 end`;
  ```

- New `getLikedVideos(profileId, { q })`: root at `videoReactions`
  (`reaction = 'like'`), `innerJoin videos`, `innerJoin
  whitelistedVideos` (playable only), `leftJoin watchProgress`; order by
  `reactedAt desc`. Return the same `{ video, progress, reaction }` row
  shape so the portal grid and watch page reuse it unchanged.

- Export `export type VideoReaction = "like" | "dislike"`.

### 3. `components/pusher-listener.tsx` (modify, one line)

Bind `"video-reacted"` → `router.refresh()` alongside the existing two.

### 4. `app/kids/[profileId]/page.tsx` (modify)

- Third tab in the pill switcher (`grid-cols-2` → `grid-cols-3`):
  **Liked** with a `Heart` icon (`weight="fill"` when active), linking
  `portalUrl({ view: "liked", channel: null })`.
- When `view === "liked"`: `rows = await getLikedVideos(profileId, { q:
  query })`; heading "Liked Videos"; hide `KidsSortSelect` (liked order
  is reactedAt desc — sorting is a future option).
- Empty state: `Heart` icon, copy "No liked videos yet! Tap the 👍 while
  watching." / "No videos found!" for `q`.
- Grid reuses `<VideoCard>` exactly — `watchUrl` already appends the
  feed query, so a liked-tab click carries `view=liked` to the watch
  page.

### 5. `app/kids/[profileId]/watch/[videoId]/page.tsx` (modify, small)

When `feed.view === "liked"`, build the playlist from
`getLikedVideos(profileId, { q: feed.q })` instead of `getKidsVideos`.
Playlist items gain `reaction` from either source. Everything else —
fallback-to-full-list, `currentIndex`, `returnQuery` — is unchanged.

### 6. `components/watch-experience.tsx` (modify — the main UI work)

- `PlaylistVideo` gains `reaction: VideoReaction | null`.
- State: `const [reactions, setReactions] = useState(() => new Map(
  playlist.map(v => [v.id, v.reaction])))` + a `reactionsRef` mirror.
  In the playlist-change effect, merge server values the same way
  `statusRef` does — the playlist is a fresh snapshot and already
  contains any tap we saved, so overwrite-per-key is safe and keeps
  multi-device in sync.
- `react(dir)`: read `latestRef.current.videoId` (NOT `playlist[index].id`
  — the ref is what the player actually loaded); toggle semantics
  (`same → null`, `different → switch`); optimistic `setReactions`; call
  `setVideoReaction({ profileId, videoId, reaction })` in a
  `startTransition`, revert on throw.
- **Buttons inside `<FullscreenPlayer>`** (required — see fullscreen
  constraint): an `absolute top-3 right-3 z-50` row of two big round
  buttons (`w-12 h-12`+, `bg-black/60`, kids-UI weight). `ThumbsUp` /
  `ThumbsDown` from `@phosphor-icons/react`, `weight="fill"` +
  `text-primary` (like) / `text-red-500` (dislike) when active, regular
  weight white otherwise. `aria-label="Like video"` / `"Dislike video"`.
- Optionally mirror the same pair in the bottom control bar next to the
  avatar for non-fullscreen browsing — same handler, cheap to add; do it
  if the overlay tests visually noisy.
- Autoplay: in the `statusAt` callback passed to `pickNextIndex`, treat a
  disliked video as tier 2 (`Math.max(status, 2)`) so autoplay skips
  disliked videos while any unwatched/started ones remain — same as the
  `statusRank` change in `getKidsVideos`.

### 7. `components/video-card.tsx` (modify, small — optional polish)

Accept `reaction` and render a small `Heart`/`ThumbsDown` badge on the
thumbnail corner so liked/disliked state is visible in grids. Optional —
skip if it clutters cards.

## UX rules (decisions)

| Case | Behavior |
|---|---|
| Tap 👍 on unreacted video | Sets `like`, button fills |
| Tap 👍 on liked video | Clears reaction (row deleted) |
| Tap 👎 on liked video | Switches row to `dislike` |
| Liked video later unpinned | Row survives; hidden from Liked tab (inner join); reappears on re-pin |
| Disliked video | Still playable/browsable; deprioritized by autoplay + `sort=status` (tier 2) |
| Reaction on non-whitelisted video | Server action no-ops (whitelist check) |
| Multi-device | Same profile → shared rows; Pusher refresh keeps tabs in sync |
| Who can react | Kid device (`activeProfileId` cookie) or managing parent session |

## Out of scope / future

- **Parent dashboard surfacing** (see what a kid liked/disliked, dislike
  → suggest unpin) — v1 is kid-side only.
- **Hiding disliked videos from the grid** — kept playable; revisit if
  parents want dislike-as-soft-unpin.
- Sort controls inside the Liked tab (reactedAt desc only in v1).
- Emoji reactions beyond like/dislike — the `text` column supports it
  later.
- Buttons inside YouTube's own control bar — impossible (cross-origin
  iframe); overlay is the design.

## Verification

1. `npm run typecheck` and `npm run lint` must pass.
2. `npm run db:generate` + `npm run db:migrate`; confirm the
   `video_reactions` table exists.
3. `npm run dev`, on a kid-locked profile (`/kids/{id}`):
   - Open a video → tap 👍 (in fullscreen AND inline — buttons must be
     reachable in both) → back to portal → **Liked** tab shows it with
     the card playable.
   - Tap 👍 again → reaction clears; Liked tab empties on refresh.
   - Tap 👎 on a video → autoplay at video end skips it in favor of an
     unwatched video; `?sort=status` groups it with watched.
   - Liked-tab card → watch → auto-advance stays inside the liked list;
     "Back to Videos" returns to the Liked tab.
   - Search `?q=` inside the Liked tab filters correctly.
   - Unpin a liked video from the parent dashboard → it leaves the Liked
     tab; re-pin → it returns.
   - On a second device/incognito session of the same profile, reactions
     appear (shared rows); Pusher refresh propagates.
   - POST-shaped auth: reaction write from a device whose
     `activeProfileId` cookie doesn't match and no session → no-op/403.
