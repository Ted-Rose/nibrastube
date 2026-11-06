# Spec Delta

## Purpose

Defines how timestamped tracklists become rows in the `songs`
catalog: the comment-first source ordering with a
description-chapters fallback, the chapter filtering rules
(intro dropped, sermon chapter onward flagged), the
`might_not_be_song` marker, preview-before-write, and per-source
re-import identity.

## ADDED Requirements

### Requirement: Commenter tracklist is the primary source

When the stored `users.songCommenterHandle` produces a parseable
tracklist among the video's comments, that tracklist SHALL be
the import source. The description-chapters fallback SHALL only
run when the comment path yields zero songs — no saved handle,
no comment by the handle, or none of the handle's comments
parse.

#### Scenario: Comment tracklist wins over chapters

- **WHEN** a video has both a parseable tracklist comment by the
  stored handle and a chapter block in its description
- **THEN** the preview shows the comment's tracklist with
  source `comment`

#### Scenario: No usable comment falls back to chapters

- **WHEN** the stored handle has no comment on the video, or none
  of their comments parse, and the video description contains a
  chapter block
- **THEN** the preview shows the chapter-derived songs with
  source `description`

#### Scenario: Neither source parses

- **WHEN** the comment path yields no songs and the description
  has no chapter-shaped block
- **THEN** the action returns an error naming both failures and
  writes nothing

### Requirement: Chapter fallback keeps uploader text only

The fallback SHALL parse `videos.description` — fetched with the
same `videos.list` call the pipeline already makes, so no
additional quota is spent. The block SHALL be chapter-shaped:
the first parsed line must start at `0:00`; descriptions failing
the gate SHALL be treated as "no chapters", not partially
parsed.

#### Scenario: Stray timestamps do not open the fallback

- **WHEN** a description contains timestamped lines but none at
  `0:00`
- **THEN** the fallback produces no songs

### Requirement: Chapter filtering rules

The first parsed chapter SHALL be dropped (the intro is never a
song). The first remaining chapter whose title starts with a
sermon marker word (case-insensitive; initial list:
`sprediķis`, `sermon`) and every chapter after it SHALL be
imported with `mightNotBeSong = true`. Chapters before the
marker SHALL be imported unflagged. When no marker matches, only
the first-chapter drop applies.

#### Scenario: Service video chapters

- **WHEN** a description parses to `0:00 Ievads`, song chapters,
  `… Sprediķis: <title>`, then more chapters
- **THEN** `Ievads` is not imported, pre-sermon chapters are
  songs, and the sermon chapter plus all following chapters are
  imported flagged `mightNotBeSong`

#### Scenario: Compilation with no sermon

- **WHEN** a description's chapters contain no marker-word title
- **THEN** all chapters except the first are imported unflagged

### Requirement: The flag is persisted, not inferred at read time

`songs.might_not_be_song` SHALL be a non-null boolean defaulting
to false, written at insert and refreshed on conflict-update.
Parser output only defaults it — the parent MAY override it per
row (see the toggle requirement). Comment-source imports
default to false.

#### Scenario: Re-import refreshes flags

- **WHEN** a video's chapters are re-imported after the marker
  list or description changed
- **THEN** upserted rows reflect the new flag values

### Requirement: Flagged songs are hidden on shared surfaces

Every `/songs` surface visible to anonymous visitors and other
parents SHALL exclude `might_not_be_song` rows: the catalog grid
and search, compilation tiles and their song counts, the "Newly
added" shelf, and the `?song=` play queue. Owner-scoped surfaces
(the "Yours" tab grid, the "Your imports" shelf) SHALL still
list the importer's flagged rows, badged, so they remain
reviewable and deletable. The `?song=<id>` by-id lookup SHALL
still resolve flagged rows so the owner can preview them.

#### Scenario: Flagged rows absent from the shared catalog

- **WHEN** a compilation's import produced flagged post-sermon
  rows
- **THEN** an anonymous visitor sees neither those rows in the
  grid nor their count in the compilation tile, and the `?song=`
  queue never advances into them

#### Scenario: Importer still sees flagged rows

- **WHEN** the importer opens "Yours" or the "Your imports"
  shelf
- **THEN** their flagged rows appear, marked "maybe not a
  song", and the owner-only delete affordance still works

### Requirement: The flag is parent-editable per row

Every song row in the import card SHALL offer a
song/not-a-song toggle. In the preview, toggle choices SHALL
ship with the import and override the parser's flag per start
offset; the re-parse SHALL still own titles and timestamps. In
the imported list, toggling SHALL update `might_not_be_song`
immediately via an owner-gated action (same guard shape as
deleteSong); non-owner rows SHALL show a static marker.

#### Scenario: Parent unflags a post-sermon song

- **WHEN** the preview flags `Lai skan Alleluja` and the parent
  toggles it to "song" before importing
- **THEN** the row is written with `might_not_be_song = false`
  and appears on shared catalog surfaces

#### Scenario: Parent flags a comment-imported row

- **WHEN** a comment-source preview is shown and the parent
  toggles a row to "not a song"
- **THEN** the import writes that row flagged despite
  `parseTracklist` leaving the flag unset

#### Scenario: Post-import retag

- **WHEN** the importer toggles a row in the imported list
- **THEN** `might_not_be_song` updates in place and shared
  surfaces reflect it on next load

#### Scenario: Non-owner sees no toggle

- **WHEN** an imported row belongs to another parent
- **THEN** the list shows the flag marker without a toggle

### Requirement: Preview before write, per source

The parent SHALL see the parsed rows — with provenance
("Tracklist by @handle" vs "Chapters from description") and a
visible marker on flagged rows — before any `songs` rows are
written. Chapter imports SHALL record
`sourceCommentId = "description"` so re-imports replace their
own output via the existing `(videoId, sourceCommentId)`
stale-row delete.

#### Scenario: Parent vets a chapter import

- **WHEN** the preview came from description chapters
- **THEN** flagged rows are marked in the preview list and the
  confirmation still requires the explicit Import action
