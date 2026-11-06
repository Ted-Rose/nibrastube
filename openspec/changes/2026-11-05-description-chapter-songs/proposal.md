# Proposal

## Why

The song importer only reads timestamped tracklists posted in the
comments by a configured commenter handle
(`users.songCommenterHandle`). Many compilation and service videos
carry the same structure as uploader-authored description
chapters — verified live against `qCrIiXtv14g`, whose description
holds a 17-chapter `0:00:00`-style tracklist that the existing
`parseTracklist` parser already handles cleanly. When the
commenter never posted (or their comment has no parseable
tracklist), the import today just fails with "No comments by
@handle".

Service videos mix songs with non-song chapters — sermon,
prayers, communion — so the fallback can't import every chapter
blindly, but it also can't drop the whole tail: chapters after
the sermon still contain songs ("Lai skan Alleluja", "Cienīgs ir
Tavs Vārds" both post-date the sermon on the reference video).

## What Changes

- `runSongImport` keeps the comment path first: stored handle →
  comments → tracklist. When that yields no songs (no handle
  saved, no comment by the handle, or none of their comments
  parse), it falls back to parsing the video's own
  `description` — already fetched and cached on the `videos` row,
  so the fallback costs zero extra quota.
- New `parseChapters()` in `lib/song-timestamps.ts` wraps
  `parseTracklist` with chapter rules: the block must start at
  `0:00` (YouTube's own chapter requirement — keeps stray
  description timestamps out); the first chapter is never
  imported (it's the intro/ievads); the first chapter whose title
  starts with a hardcoded sermon marker (`sprediķis`, `sermon`)
  and every chapter after it are imported with
  `mightNotBeSong = true`.
- `songs` gains a `might_not_be_song` boolean (default false,
  not null) marking post-sermon chapters — "probably not a song,
  but kept because some are". Comment imports always write false.
- `/songs` hides flagged rows on every shared surface: the
  catalog grid and search, the compilations tiles and their
  song counts, the "Newly added" shelf, and the `?song=` play
  queue. Owner-scoped surfaces (the "Yours" tab grid, the "Your
  imports" shelf) still show them — badged — so the importer can
  review and delete wrong guesses; a by-id `?song=` lookup still
  resolves so the owner can preview a flagged row.
- Chapter imports record `sourceCommentId = "description"` so
  re-imports replace their own rows exactly like comment-based
  re-imports do; `sourceHandle` stays null.
- The preview/imported lists show the source ("Chapters from
  description" vs "Tracklist by @handle") and mark flagged rows
  so the parent sees which entries are suspect before writing.
- Every song row gets a song/not-a-song toggle the parent can
  flip: in the preview the choices serialize into the import
  (overriding the parser's flags per start offset), and in the
  imported list a new owner-gated `setSongFlag` action re-marks
  existing rows — this is also the "unflag" path for wrongly
  flagged real songs.
- No schema migration complexity: one nullable-free boolean with
  a default; `npm run db:generate` produces the migration,
  `npm run db:migrate` is a user hand-off.

## Capabilities

### New Capabilities

- `song-import`: the tracklist-import pipeline — comment-first
  ordering with description-chapter fallback, chapter filtering
  rules (first dropped, sermon cut flags the tail), the
  `might_not_be_song` marker and its effect on catalog
  visibility, preview-before-write, and re-import identity per
  source.

### Modified Capabilities

- None. `/songs` visibility filtering is spec'd inside the new
  capability — the catalog was previously unspec'd.

## Impact

- Code: `lib/song-timestamps.ts` (`parseChapters`, sermon-marker
  list, `ParsedSong.mightNotBeSong`), `lib/db/schema.ts` (new
  column), `app/actions/songs.ts` (description carried through
  `SongImportVideo`, fallback branch in `runSongImport`, sentinel
  `sourceCommentId`, `source` on `SongImportState`, flag written
  on insert/upsert),
  `app/parent/dashboard/_components/song-import-form.tsx` and
  `song-import-card.tsx` (source label + flagged-row marker,
  card copy), `lib/songs-feed.ts` (flag column + predicates on
  all five read helpers), `components/song-card.tsx`
  ("maybe not a song" badge, owner views only),
  `scripts/test-song-parser.ts` (chapter checks).
- DB: `npm run db:generate` (agent-safe); **`npm run db:migrate`
  is a user hand-off** per project rules.
- Whitelist-safety impact: tightening only — the fallback reads
  uploader-authored description text of a video the parent
  already chose to vet, and `mightNotBeSong` hides rows from
  public/anonymous catalog surfaces. Kids see strictly fewer
  songs, never more.
