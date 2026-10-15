# Plan: Song imports from comment timestamps

**Status: implemented** (merged in #30)

Feature branch prefix: `feature/` (e.g. `feature/song-imports`).

## Goal

Parents paste a YouTube link to a **song compilation** (live stream,
medley, album video) into a form on the parent portal. The app fetches
that video's comments, finds the comment(s) written by a **parent-
configured YouTube user** whose comments contain timestamped tracklists,
and stores each line as a **song**: title, source video, start/end
seconds.

Songs are a **global registry** (like `videos`/`channels`) — generated
once, shared by everyone, NOT tied to a kid profile or the whitelist.
Importing does not approve the video for any kid. A separate kids-facing
songs view is a later feature; this plan covers generation + storage
only, plus the seams that view will need.

## Verified input format

Pulled the real comments for
`https://www.youtube.com/live/hcQavDc2qv0` via `commentThreads.list`
(project `YOUTUBE_API_KEY`, 2 top-level comments). The target user's
comment:

```
11:40 - 16:20 Godības ķēniņ (David Gate & Matt Redman)
16:20 - 23:04 Cik varens esi Tu, Dievs
```

i.e. `MM:SS - MM:SS Title (artist)` — **explicit start AND end** per
line. The parser must also handle the `MM:SS Title` variant (end =
next line's start, last song's end = video duration) since that is the
other common tracklist style, plus `H:MM:SS` timestamps for long
streams.

## Facts established by codebase investigation

- **No YouTube-comment code exists yet.** `lib/youtube.ts` wraps
  `search`, `videos`, `channels`, `playlistItems` — all axios GETs
  against `BASE_URL` with the shared `YOUTUBE_API_KEY`, throwing when the
  key is missing. New wrappers (`commentThreads.list`,
  `channels.list?forHandle=`) belong in the same file.
- **No URL → videoId parser exists.** The dashboard only searches by
  text (`DashboardSearch` → `searchYouTube`). A `parseYouTubeVideoId`
  helper must accept `watch?v=`, `youtu.be/`, `/live/`, `/shorts/`,
  `/embed/`, `music.youtube.com`, bare 11-char IDs, and junk params like
  `si=`.
- **The `videos` cache write path already exists.** `pinVideo`
  (`app/actions/pinning.ts:26-38`) shows the pattern: `findFirst` →
  `getVideoDetails` → `videoRowValues(details)` insert, with self-heal
  when `fetchedAt` is null. Song import reuses exactly this — `videos`
  rows for imported compilations get the full rich metadata for free,
  which also feeds `durationSeconds` for the last song's `end`.
- **No parent "settings" UI exists.** `parentPin` is set at signup only.
  The commenter handle needs a home — the parent dashboard sidebar is
  the natural spot for a combined "Song imports" card (handle field +
  URL field), since a dedicated `/parent/songs` page only makes sense
  once a songs management view exists.
- **Mutation auth pattern:** `getSession()` → `requireParentUnlocked()`.
  Unlike pin/unpin there is **no** `assertCanManageProfile` — songs are
  parent-account-scoped, not profile-scoped. `importedBy` records which
  user generated each row.
- **Users row is already loaded per request** in the dashboard layout
  path patterns (see `verifyParentPin` at `app/actions/safety.ts:46-49`
  fetching `users` by `session.user.id`) — pre-filling the handle field
  costs one indexed SELECT.
- **Drizzle table style:** uuid PKs for entities (`profiles`,
  `playlists`), composite PKs for join tables, `text` for YouTube IDs,
  `integer` for seconds. A unique index fits via `uniqueIndex` in the
  table callback (currently only `primaryKey` is used there — first
  `uniqueIndex` in the schema).
- **Quota is cheap here.** `commentThreads.list` = 1 unit/page
  (100 threads/page), `channels.list` = 1, `videos.list` = 1 — ~3-8
  units per import vs the 10k/day budget. Nothing like the 100-unit
  `search` calls.

## Data model

### `users` — new column

```ts
songCommenterHandle: text("song_commenter_handle"), // e.g. "tedisrozenfelds7630"
```

Nullable, no default. A stored preference written by its own
`saveSongCommenterHandle` action (verified against `channels.list`
before saving) — the import form never carries it as a field, so no
separate settings page is needed for v1.

### `songs` — new table

```ts
export const songs = pgTable(
  "songs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    videoId: text("video_id")
      .references(() => videos.id, { onDelete: "cascade" })
      .notNull(),
    title: text("title").notNull(),
    startSeconds: integer("start_seconds").notNull(),
    // null = "play to the end of the video" — the comment gave a bare
    // start and there is no next song to bound it.
    endSeconds: integer("end_seconds"),
    sourceCommentId: text("source_comment_id"), // YT comment id — re-import identity
    sourceHandle: text("source_handle"),        // normalized handle, no "@"
    importedBy: uuid("imported_by")
      .references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    uniqueVideoStart: uniqueIndex("songs_video_start_uniq").on(
      table.videoId,
      table.startSeconds
    ),
  })
);
```

**Collision tradeoff:** `(videoId, startSeconds)` unique means two
different commenters' tracklists for the same video merge into one song
set on shared boundaries — acceptable: identical starts almost always
describe the same song, and the last import wins via upsert. If real
conflicts appear, widen the key to include `sourceCommentId`.

**Re-import semantics:** after a successful parse, delete rows matching
`(videoId, sourceCommentId)` that aren't in the new result, then upsert
the rest — an edited comment cleanly replaces its own output without
clobbering a different commenter's rows.

Then: `npm run db:generate` (commit `drizzle/`), migrate as `avnadmin`
per AGENTS.md — `ai_agent` fails silently on DDL.

## YouTube API additions (`lib/youtube.ts`)

```ts
// channels.list?part=id&forHandle=<handle> — resolves @name → UC... id.
// Returns null when the handle doesn't exist.
export async function resolveChannelHandle(handle: string): Promise<string | null>

export interface VideoComment {
  id: string;
  authorChannelId: string | null;
  authorDisplayName: string;
  text: string; // textFormat=plainText
}

// commentThreads.list, part=snippet,replies, maxResults=100, paginated.
// `replies` yields up to 5 inline replies per thread — the target user's
// tracklist is often a reply to their own or someone else's comment.
// Cap at ~5 pages (500 threads) to bound latency; threads with
// totalReplyCount > 5 whose replies could contain the author are noted
// as a known v1 limitation (comments.list?parentId= follow-up is the
// escape hatch).
export async function listVideoComments(videoId: string): Promise<VideoComment[]>
```

## Timestamp parser (`lib/song-timestamps.ts`, pure)

```ts
export interface ParsedSong {
  title: string;
  startSeconds: number;
  endSeconds: number | null;
}

export function parseTracklist(
  commentText: string,
  videoDurationSeconds: number | null
): ParsedSong[]
```

Per-line rules:

1. **Range line** — `^\s*(TS)\s*[-–—:]\s*(TS)\s*[-–—:]?\s*(.+)$` where
   `TS` = `(\d{1,3}:)?\d{1,2}:\d{2}`. Explicit `start - end` wins.
   Strip track numbering (`"3."`, `"03)"`) and leading separators from
   the title.
2. **Start-only line** — `^\s*(TS)\s*[-–—:]?\s*(.+)$`. `end` =
   next parsed line's `start`. The **last** song keeps
   `endSeconds = null` — playback just starts at `startSeconds` and
   runs to the video's end (more robust than clamping to the API's
   `durationSeconds`, which can be a second off and clip the tail).
3. A comment counts as a tracklist only when **≥2 lines** parse — one
   lone timestamp ("my favourite at 3:20!") is not a tracklist.
4. Sanitize: drop entries with `end <= start`, sort by `startSeconds`,
   merge/keep-first on duplicate starts, clamp `end` to
   `videoDurationSeconds` when known.

**Which comment wins:** collect all comments by the configured author
(handle match, below), parse each, take the one with the **most parsed
lines**; tie → earliest `publishedAt`. Alternative (merge all lines
across the author's comments, sorted by start) is a noted variant —
single-comment-wins is more predictable for preview/confirm UX.

**Author matching:** normalize the stored handle (strip `@`, `https://
youtube.com/@…`, lowercase) → `resolveChannelHandle` → match
`authorChannelId === resolved`. Fallback when handle resolution fails or
the comment predates channel IDs surfacing: `authorDisplayName`
case-insensitive equals `"@" + handle`.

## Server actions (`app/actions/songs.ts`, `"use server"`)

Two actions so the parent can eyeball the parse before anything lands —
comment formats drift and a wrong handle otherwise writes garbage:

```ts
// Dry run: URL → videoId → ensure video details (for duration) →
// comments → author match → parse. Returns { video: {id,title,thumb,
// durationSeconds}, songs: ParsedSong[] } or { error: string }.
// No writes. Costs ~3-6 quota units.
export async function previewSongImport(prevState, formData)

// Confirm: reruns the same pipeline deterministically against the
// stored handle, writes the videos row if still missing, applies the
// re-import delete+upsert. Redirects back with ?songsVideo=<id> so the
// card can show the imported list.
export async function importSongs(prevState, formData)

// Preference save: normalize → verify via channels.list (rejects typos
// up front) → persist users.songCommenterHandle → revalidatePath.
export async function saveSongCommenterHandle(prevState, formData)
```

Auth on both: `getSession()` → `requireParentUnlocked()` — same shape
as `pinVideo` minus `assertCanManageProfile`. No Pusher event: nothing
kid-facing depends on songs yet (the future songs view will add
`songs-imported` on `profile-*` or a global channel then).

Error cases surfaced to the form (string `error`, mirroring
`verifyParentPin`'s `{ error }` return):

- URL doesn't parse → "That's not a YouTube link I recognize."
- `videos.list` empty / `commentThreads` 403 `commentsDisabled` →
  "Couldn't load comments for that video (disabled or removed?)."
- Handle lookup null → "No YouTube channel for @handle — check spelling."
- Author found, no tracklist → "Found N comments by @handle but no
  timestamped tracklist."
- Author absent → "No comments by @handle on that video." (report
  comments scanned so a capped scan is honest about partial coverage)

## UI surface (parent dashboard)

New `components/song-import-form.tsx` client component in the sidebar,
below `ApprovedChannelsCard` — a `Card` titled **Import songs** with:

- The commenter handle shown as a stored preference (`Song commenter:
  @handle · Change`) once set; the bare `Input` + Save button only
  appears while unset or being edited — the handle is never re-asked
  per import and never round-trips as a form field.
- URL `Input` + `SubmitButton` "Find songs" → `previewSongImport`.
- Preview state renders the parsed list (`m:ss — m:ss Title`, video
  title + thumbnail) with a confirm `SubmitButton` "Import N songs" →
  `importSongs`.
- After import, the card lists existing songs for that videoId
  (`?songsVideo=` param) with a short "N songs from @handle" summary.

`DashboardSearch` is the precedent for a client form in an otherwise
server-rendered dashboard. The card needs `songCommenterHandle` — the
dashboard already has `session`, so fetch the `users` row next to
`getManageableProfiles`.

## Explicitly out of scope (seams for later)

- **Kids-facing songs view** — new `KidsView` entry, song cards,
  drill-in per compilation. The `songs` table plus the `KIDS_VIEWS`
  table/`feed-content.tsx` switch make this additive.
- **Segment playback** — `WatchExperience.PlaylistVideo` needs
  `endSeconds`; the existing 500 ms tick already polls position, so
  `time >= endSeconds` can drive `advance()` (more reliable than the
  `end` playerVar, which also fights the resume/snapback logic keyed on
  `videoId`). A **null** `endSeconds` skips the check entirely — the
  song is "the rest of the video" and the normal ENDED/near-end
  advance path takes over.
- **Watch auth for segment-only videos** — today `/watch/[videoId]` and
  `/api/watch-progress` gate on `whitelisted_videos` by `videoId`.
  Playing songs without whitelisting the compilation needs a
  songs-aware check (e.g. `?song=<uuid>` resolving to a `songs` row for
  the profile's parent space).
- **Song-level progress/reactions** — `watch_progress` is keyed
  `(profileId, videoId)`; a 3-minute song inside a 5-hour video would
  poison "Continue watching" for the compilation. A song-scoped
  progress table is the clean fix when playback lands.

## Implementation order

1. `lib/db/schema.ts`: `users.songCommenterHandle`, `songs` table →
   `npm run db:generate` → migrate as `avnadmin`.
2. `lib/song-timestamps.ts` parser (pure, unit-testable by hand —
   no test suite exists; verify via a throwaway `node` script against
   the real comment text above).
3. `lib/youtube.ts`: `parseYouTubeVideoId` (or `lib/` util),
   `resolveChannelHandle`, `listVideoComments`.
4. `app/actions/songs.ts`: `previewSongImport`, `importSongs`.
5. `components/song-import-form.tsx` + dashboard wiring.
6. `npm run typecheck` + `npm run lint`, manual pass: import
   `hcQavDc2qv0` with `tedisrozenfelds7630` → expect the 2 songs above;
   re-import → same 2 rows, no dupes; bad handle / comments-disabled
   video → friendly errors.
```
