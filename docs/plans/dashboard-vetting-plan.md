# Plan: Parent dashboard — paginated search, video preview, channel browse

**Status: not implemented**

## Goal

Turn the parent dashboard into a real vetting surface:

1. **Paginated search** — scrolling loads more YouTube results (today a
   search is a single `maxResults: 12` call that filters down to ~5-8
   cards, with no way to get more).
2. **Duration badges** on result cards (the data is already fetched,
   just never rendered).
3. **In-app video preview** — click a result to watch it before
   pinning (`?video=<youtubeId>` overlay).
4. **Channel drill-in** — click a channel result to read its
   description/stats and page through ALL its uploads, pinning
   individual videos or approving the channel (`?channel=<UCid>`).

## Facts established by codebase investigation

- `lib/youtube.ts` `searchYouTube` (lines 248-278): one
  `search.list` call, `maxResults: 12`, **no `pageToken`** — then
  `getVideosBatch` drops non-embeddable items, then `madeForKids` /
  `ageRestricted` are filtered (search is an unvetted surface).
  ~5-8 visible cards from 12 raw hits is the "few results" bug.
- `searchChannels` (lines 297-315): same single call, `maxResults:
  12`, no hydration, no paging.
- `search.list` DOES paginate via `pageToken`/`nextPageToken`;
  `maxResults` cap is 50. Cost is **100 units/call** regardless of
  page size (10k/day budget) — `maxResults: 25` doubles yield per
  unit. `videoEmbeddable: "true"` pre-filters the biggest drop
  source server-side (video search only).
- `searchYouTube` already returns hydrated `FullVideoDetails`
  (duration, description, viewCount, isShort, flags) — duration
  badges need zero new API calls.
- `searchChannels`/`searchYouTube` have exactly ONE call site:
  `app/parent/dashboard/page.tsx:353-354`.
- Infinite-scroll precedent (copy this, not `?page=` links):
  `app/actions/kids-feed.ts` `loadMoreForYou` (read action, gated,
  bound in the server component so the client prop is just
  `(cursor) => Promise<page>`) + `components/kids-video-grid.tsx`
  (IntersectionObserver sentinel with `rootMargin`, the "Show more"
  button IS the sentinel so it degrades to click, dedup-by-id Set,
  `prevInitial` render-phase reset when first-page identity changes,
  `.catch -> exhausted`).
- Overlay precedent: `?song=<uuid>` — `app/songs/page.tsx` validates
  the param with a regex and mounts a `<Suspense fallback={null}>`
  wrapper after `<main>`; `app/songs/_components/song-overlay.tsx`
  (async server) resolves data; `components/song-player-overlay.tsx`
  (client) is the player: `fixed inset-0 z-50` overlay, watch-page
  chrome (back link + title + X), `FullscreenPlayer`,
  `ensureYouTubeAPI` + `new window.YT.Player`, Escape-to-close,
  `document.body.style.overflow = "hidden"`. `components/song-
  card.tsx` opens it via `<Link href={?song=…} scroll={false}>`.
  The queue/segment/snapback machinery is the part to DROP.
- Duration badge canonical markup — `components/video-card.tsx`:
  `absolute bottom-2 right-2 rounded-lg bg-black/75 px-2 py-0.5
  text-sm font-bold text-white tabular-nums` fed by
  `formatDuration(video.durationSeconds)` (null -> no badge).
- Channel drill-in convention: kids portal uses
  `?view=channels&channel=<UCid>` + `components/back-link.tsx`
  "All channels" exit. `/songs` mirrors with `?video=`.
- `getChannelDetails` -> `ChannelDetails {uploadsPlaylistId,
  description, country, publishedAt, subscriberCount, videoCount}`
  (1 quota unit, null when channel vanished). `getUploadsPage
  (playlistId, pageToken?) -> {videoIds, nextPageToken}`, 50/page,
  **1 unit** — cheapest uploads listing. `getVideosBatch` hydrates
  ids (embeddable-only, 1 unit/50). `upsertVideoRows`
  (`lib/video-cache.ts`) warms the `videos` cache so `pinVideo`'s
  `fetchedAt` check skips its own fetch.
- `pinVideo(profileId, videoId)` / `approveChannel(profileId,
  channelId)` need NO changes — both self-gate
  (`getSession` + `requireParentUnlocked` +
  `assertCanManageProfile`), hydrate caches, fire Pusher,
  `revalidatePath("/parent/dashboard")`. Importable into client
  components; `.bind` works in `<form action>`.
- Auth helpers for read actions: `parentSession(session)` +
  `isParentUnlockedCookie(session)` (lib/auth.ts) — do NOT use
  `requireParentUnlocked()` in fetch-style actions (it redirects).
- Suitability contract: `age_restricted` = hard floor (pin is
  inert; `PinnedVideosPanel` labels them "Blocked"); `made_for_kids`
  gate applies to unvetted surfaces only — parent-vetted content
  is exempt.
- Plan-file format: this file. Implemented plans are DELETED in the
  implementing PR (AGENTS.md rule 11). Every line <= 79 chars.

## URL scheme

Dashboard params today: `q`, `profileId`, `type`, `refreshed`,
`removed`, `songsVideo`. Add two non-feed params:

| Param     | Shape                    | Meaning                        |
|-----------|--------------------------|--------------------------------|
| `video`   | `^[A-Za-z0-9_-]{11}$`    | Preview overlay open on YT id  |
| `channel` | `^UC[\w-]{10,40}$` loose | Channel drill-in (type=channels)|

Bad values render nothing (never 404). `video` composes with
everything (openable from search results AND the channel drill-in);
`channel` switches the results area. Replace the `dashboardHref`
string-concat with a `dashboardUrl({type, channel, video})` builder
so every link (type tabs, profile picker, back link, card hrefs,
overlay close) drops/keeps params deliberately. `channel` is
dropped when switching to `type=videos` or changing `q`/`profileId`
(navigation via existing links naturally rebuilds the URL — just
ensure the builder is the single source).

## 1. Paginated search

### `lib/youtube.ts`

```ts
export interface SearchPage<T> {
  items: T[];
  nextPageToken: string | null; // null = no more pages
}

export async function searchYouTube(
  query: string,
  pageToken?: string | null
): Promise<SearchPage<FullVideoDetails>>;

export async function searchChannels(
  query: string,
  pageToken?: string | null
): Promise<SearchPage<YouTubeChannel>>;
```

- Pass `pageToken` (when non-null) + `maxResults: 25` + for video
  search `videoEmbeddable: "true"`; capture
  `response.data.nextPageToken ?? null`.
- Fix the return type to `FullVideoDetails` (already the de-facto
  item type — callers get duration/description typed access).
- Keep hydration + MFK/age-restricted filtering untouched.

### New `app/actions/search.ts` (`"use server"`)

Two read actions (clean types beat one union):

```ts
export async function loadMoreSearchVideos(
  profileId: string, query: string, pageToken: string | null
): Promise<{
  items: DashboardVideo[];      // trimmed (below)
  pinnedIds: string[];
  nextPageToken: string | null;
}>;

export async function loadMoreSearchChannels(
  profileId: string, query: string, pageToken: string | null
): Promise<{
  items: YouTubeChannel[];
  approvedIds: string[];
  nextPageToken: string | null;
}>;
```

Guards (both): `getSession()` -> `parentSession(session)` non-null
-> `isParentUnlockedCookie(session)` -> `assertCanManageProfile
(session, profileId)` (pin state is profile-scoped). Throw
`Error("Not authorized")` — the client `.catch` marks exhaustion.
Clamp `query` to ~200 chars. `pageToken` is opaque — pass through.
Each action intersects the page's ids with `whitelistedVideos` /
`whitelistedChannels` for `profileId` so appended cards render
correct Approved/Pinned state.

`DashboardVideo` = trimmed serializable subset:
`{id, title, thumbnail, channelTitle, channelId, durationSeconds,
isShort, viewCount, publishedAt, ageRestricted}` — drop `raw` and
the flags the UI doesn't render. (Define it in `lib/youtube.ts` or
the action file; it must be usable from both server and client.)

### New `components/search-results-grid.tsx` (`"use client"`)

Clone `kids-video-grid.tsx`'s accumulation logic, keyed on the
opaque token instead of offset:

- Props: `{searchType, initialItems, initialNextPageToken,
  initialFlaggedIds: string[], profileId, profileName,
  previewBaseHref, channelBaseHref,
  loadMore?: (pageToken: string | null) => Promise<page>}`.
- State: items, flagged-id Set (union of initial + per-page),
  nextToken, fetching, exhausted, `prevInitial` reset on
  `initialItems` identity change.
- **Exhaustion = `nextPageToken == null`** — NOT empty items
  (a page can filter to zero while a token remains). Keep the
  sentinel alive on empty-but-token pages so the observer re-fires
  or the user clicks.
- Sentinel: IntersectionObserver `rootMargin: "300px"` (kids uses
  600px — tighter here since each page costs 100 quota units) +
  "Show more results" fallback button inside the sentinel div.
- Dedup appended pages by id Set (YouTube pages overlap when
  ranking drifts).
- Renders `DashboardVideoCard` (videos) / channel card (below).
  `pinVideo`/`approveChannel` imported + bound inside the card —
  `pinned`/`approved` flags come from the flagged-id Set.

### `app/parent/dashboard/page.tsx` — `SearchResults`

Becomes a thin shell: fetch first page (`searchYouTube(query)` /
`searchChannels(query)` -> `SearchPage`) + the two existing
pinned/approved id queries, then:

```tsx
<SearchResultsGrid
  searchType={searchType}
  initialItems={page.items}
  initialFlaggedIds={...}
  initialNextPageToken={page.nextPageToken}
  profileId={profileId}
  profileName={profileName}
  previewBaseHref={dashboardUrl({...})}
  channelBaseHref={dashboardUrl({...})}
  loadMore={page.nextPageToken
    ? loadMoreSearchVideos.bind(null, profileId, query)
    : undefined}
/>
```

- Add `profileId` to the `<Suspense key={...}>` (line ~585:
  currently `${searchType}:${query}`) — switching kid with the same
  q+type must remount the grid or the flagged sets go stale.
- On pin -> `revalidatePath` -> new `initialItems` -> the
  `prevInitial` pattern resets appended pages (same tradeoff as
  kids feed; accepted — note it in a comment).

## 2. Shared card + duration badge

New `components/dashboard-video-card.tsx` — presentational
(server-safe, no `"use client"`) card extracted from the inline
markup at page.tsx:404-435:

- Props `{video: DashboardVideo, pinned: boolean, profileId,
  profileName, previewHref}`.
- Thumbnail `relative aspect-video` block gets the duration badge
  (canonical markup above); hover overlay's play icon becomes a
  `<Link href={previewHref} scroll={false}>` replacing the external
  `youtube.com` `<a>` at page.tsx:410-414.
- Pin form / disabled "Approved" button moved verbatim.
- Used by SearchResultsGrid AND the channel-uploads list — the
  badge is written once (the DRY ask).

Channel card (search results): keep existing structure; make the
avatar+title a `<Link href={channelHref}>` into the drill-in.

## 3. Video preview overlay (`?video=`)

- New `components/video-preview-overlay.tsx` (`"use client"`) —
  `song-player-overlay.tsx` minus queue/segments/snapback: props
  `{video: DashboardVideo, pinned, profileId, profileName,
  closeHref}`; single `new window.YT.Player(mount, {videoId,
  playerVars: {autoplay:1, modestbranding:1, rel:0,
  iv_load_policy:3, controls:1, playsinline:1}})` inside
  `<FullscreenPlayer portrait={video.isShort}>`; Escape listener;
  body-overflow lock; destroy on unmount; watch-page chrome (back
  link + title + X). Bottom bar: channel title, duration, view
  count, published date, pin form/Approved state, subtle "Open on
  YouTube" external link.
  - **Rogue-video snapback deliberately omitted** — it guards
    kid-reachable surfaces; a suggestion hijack in a PARENT preview
    is harmless/informative. Leave a comment so nobody "fixes" it.
- New `app/parent/dashboard/_components/video-preview.tsx` —
  async server wrapper (mirrors `song-overlay.tsx`): validate id,
  `db.query.videos.findFirst` -> hydrate via `getVideoDetails` +
  `upsertVideoRows` when missing/stale (warms cache for a
  subsequent pin); compute `pinned` for profileId; pass trimmed
  props. `ageRestricted === true` or non-embeddable -> render a
  notice card instead of the player (craftable URL).
- `page.tsx`: parse `video` against `/^[A-Za-z0-9_-]{11}$/`, mount
  `<Suspense fallback={null}><VideoPreview .../></Suspense>` at the
  page root.
- Pinning from the preview does NOT auto-close — the button flips
  to Approved via revalidation; parent may keep vetting.

## 4. Channel drill-in (`?channel=`)

`?channel=<UCid>` with `type=channels` replaces the results area —
mirrors the kids `?view=channels&channel=` convention, keeps `q`
context for the "All channels" back link.

- New `app/parent/dashboard/_components/channel-detail.tsx` —
  async server component:
  1. `getChannelDetails(channelId)` in try/catch -> error card on
     throw (quota/network), "not found" empty state on null.
  2. `getUploadsPage(uploadsPlaylistId)` -> `getVideosBatch` ->
     `upsertVideoRows` (warms cache; do NOT write the `channels`
     row — `approveChannel` owns it). Empty uploadsPlaylistId ->
     header + empty state.
  3. Pinned/approved lookups for profileId (same queries as
     SearchResults).
  4. Render: `BackLink` "All channels" -> `dashboardUrl` without
     `channel`; header card (avatar, title, description
     line-clamped, stats row: subscribers/videos/country/joined,
     "Open on YouTube", Approve CTA via `approveChannel.bind` /
     Approved disabled); uploads grid ->
     `<ChannelUploadsList>`; copy notes playable-only listing
     ("showing playable videos").
- New `components/channel-uploads-list.tsx` (`"use client"`) —
  same accumulation pattern as SearchResultsGrid (token-keyed,
  sentinel+button, dedup), renders `DashboardVideoCard` with
  `previewHref` that keeps the `channel` param.
- New `app/actions/channel-videos.ts` (`"use server"`):

  ```ts
  export async function loadChannelUploads(
    profileId: string, channelId: string, pageToken: string | null
  ): Promise<{
    items: DashboardVideo[];
    pinnedIds: string[];
    nextPageToken: string | null;
  }>;
  ```

  Same guards as search actions. Resolve `uploadsPlaylistId` (DB
  `channels` row first, `getChannelDetails` fallback) ->
  `getUploadsPage` -> `getVideosBatch` -> `upsertVideoRows` ->
  pinned lookup.
- `page.tsx`: parse `channel` against the loose regex; when set +
  `type=channels`, render `<Suspense key={channel}
  fallback={<SearchResultsFallback/>}><ChannelDetail .../></Suspense>`
  in place of `SearchResults`.

### Suitability on the uploads list (decided)

- **MFK videos: SHOWN** — this is a parent vetting surface and the
  MFK gate exists for unvetted surfaces only; filtering would hide
  essentially every video on a kids channel.
- **Age-restricted videos: SHOWN, badged "Blocked", pin disabled**
  — same treatment as `PinnedVideosPanel`'s inert-pin label; a
  cluster of 18+ rows is exactly the vetting signal. Plumb
  `ageRestricted` through `DashboardVideo` and disable the pin in
  `DashboardVideoCard` (Blocked badge like PinnedVideosPanel).
- Non-embeddable stay dropped by `getVideosBatch`; UI copy notes
  "showing playable videos".

## Contract / edge cases

- Every line <= 79 chars; `@phosphor-icons/react/dist/ssr` in
  server modules, `@phosphor-icons/react` in client modules.
- New search query / tab switch: Suspense key remount handles
  reset; `profileId` added to the key.
- Client-appended pages keep per-page pinned state from the action
  response (fresh per page — pinVideo elsewhere can't go stale
  within the set since flag is read per page).
- YouTube token expiry/API error -> `.catch` marks exhausted;
  button text can show "Couldn't load more — retry" state.
- `?video=` / `?channel=` crafted with invalid ids -> validate
  regex, render nothing / not-found card.
- `getChannelDetails`/`getUploadsPage` throw on quota exhaustion
  -> friendly "YouTube quota reached" card, not an error boundary.
- Preview id resolution: crafted `?video=` for restricted/
  non-embeddable -> notice card, no player.
- No DB migration needed. No changes to `proxy.ts` (params only).
- AGENTS.md: update if `searchYouTube`/`searchChannels` signature
  changes are documented there (rule 10 keeps contract doc synced);
  add the new components to the Layout section per convention.

## Explicitly out of scope (seams)

- Hydrating channel search-result cards with stats
  (`getChannelsBatch`) — drill-in provides them; possible v2.
- Sort/filter of channel uploads (date order from
  `getUploadsPage` is fine for v1).
- Auto-load caps — infinite scroll is unbounded like the kids
  feed; quota noted.
- Kids-surface changes — none.

## Implementation order

1. `lib/youtube.ts`: `SearchPage<T>`, `DashboardVideo` type,
   `pageToken`/`maxResults`/`videoEmbeddable` params,
   `FullVideoDetails` return fix.
2. `app/actions/search.ts` + `app/actions/channel-videos.ts`.
3. `components/dashboard-video-card.tsx` (extract + badge +
   preview Link).
4. `components/search-results-grid.tsx` +
   `components/channel-uploads-list.tsx`.
5. `components/video-preview-overlay.tsx` +
   `app/parent/dashboard/_components/video-preview.tsx`.
6. `app/parent/dashboard/_components/channel-detail.tsx`.
7. `app/parent/dashboard/page.tsx`: `dashboardUrl` builder, param
   parsing, wire everything.
8. `npm run typecheck && npm run lint`; manual UI pass on :3100 —
   search videos, scroll-paginate, preview a video, pin from
   preview, search channels, drill in, scroll uploads, pin one
   video, approve channel.
