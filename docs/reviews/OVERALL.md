# NibrasTube — Consolidated Code Review

Consolidates the ten unit reviews in `docs/reviews/` into one
deduplicated, severity-ranked issue list for the refactoring plan.
Where reports disagreed on severity the reconciliation is noted.

## Executive summary

**Overall health: ~7.5/10 — strong architecture, one live break.**

The codebase is unusually disciplined: the whitelist + 18+ floor is
enforced from a single SQL fragment ANDed into every kid-facing
query, session claims are a narrowed union with fail-closed decrypt,
and comments document nearly every non-obvious invariant, race, and
quota cost. The real problems are concentrated: realtime is broken
in production by a non-public env var, the kid-write auth gate
exists in three diverging copies, there are zero error boundaries
and zero secondary indexes, and a handful of sync/tombstone edges
silently undo user intent. Everything else is polish-level debt.

### Report inventory

| Unit                   | Health | Top finding                          |
|------------------------|--------|--------------------------------------|
| architecture           | ~8/10  | Node Pusher SDK bundled into client  |
| auth-session-routing   | good   | Deleted-profile kid redirect ping-pong |
| auth-flows-gates       | good   | Invite link undeliverable (dead feature) |
| parent-portal          | good   | Unpin tombstones miss manual pins    |
| kids-portal-feed       | good   | Stale in-flight page pollutes feed   |
| watch-playback-apis    | ~8/10  | Unplayable video deadlocks autoplay  |
| playlists-realtime     | mixed  | PUSHER_CLUSTER non-public, realtime dead |
| songs-domain           | good   | Kid session misclassified on /songs  |
| youtube-sync           | good   | Unauth sync route; getVideoDetails crash |
| db-platform-shell      | good   | Zero secondary indexes               |

## Cross-cutting themes

1. **Realtime is misconfigured and mis-bundled** (playlists-realtime,
   architecture) — **high**. `getPusherClient` reads non-public
   `PUSHER_CLUSTER` so the browser always falls back to `"ap2"` while
   the app lives in `eu` — verified against `lib/pusher.ts:14` and
   `.env`: subscriptions can never succeed. The same module
   instantiates the Node `pusher` server SDK at module scope, so the
   whole package ships to every kid's browser as dead weight, and
   awaited `pusher.trigger` calls after DB commits turn realtime
   outages into false "Couldn't save" errors. One bad file, three
   distinct failure modes.
2. **Auth/access guard drift** (architecture, auth-session-routing,
   watch-playback-apis, parent-portal) — **med, trending high**.
   The `isKidSession → activeProfileId → assertCanManageProfile`
   chain exists in three copies with different semantics (the API
   routes skip the profile-existence re-check `assertCanEditKidData`
   performs); `assertDashboardReader` is re-implemented inline; the
   `!session` vs `role !== "parent"` preamble is inconsistent; and
   the `/parent/*` PIN gate has no server-side backstop outside
   `proxy.ts`. Security gates that exist in N copies drift.
3. **Missing error surfaces & boundaries** (architecture,
   parent-portal, watch-playback-apis) — **med**. Zero
   `error.tsx`/`not-found.tsx`/`global-error.tsx` anywhere: a Neon
   hiccup, quota-exhausted page-1 search, or thrown action renders
   Next's stock error screen on a kid device, while page-N infinite
   scroll gets graceful retry UI. `profileExists` DB errors propagate
   through proxy and 500 every matched navigation.
4. **Unvalidated input → Postgres 500s** (architecture,
   playlists-realtime, auth-flows) — **med** (two reports said low;
   reconciled up — it's pervasive but centrally fixable). Most
   actions feed raw `profileId`/args into `eq()` on uuid columns
   before shape-checking → `invalid input syntax` 500s; FormData
   entries are cast to string and `.trim()`ed before zod sees them
   (a `File` value throws).
5. **Sync/tombstone correctness edges** (parent-portal, youtube-sync)
   — **med**. Tombstones only cover `viaChannelId` pins, so manually
   pinned videos on approved channels resurrect after unpin;
   re-approving a channel re-backfills from page 1; `pollChannel`
   permanently misses uploads past its 5-page window; tombstoned
   videos don't count as known-stop markers; `isQuotaError` can
   itself throw and misses `dailyLimitExceeded`. Small holes that
   silently undo parent intent or waste quota.
6. **Duplicated logic & oversized files** (architecture,
   parent-portal, watch-playback-apis, kids-portal-feed) — **med**.
   822-line dashboard god-page; ~800-line `watch-experience`
   mega-effect with ~15 refs; three copies of the YouTube player
   lifecycle; ~90%-duplicated token-pager components; duplicated
   uploads-hydration and flag-lookup queries.
7. **Unbounded growth / missing indexes** (db-platform-shell,
   kids-portal-feed, watch-playback-apis) — **med**. Zero secondary
   indexes: hot filters (`videos.channel_id`,
   `whitelisted_videos.via_channel_id`, `watch_history` date+sort,
   `songs.imported_by`, `playlists.profile_id`) and every
   trailing-column FK cascade seq-scan. `getWatchHistory`, the
   watch-queue serialization (~2k rows → ~300 KB props), and page-1
   pin/channel flag lookups are all unbounded.
8. **Incomplete or dead features** (auth-flows, db-platform,
   architecture) — **med**. The invite link is never delivered
   (feature unreachable); `shared_access.role`, `invites.email`,
   `invites.status:"rejected"` are dead columns; `KidClaims.name` is
   a dead claim; the theme provider forces light while `dark:`
   classes rot.
9. **Player lifecycle fragility** (watch-playback-apis, songs-domain,
   architecture) — **med**. No `onError` handler anywhere: an
   unplayable entry deadlocks autoplay AND swipe nav on the watch
   page and stalls the song queue on a black frame. A failed
   `iframe_api` load is a permanent black box.

## Master issue list

### High

1. **Pusher client cluster env is non-public — realtime is dead** —
   `lib/pusher.ts:14` reads `process.env.PUSHER_CLUSTER` (always
   undefined in the browser) → falls back to `"ap2"`; the app is in
   `eu`. Also hardcoded fallback key `"34c7db220ff83d26d348"`.
   Reports: playlists-realtime #1 (verified against `.env`).
   Fix: `NEXT_PUBLIC_PUSHER_CLUSTER`; delete both fallbacks.

### Medium

2. **Node `pusher` SDK bundled into client code** — `lib/pusher.ts:1-10`
   instantiates `pusherServer` at module scope; `"use client"`
   `components/pusher-listener.tsx:5` imports the same module.
   Reports: architecture #1, playlists-realtime #2.
   Fix: split `lib/pusher-server.ts` (`import "server-only"`) /
   `lib/pusher-client.ts`; repoint six `await import` call sites.
3. **`/api/sync-channels` is an unauthenticated mutating endpoint** —
   `app/api/sync-channels/route.ts:39-46` GET+POST, no auth; matcher
   excludes `/api/*`. A crawler burns the daily quota slot.
   Reports: architecture #2, youtube-sync #2.
   Fix: session check for POST; `CRON_SECRET` bearer (or drop) GET.
4. **Kid-write auth guard exists in three divergent copies** —
   `app/api/watch-progress/route.ts:34-47`,
   `app/api/video-reactions/route.ts:30-43` copy the chain;
   `lib/profiles.ts:49-68` re-implements it (adds existence check,
   `redirect()`s — a 307 HTML to a beacon, not JSON 403).
   Reports: architecture #3, auth-session-routing #3,
   watch-playback-apis #3.
   Fix: one `kidWriteGate(profileId)`/`assertKidWriteAccess` core
   shared by routes (returns `NextResponse | null`) and actions.
5. **Redirect ping-pong for deleted-profile kid sessions** —
   `profileExistsCache` (`proxy.ts:24-42`) holds stale `exists:true`
   ≤60 s; page's uncached `canViewProfile` → `redirect("/kids")` →
   proxy bounces back → ~2 navs/round-trip until TTL expiry.
   Comments at `proxy.ts:53-56` claim this can't happen.
   Report: auth-session-routing #1.
   Fix: `notFound()` (not redirect) when `canViewProfile` fails under
   a kid session; or share the TTL entry between proxy and page.
6. **No server-side PIN-unlock backstop on `/parent/*` reads** —
   `app/parent/layout.tsx:10-11` checks `parentSession` only;
   `proxy.ts:150-156` is the sole unlock enforcement for page loads.
   Report: auth-session-routing #2.
   Fix: add `isParentUnlockedCookie` check → `redirect("/kids?gate=1")`
   in the parent layout.
7. **`unpinVideo` tombstone gaps — unpins silently resurrect** —
   `app/actions/pinning.ts:110-133` only tombstones when
   `viaChannelId` was set (manual pins on approved channels get
   re-added by next `pollChannel`), and the read-then-delete window
   can drop a tombstone for a concurrent sync insert.
   Reports: parent-portal #1, #6.
   Fix: `DELETE … RETURNING via_channel_id`; tombstone whenever
   `videos.channelId` is an approved channel for the profile.
8. **Re-approving an approved channel re-backfills from page 1** —
   `app/actions/channels.ts:63-91` calls `backfillChannel`
   unconditionally; `backfillPageToken` is null post-completion so
   the whole uploads playlist re-scans and "Syncing…" resurrects.
   Report: parent-portal #2.
   Fix: skip backfill in `after()` when `backfillComplete` is true.
9. **No error boundaries; first-page YouTube failures unhandled** —
   zero `error.tsx`/`not-found.tsx` files; `SearchResults`
   (`app/parent/dashboard/page.tsx:467-483`), `approveChannel`'s
   throw, `refreshVideoIds` throws all propagate to the stock screen.
   `profileExists` DB errors 500 every navigation (`proxy.ts:33-36`).
   Reports: architecture #8, parent-portal #3,
   auth-session-routing #11.
   Fix: root `error.tsx`/`not-found.tsx` with kid-safe chrome +
   `app/parent/dashboard/error.tsx`; catch in `profileExists`.
10. **`getVideoDetails` crashes on dead/missing video ids** —
    `lib/youtube.ts:345-346` does `items[0]` unguarded → TypeError;
    `pinVideo` (`pinning.ts:40`) doesn't catch → opaque 500.
    `getChannelDetails` returns `null` for the same case.
    Reports: parent-portal #4, youtube-sync #1.
    Fix: return `FullVideoDetails | null`; friendly error in pinVideo.
11. **`embeddable` is never gated on ingest paths** — `getVideoDetails`
    doesn't filter `embeddable:false` (unlike `getVideosBatch`), so
    `pinVideo` and `getOrFetchVideo` (`app/actions/songs.ts:87-110`)
    store unplayable pins/songs that list fine and can never play —
    and per #19 the queue then stalls.
    Reports: parent-portal #4, songs-domain #2.
    Fix: refuse `embeddable !== true` on both paths; optionally add
    `embeddable IS DISTINCT FROM false` to visibility fragments.
12. **Invite flow is broken/dead in three ways** — (a) `inviteParent`
    only `console.log`s the link and the UI renders no copyable URL
    (`invites.ts:29-31`, `profiles/page.tsx:107-112`) — feature
    unreachable; (b) `assertCanManageProfile` lets a shared-access
    *editor* mint invites for the owner's profile; (c) `email` is
    unvalidated and never bound at `acceptInvite`.
    Reports: auth-flows #1/#5/#6, parent-portal #5, architecture #12.
    Reconciled med (architecture had it in a low bundle) — the flow
    is dead, not cosmetic.
    Fix: return `{ url }` and render a copyable link; require
    `profile.parentId === user.id`; `normalizeIdentifier` + optional
    email binding; expiry-aware pending UI.
13. **Brute-force throttling defeated by concurrency** — flat 500 ms
    sleep (`auth.ts:188`, `safety.ts:52`), no attempt counter: N
    parallel calls try N candidates; 4-digit PIN / short kid
    passwords enumerable in minutes.
    Report: auth-flows #2.
    Fix: `failedAttempts`/`lockedUntil` on `users` + `profiles`.
14. **Unvalidated uuid/FormData inputs reach Postgres → 500s** —
    most actions run `eq(profiles.id, profileId)` before shape
    checks; `(formData.get(k) as string).trim()` throws on `File`;
    `acceptInvite`/`createInviteAction` pass raw values to uuid eq()s.
    Refs: `pinning.ts`, `channels.ts`, `playlists.ts:72,140,249`,
    `auth.ts:132`, `profiles.ts:45`, `invites.ts:37-53`.
    Reports: architecture #9 (med), playlists-realtime #7 (low),
    auth-flows #10 (low) — reconciled med: pervasive, one central fix.
    Fix: `z.uuid()` inside `assertCanManageProfile`/
    `assertCanEditKidData` + a shared `getString(formData, key)`.
15. **Four inconsistent server-action error contracts** — `void` +
    `console.log` (pinning/channels), `throw` (playlists), `{ error }`
    (profiles/songs/auth), throw for reads. Debug `console.log`s at
    `pinning.ts:24,29,103,108`, `invites.ts:31`.
    Reports: architecture #4, auth-flows #12.
    Fix: pick one contract for form actions; strip debug logs.
16. **Dashboard page is an 822-line god-page** —
    `app/parent/dashboard/page.tsx` hosts four private async
    sub-components + `dashboardUrl`, violating the repo's own
    `_components/` convention.
    Reports: architecture #5, parent-portal (refactor #1).
    Fix: extract `PinnedVideosCard`, `ApprovedChannelsCard`,
    `SongImportCard`, `SearchResults` into `_components/`.
17. **Dashboard hydration + reader-gate duplication** —
    `channel-videos.ts:44-91` ≈ `channel-detail.tsx:102-160`
    (resolve→uploads→batch→upsert→pinned-lookup);
    `assertDashboardReader`
    (`search.ts:42-49`) copied inline at `channel-videos.ts:37-42`;
    five copies of the pinned/approved flag queries.
    Reports: architecture #6, parent-portal refactor #2-4.
    Fix: extract `hydrateUploadsPage`, `getPinnedVideoIds`/
    `getApprovedChannelIds`, export `assertDashboardReader`.
18. **`watch-experience.tsx` is the fragility hotspot** — ~800 lines;
    one ~340-line effect over ~15 refs; player torn down/rebuilt on
    `playlist` identity change; three components re-implement
    `ensureYouTubeAPI → onReady-ref → tick`.
    Reports: architecture #7, watch-playback-apis refactor #1.
    Fix: extract `useYouTubePlayer`, `useProgressFlush`, `useNavStack`;
    stabilize playlist prop via a content signature.
19. **No `onError` handler — unplayable videos deadlock nav** —
    `advancingRef` only releases on PLAYING (`watch-experience.tsx:
    276-373`); a whitelisted-but-unplayable video never emits it →
    autoplay stalls and swipe/confirm-nav are blocked; same stall in
    `song-player-overlay.tsx:121-146`.
    Reports: watch-playback-apis #1, songs-domain #4.
    Fix: `events.onError` → mark-skip + advance; optionally a ~15 s
    watchdog releasing `advancingRef`.
20. **For-You/Shorts watch queue silently caps at 60 rows** —
    `getRecommendedVideos` default `limit=60`
    (`lib/kids-feed.ts:615`); cards tapped deeper rebuild the
    all-videos queue → deep Short autoplay-advances into long-form.
    Report: watch-playback-apis #2.
    Fix: rebuild with larger limit (ranking is day-stable) or carry
    the card offset in the watch href.
21. **`KidsVideoGrid` stale in-flight page pollutes refreshed feed** —
    `kids-video-grid.tsx:60-79`: a `loadMore` resolving after
    `router.refresh()`/navigation appends old-filter rows to the new
    feed and corrupts `offset`; a stale `.catch` wrongly exhausts.
    Report: kids-portal-feed #1.
    Fix: generation counter/ref; drop resolutions from stale gens.
22. **`getWatchHistory` is unbounded** — `lib/kids-feed.ts:509-567`
    returns every (video, day) row ever; History view + watch-page
    `view=history` queue pull the whole set per render.
    Report: kids-portal-feed #2.
    Fix: LIMIT or rolling N-day window (date picker covers deep past).
23. **For-You ranking query runs twice per home render** —
    `home-shelves.tsx:42-59` runs `getRecommendedVideos` for Picked
    and Shorts — 2 copies of the heaviest query on a 3-conn pool.
    Report: kids-portal-feed #3.
    Fix: hoist shared CTEs/ranking into a subquery both lists reuse.
24. **Filtered playlist view offers drag that can never succeed** —
    `playlists-view.tsx:27-33` passes filters to `getPlaylistVideos`;
    `setPlaylistOrder` demands the *full* visible set → every
    filtered reorder throws and snaps back silently.
    Reports: playlists-realtime #3, #6.
    Fix: `sortable` flag gated on no-active-filters; disable handles
    + "clear filters to reorder" hint; surface reorder failures.
25. **Awaited `pusher.trigger` after commit → false failures** —
    `playlists.ts:36-40` (+ same pattern at `pinning.ts:94/137`,
    `channels.ts:191`, `refresh.ts:44`, `channel-sync.ts:112`,
    `video-reactions/route.ts:83`): Pusher down/slow → action throws
    *after* the write → client reverts a persisted change.
    Report: playlists-realtime #4.
    Fix: shared `notifyProfile()` helper with try/catch around
    `trigger` (realtime is best-effort; `revalidatePath` covers self).
26. **Pusher WebSocket leaked on every listener remount** —
    `pusher-listener.tsx:11,33` constructs a new client per effect;
    cleanup unsubscribes but never `disconnect()`s.
    Report: playlists-realtime #5.
    Fix: `pusher.disconnect()` in cleanup, or a module-level
    singleton + per-profile subscribe only.
27. **`?song=` survives search navigation → overlay desync** —
    `KidsSearch.navigate` (`kids-search.tsx:77-84`) rebuilds the URL
    from all live params, so `song=` persists; the overlay keeps its
    key but gets a new `queue` → wrong song plays or black frame.
    Report: songs-domain #3.
    Fix: `stripParams` prop on `KidsSearch` (`["song"]` from
    `CatalogHeader`).
28. **Song parser: out-of-order start-only lines lose songs** —
    `lib/song-timestamps.ts:82-90` fills `endSeconds` from the next
    *file-order* line before sorting by `startSeconds` — verified
    repro: out-of-order tracklists drop songs / mis-bound ranges.
    Report: songs-domain #5.
    Fix: sort lines by `startSeconds` before the end-fill pass;
    add regression cases to `scripts/test-song-parser.ts`.
29. **`isQuotaError` can throw and misses sibling quota reasons** —
    `lib/channel-sync.ts:28-34`: `JSON.stringify(undefined)` →
    `.includes` throws inside the catch handler; only
    `"quotaExceeded"` matches, not `dailyLimitExceeded`/
    `userRateLimitExceeded`/429.
    Reports: youtube-sync #3, #4.
    Fix: check `err.response?.data?.error?.errors` reason list.
30. **`pollChannel` permanently misses uploads past its window** —
    `lib/channel-sync.ts:191-213`: 5-page cap (~250 ids), token
    discarded; ids below the cutoff are never revisited since
    `backfillComplete` stays true.
    Report: youtube-sync #5.
    Fix: persist a poll resume cursor when the cap hits without
    `hitKnown`.
31. **`QuotaExceededError` is dead code; no shared request helper** —
    `lib/channel-sync.ts:19` declared, checked, never thrown; API key
    guard repeated 8× in `lib/youtube.ts`; no axios timeout anywhere.
    Reports: youtube-sync #6, #8.
    Fix: shared `ytGet()` helper (base URL, key guard, 15 s timeout,
    quota-error normalization).
32. **Zero secondary indexes** — every `drizzle/meta` snapshot has
    `"indexes": {}`; hot paths seq-scan: `videos(channel_id)`
    (unapprove tombstone cleanup scans the largest table),
    `whitelisted_videos(profile_id, via_channel_id)` partial,
    `watch_history(profile_id, watched_on, last_seen_at)`,
    `songs(imported_by)`, `playlists(profile_id)`, plus trailing-FK
    indexes so `videos`/`users`/`channels` deletes don't seq-scan ~6
    child tables per row.
    Reports: db-platform-shell #1, kids-portal-feed #12.
    Fix: one `0016_*` migration adding the indexes above.
33. **pg pool misconfigured** — `lib/db/index.ts:15` sets
    `idleTimeoutMillis: 10_000` = the pg default the comment claims
    to beat; no `pool.on("error")` handler → an idle-client drop
    (Neon does routinely) throws on the EventEmitter.
    Reports: db-platform-shell #2, #3.
    Fix: `idleTimeoutMillis: 60_000` + error handler; fix comment.
34. **`capacitor.config.ts` silently falls back to a placeholder URL**
    — `:11-14` uses `https://nibrastube.example.com` when
    `CAPACITOR_SERVER_URL` is unset → CI could ship a dead APK.
    Report: db-platform-shell #4.
    Fix: throw when unset (or gate fallback on non-production).
35. **`"use client"` on `ui/button.tsx` + `ui/label.tsx`** — ships
    `@base-ui/react` + cva + tailwind-merge client JS for
    server-rendered chrome; `ui/input.tsx` proves it's unnecessary.
    Reports: db-platform-shell #5 (med), architecture #13 (low) —
    reconciled med (label too; verified both files).
    Fix: remove the directives; client callers keep working.
36. **Prettier `semi: false` vs all-semi codebase** — `.prettierrc:3`;
    `npm run format` would strip semicolons repo-wide in one noise
    diff.
    Report: db-platform-shell #6.
    Fix: flip to `"semi": true`.
37. **Dead schema surface** — `shared_access.role` (only "editor"
    ever granted), `invites.email` (never used), `invites.status`
    "rejected" never set; `KidClaims.name` never read.
    Reports: db-platform-shell #7, architecture #14,
    auth-session-routing #9.
    Fix: drop or implement each; drop `name` from kid claims.
38. **Kid session treated as signed-in parent on `/songs`** —
    `app/songs/page.tsx:42,68,88`: `!!session` is true for kid JWTs →
    dead "Yours" tab, "Parent portal" pill that bounces, no Videos
    back-link (`kidsHref` needs `!session`), no signup banner.
    Verified at `page.tsx:54-58`.
    Reports: songs-domain #1 (med), auth-session-routing #5 (low) —
    reconciled med: the kid loses the only link back to their feed.
    Fix: gate chrome on `parentSession(session)`; kid session →
    `kidsHref=/kids/<profileId>`.

### Low

39. **Playlist UX/robustness lows** — reorder failure swallowed with
    no toast or `router.refresh()` (`playlist-sortable-list.tsx:184`);
    `createAndAdd` partial-failure misleads + `videoCount: 0` flicker
    (`save-to-playlist-dialog.tsx:119-144`); concurrent add/reorder
    races benign but unguarded; hidden rows keep stale positions;
    caps count hidden rows.
    Reports: playlists-realtime #6, #8-11.
    Fix: surface failures; serialize per-playlist mutations
    (advisory lock) + single `UPDATE … FROM (VALUES …)`.
40. **Watch-page lows** — revisited videos lose live resume position
    (`watch-experience.tsx:261-266`); mid-session unpin can't
    interrupt playback + playlist-merge machinery unreachable
    (PusherListener only on feed page); `day` accepts arbitrary dates
    + `en-CA` trick brittle; `completed` last-write-wins un-watches;
    500 ms snapback exposure window; failed flush consumes send
    budget; future `router.refresh()` recreates the iframe;
    `iframe_api` load failure = permanent black box; ~300 KB
    full-whitelist queue props; progress+history upserts not
    transactional; `SwipeConfirmDialog` no Escape/backdrop;
    `react()` can hit the outgoing video; `formatDuration` negative.
    Reports: watch-playback-apis #4-17.
    Fix: live-position `Map`; mount listener (or accept+document);
    clamp `day` server-side + build via `getFullYear` parts; decide
    sticky `completed`; sent-markers on success only; `db.transaction`.
41. **Kids-feed param/render lows** — `?date=` "today" computed in
    server TZ vs client-written `watchedOn`; inverted `?min>`/`?max<`
    not normalized; `?min/max` invisible+unclearable on Shorts view;
    transient `loadMore` failure permanently ends feed; needless
    sequential awaits in four views + `getKidsChannels`; channels
    over-fetch (full rows + third thumbnail query); `=== 60` magic
    coupling to `limit=60`; `watchStatus` comment overclaims vs SQL;
    `?q` untrimmed; `getPlaylists` fetched on empty paths.
    Reports: kids-portal-feed #4-11, #16-17.
    Fix: normalize params once in `parseKidsFeedParams`; retry state;
    `Promise.all`; export `FOR_YOU_PAGE_SIZE`.
42. **Auth/session lows** — double JWT decrypt per request + per
    action (`proxy.ts:46/164`, `auth.ts:251`); dead `KidClaims.name`;
    `decrypt` doesn't check `user.email`/`name`; no parent-session
    revocation on user delete; stale `activeProfileId` on a deleted
    profile = permanent `/` → 404; `startsWith("/parent")` open
    prefix; login timing enumerates identifiers (no dummy-hash
    compare); identifiers case-sensitive end-to-end; raced
    duplicate-email signup 500s; expired invites show a dead Accept
    button; gate modal lacks dialog semantics/focus handling;
    `handlePass` leaves `verifying` stuck; already-unlocked parent on
    a locked device must re-enter PIN; minor redirect hops.
    Reports: auth-session-routing #4,#6-10; auth-flows #3-9,#11-12.
    Fix: thread session through helpers; `normalizeIdentifier`;
    `onConflictDoNothing` on user insert; dialog a11y pass.
43. **YouTube/sync lows** — tombstoned videos don't count as
    known-stop markers (~10 wasted quota units/day on unpinned
    channels); no axios timeout; `isChannelSyncEnabled` = 3 queries
    per page ×2 per page; `refreshVideoIds.missing` conflates deleted
    vs non-embeddable (+ undocumented songs cascade on prune);
    `parseIsoDuration` accepts bare `"PT"` → 0 → `isShort`;
    reconcile-migration-hashes hard-fails on pending migrations +
    stale `avnadmin` doc; `channelsSynced` metric overstates;
    `UploadsPage`/`SearchPage` token nullability inconsistent;
    client/server daily-sync dedup uses different clocks;
    `test-foryou-paging.ts` crashes on empty profiles + N+1.
    Reports: youtube-sync #7-16.
    Fix: union exclusions in stop check; `ytGet` helper (see #31);
    `ORDER BY … NULLS FIRST` via sql; unify `string | null`.
44. **Songs lows** — bare `start - end` lines mint songs titled with
    the end timestamp; import delete+upsert not atomic; reposted
    comments orphan rows (delete scoped to `sourceCommentId`);
    `deleteSong` check-then-delete TOCTOU; `db.insert(videos)` not
    conflict-safe (concurrent imports 500); import-form stale
    error/edit-state nits; `next` uses unclamped index; `ilike`
    wildcards unescaped; case-sensitive title sort.
    Reports: songs-domain #6-13.
    Fix: reject titles matching `TS` regex; `db.transaction` for the
    import; scope stale-delete to video+importer; fold ownership
    into the delete; `onConflictDoNothing`.
45. **Parent-portal lows** — `setChannelSyncExcluded` comment
    overclaims scope; unbounded page-1 pin/channel flag lookups
    (~2k rows to flag ~25 items); `refreshStaleVideos` edges (quota
    throw unhandled, tombstone cascade on prune, `refreshed=abc` → 0);
    `SearchResultsGrid`/`ChannelUploadsList` ~90% duplicated; `!session`
    vs `role!=="parent"` preamble drift; `createProfile` no trim/max
    (bcrypt truncates >72 B); no confirmation on delete-kid /
    unapprove; `songsVideo` param unvalidated; `DashboardSearch`
    re-implements URL builder.
    Reports: parent-portal #7-14.
    Fix: shared `useTokenPager`/flagged-id helpers (see #17);
    confirmations; validation trims.
46. **DB/platform/config lows** — `shadcn` in dependencies; redundant
    `@types/bcryptjs`; `format` script misses `.mjs`/`.md`/`.css`;
    `ThemeProvider` forces light while `dark:` classes are dead code;
    tsconfig could be stricter (`noUncheckedIndexedAccess`);
    `max:3` pool vs parallel page queries; `videos.raw` ~9 KB/row
    mostly duplicated; cross-table identifier uniqueness app-enforced
    only; 79-col drift in schema/kids page; `sw.js` cache name pinned
    (`/icons` unhashed); `next.config.mjs` empty (no
    `serverExternalPackages`/`poweredByHeader`); JWT `"secret"`
    fallback + hardcoded Pusher key fallback mask misconfiguration;
    empty-state ternary chains duplicated per view; whole-whitelist
    grid + `SONGS_LIMIT=240` caps.
    Reports: db-platform-shell #8-16; architecture #10-11,#15-16;
    kids-portal-feed #13.
    Fix: hygiene pass; startup asserts for secrets; `emptyStateFor`.

## What's healthy (do not touch)

- **`suitableVideo`/`visibleVideo` enforcement** — one SQL fragment
  ANDed into every kid-facing query and both write APIs; the 18+
  floor added by touching almost nothing. Triple-layer whitelist
  (page redirect, 500 ms snapback, write-guard inner joins) holds.
- **Session model** — `ParentClaims | KidClaims` union narrowed only
  via `parentSession()`/`isKidSession()`; `decrypt` fails closed on
  wrong-shape signed tokens; unlock tokens are `sub`-bound and
  scope-checked; `loginKid` clears stale `parentUnlocked`.
- **`safeCallback`** — closes every open-redirect bypass verified
  against the WHATWG parser (`\`, `%09`, `..//`, `javascript:`).
- **URL-as-state** — `parseKidsFeedParams`/`kidsPortalUrl` (and the
  songs twins) keep all filters in the URL; validation degrades bad
  values to defaults instead of 500ing; `isCalendarDate` round-trip.
- **`getRecommendedVideos` ranking** — NULL-safe CTEs, bounded
  affinity, deterministic day-seeded tiebreak → offset paging can't
  dupe/skip; For-You/Shorts infinite paging works off it.
- **Channel sync core** — resumable `backfillPageToken` checkpointed
  per page, idempotent `onConflictDoNothing` inserts, mid-flight
  approval/pause re-checks, owner-keyed SQL-prefiltered exclusions,
  `daily_syncs` PK dedup lock.
- **Token-keyed infinite scroll** — exhaustion = null token
  (survives hydrate-to-empty pages), generation-counter mid-flight
  reset guards, drift dedup.
- **Watch flush/beacon machinery** — `sentAt` clamped server-side,
  `setWhere: lt(existing, sentAt)` on both upserts, flush coverage
  on pause/END/tick/pagehide/visibilitychange/unmount/pre-load.
- **Playlist domain integrity** — `assertCanEditKidData` on every
  action (incl. reads), exact-set reorder check fails closed,
  pin + 18+ enforcement on `addToPlaylist`, `addedAt` tiebreak makes
  races deterministic.
- **Songs leak-prevention** — `feedSongCols` + `toFeedSong` explicit
  projection means `importedBy` never reaches props; `mine` fails
  closed on nil-uuid; `deleteSong` double-verifies with one uniform
  error.
- **Platform shell** — `sw.js` (cache-first hashed only),
  `app-update.ts` (never throws, https+GitHub-only APK URLs),
  `drag-scroll.tsx`, `pwa-register.tsx` dev unregister; migrations
  are append-only with self-healing data fixes; `drizzle.config.ts`
  unpooled-URL preference; CI verifies APK versionCode before
  publishing `update.json`.
- **Comments** — near-universal documentation of invariants, races,
  and quota costs; keep the habit in every fix above.

## Top 10 priorities

1. **Fix realtime** (S) — `NEXT_PUBLIC_PUSHER_CLUSTER`, split
   `lib/pusher.ts` into server/client modules, delete hardcoded
   fallbacks, add `disconnect()` in listener cleanup, wrap
   `trigger` in a shared `notifyProfile` try/catch. Issues #1, #2,
   #25, #26.
2. **Auth-gate `/api/sync-channels`** (S) — session for POST,
   `CRON_SECRET` or removal for GET. Issue #3.
3. **Server-side PIN backstop on `/parent/*`** (S) — one-line
   `isParentUnlockedCookie` check in `app/parent/layout.tsx`. #6.
4. **Unify the kid-write guard + validate uuids** (M) — shared
   `assertKidWriteAccess`/`kidWriteGate` used by both API routes and
   `assertCanEditKidData`; `z.uuid()` inside the assert helpers;
   `getString(formData, key)` for FormData. Issues #4, #14.
5. **Add error boundaries + error surfaces** (S–M) — root
   `error.tsx`/`not-found.tsx` with kid-safe chrome, dashboard
   `error.tsx`, catch in `profileExists`, friendly `pinVideo`
   not-found path. Issues #9, #10.
6. **Fix unpin tombstones + re-approve backfill** (S–M) —
   `DELETE…RETURNING` + channel-approved tombstone check; skip
   `backfillChannel` when `backfillComplete`. Issues #7, #8.
7. **Gate `embeddable` everywhere** (S) — `getVideoDetails` →
   `| null`, refuse `embeddable !== true` on pin and song-import
   paths, optional defense-in-depth predicate. Issues #10, #11.
8. **Deliver + tighten invites** (S) — return the URL and render it
   copyable; owner-only `inviteParent`; `normalizeIdentifier`;
   expiry-aware pending UI. Issues #12, parts of #42.
9. **Index migration** (S) — `videos(channel_id)`, partial
   `whitelisted_videos(profile_id, via_channel_id)`,
   `watch_history(profile_id, watched_on, last_seen_at)`,
   `songs(imported_by)`, `playlists(profile_id)`, trailing-FK
   indexes. Issue #32.
10. **Player resilience** (M–L) — `onError` → skip on watch + song
    overlays (S); then extract `useYouTubePlayer`/`useProgressFlush`/
    `useNavStack` and stabilize the playlist prop (L). Issues #18, #19.

Next tier (not in top 10, schedule soon): deleted-profile redirect
ping-pong (#5), `KidsVideoGrid` staleness guard (#21), bounded
`getWatchHistory` + For-You query dedup (#22, #23), filtered-drag
gate (#24), `?song=` strip (#27), parser sort-before-fill (#28),
quota-error normalization + poll resume cursor (#29–#31), pool fix
(#33), brute-force counters (#13), dashboard `_components/` split
(#16), hydration/flag-helper extraction (#17).
