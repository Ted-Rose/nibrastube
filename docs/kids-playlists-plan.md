# Plan: Kid Playlists (save, reorder, play)

Feature branch prefix: `feature/` (e.g. `feature/kids-playlists`).

## Goal

Let a kid (or a parent acting on the profile) create named playlists from
approved videos: a "⋮" menu on every video card → **Save to playlist** →
pick an existing playlist or create a new one. A new **Playlists** tab on
`/kids/[profileId]` lists them; drilling into a playlist shows its videos
in order with **drag-and-drop reordering**. Watching a playlist
auto-advances in playlist order.

Whitelist stays absolute — only currently-whitelisted videos can be added
or played; nothing about this feature lets a kid reach unapproved content.

## Facts established by codebase investigation

- **Feed plumbing is parameter-driven end to end** (`lib/kids-feed.ts`).
  `KidsFeedParams` (`view`, `channel`, `sort`, `dir`, `q`) is parsed by
  `parseKidsFeedParams`, serialized by `kidsFeedQuery`, embedded in every
  card href via `watchUrl()`, rebuilt into the watch-page playlist, and
  carried back by `returnQuery`. Extending `view` with `"playlists"` and
  adding a `list` param (uuid, like `channel` is a channel-id) gets tab
  state, drill-down, watch-queue context, and back-navigation for free.
- **Dual-auth precedent for kid writes exists.** `/api/watch-progress`
  and `/api/video-reactions` accept a write when the `activeProfileId`
  cookie === profileId (kid-locked device, no session) OR `getSession()`
  + `assertCanManageProfile` succeeds (parent). Playlist actions reuse
  this — factor the inline pattern into a shared `lib/profiles.ts`
  helper (e.g. `assertCanEditKidData(profileId)`) instead of copying it
  a third time.
- **Route handlers are NOT required here.** The `/api/video-reactions`
  route exists only because a server action's `revalidatePath`
  re-renders the watch route, tearing down the YouTube player. All
  playlist mutations happen on the portal grid — a re-render there is
  harmless — so plain server actions in `app/actions/playlists.ts`
  follow the `app/actions/*` convention.
- **Schema precedent:** `(profileId, videoId)` composite-PK tables with
  cascade FKs (`watch_progress`, `video_reactions`,
  `channel_video_exclusions`). Playlists need one uuid-PK table +
  one composite-PK items table.
- **Unpin semantics precedent:** `video_reactions` and `watch_progress`
  have no FK to `whitelisted_videos` — rows survive unpinning and reads
  inner-join the whitelist (`getLikedVideos`), so an unpinned item hides
  and silently returns on re-pin. `playlist_items` follows the same rule,
  which also preserves the kid's ordering across an accidental unpin.
- **Menu/dialog primitives are already installed.** `@base-ui/react`
  `Menu` (see `components/app-install-menu.tsx`) and `Dialog` cover the
  ⋮ menu and the save-to-playlist sheet — no new UI dependency.
- **No drag-and-drop library is installed.** Add `@dnd-kit/core` (6.3.1,
  stable/mature) + `@dnd-kit/sortable` + `@dnd-kit/utilities`. HTML5 DnD
  is a non-starter: kids are on touch devices (Android WebView PWA), and
  only pointer-event-based DnD works there.
- **Naming overlap to keep in mind:** `WatchExperience` already calls its
  autoplay queue `playlist` (`PlaylistVideo` interface). DB entities are
  `playlists` / `playlist_items`; call the kid feature "playlists" in UI
  copy and keep `PlaylistVideo` as-is (it's the queue, unchanged shape).
- **Pusher precedent:** server actions trigger `profile-<id>` events via
  dynamic `import("@/lib/pusher")`; `PusherListener` binds each event to
  `router.refresh()`. One new event: `playlist-changed`.
- **Watch page already has stale-link fallback:** if `videoId` isn't in
  the rebuilt queue it retries unfiltered, then redirects to the portal.
  A deleted/emptied playlist degrades gracefully with zero new code.

## Data model — two new tables

`lib/db/schema.ts`:

```ts
// Kid-created playlists, scoped to a profile.
export const playlists = pgTable("playlists", {
  id: uuid("id").primaryKey().defaultRandom(),
  profileId: uuid("profile_id")
    .references(() => profiles.id, { onDelete: "cascade" })
    .notNull(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Ordered membership. Rows survive unpinning (no FK to
// whitelisted_videos); reads inner-join the whitelist.
export const playlistItems = pgTable(
  "playlist_items",
  {
    playlistId: uuid("playlist_id")
      .references(() => playlists.id, { onDelete: "cascade" })
      .notNull(),
    videoId: text("video_id")
      .references(() => videos.id, { onDelete: "cascade" })
      .notNull(),
    position: integer("position").notNull(), // compact 0..n-1
    addedAt: timestamp("added_at").defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.playlistId, table.videoId] }),
  })
);
```

Then `npm run db:generate` (commit the generated `drizzle/` files) and
`npm run db:migrate`.

**Ordering rule:** `position` is a compact integer index. Add =
`max(position)+1`; remove leaves a gap (harmless — `ORDER BY position`
doesn't care); reorder rewrites all positions `0..n-1` in a transaction.
No fractional indexing — playlists are small and full rewrites are cheap.

## Files to create / modify

### 1. `lib/db/schema.ts` + drizzle migration (above)

### 2. `lib/profiles.ts` (modify)

Add a shared dual-auth helper so playlist actions (and future kid-scope
writes) stop duplicating the inline cookie check:

```ts
// Kid-scope writes: kid-locked device (activeProfileId match) OR a
// managing parent session. Throws like assertCanManageProfile.
export async function assertCanEditKidData(profileId: string) {
  const activeProfileId = (await cookies()).get("activeProfileId")?.value;
  if (activeProfileId === profileId) return;
  await assertCanManageProfile(await getSession(), profileId);
}
```

### 3. `app/actions/playlists.ts` (new)

Server actions, each starting with `await assertCanEditKidData(profileId)`
(never `requireParentUnlocked` — kid-locked devices must work). Playlist
id → profileId ownership is verified on every item-level action.

- `createPlaylist(profileId, name)` — zod-validate (`min(1).max(60)`);
  insert; trigger `playlist-changed`; `revalidatePath`.
- `renamePlaylist(profileId, playlistId, name)` / `deletePlaylist(...)` —
  ownership check, then update/delete.
- `addToPlaylist(profileId, playlistId, videoId)` — playlist belongs to
  profile; `whitelisted_videos` row must exist (whitelist is absolute);
  `position = max+1`; `onConflictDoNothing()` for repeat adds.
- `removeFromPlaylist(profileId, playlistId, videoId)` — delete row.
- `setPlaylistOrder(profileId, playlistId, videoIds)` — the posted id
  list must equal the playlist's item set exactly (reject partial/extra
  ids so a stale client can't silently drop items); transaction rewriting
  `position = index`.
- Every mutator ends with a dynamic-import Pusher trigger
  (`playlist-changed`) + `revalidatePath(`/kids/${profileId}`)`.
- Cheap guardrails: cap at ~50 playlists/profile and ~500 items/playlist.

### 4. `lib/kids-feed.ts` (modify)

- `KidsView` → `"videos" | "channels" | "liked" | "playlists"`;
  `KidsFeedParams` gains `list: string | null`.
- `parseKidsFeedParams`: accept `"playlists"`; validate `list` with the
  uuid regex (mirroring `CHANNEL_ID_RE` for `channel`).
- `kidsFeedQuery`: emit `list` only when `view === "playlists"` and set
  (mirroring the `channel` guard) — so tab/sort/search links never drop
  or leak each other's params.
- `getPlaylists(profileId)` → `{ id, name, videoCount, coverThumbnail }`
  (count + first item's thumb via inner join on `whitelisted_videos`).
- `getPlaylistVideos(profileId, playlistId, { q })` → same
  `{ video, progress, reaction }` row shape as `getKidsVideos`, rooted at
  `playlistItems` ordered by `position asc`, inner-joined to
  `whitelisted_videos` (on the playlist's profileId) so unpinned items
  hide. Reject a playlist whose `profileId` doesn't match (returns []).

### 5. `app/kids/[profileId]/page.tsx` (modify)

- 4th tab in the pill switcher (`grid-cols-3` → `grid-cols-4`):
  **Playlists** (`Playlist`/`Queue` phosphor icon), linking
  `portalUrl({ view: "playlists", channel: null, list: null })`.
- `view === "playlists" && !list`: playlist cards grid — cover thumbnail
  (or `Playlist` placeholder), name, "N videos" — each linking
  `portalUrl({ list: p.id })`; plus a **New playlist** card/button.
- `view === "playlists" && list`: playlist detail — header (name,
  rename/delete ⋮ menu, Play-all → `/kids/<pid>/watch/<firstId>` with the
  feed query) and the sortable list.
- Wrap the video grid in `<SaveToPlaylistProvider playlists={…}>` (new
  client component holding dialog state) so every card's ⋮ menu shares
  one dialog + one playlists snapshot.

### 6. `components/video-card.tsx` (modify — restructure, not restyle)

`<Link>` currently wraps the whole `Card` — a ⋮ button inside it is
invalid interactive-inside-interactive markup and its clicks would
navigate. Restructure to `<div className="relative group">` containing
the existing `<Link>` (unchanged card body) plus a sibling
`<VideoCardMenu>` absolutely positioned top-right over the thumbnail
(`absolute top-3 right-3 z-10`, white/90 circular button — mirrors the
reaction badge slot at top-left).

### 7. `components/video-card-menu.tsx` (new, client)

`Menu` from `@base-ui/react/menu` (app-install-menu pattern): ⋮ trigger
→ "Save to playlist" (opens the shared dialog via context) and, when
rendered inside a playlist detail view, "Remove from this playlist".

### 8. `components/save-to-playlist-dialog.tsx` (new, client)

Provider + `Dialog` from `@base-ui/react/dialog`: lists the profile's
playlists as big tap targets with a check state (already-added playlists
get a filled check; tapping toggles add/remove via the actions), plus an
inline "New playlist" name field → `createPlaylist` then `addToPlaylist`.
Kids-UI styling: `rounded-[32px]`, `font-black`, large tap targets.

### 9. `components/playlist-sortable-list.tsx` (new, client)

`DndContext` + `SortableContext` (`verticalListSortingStrategy`) with
`PointerSensor` on a **drag handle only** (`DotsSixVertical` icon,
`touch-action: none` on the handle) — without a dedicated handle, touch
scrolling and drag initiation fight. `onDragEnd` → optimistic
`arrayMove` + `setPlaylistOrder(...)`; revert on failure. Row layout:
position number, thumb, title, duration/progress — same kids-UI cards.

### 10. `app/kids/[profileId]/watch/[videoId]/page.tsx` (modify, small)

When `feed.view === "playlists" && feed.list`, build the queue from
`getPlaylistVideos(profileId, feed.list)`; pass a new `sequential` prop
to `WatchExperience`. The existing stale-link fallback already covers
"video not in this playlist".

### 11. `components/watch-experience.tsx` (modify, small)

New optional `sequential?: boolean` prop: `advance()` and swipe-next use
`(i + 1) % length` instead of `pickNextIndex` — a kid-ordered playlist
must play in order, not unwatched-first. Wrap-to-start at the end
matches the existing "never exit to portal" behavior. Everything else
(statusRef merging, mid-session refresh shrink/reorder handling, rogue-
video snapback) already works because it follows videos by id.

### 12. `components/pusher-listener.tsx` (one line)

Bind `"playlist-changed"` → `router.refresh()` alongside the existing
three binds.

### 13. `proxy.ts` — no changes

Everything lives under `/kids/:profileId` (the `list` param is a query
param on the existing page); the kid-lock/session rules already apply.

## UX rules (decisions)

| Case | Behavior |
|---|---|
| ⋮ on a video card → Save to playlist | Dialog lists playlists; tap toggles membership; "New playlist" row creates + adds |
| Duplicate add to same playlist | No-op (`onConflictDoNothing` on the PK) |
| Add non-whitelisted video | Impossible from UI; action rejects it anyway (whitelist join check) |
| Video unpinned while in playlists | Item hides (inner join); order survives; returns on re-pin |
| Watch inside a playlist | Queue = playlist order; auto-advance + swipe = sequential, wraps at end |
| Back to Videos from playlist watch | Returns to the playlist detail (feed params in `returnQuery`) |
| Reorder | Drag handle → `setPlaylistOrder` rewrites positions; optimistic UI, revert on error |
| Playlist deleted while watching | Watch page falls back to full approved list (existing stale-link path) |
| Multi-device | Pusher `playlist-changed` → refresh on other devices of same profile |
| Who can mutate | Kid-locked device (`activeProfileId` match) or managing parent session |

## Out of scope / future

- **Parent dashboard playlist management** (PRD's parent-created
  playlists, "pin to playlist") — schema already supports it; only the
  UI is kid-side in v1.
- **⋮ menu / save on the watch page** — would need a route handler (not
  a server action) to avoid revalidation tearing down the YT player.
- Playlist reorder of the playlists *list* itself, custom cover art,
  sharing playlists between profiles, item notes.
- Time limits / scheduling per playlist.

## Verification

1. `npm run typecheck` and `npm run lint` must pass.
2. `npm run db:generate` + `npm run db:migrate`; confirm `playlists` and
   `playlist_items` exist.
3. `npm run dev`, on a kid-locked profile (`/kids/{id}`):
   - Card ⋮ → Save to playlist → New playlist "Cartoons" → toast/check
     shows membership; Playlists tab shows the new playlist.
   - Add 3+ videos across cards; open the playlist; drag rows into a new
     order with the handle (touch AND mouse); refresh — order persists.
   - Play-all → auto-advance follows playlist order (not unwatched-first);
     "Back to Videos" returns to the playlist view.
   - From the parent dashboard, unpin a playlist video → it disappears
     from the playlist; re-pin → it returns at its old position.
   - Second device/incognito on the same profile → playlists are shared;
     Pusher refresh propagates changes.
   - No-session, mismatched `activeProfileId` device → playlist actions
     throw / no-op.
   - Delete a playlist → items cascade; watching that playlist's video
     falls back to the full approved list.
