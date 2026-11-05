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
Comment-source imports SHALL always write false.

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

## REMOVED Requirements

None.

## MODIFIED Requirements

None — this capability is new; prior behavior was unspec'd.
