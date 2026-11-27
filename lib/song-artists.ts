// Extracts the worship-leader names ("who is singing") from a
// compilation video's uploader description. The church-service
// uploads the catalog is built from carry a dedicated credit line:
//
//   Sludina: Kristaps Āboltiņš          ← preacher, NOT singers
//   Slavēšanu vada: Daniēls Oleksa un Renāte Luīze Cietvīra
//
// One video = one worship team, so every song imported from a video
// shares the same artist list (songs.artists). Returns [] when no
// credit line parses — callers store NULL, meaning "unknown", not
// "none". The preacher's line is deliberately not matched.

// Recognized label for the singers credit line. Latvian "slavēšanu
// vada" = "worship led by" — [eē][sš] also accepts the
// diacritic-less "slavesanu" some uploaders type; the English
// spellings cover non-Latvian uploads using the same template. The
// line may lead with whitespace, bullets or emoji, but no
// letters/digits.
const LEADER_LINE = new RegExp(
  "^[^\\p{L}\\p{N}]*" +
    "(?:slav[eē][sš]anu\\s+vada|worship\\s+(?:led\\s+by|leaders?))" +
    "\\s*[:：\\-–—]\\s*(.+?)\\s*$",
  "iu"
);

// Name separators inside the credit value: commas, ampersands, plus
// signs, pipes/semicolons (occasional inline field separators) and
// the conjunctions — Latvian "un" and English "and", both requiring
// surrounding spaces so they can't split inside a name. A "/" is
// deliberately not a separator — act names like "A/B" exist.
const NAME_SEP = /\s*(?:,|&|\+|\||;|\s+un\s+|\s+and\s+)\s*/;

// A name shouldn't run a whole paragraph — a longer segment means the
// credit line bled into prose, not a longer name. Segments carrying
// a colon are a second credit line inlined by a separator
// ("A | Sludina: B"), not a person.
const MAX_NAME_LEN = 60;

// Whole-segment rejects: a bare credit label inlined by a separator
// ("A | Sludina:" → "Sludina") is not a person either.
const LABEL_WORDS = new Set([
  "sludina",
  "tēma",
  "tema",
  "preacher",
  "sermon",
  "worship led by",
  "worship leader",
  "worship leaders",
  "slavēšanu vada",
  "slavesanu vada",
]);

export function parseSongArtists(description: string): string[] {
  const seen = new Set<string>();
  for (const raw of description.split(/\r?\n/)) {
    const match = LEADER_LINE.exec(raw);
    if (!match) continue;

    const artists = match[1]
      .split(NAME_SEP)
      .map((name) =>
        name
          // Punctuation → conjunctions → punctuation again:
          // "(Anna) un" needs all three passes to land on "Anna";
          // a leading "and" survives the ", " split of an Oxford
          // comma ("A, B, and C").
          .replace(/^[\p{P}\s]+|[\p{P}\s]+$/gu, "")
          .replace(/^(?:un|and)\s+|\s+(?:un|and)$/gi, "")
          .replace(/^[\p{P}\s]+|[\p{P}\s]+$/gu, "")
          .trim()
      )
      .filter((name) => {
        if (
          name.length === 0 ||
          name.length > MAX_NAME_LEN ||
          /[:：]/.test(name) ||
          LABEL_WORDS.has(name.toLowerCase())
        ) {
          return false;
        }
        const key = name.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    // A matched-but-empty credit line keeps the scan going — a
    // second, well-formed one later in the description still wins.
    if (artists.length > 0) return artists;
  }
  return [];
}
