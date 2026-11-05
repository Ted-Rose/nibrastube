# Tasks

## 1. Parser

- [ ] 1.1 `lib/song-timestamps.ts`: add `SERMON_MARKERS`
      (`["sprediķis", "sermon"]`, case-insensitive title-prefix
      match) and `mightNotBeSong?: boolean` on `ParsedSong`
- [ ] 1.2 Add `parseChapters(description, durationSeconds)`:
      reuse `parseTracklist`, reject unless the first parsed
      line starts at 0, drop index 0, flag the sermon-marker
      chapter and all following rows with
      `mightNotBeSong = true`

## 2. Schema

- [ ] 2.1 `lib/db/schema.ts`: `songs.mightNotBeSong` —
      `boolean("might_not_be_song").notNull().default(false)`
- [ ] 2.2 `npm run db:generate` — commit the migration file
      (**user hand-off: `npm run db:migrate`**, agents never
      run it)

## 3. Pipeline

- [ ] 3.1 `app/actions/songs.ts`: carry `description` through
      `SongImportVideo`/`getOrFetchVideo` (cached row column +
      `FullVideoDetails.description` on fresh fetch)
- [ ] 3.2 `runSongImport`: on no usable commenter tracklist (no
      handle, no comment by handle, no parse), run
      `parseChapters` on the description; result gets
      `sourceCommentId = "description"`, `sourceHandle = null`,
      `source = "description"`; comment path sets
      `source = "comment"`
- [ ] 3.3 `SongImportState` gains `source`; `importSongs`
      inserts/upserts `mightNotBeSong` (comment rows always
      false)
- [ ] 3.4 Error copy: when both paths fail, message reflects
      "no tracklist comment and no description chapters"

## 4. Catalog visibility

- [ ] 4.1 `lib/songs-feed.ts`: add `songs.mightNotBeSong` to
      `feedSongCols`/`SongRow`/`toFeedSong`; AND
      `eq(songs.mightNotBeSong, false)` into `getSongs` (skipped
      for `view=mine`), `getCompilations`, and `getNewSongs`;
      `getSong` and `getUserSongs` unfiltered
- [ ] 4.2 `components/song-card.tsx`: "maybe not a song" badge
      when `mightNotBeSong` (only reachable via owner views)

## 5. UI

- [ ] 5.1 `song-import-form.tsx`: preview shows provenance
      ("Tracklist by @handle" vs "Chapters from description")
      and a muted marker on `mightNotBeSong` rows
- [ ] 5.2 `song-import-card.tsx`: imported list marks flagged
      rows; card description mentions chapters

## 6. Verification

- [ ] 6.1 `scripts/test-song-parser.ts`: checks for chapter
      gating (no leading 0:00 → reject), first-chapter drop,
      sermon cut flagging, no-marker case, and that comment
      behavior is unchanged
- [ ] 6.2 `npm run typecheck` + `npm run lint` clean
- [ ] 6.3 `awk 'length > 79'` on every touched file — no
      violations
- [ ] 6.4 Re-run the live check against `qCrIiXtv14g`: 16 songs
      (17 chapters − intro), flagged set = `Sprediķis:…` +
      everything after it
- [ ] 6.5 `/songs` spot-check: flagged rows absent from catalog,
      compilations count, and "Newly added"; present + badged on
      "Yours"/"Your imports"; `?song=<flagged-id>` still plays

## Workflow follow-up

- Open a draft PR against `Ted-Rose/nibrastube` with UI
  verification steps (import the reference video through the
  dashboard card, confirm flagged rows in preview and in the
  imported list).
- Remind the user to run `npm run db:migrate` before verifying.
- Archive this change per openspec-archive-change once merged.
