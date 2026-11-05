# Design

## Context

`runSongImport` (app/actions/songs.ts) is the shared
preview/import pipeline: `getOrFetchVideo` → resolve stored
handle → `listVideoComments` → keep the handle's comments →
`parseTracklist` each → longest parse wins. `parseTracklist`
(lib/song-timestamps.ts) is text-agnostic: it already parses the
exact `0:00 Title` / `0:00:00 Title` line shape YouTube chapters
use — confirmed end-to-end on `qCrIiXtv14g` (17 chapters parsed,
`H:MM:SS`, contiguous end inference, last chapter `end=null`).

YouTube exposes no chapters endpoint; chapters are derived by
YouTube's UI from `snippet.description`, which `getVideoDetails`
already fetches and `videoRowValues` already persists to
`videos.description`. `getOrFetchVideo` just doesn't return it
yet (`SongImportVideo` lacks the field).

## Goals / Non-Goals

**Goals:**

- Import songs from videos that have description chapters but no
  commenter tracklist.
- Keep the comment path authoritative: a stored-handle tracklist
  still wins when it exists (the commenter may post a corrected
  or more detailed list).
- Keep post-sermon chapters importable but marked — service
  videos interleave songs, sermon, prayers, and communion after
  the worship block, and only the parent can tell which.
- Hide flagged rows from the shared `/songs` catalog while
  keeping them visible — and deletable — to their importer.
- Zero additional YouTube quota on the fallback path.

**Non-Goals:**

- A configurable sermon marker — hardcoded prefix list for now;
  a `users.songSermonMarker`-style preference is over-engineering
  until a second language/channel needs it.
- Per-chapter opt-out checkboxes — the flag plus existing
  owner-delete covers the "this chapter isn't a song" cleanup.
- Chapters for `youtube.com/chapters`/`t=` links, pinned comments
  by other users, or hidden-reply expansion — same v1 limits as
  today.

## Decisions

- **Comment first, chapters as fallback** — not a source toggle.
  When the stored handle produces a tracklist, it's authoritative
  (the parent configured that handle because its tracklists are
  trusted). The fallback triggers whenever the comment path
  yields zero songs: no saved handle, no comment by the handle,
  or comments that don't parse. Zero UI change — the form still
  has one "Find songs" button. Alternative (parent picks the
  source per import) — rejected: two knobs for a case that has
  an obvious precedence.
- **Chapter-shape gate: first parsed line must start at 0.**
  YouTube's own rule for chapters (first at `0:00`, ≥3 chapters,
  ≥10 s each) is approximated by requiring `startSeconds === 0`
  on the first parsed line plus `parseTracklist`'s existing ≥2
  floor. Descriptions are noisier than dedicated tracklist
  comments — a "my favorite at 3:20" line must not turn the
  whole description into a tracklist. Without the gate the
  fallback would produce garbage rows on any description with
  two stray timestamps.
- **Drop chapter[0] unconditionally.** The user's rule: the
  first chapter is the intro/ievads, never a song. Combined
  with the 0:00 gate this means the discarded chapter is always
  the `0:00` one.
- **Sermon cut = first title starting with a marker word.**
  `SERMON_MARKERS = ["sprediķis", "sermon"]`, case-insensitive,
  matched at the title's start so "Sprediķis: Atļauj sevi
  pārbaudīt" cuts while "Uz Krustu" doesn't. Everything from
  that chapter onward — including it — gets
  `mightNotBeSong = true`. No marker found → only the
  first-chapter drop applies.
- **`mightNotBeSong` as a column, not a naming convention.**
  `songs.might_not_be_song boolean notNull default false`.
  Comment imports always write false; chapter imports set it per
  row. `onConflictDoUpdate` includes it so a re-import refreshes
  flags (e.g. marker list grows later).
- **`sourceCommentId = "description"` sentinel.** The stale-row
  delete in `importSongs` is scoped to `(videoId,
  sourceCommentId)`; a fixed sentinel gives chapter imports the
  same replace-own-output semantics as comment re-imports
  without making the column's null-vs-sentinel meaning fuzzy.
  `sourceHandle` stays null; the card already guards on it.
- **`SongImportState` gains `source: "comment" | "description"`**
  so preview/imported lists can label the provenance and mark
  flagged rows. The import button count is unchanged.
- **Flagged = hidden on shared surfaces, visible to the
  importer.** `lib/songs-feed.ts` predicates split by audience:
  `eq(songs.mightNotBeSong, false)` ANDs into `getSongs` (except
  `view=mine`), `getCompilations` (so counts and tiles only
  reflect real songs), and `getNewSongs`. `getSongs(view=mine)`
  and `getUserSongs` keep flagged rows so the importer retains a
  management surface — `FeedSong` gains `mightNotBeSong` and
  `song-card.tsx` badges it. `getSong` (the `?song=` by-id
  lookup) deliberately does NOT filter: owner preview from the
  "Yours" tab must resolve, and a flagged row is never unsafe —
  the compilation already passed the made-for-kids/18+ gates;
  a shared direct link playing it is acceptable since nothing
  steers it into a list or queue. Alternative (filter `getSong`
  too, fail closed) — rejected: makes flagged rows unplayable
  for the one person who can judge them.
- **The flag is parent-editable, not parser-final.** Preview
  rows carry a song/not-a-song pill toggle whose choices ship as
  a JSON `startSeconds -> mightNotBeSong` map; `importSongs`
  still re-runs the pipeline (the parse stays authoritative for
  titles/timestamps) and applies toggles per start offset, so a
  parent can unflag a post-sermon song OR flag a comment-row —
  the toggle is offered on every row, not just chapter rows.
  Post-import, the same toggle on the imported list calls a new
  `setSongFlag` action gated exactly like `deleteSong`
  (`importedBy === session.user.id`). The preview's local
  override map is keyed to the previewed video id so a second
  preview can't inherit stale toggles.

## Data Flow

```
url --> getOrFetchVideo (videos.list; description now carried)
  |
  +-- handle saved --> listVideoComments --> parseTracklist
  |     +-- songs found --> source="comment",
  |                       mightNotBeSong=false
  |
  +-- (no handle | no comments | no parse)
        +--> parseChapters(description)
              +-- first start != 0 or <2 lines -> error
              +-- drop index 0 (intro)
              +-- sermon-marker hit at i -> rows[i..] flagged
                    --> source="description",
                        sourceCommentId="description"
```

## Risks

- **Marker list misses non-Latvian/non-English sermons** — the
  tail just imports unflagged; parent deletes via the catalog.
  Acceptable for v1.
- **Chapter block mid-description with stray timestamps above
  it** — lines before the first `0:00` line don't parse as
  tracklist entries only if they aren't timestamp-shaped; a
  timestamped junk line before the chapters shifts "first" off
  `0:00` and the gate rejects the whole block. Conservative
  direction (fail closed) — a commenter tracklist or manual edit
  covers the rare false negative.
- **Descriptions longer than comment text** — `parseTracklist`
  is line-oriented and cheap; no perf concern.
