# Tasks

## 1. Parser

- [x] 1.1 `lib/song-timestamps.ts`: add `SERMON_MARKERS`
      (`["sprediķis", "sermon"]`, case-insensitive title-prefix
      match) and `mightNotBeSong?: boolean` on `ParsedSong`
- [x] 1.2 Add `parseChapters(description, durationSeconds)`:
      reuse `parseTracklist`, reject unless the first parsed
      line starts at 0, drop index 0, flag the sermon-marker
      chapter and all following rows with
      `mightNotBeSong = true`

## 2. Schema

- [x] 2.1 `lib/db/schema.ts`: `songs.mightNotBeSong` —
      `boolean("might_not_be_song").notNull().default(false)`
- [x] 2.2 `npm run db:generate` — commit the migration file
      (**user hand-off: `npm run db:migrate`**, agents never
      run it)

## 3. Pipeline

- [x] 3.1 `app/actions/songs.ts`: carry `description` through
      `SongImportVideo`/`getOrFetchVideo` (cached row column +
      `FullVideoDetails.description` on fresh fetch)
- [x] 3.2 `runSongImport`: on no usable commenter tracklist (no
      handle, no comment by handle, no parse), run
      `parseChapters` on the description; result gets
      `sourceCommentId = "description"`, `sourceHandle = null`,
      `source = "description"`; comment path sets
      `source = "comment"`
- [x] 3.3 `SongImportState` gains `source`; `importSongs`
      inserts/upserts `mightNotBeSong` (comment rows always
      false)
- [x] 3.4 Error copy: when both paths fail, message reflects
      "no tracklist comment and no description chapters"

## 4. Catalog visibility

- [x] 4.1 `lib/songs-feed.ts`: add `songs.mightNotBeSong` to
      `feedSongCols`/`SongRow`/`toFeedSong`; AND
      `eq(songs.mightNotBeSong, false)` into `getSongs` (skipped
      for `view=mine`), `getCompilations`, and `getNewSongs`;
      `getSong` and `getUserSongs` unfiltered
- [x] 4.2 `components/song-card.tsx`: "maybe not a song" badge
      when `mightNotBeSong` (only reachable via owner views)

## 5. UI

- [x] 5.1 `song-import-form.tsx`: preview shows provenance
      ("Tracklist by @handle" vs "Chapters from description")
      and a muted marker on `mightNotBeSong` rows
- [x] 5.2 `song-import-card.tsx`: imported list marks flagged
      rows; card description mentions chapters

## 6. Parent-editable flag toggles

- [x] 6.1 `app/actions/songs.ts`: `importSongs` accepts a JSON
      `flags` map (startSeconds → mightNotBeSong) overriding the
      parser's flags per row; new owner-gated `setSongFlag`
      action (same guard shape as `deleteSong`)
- [x] 6.2 New `song-flag-toggle.tsx`: presentational
      `SongFlagToggle` pill + `SongFlagToggleAction` writing
      through the action
- [x] 6.3 `song-import-form.tsx`: per-row toggle on every
      preview row; overrides keyed to the previewed video,
      serialized as `flags` into the import form
- [x] 6.4 `song-import-card.tsx`: per-row toggle on imported
      rows the viewer owns; others keep the static marker

## 7. Verification

- [x] 7.1 `scripts/test-song-parser.ts`: checks for chapter
      gating (no leading 0:00 → reject), first-chapter drop,
      sermon cut flagging, no-marker case, and that comment
      behavior is unchanged
- [x] 7.2 `npm run typecheck` + `npm run lint` clean
- [x] 7.3 `awk 'length > 79'` on every touched file — no
      violations
- [x] 7.4 Re-run the live check against `qCrIiXtv14g`: 16 songs
      (17 chapters − intro), flagged set = `Sprediķis:…` +
      everything after it
- [ ] 7.5 `/songs` spot-check (migration applied; manual UI
      pass): flagged rows absent from catalog, compilations
      count, and "Newly added"; present + badged on
      "Yours"/"Your imports"; `?song=<flagged-id>` still plays;
      toggles flip rows in preview AND post-import

## Workflow follow-up

- Open a ready-for-review PR against `Ted-Rose/nibrastube`
  with UI
  verification steps (import the reference video through the
  dashboard card, confirm flagged rows in preview and in the
  imported list).
- Remind the user to run `npm run db:migrate` before verifying.
- Archive this change per openspec-archive-change once merged.
