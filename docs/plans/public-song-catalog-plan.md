# Plan: Public song catalog (`/songs`)

**Status: implemented** (`feature/public-song-catalog`, squash-merged
to main)

Feature branch prefix: `feature/` (e.g. `feature/public-song-catalog`).
Depends on `feature/song-imports` (the `songs` registry + import flow).

## Goal

A public `/songs` page — no sign-in required — that works **one-to-one
like the Kids Corner videos section**: sticky frosted header, type-ahead
search, view tabs, sort chips, card grid, home shelves, empty states.

Three audience tiers from the same page:

- **Anonymous** — full browse/search of the global `songs` registry.
  No user-specific sections or buttons; a slim banner invites them to
  create a free account to import and manage songs.
- **Signed-in parent** — same catalog plus a **Yours** tab
  (`importedBy = session.user.id`), a "Your imports" shelf on the home
  layout, delete affordances on their own imported rows, and a link
  back to `/parent/dashboard` to import more.
- **Kid-locked devices** — `activeProfileId` cookie only; no session.
  They get the anonymous experience (the catalog is read-only for them;
  nothing kid-facing depends on songs yet anyway).

## Facts established by codebase investigation

- **`/songs` needs zero `proxy.ts` changes.** The matcher is
  `["/", "/parent/:path*", "/kids/:path*", "/login", "/signup"]` — a
  top-level route never enters `proxy()`, so anonymous traffic is
  already unguarded. Trade-off: the ~1y session cookie doesn't
  rolling-refresh on `/songs` visits — acceptable, any other page
  refreshes it. (Do NOT add it to the matcher just for refresh: that
  would pay a JWT decrypt on every public hit.)
- **`/` for anonymous currently goes to `/signup`.** Optional follow-up:
  point anonymous `/` at `/songs` so the catalog becomes the landing
  page. Kept out of v1 — redirecting strangers to a signup wall vs a
  catalog is a product decision.
- **The kids chrome is already generic.** `KidsHeader` (`row1` + `tabs`
  slots), `KidsViewTabs` (`tabs` prop), `KidsSortChips` (`options`
  prop), `KidsSearch` (`query` + `placeholder`, URL rebuilt from live
  `searchParams`), `EmptyState`, `VideoGridSkeleton`/`ShelfSkeleton` —
  none take a `profileId` or touch profile state. They can render the
  catalog verbatim; only the names are kid-flavored.
- **`FeedHeader` and `BackLink` are route-private**
  (`app/kids/[profileId]/_components/`), ~20 lines each. Promote both to
  `components/` so the catalog shares them — small move, keeps the two
  feeds pixel-identical instead of drift-prone copies.
- **`songs` already carries everything the UI needs:**
  `title`, `startSeconds`/`endSeconds` (null = "to end of video"),
  `sourceHandle`, `importedBy` (the "Yours" filter — `onDelete: set
  null`, so orphaned rows just become anonymous contributions), and a
  `videos` join for compilation `title`/`thumbnail`/`channelTitle`/
  `durationSeconds`. **No schema change.**
- **The kids query layer is the template.** `lib/kids-feed.ts` shows the
  whole pattern: `parseKidsFeedParams` (validate raw searchParams, bad
  values → defaults), `kidsFeedQuery`/`kidsPortalUrl` (single URL
  builder so tabs/sorts/search never drop each other's params),
  `cache()`d row queries. `lib/songs-feed.ts` mirrors it minus the
  profile dimension.
- **Home layout = shelves over grid.** `VideosView` (no `q`, no drill-in)
  renders `<HomeShelves>` then `<AllVideosGrid>` under separate Suspense
  boundaries; empty shelves don't render. The catalog copies this
  structure exactly.
- **Song rows can't play in-app yet.** Segment playback + songs-aware
  watch auth are documented seams in `song-imports-plan.md`. So v1 card
  clicks are **external YouTube deep-links**
  (`https://www.youtube.com/watch?v=<videoId>&t=<startSeconds>s`) — the
  honest affordance until the watch page learns `?song=<uuid>`.
- **No Pusher.** `PusherListener` subscribes `profile-<id>` — profiles
  don't exist in this surface. Song imports are rare; a `songs-imported`
  global channel is the noted seam if live refresh ever matters.

## Data layer (`lib/songs-feed.ts`)

Mirror `kids-feed.ts` at half the size — no view drill-ins beyond
`video`, no date/list params:

```ts
export type SongsView = "songs" | "compilations" | "mine";
export type SongsSort = "recent" | "title" | "length";
export type SongsDir = "asc" | "desc";

export interface SongsFeedParams {
  view: SongsView;          // "mine" coerced to "songs" when !session
  video: string | null;     // drill-in: one compilation's songs
  sort: SongsSort;
  dir: SongsDir;
  q: string;
}

export function parseSongsFeedParams(raw): SongsFeedParams
export function songsFeedQuery(params, overrides?): string   // "?" + qs
export function songsCatalogUrl(feed, overrides?): string    // "/songs" + qs

export interface FeedSong {
  id: string;               // songs.id — key + future ?song= param
  title: string;
  startSeconds: number;
  endSeconds: number | null;
  videoId: string;
  videoTitle: string;
  thumbnail: string;        // compilation thumb
  channelTitle: string;
  sourceHandle: string | null;
  importedBy: string | null;
}

// join videos; ilike on songs.title OR videos.title when q; sort:
// recent=songs.createdAt (default desc), title=songs.title,
// length=(end-start, null end = video duration - start). video=<id>
// filters to one compilation. LIMIT 240 — songs from a 5h stream can
// run 50+ and the registry grows; cursor pagination is a seam.
export function getSongs(feed: SongsFeedParams, importedByUserId?: string)
export function getCompilations() // distinct videos having ≥1 song + counts
export function getNewSongs(limit = 12)  // "Newly added" shelf
export function getUserSongs(userId: string, limit = 12) // "Your imports"
```

`view=mine` with no session coerces to `songs` in the parser — the URL
never 404s, it just lands on the public view.

## Route & page

```
app/songs/
  page.tsx               server component — session branch lives here
  _components/
    view-config.tsx      SONGS_VIEWS table (label/icon/title/placeholder),
                         mirrors kids view-config
    feed-content.tsx     picks view; songs/mine drill into SongsView
    songs-view.tsx       the grid view (+ compilation drill-in)
    compilations-view.tsx tile grid of compilations (KidsTileCard-style)
    home-shelves.tsx     "Newly added" always; "Your imports" session-only
    catalog-header.tsx   public header (below)
```

`page.tsx` shape, mirroring `kids/[profileId]/page.tsx`:

- `getSession()` — no redirect ever; `session` only switches sections.
- `parseSongsFeedParams(await searchParams)` — pass `session` for the
  `mine` coerce.
- Tab strip: `songs`, `compilations`, plus `mine` **only when session**
  (anon never sees the tab; same rule as hiding their content).
- Header (see below) + `<Suspense fallback={<VideoGridSkeleton/>}>
  <FeedContent …/>`.
- `metadata`: `title: "NibrasTube Songs"`, a line about the catalog.

### Catalog header — anonymous vs signed-in

`catalog-header.tsx` = `KidsHeader` with different slots, `bg-[#F0F4FF]`
backdrop for visual parity:

- Row 1 left: `NibrasTube` brand link → `/songs`.
- Center: `<KidsSearch query={q} placeholder={…}>` — works unchanged
  (it rebuilds the URL from live `searchParams`).
- Right, anonymous: `Log in` (ghost) + `Sign up free` (primary) links.
- Right, signed-in: `Parent portal` link → `/parent/dashboard`.
- Row 2: `<KidsViewTabs tabs={tabs}>`.

Below the header, **anonymous only**: slim banner card —
"Curating parents add these songs from their own compilations.
Create a free account to import yours." with a `Sign up` CTA → `/signup`.

### Views

- **Songs view** (`songs` default, and `mine` with `importedBy=session`):
  `<FeedHeader title=… actions={<KidsSortChips …/>}>` +
  `<SongCatalogGrid>` or `<EmptyState>`
  ("No songs yet!" / signed-in: `Import songs` → `/parent/dashboard`,
   anon: `Sign up free` → `/signup`).
  `?video=<id>` drill-in adds `<BackLink>All compilations</BackLink>` +
  the compilation title — same pattern as `?channel=` in the kids feed.
- **Compilations view**: tile grid of `getCompilations()` — thumbnail,
  video title, "N songs" — each linking `?view=songs&video=<id>`
  (internal drill-in, not external).
- **Home shelves** (plain Songs tab, no `q`/`video`): "Newly added"
  (`getNewSongs`) always; "Your imports" (`getUserSongs`) session-only.
  Shelf cards: `SongShelf` reusing `video-shelf.tsx`'s snap-scroll row.

### Song card (`components/song-card.tsx`)

Mirrors `video-card.tsx` (rounded-[32px], hover lift, aspect-video
thumb = compilation's, play overlay) with songs-appropriate chrome:

- Title = `song.title`; subtitle = compilation `videoTitle` + a
  `m:ss – m:ss` range badge (`endSeconds ?? video duration ?? "end"`)
  via `formatDuration`.
- Whole card is an `<a target="_blank" rel="noopener noreferrer">` to
  `https://www.youtube.com/watch?v=<videoId>&t=<start>s` — external,
  since the in-app watch page can't play unwhitelisted segments yet.
- **Signed-in + `importedBy === session.user.id`**: a ⋮-style delete
  affordance in the card corner (sibling of the link, same
  invalid-interactive-in-interactive rule as `VideoCardMenu`) →
  `deleteSong` below. Everyone else's rows have no affordance.

## Server action (`app/actions/songs.ts`, add one)

```ts
// Owner-only delete from the public catalog (or dashboard later).
// Global row — deleting affects every viewer, so it's gated like a
// parent mutation AND on songs.importedBy === session.user.id.
export async function deleteSong(songId: string)
```

`getSession()` → `requireParentUnlocked()` → fetch the row, verify
`importedBy === session.user.id` (mismatch → `return { error }`, no
404-oracle probing beyond "couldn't delete") → `db.delete` →
`revalidatePath("/songs")`. No Pusher (see above).

`importedBy` is nullable — rows from deleted accounts are unowned and
simply can't be deleted through the UI (admin cleanup is manual).

## Explicitly out of scope (seams)

- **In-app segment playback** — `?song=<uuid>` on the watch page,
  `endSeconds`-driven advance, songs-aware whitelist check. When that
  lands, card hrefs switch from youtube.com to `/kids/<id>/watch/…`
  (kid-locked devices: still external or the locked profile's feed —
  product call then).
- **Curating/kid-facing songs view** — this catalog is the public
  registry, not a kid feed. Whitelisting individual songs for a
  profile is a separate feature (needs a per-profile song join table).
- **Anonymous `/` landing** — keep `/` → `/signup`; revisit whether the
  catalog should be the front door.
- **Pagination** — `LIMIT 240` now; cursor pagination when the registry
  actually exceeds it.
- **Live updates** — a global Pusher `songs` channel if import volume
  ever justifies it.

## Implementation order

1. Promote `feed-header.tsx` + `back-link.tsx` from
   `app/kids/[profileId]/_components/` to `components/`; update the
   kids imports (no behavior change).
2. `lib/songs-feed.ts` — params, URL builder, `getSongs`/
   `getCompilations`/`getNewSongs`/`getUserSongs`.
3. `components/song-card.tsx` + `components/song-catalog-grid.tsx`
   (mirror `kids-video-grid` incl. eager/lazy split).
4. `app/songs/` — page, `_components` (view-config, feed-content,
   songs-view, compilations-view, home-shelves, catalog-header).
5. `deleteSong` action + card affordance.
6. `npm run typecheck` + `npm run lint`. Manual pass:
   - Incognito `/songs` → catalog browses/searches, no tabs beyond
     Songs/Compilations, signup banner + Log in/Sign up buttons.
   - Signed-in `/songs` → Yours tab + Your imports shelf + delete on
     own rows + Parent portal link, no banner.
   - `?q=` filters, sort chips rewrite URL, `?video=` drill-in works,
     card opens YouTube at the right timestamp.
   - Delete someone else's song id (curl the action) → error, row kept.