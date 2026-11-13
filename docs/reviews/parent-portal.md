# Review: Parent dashboard, profiles & vetting surfaces

## Summary

This unit is well-built and unusually well-commented: the parent-unlock
gate is applied consistently, `dashboardUrl`'s param keep/drop rules are
deliberate and correct, and the token-keyed infinite scroll handles the
hard cases (mid-flight resets, dedup, non-empty-page exhaustion)
correctly. The real risks are in the channel-sync interaction edges —
tombstones are only written for `viaChannelId` pins (manual pins on
approved-channel videos resurrect after unpin), and re-approving an
already-approved channel silently re-backfills its entire uploads
playlist — plus a first-page search failure path with no error surface.
The 822-line dashboard page also violates the repo's own `_components/`
convention.

## Strengths

- **Gate discipline is correct on every surface.** Verified all
  in-scope mutations call `requireParentUnlocked()` after a session
  check: `pinning.ts:27,106`, `channels.ts:27,108,151`,
  `profiles.ts:29,81,138,218`, `refresh.ts:21`, `songs.ts:224,263,296`,
  `invites.ts:15`. The throw-vs-redirect split is right: form actions
  redirect to the PIN gate; fetch-style paging actions throw
  (`search.ts:37-49`, `channel-videos.ts:37-42`) because a redirect is
  meaningless inside a fetch — the client's `.catch` marks the feed
  exhausted. Owner-only mutations (`deleteProfile` `profiles.ts:85`,
  `setKidCredentials` `profiles.ts:172`) correctly use
  `profiles.parentId === session.user.id` rather than
  `assertCanManageProfile`, so shared editors can't lock the kid out.
- **`dashboardUrl` is correct under every param combination**
  (`page.tsx:583-604`). `channel` survives only when
  `type === "channels"`; switching tabs, profile, or `q` drops it
  because callers don't re-pass it; `video` composes with both search
  results and the drill-in; `refreshed`/`removed`/`songsVideo` are
  one-shot params that all links deliberately drop (so they never
  become sticky). `closeHref={dashboardUrl({ channel: drillChannelId })}`
  correctly keeps the drill-in when closing the preview. Param
  validation (lines 81-82, 555-560) ignores bad values instead of
  404ing — matches the repo contract.
- **Token-keyed paging is done right.** `search-results-grid.tsx`
  treats exhaustion as `nextPageToken == null` (not empty page —
  hydration can filter a page to zero while a token remains), dedups
  appended items against YouTube's ranking drift (lines 121-127), and
  uses a generation counter bumped in a layout effect so a mid-flight
  `loadMore` can't append a stale page over a reset (lines 86-108).
  The page-1 server component clamps `q` to 200 chars so the bound
  `loadMore` sees the identical query string (page.tsx:466).
- **Mid-flight sync guards are real.** `isChannelSyncEnabled`
  re-checks approval + pause before every batch insert
  (`channel-sync.ts:50-69,94`), `approveChannel`'s `after()` re-reads
  the whitelist row and owner-keyed exclusion before backfilling
  (`channels.ts:63-91`), and `syncAllChannels` left-joins exclusions
  owner-keyed (`channel-sync.ts:243-257`). `ApprovedChannelsCard`
  correctly displays the *owner's* pause state for shared-access
  profiles via the profiles join (`page.tsx:239-248`).
- **Good failure design on the drill-in.** `channel-detail.tsx`
  distinguishes quota/throw (line 105 → `QUOTA_MESSAGE`) from
  not-found (line 113 → `NOT_FOUND_MESSAGE`) and wraps the uploads
  fetch separately so a dead playlist doesn't hide the header.
- **Small sharp touches:** `PinnedVideosPanel` windows at 50 rows
  client-side so ~2k pins don't stall navigation; `LinkPendingSpinner`
  inside `<Link>` gives pending feedback for searchParams-only
  navigations where `loading.tsx` never fires; `ParentNav`'s
  `openFor === pathname` keying auto-closes the mobile menu on
  navigation without an effect; `refreshStaleVideos` validates
  `returnTo` against `/parent/dashboard` before appending params
  (`refresh.ts:54-58`).

## Issues

1. **Med — Tombstones miss manual pins on approved-channel videos.**
   `unpinVideo` only writes a `channelVideoExclusions` row when the
   deleted pin had `viaChannelId` set (`pinning.ts:110-133`). If a
   parent manually pins a video (`viaChannelId = null`) whose channel
   is *also* approved for that profile — or a sync hasn't reached that
   video yet — then unpins it, no tombstone is written, and the next
   `pollChannel` re-inserts the pin (`channel-sync.ts:203-218` adds any
   id not already whitelisted). The unpin silently doesn't stick.
   **Fix:** in `unpinVideo`, tombstone when
   `videos.channelId ∈ profile's whitelistedChannels`, not only when
   `existing.viaChannelId` is set.
2. **Med — Re-approving an approved channel re-backfills from page 1.**
   `approveChannel`'s insert is `onConflictDoNothing`
   (`channels.ts:54-57`) but `after()` calls `backfillChannel`
   unconditionally (`channels.ts:63-91`). For an already-approved,
   backfill-complete channel, `backfillPageToken` is null
   (`channel-sync.ts:140`) so the run re-scans the whole uploads
   playlist — up to `MAX_BACKFILL_PAGES_PER_RUN` × ~2 API calls of
   quota waste — and flips `backfillComplete` false per page
   (`channel-sync.ts:152-168`), resurrecting the "Syncing…" state.
   Double-submits / stale "Approve" forms hit this. **Fix:** skip
   `backfillChannel` in `after()` when `whitelist.backfillComplete`
   (the unapprove→re-approve path already works — unapprove deletes the
   row so a fresh insert has `backfillComplete=false`).
3. **Med — No error surface for first-page YouTube failures.**
   `SearchResults` (`page.tsx:467-483`) lets `searchYouTube`/
   `searchChannels` quota/network exceptions propagate through the
   Suspense boundary — and there is no `error.tsx` anywhere in the app
   — so a quota-exhausted page-1 search (100 units) renders Next's
   default error screen while page-N failures get the graceful
   "Couldn't load more — retry" sentinel and the channel drill-in gets
   `ChannelNotice`. Same void swallows `approveChannel`'s
   `throw new Error("Channel not found")` (`channels.ts:32`) and
   `pinVideo`'s unguarded `getVideoDetails` throw (`pinning.ts:40`).
   **Fix:** `app/parent/dashboard/error.tsx` (or a try/catch → notice
   inside `SearchResults`) at minimum.
4. **Med — `pinVideo` crashes on dead ids and stores invisible dead
   pins.** `getVideoDetails` does `mapVideoItem(response.data.items[0])`
   with no items guard (`lib/youtube.ts:345-346`) → `TypeError` on a
   deleted/private/malformed `videoId` (no `VIDEO_ID_RE` check at the
   action boundary — `pinning.ts:21`). Also, `getVideoDetails` doesn't
   filter `embeddable` like `getVideosBatch` does
   (`youtube.ts:223,588`), so pinning a non-embeddable video writes an
   inert pin that nothing labels (the Blocked badge only covers
   `ageRestricted` — `dashboard-video-card.tsx:109-114`,
   `pinned-videos-panel.tsx:58-63`). **Fix:** validate
   `/^[A-Za-z0-9_-]{11}$/` up front, return a friendly error when
   `items[0]` is missing, and either reject `embeddable === false` or
   surface it as a second Blocked label.
5. **Med — `inviteParent` lets a shared-access editor mint invites.**
   `invites.ts:12-27` gates with `assertCanManageProfile`, so anyone
   with an editor `shared_access` row can create invite tokens
   granting further shared access to the *owner's* profile — broader
   than the owner-only posture `deleteProfile`/`setKidCredentials`
   enforce on the same page (`profiles/page.tsx` only renders the
   invite form for owned profiles, but the action itself trusts the
   bound profileId). **Fix:** require
   `profile.parentId === session.user.id`. (File is adjacent to the
   unit but reachable from `profiles/page.tsx:99-103`.)
6. **Low-med — `unpinVideo` read-then-delete race drops the tombstone.**
   `existing` is read at `pinning.ts:110-115` *before* the delete at
   117-124; a sync `onConflictDoNothing` insert landing between them is
   deleted without a tombstone → resurrected by the next poll. Same
   shape as issue 1. **Fix:** capture the row with
   `DELETE … RETURNING via_channel_id` (drizzle `.returning()`), or —
   combined with issue 1's fix — write the tombstone whenever the
   video's channel is approved, keyed off `videos.channelId`, not the
   pin row.
7. **Low-med — `setChannelSyncExcluded` mutes beyond the editor's
   scope.** The exclusion is keyed by `profiles.parentId`
   (`channels.ts:120-143`), so a shared-access parent pausing a channel
   mutes sync for *all* of the owner's profiles — including ones never
   shared with them. The UI copy ("sync paused for all profiles",
   `page.tsx:307`) discloses this, but the doc comment's claim that it
   covers "exactly the profiles they see" (`channels.ts:100`) is wrong.
   **Fix:** correct the comment; the behavior itself is probably the
   pragmatic choice (no per-profile mute granularity), just under-documented.
8. **Low-med — Unbounded whitelist reads to flag ~25 items.**
   `SearchResults` fetches *every* pin and channel approval for the
   profile to flag page-1 items (`page.tsx:475-483`), and
   `channel-detail.tsx:146-150` fetches every pin — while the paging
   actions correctly scope with `inArray(ids)`
   (`search.ts:63-73,91-101`, `channel-videos.ts:77-90`). A ~2k-pin
   profile pays a 2k-row select per dashboard navigation. **Fix:**
   scope page-1 lookups by the result ids too — a shared
   `getPinnedVideoIds(profileId, ids)` / `getApprovedChannelIds(profileId,
   ids)` helper would fix this and answer the duplicated-lookup question in
   one move.
9. **Low — `refreshStaleVideos` edge cases.** (a) A quota/network throw
   from `refreshVideoIds` propagates to the missing error boundary —
   partial chunks upsert but the user sees a crash, not a count.
   (b) The `videos` delete (`refresh.ts:39`) is on the *global* cache —
   correct for dead videos (cascade unpins them everywhere), but it
   also cascade-deletes `channelVideoExclusions` tombstones
   (`schema.ts:241-242`), so a video that regains embeddability later
   gets re-added by sync — harmless edge, worth a comment.
   (c) `refreshed=abc` renders "Refreshed details for 0 videos"
   (`page.tsx:670-671`) since `Number("abc") | 0 → 0`.
10. **Low — `SearchResultsGrid` / `ChannelUploadsList` are ~90%
    duplicated** (`search-results-grid.tsx:76-159` vs
    `channel-uploads-list.tsx:53-128`): identical state machine,
    generation guard, observer, sentinel button; only item type,
    rootMargin (300 vs 600 px) and labels differ. Additionally, the
    `prevInitial !== initialItems` reference check means *every*
    revalidation — e.g. pinning a page-3 result — discards accumulated
    pages and scroll position (acknowledged in comments, but the
    cheapest fix is the same extraction). **Fix:** a shared
    `useTokenPager` hook or a generic `TokenPagedGrid`.
11. **Low — Gate-preamble inconsistencies (cosmetic but drift-prone).**
    Mutations split between `if (!session) return`
    (`pinning.ts:23,101`, `channels.ts:26,150`, `refresh.ts:20`,
    `profiles.ts:217`) and `session.role !== "parent"`
    (`profiles.ts:26,80,135`, `channels.ts:107`) — a kid session in the
    first group falls through to `requireParentUnlocked`'s
    `/kids?gate=1` redirect, a slightly wrong target (proxy bounces it
    anyway). `assertDashboardReader` (`search.ts:42-49`) is
    re-implemented inline in `channel-videos.ts:37-42` instead of being
    exported. No mutation is *missing* the unlock check — this is
    cleanup, not a hole.
12. **Low — `createProfile` validation gaps** (`profiles.ts:16-76`):
    `name` is `z.string().min(2)` with no trim or max (`"  "` passes);
    `password` has a min-4 but no max — `setKidCredentials` caps at 128
    (`profiles.ts:123`) while `createProfile` doesn't, and bcrypt
    silently truncates beyond 72 bytes; the raw `name`/`avatar` values
    are inserted rather than `validated.data` (no transforms today, so
    behavior-identical but fragile).
13. **Low — Destructive actions have no confirmation.** The
    delete-kid button (`profiles/page.tsx:73-80`) cascades the whole
    whitelist/history on one click; unapprove channel
    (`page.tsx:346-364`) wipes all `viaChannelId` pins and tombstones
    on one click. A two-step confirm (or `ConfirmButton`) would match
    the irreversibility.
14. **Low — Cosmetic/debug residue:** `console.log` calls left in
    `pinning.ts:24,29,103,108`; `songsVideo` is the only dashboard param
    not shape-validated (`page.tsx:391-396` — harmless `eq` lookup, but
    inconsistent with `video`/`channel` validation);
    `DashboardSearch` re-implements the URL shape inline
    (`dashboard-search.tsx:31-34`) instead of sharing the `dashboardUrl`
    builder's param-order contract; `profiles/page.tsx` queries
    `invites`/`sharedAccess` with `inArray` over a possibly-empty id
    list (harmless `false` predicate, wasted round-trip).

## Refactor suggestions

1. **Split the dashboard page into `_components/`** — the repo's own
   convention (already applied to `channel-detail`/`video-preview`).
   Move out: `SidebarCardFallback`, `SearchResultsFallback`,
   `PinnedVideosCard` (`page.tsx:121-213`), `ApprovedChannelsCard`
   (215-372), `SongImportCard` (377-442), `SearchResults` (449-532).
   That leaves the page at ~200 lines of params/guard/layout. Consider
   `dashboardUrl` + the two regexes →
   `app/parent/dashboard/_components/dashboard-url.ts` if
   `DashboardSearch` is made to consume it (fixing the duplication in
   issue 14). Dashboard-only shared components (`dashboard-search`,
   `pinned-videos-panel`, `search-results-grid`,
   `channel-uploads-list`, `video-preview-overlay`) are also candidates
   to relocate, since nothing else imports them.
2. **Extract `hydrateUploadsPage(playlistId, pageToken?)`** into
   `lib/youtube.ts` or `lib/video-cache.ts` — the
   `getUploadsPage → getVideosBatch → order-preserving flatMap →
   upsertVideoRows` block is verbatim in `channel-videos.ts:60-75` and
   `channel-detail.tsx:129-140`.
3. **Extract flagged-id helpers** `getPinnedVideoIds(profileId, ids)` /
   `getApprovedChannelIds(profileId, ids)` — used by `SearchResults`,
   `ChannelDetail`, `loadMoreSearchVideos`, `loadMoreSearchChannels`,
   `loadChannelUploads`; scopes page-1 lookups (fixes issue 8) and
   collapses five copies of the same query.
4. **Export `assertDashboardReader`** from `search.ts` (or move to a
   shared `lib/dashboard-gate.ts`) and use it in `channel-videos.ts`
   instead of the inline copy; while there, unify the
   `!session` vs `role !== "parent"` preamble (issue 11).
5. **Fix tombstone semantics (issues 1+6 together):** in `unpinVideo`,
   delete with `.returning({ viaChannelId: whitelistedVideos.viaChannelId })`,
   and write the exclusion whenever the video's `videos.channelId`
   belongs to the profile's approved channels — covers both the
   manual-pin resurrection and the read-then-delete window.
6. **Guard the re-approve path:** skip `backfillChannel` in
   `approveChannel`'s `after()` when `whitelist.backfillComplete`
   (issue 2).
7. **Add `app/parent/dashboard/error.tsx`** and give `SearchResults` a
   quota-notice parity with `ChannelNotice` (issue 3); add a
   `VIDEO_ID_RE` check + `items[0]` guard to `pinVideo`/`getVideoDetails`
   (issue 4).
8. **Tighten `inviteParent` to owners** (issue 5), then dedupe the two
   infinite-scroll components into a shared hook (issue 10), then the
   small stuff: confirmations on delete/unapprove, `createProfile`
   trims/max-lengths, remove debug logs.
