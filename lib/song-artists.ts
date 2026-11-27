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

// Recognized label prefixes for the singers credit line. Latvian
// "slavēšanu vada" = "worship led by"; the English spellings cover
// non-Latvian uploads using the same template.
const LEADER_LINE = new RegExp(
  "^\\s*(?:slavēšanu\\s+vada|worship\\s+(?:led\\s+by|leaders?))" +
    "\\s*[:：\\-–—]\\s*(.+?)\\s*$",
  "i"
);

// Name separators inside the credit value: commas, ampersands, plus
// signs and the conjunctions — Latvian "un" and English "and", both
// requiring surrounding spaces so they can't split inside a name.
const NAME_SEP = /\s*(?:,|&|\+|\s+un\s+|\s+and\s+)\s*/;

// A name shouldn't run a whole paragraph — a longer segment means the
// credit line bled into prose, not a longer name.
const MAX_NAME_LEN = 60;

export function parseSongArtists(description: string): string[] {
  for (const raw of description.split(/\r?\n/)) {
    const match = LEADER_LINE.exec(raw);
    if (!match) continue;

    const seen = new Set<string>();
    return match[1]
      .split(NAME_SEP)
      .map((name) => name.replace(/^[\s•·*]+|[\s.,;:!?]+$/g, ""))
      .filter((name) => {
        if (name.length === 0 || name.length > MAX_NAME_LEN) {
          return false;
        }
        const key = name.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }
  return [];
}
