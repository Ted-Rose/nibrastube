# Review: Public song catalog & import pipeline

## Summary

The unit is in good health overall: the public surface leaks no
`importedBy` (explicit `toFeedSong` projection), all five feed queries
AND the MFK + 18+ visibility predicates, `deleteSong` re-verifies
ownership server-side, and the player overlay reproduces the watch
page's segment/snapback discipline faithfully. The real gaps are at
the seams: kid-scoped sessions are misclassified as signed-in parents
on `/songs`, the embeddable flag is never gated (unplayable
compilations import and list fine), `?song=` survives search
navigation and desyncs the queue, and the import's
delete-stale-then-upsert is not atomic. The parser has two real edge
bugs (out-of-order start-only lines silently drop songs; bare
`start - end` lines mint phantom "timestamp" titles).

## Strengths

- **Field-level leak prevention is done right.** `feedSongCols`
  (lib/songs-feed.ts:144-155) selects `importedBy` for server-side
  stamping, then `toFeedSong` (:160-173) enumerates outgoing fields
  explicitly — `canDelete` resolves `importedBy === viewerId` and the
  user id itself never reaches props. `SongQueueEntry` (:123-132) is a
  `Pick` of the already-safe `FeedSong`.
- **"mine" fails closed at the DB layer.** lib/songs-feed.ts:238-243 —
  a missing `importedByUserId` becomes a nil-uuid `eq` predicate
  (valid literal, zero rows) instead of a dropped filter.
- **Delete is doubly verified.** app/actions/songs.ts:365-384 —
  `parentSession` + `requireParentUnlocked` + zod uuid, then
  `song.importedBy !== user.id` re-check, with one identical error for
  missing and foreign rows (no id enumeration). `importedBy: null`
  orphans correctly can't be deleted (:378).
- **Visibility coverage is complete on read.** All five queries AND
  `visibleVideo` (MFK) + `suitableVideo` (18+): `getSongs` :230-232,
  `getCompilations` :281-284, `getSong` :303, `getNewSongs` :318,
  `getUserSongs` :333. `getOrFetchVideo` refuses both flags on the
  cached AND fresh paths (app/actions/songs.ts:87, 104-110).
- **Overlay auth/auth path hygiene.** `?song=` is UUID-validated and
  silently ignored on miss (app/songs/page.tsx:48-49); `getSong` wraps
  misses as null rather than 404 (song-overlay.tsx:30-34).
- **Player mechanics are thoughtful.** `key={song.id}` remount model
  (song-overlay.tsx:48-56), segment end caught both via ENDED and the
  500 ms PAUSED/PLAYING-near-end poll (song-player-overlay.tsx:156-181),
  rogue-video snapback via `loadedVideoId`, `advancingRef` guard against
  double-advance, StrictMode-safe mount-node recreation, onReady
  catch-up for mid-init `goTo`, `body.overflow` lock cleanup, and the
  deterministic `closeHref` (shared links can't strand anyone).
- **React `cache` dedup works as designed** — page.tsx passes the same
  `feed` object reference to `FeedContent` and `SongOverlay`, so the
  overlay's queue shares the grid's single DB round trip.
- **Parser covers the documented formats** — range/start-only mixing,
  `[-–—:]` separators, `N.`/`N)` numbering, H:MM:SS, dup-start dedup,
  `end <= start` drops, duration clamp; the `endSeconds = null`
  "play to video end" choice is deliberately more robust than clamping
  (song-timestamps.ts:6-8).

## Issues

1. **med — Kid sessions are treated as signed-in parents on /songs.**
   app/songs/page.tsx:42, 54-58, 68-70, 88-90. `!!session` is true for
   a `role:"kid"` JWT, so a logged-in kid device (which reaches /songs
   via the MusicNotes header link, app/kids/[profileId]/page.tsx:120)
   gets: a "Yours" tab that always renders empty (nil-uuid predicate),
   a "Parent portal" pill that the proxy just bounces back to their
   feed, NO "Videos" back-link (`kidsHref` requires `!session`), and
   no signup banner. The catalog plan only modeled kid-locked devices
   as "cookie, no session" — kid login shipped later. Fix: derive
   `const parent = parentSession(session)` and gate the tab list /
   `signedIn` prop / banner on `parent`; compute `kidsHref` as
   `/kids/${session.profileId}` for kid sessions (else the
   `activeProfileId` cookie path).

2. **med — Non-embeddable videos import and list as playable songs.**
   app/actions/songs.ts:87-110 never checks `embeddable`;
   `mapVideoItem` defaults it `false` (lib/youtube.ts:223), and
   `getVideosBatch` explicitly drops non-embeddable rows (:586-588) —
   but `getVideoDetails` doesn't, so the import path ingests
   `embeddable:false` videos. Their songs display in every catalog
   query (no `videos.embeddable` predicate anywhere in
   lib/songs-feed.ts) but can never play in the IFrame player — and
   per issue 4 the queue then stalls on the error frame. Fix: refuse
   `details.embeddable !== true` (and `existing.embeddable === false`
   on the cached path) in `getOrFetchVideo`; optionally add
   `videos.embeddable IS DISTINCT FROM false` to the five feed queries
   for defense in depth.

3. **med — Searching while the overlay plays desyncs or kills the
   player.** lib/songs-feed.ts:92-95 documents "?song= is not a feed
   param, so tab/sort/search navigation closes the overlay" — but
   `KidsSearch.navigate` (components/kids-search.tsx:77-84) rebuilds
   the URL from ALL live `searchParams` and only touches `q`, so
   `song=` survives. The server then renders `SongOverlay` with the
   same `key` (no remount) but a NEW `queue`: the effect re-runs,
   destroys the player, and recreates it at `queue[indexRef.current]`
   — either a different song than the ?song= URL shows (URL lies) or,
   when the filtered queue is shorter than the stale index, no player
   at all (black frame until Escape). Fix: strip `song` in the search
   navigation — e.g. a `dropParams`/param-blocklist prop on
   `KidsSearch` supplied by `CatalogHeader` ("song"), keeping the
   component generic for the kids portal.

4. **med — No `onError` handler: an unplayable queue entry dead-ends
   auto-advance.** components/song-player-overlay.tsx:121-146 — the
   poll (:170-180) only advances on PAUSED/PLAYING near `end`; a
   YT-deleted / embed-blocked / region-locked video sits in an error
   state forever (state is neither, `loadedId` may still match) and
   the whole queue stalls on a black frame. Fix: add
   `onError: () => finishSong()` to the events map so bad entries are
   skipped (queue end still closes).

5. **med — Out-of-order start-only lines lose songs and produce wrong
   bounds.** lib/song-timestamps.ts:82-90 fills `endSeconds` from the
   NEXT LINE IN FILE ORDER before sorting by `startSeconds`. Verified:
   `parseTracklist("4:12 B\n0:00 A\n9:00 C", 1000)` fills B's end with
   A's start (0) → B is filtered out and A wrongly runs 0→540 instead
   of 0→252; `"0:00 - 4:00 A\n9:00 C\n4:00 - 9:00 B"` drops C entirely
   (end 240 < start 540). Range lines survive unordered input (the
   test proves that), so the asymmetry is invisible until a commenter
   lists tracks out of order. Fix: sort `lines` by `startSeconds`
   BEFORE the end-fill pass, then fill from the next sorted entry.

6. **low — Bare `start - end` lines mint phantom songs titled with
   the end timestamp.** `RANGE_LINE` needs a title after the second
   timestamp, so `"5:00 - 9:00"` falls through to `START_LINE`, whose
   `(.+)` captures "9:00" as the title (cleanTitle's
   `^\d{1,3}\s*[.)]` strip doesn't match a colon). Verified:
   `"0:00 A\n5:00 - 9:00\n10:00 B"` → a song literally named "9:00".
   Fix: in `cleanTitle`/the caller, reject a captured title that is
   itself a full `TS` match (e.g. `^\d{1,3}:\d{2}(:\d{2})?$`).

7. **low — Import delete+upsert is not atomic.**
   app/actions/songs.ts:314-346 — the stale-row DELETE and the
   upsert run as two statements with no transaction; a failure between
   them (pool drop, constraint error) permanently removes the previous
   import's rows until someone re-imports. Concurrent imports of the
   same video can't corrupt identity (deletes are
   `sourceCommentId`-scoped, upserts resolve on
   `(videoId, startSeconds)`), so the exposure is a crash window, not
   a race. Fix: wrap both in `db.transaction(async (tx) => …)` —
   pg transactions are fine over Neon's PgBouncer since drizzle holds
   one pooled connection for the block.

8. **low — Reposted comments leave orphaned song rows forever.**
   Re-import identity is `sourceCommentId`
   (app/actions/songs.ts:314-322): when the commenter deletes and
   reposts their tracklist (new comment id), the delete predicate only
   matches the NEW id, so old-id rows at non-shared `startSeconds`
   linger in the catalog — invisible at the source, still listed and
   playable. Rows at shared starts get adopted by the upsert's
   `importedBy`/`sourceCommentId` overwrite (:337-345), which is the
   intended merge. Fix: scope the stale-delete to the video+importer
   rather than the comment (`videoId` + `importedBy` + `notInArray`),
   or add a follow-up GC that drops `songs` rows whose
   `sourceCommentId` no longer appears in the video's comments.

9. **low — `deleteSong` has a check-then-delete TOCTOU.**
   app/actions/songs.ts:373-382 — a concurrent import whose upsert
   flips `importedBy` between the `findFirst` and the `delete` lets
   the previous owner delete a row they no longer own (tiny window,
   same-family impact). Fix: fold ownership into the mutation —
   `db.delete(songs).where(and(eq(songs.id, id),
   eq(songs.importedBy, user.id)))` — and error on `rowCount === 0`;
   keeps the uniform-error property and drops a round trip.

10. **low — `db.insert(videos)` in `getOrFetchVideo` isn't
    conflict-safe.** app/actions/songs.ts:113-118 — two concurrent
    imports of the same uncached video race `insert` on the same PK;
    the loser throws a unique-violation 500 instead of importing. Fix:
    `.onConflictDoNothing()` (or reuse `videoCache.upsert`-style
    `onConflictDoUpdate` like channels.ts:48).

11. **low — Song-import form nits.**
    components/song-import-form.tsx — (a) re-saving the SAME handle
    leaves the editor open: `editingHandle === handle` stays true when
    `saved.saved === handle` (:30-34); fix by clearing
    `editingHandle` on a "saved" result (effect on `saved`). (b) A
    stale `importResult` error renders alongside a fresh successful
    preview (:38-41 combines both states); clear one state when the
    other resolves, or key them to the same submission.

12. **low — `next` uses the unclamped index while `current` clamps.**
    components/song-player-overlay.tsx:210-212 — `queue[Math.min(index,
    len-1)]` vs `queue[index + 1]`; if a queue shrink ever leaves
    `index` past the end (can't happen today — only remounts change
    identity — but issue 3 makes prop-driven queue changes live), the
    header shows the clamped song with a wrong/absent "Up next". Use
    the same clamped position for both.

13. **low — Assorted cosmetic edges.** `ilike` patterns take raw `q`,
    so `%`/`_` in a search act as wildcards (lib/songs-feed.ts:244-249)
    — same posture as kids-feed presumably; escape if undesired.
    `getCompilations` orders `asc(videos.title)` (:293) — Postgres
    sorts case-sensitively, so lowercase titles fall after Z;
    `asc(sql`lower(${videos.title})`)` if that matters. `cleanTitle`'s
    leading-separator strip omits `.`/`·` mid-dot variants
    (song-timestamps.ts:39) — "0:00. Intro" keeps a leading dot.
    Comment-length `authorDisplayName` fallback (:173) compares to a
    lowercased display name — fine, but a commenter who renamed their
    handle after posting is invisible; known v1 limitation class.

## Refactor suggestions

1. **Centralize the session-tier check for /songs.** Compute
   `parent = parentSession(session)` once in `page.tsx` and pass
   `signedIn={!!parent}` / `userId` / `kidsHref` (kid session →
   `/kids/${session.profileId}`) from that single source, instead of
   mixing `!!session` and `parentSession()` — prevents the kid-tier
   drift in issue 1 from recurring when a fourth tier appears.
2. **Add `songs`-route awareness to `KidsSearch` minimally.** A
   `stripParams?: string[]` prop (`["song"]` from `CatalogHeader`)
   keeps the shared component route-agnostic while restoring the
   documented "search closes the overlay" behavior.
3. **Fold `videos.embeddable` into the shared visibility fragment.**
   Extend `visibleVideo` in lib/songs-feed.ts (or a sibling export in
   `lib/video-suitability.ts`) to include `embeddable IS DISTINCT FROM
   false`, so all five queries and `getOrFetchVideo` share one
   "playable on an unvetted surface" predicate — currently the flags
   are checked in two places and embeddable in zero.
4. **Reorder `parseTracklist`: sort → fill → dedup → clamp.** Moving
   the sort above the end-fill fixes issue 5 and simplifies reasoning
   (each pass then operates on canonical order); add the two failing
   cases above to `scripts/test-song-parser.ts` as regression checks.
5. **Wrap the import mutation in `db.transaction`** covering the
   videos upsert, stale-song delete, and songs upsert — collapses
   issues 7 and 10 into one atomic block.
6. **Reconcile overlay state on `queue` prop change.** If issue 3 is
   fixed by closing the overlay this is moot; if the product ever
   wants search-while-playing, `SongPlayerOverlay` needs to re-seed
   `indexRef` from the current `?song=` id (or be keyed by the full
   `song.id + queue` pair) rather than trusting the mount-time index.
7. **Retire the `useActionState` triple in the import form** in favor
   of one discriminated `formStep` state (idle → previewing → preview
   → importing) — removes the stale-error bleed (issue 11b) and makes
   the preview/in-flight relationship explicit.
