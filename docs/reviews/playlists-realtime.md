# Review: Playlist domain & Pusher realtime

Files: `app/actions/playlists.ts`, `components/save-to-playlist-dialog.tsx`,
  `components/new-playlist-button.tsx`, `components/playlist-actions-menu.tsx`,
  `components/playlist-sortable-list.tsx`, `components/pusher-listener.tsx`,
  `lib/pusher.ts` (+ `lib/kids-feed.ts`, `lib/profiles.ts`, `lib/db/schema.ts`,
  `app/kids/[profileId]/_components/*` as context)

## Summary

The playlist domain is in good shape: auth is uniformly applied, the
  whitelist/age-floor invariants hold on every write, and the exact-set reorder
  check is a genuinely good integrity design whose "visible set" mirror of
  `getPlaylistVideos` is correct. The realtime half is weaker:
  `getPusherClient` reads a non-public env for the cluster so the browser
   always falls back to `"ap2"` (`.env` says `eu` — realtime is very
   likely dead
  in this deployment), and `lib/pusher.ts` still bundles the Node server SDK
  into client code. The most interesting domain bug is that the filtered
  playlist-detail view offers drag-and-drop that can never succeed against the
  full-set server check.

## Strengths

- **Uniform auth coverage.** Every action in `app/actions/playlists.ts` —
  including the read-only `getVideoPlaylistIds` (line 45) — calls
  `assertCanEditKidData(profileId)` before touching data. `getOwnedPlaylist`
  (lines 26-34) then scopes to `playlist.profileId === profileId` with a single
  "not found" error for missing vs. foreign playlists (no existence oracle).
- **Whitelist invariants upheld.** `addToPlaylist` enforces the pin (lines
  137-143) and the 18+ hard floor (lines 148-154) — the comment correctly
  notes a crafted action call could otherwise add an inert restricted pin.
  `setPlaylistOrder`'s visibility query (lines 237-250) joins `videos` +
  `whitelistedVideos` + `suitableVideo`, exactly mirroring `getPlaylistVideos`
  (`lib/kids-feed.ts:954-994`) minus the q/type/length filters — the mirror
  is right for the unfiltered set.
- **Exact-set reorder check.** Requiring the posted id list to equal the
  visible set (lines 251-257) means a stale client can neither silently drop a
  newly added item nor inject one; failures fail closed with "Playlist changed
  — refresh and try again".
- **Position semantics are coherent.** Removal leaves gaps
  (`removeFromPlaylist`, lines 194-195 comment), reorder compacts to 0..n-1,
  and `getPlaylistVideos` tie-breaks equal positions by `addedAt`
  (kids-feed.ts:992-994), so the concurrent `max(position)+1` race in
  `addToPlaylist` (line 173) degrades to a deterministic order rather than
  corruption.
- **Good client-side patterns.** Optimistic toggle with revert and `busy`
  serialization (save-to-playlist-dialog.tsx:96-117); the `prevRows !== rows`
  resync-during-render idiom in playlist-sortable-list.tsx:156-160 is the
  correct React 19 replacement for a syncing effect; drag is handle-only with
  `PointerSensor` + `KeyboardSensor` + `sortableKeyboardCoordinates` — proper
  touch/scroll behavior and keyboard a11y.
- **Sensible realtime coalescing.** The 1.5s debounced `router.refresh()`
  (pusher-listener.tsx:17-24) collapses channel-backfill event bursts into one
  refetch — exactly right for the sync storm described in AGENTS.md.
- **Dynamic `pusher` import in actions** (`await import("@/lib/pusher")`,
  playlists.ts:37) follows the documented convention and keeps the server SDK
  out of the action's module graph; `useTLS: true` on the server client.
- Dedup-friendly writes: duplicate adds no-op via the `(playlistId, videoId)`
  PK + `onConflictDoNothing` (line 175); playlist delete relies on `onDelete:
  "cascade"` (schema.ts:268).

## Issues

1. **high — `lib/pusher.ts:14`: client cluster always resolves to `"ap2"`,
   ignoring real config.** `getPusherClient` reads
   `process.env.PUSHER_CLUSTER`, which is not `NEXT_PUBLIC_`-prefixed, so it is
   always `undefined` in the browser bundle and the `|| "ap2"` fallback always
   wins. `.env` sets `PUSHER_CLUSTER=eu`, so the client builds a
   `ws-ap2.pusher.com` connection for an app that lives in `eu`
   — subscriptions
   fail and realtime is silently dead (only the hardcoded key would pair with
   ap2, which is a *different* Pusher app). Fix: read
   `NEXT_PUBLIC_PUSHER_CLUSTER` (add it to `.env`/README), and remove the
   `"ap2"` fallback — fail fast instead of connecting to the wrong cluster.

2. **med — `lib/pusher.ts:1-10` + `components/pusher-listener.tsx:5`: server
   Pusher SDK bundled into client code.** The `"use client"` listener
   statically imports `getPusherClient` from a module that top-level `import
   PusherServer from "pusher"` and instantiates `new PusherServer({ secret:
   process.env.PUSHER_SECRET! })` at module scope. The secret *value* doesn't
   ship (non-public envs aren't inlined), but the whole Node `pusher` package
   becomes dead weight in every kid's browser bundle, and whether the
   constructor tolerates all-`undefined` config at client module-eval time is
   luck, not contract — a bundler/SDK change could turn this into a
   page-breaking throw inside a module evaluated on mount. Already flagged in
   `docs/reviews/architecture.md` (issue 1) and still unfixed. Fix: split into
   `lib/pusher-server.ts` (`import "server-only"`; `pusherServer`) and
   `lib/pusher-client.ts` (`getPusherClient`); update the five `await
   import("@/lib/pusher")` call sites (playlists.ts:37, pinning.ts:93/136,
   channels.ts:190, refresh.ts:43, channel-sync.ts:111,
   video-reactions/route.ts:82) to the server module.

3. **med — filtered playlist view offers drag that can never succeed.**
   `playlists-view.tsx:27-33` passes `q`, `type`, `minLen`, `maxLen` into
   `getPlaylistVideos`, so `rows` can be a strict subset of the visible set,
   while `setPlaylistOrder` demands the posted ids equal the *full* visible set
   (playlists.ts:252-257). `PlaylistDetailView` renders
   `KidsTypeFilter`/`KidsLengthFilter` and the search box above the same
   `PlaylistSortableList` (playlist-detail-view.tsx:73-74, 117-122) with
   handles fully active. Any reorder under an active filter posts a subset →
   always throws → silent snap-back (see issue 6). Fix: pass a
   `sortable` flag
   — `rows` unfiltered iff `!feed.q && feed.type === "all" && feed.minLen ===
   null && feed.maxLen === null` — and disable/hide the drag handles (or grey
   them with a "clear filters to reorder" hint) when filtered.

4. **med — `playlists.ts:36-40`: unguarded `await pusherServer.trigger` after
   the commit.** `notifyPlaylistChanged` awaits the trigger; if Pusher is
   down/slow, the action throws *after* the DB write committed → the client
   shows "Couldn't save" and reverts optimistic state for an actually-persisted
   change (in `createAndAdd`, a retry then creates a duplicate playlist). Same
   systemic pattern at pinning.ts:94/137, channels.ts:191, refresh.ts:44,
   channel-sync.ts:112, video-reactions/route.ts:83. Fix: wrap the trigger in
   try/catch (`console.warn` on failure — realtime is best-effort since
   `revalidatePath` already covers the acting client), ideally via a shared
   `notifyProfile(profileId, event, payload)` helper.

5. **med — `pusher-listener.tsx:11,33`: WebSocket leaked on every remount.**
   `getPusherClient()` constructs a *new* `PusherClient` (new socket) inside
   the effect; cleanup calls `pusher.unsubscribe(...)` but never
   `pusher.disconnect()`, so the connection outlives the component (React
   strict-mode double-mount in dev, or navigating away/back). Fix:
   `pusher.disconnect()` in cleanup after unsubscribe, or hoist a module-level
   singleton client and only subscribe/unsubscribe per profile.

6. **low — `playlist-sortable-list.tsx:184`: reorder failure is swallowed.**
   `.catch(() => setItems(prev))` reverts silently — no toast/hint — so the
   server's "Playlist changed" message never reaches the user; combined with
   issue 3 the row just jumps back with no explanation. Surface at least a
   transient "Couldn't reorder — list refreshed" state (and call
   `router.refresh()` on failure so the truth resyncs immediately rather than
   waiting for the next render).

7. **low — `profileId` is never schema-validated in the actions.**
   `playlistId`/`videoId` get zod checks but `profileId` goes straight into
   `eq(...)` on uuid columns (e.g. playlists.ts:72, 140, 249). The
   `activeProfileId` cookie is forgeable by design (acknowledged at
   profiles.ts:46-47 and auth.ts:117-118), so a request with cookie
   `activeProfileId=foo` + `profileId=foo` passes `assertCanEditKidData` and
   dies in Postgres with `invalid input syntax for type uuid` — a noisy 500
   instead of a clean error. Fix: `z.uuid().safeParse(profileId)` per action,
   or once inside `assertCanEditKidData`.

8. **low — concurrent-add and reorder races are benign but unguarded.**
   `addToPlaylist` computes `max(position)+1` outside any transaction (lines
   156-173): two concurrent adds can land on the same position (handled today
   by the `addedAt` tiebreak + next-reorder compaction). More subtly,
   `setPlaylistOrder`'s equality check (line 237) runs *before* its update
   transaction (line 259): a racing `addToPlaylist` can insert at a stale
   `max+1` that collides with a just-reassigned compact position, and a racing
   `removeFromPlaylist` turns an update into a silent no-op leaving a gap. All
   outcomes are safe (deterministic order, self-healing), but the airtight
   version is cheap: `SELECT ... FOR UPDATE` on the `playlists` row (or
   `pg_advisory_xact_lock(hashtext(playlistId))`) inside the transaction, then
   re-run the set check and the updates within it; that also serializes adds if
   `addToPlaylist` takes the same lock.

9. **low — hidden rows keep stale positions that can collide with the compact
   range.** Reorder writes 0..n-1 over *visible* items only;
   unpinned/restricted rows keep their old positions (comment at
   playlists.ts:210). On re-pin, a hidden row can resurface at a position that
   now belongs to another item — deterministic via the `addedAt` tiebreak,
   but the kid-visible order can jump around until the next reorder. Either
   accept-and-document (the schema comment `// compact 0..n-1` at schema.ts:273
   is now only true for the visible subset) or normalize hidden rows to
   `position = n + index` in the same transaction.

10. **low — `createAndAdd` partial failure + stale count**
    (`save-to-playlist-dialog.tsx:119-144`). If `createPlaylist` succeeds but
    `addToPlaylist` throws, the catch reports "Couldn't create" for a playlist
    that exists — retry duplicates it. Also the `extra` entry is pushed with
    `videoCount: 0` (line 131) though the video is added a line later —
    cosmetic until revalidation lands. Fix: split the try/catch (on add
    failure, keep the extra entry but show "Created, but couldn't add the
    video"), and set `videoCount: 1` after a successful add.

11. **low — caps are soft and count hidden rows.**
    `MAX_PLAYLISTS`/`MAX_ITEMS`
    are check-then-insert (lines 69-75, 156-165): two concurrent creates/adds
    can each pass the count check and exceed the cap by one. `MAX_ITEMS` also
    counts *all* `playlist_items` rows including unpinned-hidden ones, so a
    playlist with 500 hidden items rejects adds despite showing 0. Both are
    acceptable defense-in-depth limits; if precision matters, gate the count on
    the same visible-set join or add the item-count check inside the ordering
    lock from issue 8.

12. **low — event model notes (sufficient today, worth recording).** Public
    `profile-<uuid>` channels mean anyone who learns a profile UUID can
    subscribe and observe pin/unpin/playlist activity in realtime; payloads
    carry `{videoId}` (pinning.ts:94) — YouTube IDs only, low sensitivity
    — and
    `playlist-changed` sends `{}` while the listener ignores payloads entirely
    and just schedules `router.refresh()`. That coarse-refresh model is
    *sufficient and appropriate* for this app (one profile page, cheap
    refetch), but the payloads are currently dead bytes — either use them for
    targeted invalidation later or drop them; consider `private-` channels + an
    auth endpoint only if payloads ever carry sensitive data. Also note
    `PusherListener` mounts only on the feed page
    (`app/kids/[profileId]/page.tsx:95`), not the watch page — intentional,
    since the watch queue is built at load.

## Refactor suggestions (ordered)

1. **Split `lib/pusher.ts`** into `lib/pusher-server.ts` (`import
   "server-only"`, `pusherServer`) and `lib/pusher-client.ts`
   (`getPusherClient`); switch the client to `NEXT_PUBLIC_PUSHER_CLUSTER` and a
   `NEXT_PUBLIC_PUSHER_KEY` fail-fast (delete the `"34c7db220ff83d26d348"` /
   `"ap2"` fallbacks — they mask misconfiguration by pointing at the upstream
   author's app). Fixes issues 1+2.
2. **Extract `notifyProfile(profileId, event, payload)`** into
   `lib/pusher-server.ts` with a try/catch around `trigger`, and route all six
   call sites through it. Fixes issue 4 everywhere at once.
3. **Gate reordering on the unfiltered view** (`sortable` prop / disabled
   handles + hint) and surface reorder failures (issue 6) — together they
   remove the only user-visible dead-end in the domain.
4. **`pusher.disconnect()` in the listener cleanup** (issue 5) — one line.
5. **Validate `profileId` as uuid in `assertCanEditKidData`** (issue 7) — one
   check fixes every current and future kid-scope action.
6. **Serialize playlist mutations per playlist** — advisory lock or `FOR
   UPDATE` on the `playlists` row inside `setPlaylistOrder`/`addToPlaylist`,
   re-checking the set inside the transaction; while there, replace the N
   sequential UPDATEs (playlists.ts:259-271) with one `UPDATE playlist_items
   SET position = v.pos FROM (VALUES ...) v(video_id, pos) WHERE ...`. Fixes
   issues 8+9 and is O(1) round-trips.
7. **Tidy `createAndAdd`** (issue 10): separate try/catch for create vs. add,
   set `videoCount: 1` on success.
8. **Decide on event payloads**: either wire `videoId` into targeted refetches
   (e.g. `router.refresh()` only when the event touches the visible view) or
   send empty payloads consistently — currently only pin/unpin/reaction carry
   data the listener ignores.
