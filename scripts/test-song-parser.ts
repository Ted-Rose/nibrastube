// Throwaway verification for the song parser + URL matcher — no test
// suite exists; run with `npx tsx scripts/test-song-parser.ts`.
import {
  parseTracklist,
  parseChapters,
  normalizeHandle,
} from "../lib/song-timestamps";
import { parseYouTubeVideoId } from "../lib/youtube";

let failures = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  const detail =
    `\n  got:  ${JSON.stringify(got)}\n` +
    `  want: ${JSON.stringify(want)}`;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`, ok ? "" : detail);
}

// The real comment from the plan (youtube.com/live/hcQavDc2qv0).
check(
  "range format",
  parseTracklist(
    "11:40 - 16:20 Godības ķēniņ (David Gate & Matt Redman)\n" +
      "16:20 - 23:04 Cik varens esi Tu, Dievs",
    2000
  ),
  [
    {
      title: "Godības ķēniņ (David Gate & Matt Redman)",
      startSeconds: 700,
      endSeconds: 980,
    },
    { title: "Cik varens esi Tu, Dievs", startSeconds: 980, endSeconds: 1384 },
  ]
);

check(
  "start-only + H:MM:SS, last = null",
  parseTracklist("0:00 Intro\n4:12 Song Two\n1:02:03 Long Song", 5000),
  [
    { title: "Intro", startSeconds: 0, endSeconds: 252 },
    { title: "Song Two", startSeconds: 252, endSeconds: 3723 },
    { title: "Long Song", startSeconds: 3723, endSeconds: null },
  ]
);

check(
  "track numbering + title cleanup",
  parseTracklist(
    "1. 0:00 - 0:30 Intro\n03) 0:30 - 1:11:00 Big Medley",
    null
  ),
  [
    { title: "Intro", startSeconds: 0, endSeconds: 30 },
    { title: "Big Medley", startSeconds: 30, endSeconds: 4260 },
  ]
);

check(
  "clamp to video duration",
  parseTracklist("1:00 - 5:00 A\n5:00 - 9:59:00 B", 540),
  [
    { title: "A", startSeconds: 60, endSeconds: 300 },
    { title: "B", startSeconds: 300, endSeconds: 540 },
  ]
);

check(
  "single line = not a tracklist",
  parseTracklist("my fave at 3:20", null),
  []
);
check(
  "one parsed line = not a tracklist",
  parseTracklist("3:20 Only", null),
  []
);

check(
  "dup starts keep first, junk end<=start dropped",
  parseTracklist(
    "5:00 - 4:00 Bad\n1:00 - 2:00 A\n1:00 - 2:30 A-dup\n3:00 - 4:00 C",
    null
  ),
  [
    { title: "A", startSeconds: 60, endSeconds: 120 },
    { title: "C", startSeconds: 180, endSeconds: 240 },
  ]
);

check(
  "unordered input sorted",
  parseTracklist("10:00 - 20:00 B\n1:00 - 9:00 A", null),
  [
    { title: "A", startSeconds: 60, endSeconds: 540 },
    { title: "B", startSeconds: 600, endSeconds: 1200 },
  ]
);

// --- parseChapters (description-chapters fallback) ---------------

check(
  "chapters: no leading 0:00 → rejected",
  parseChapters("1:00 A\n2:00 B\n3:00 C", 600),
  []
);

check(
  "chapters: stray timestamp above the block → rejected",
  parseChapters("3:20 my favorite\n0:00 Intro\n5:00 A\n10:00 B", 900),
  []
);

check(
  "chapters: first chapter (intro) dropped",
  parseChapters("0:00 Intro\n5:00 Song A\n10:00 Song B", 900),
  [
    { title: "Song A", startSeconds: 300, endSeconds: 600 },
    { title: "Song B", startSeconds: 600, endSeconds: null },
  ]
);

check(
  "chapters: sermon cut flags the tail",
  parseChapters(
    "0:00 Ievads\n2:00 Song A\n10:00 Sprediķis: Tēma\n15:00 Song B",
    1200
  ),
  [
    { title: "Song A", startSeconds: 120, endSeconds: 600 },
    {
      title: "Sprediķis: Tēma",
      startSeconds: 600,
      endSeconds: 900,
      mightNotBeSong: true,
    },
    {
      title: "Song B",
      startSeconds: 900,
      endSeconds: null,
      mightNotBeSong: true,
    },
  ]
);

check(
  "chapters: marker match is case-insensitive",
  parseChapters("0:00 Intro\n1:00 A\n2:00 SERMON part\n3:00 B", 240),
  [
    { title: "A", startSeconds: 60, endSeconds: 120 },
    {
      title: "SERMON part",
      startSeconds: 120,
      endSeconds: 180,
      mightNotBeSong: true,
    },
    {
      title: "B",
      startSeconds: 180,
      endSeconds: null,
      mightNotBeSong: true,
    },
  ]
);

check(
  "chapters: mid-title marker does not cut",
  parseChapters("0:00 Intro\n1:00 A\n2:00 Uz Sprediķi Ejām\n3:00 B", 240),
  [
    { title: "A", startSeconds: 60, endSeconds: 120 },
    { title: "Uz Sprediķi Ejām", startSeconds: 120, endSeconds: 180 },
    { title: "B", startSeconds: 180, endSeconds: null },
  ]
);

check(
  "chapters: no marker → only the intro drop",
  parseChapters("0:00 Intro\n1:00 A\n2:00 B", 180),
  [
    { title: "A", startSeconds: 60, endSeconds: 120 },
    { title: "B", startSeconds: 120, endSeconds: null },
  ]
);

check(
  "comments unchanged: parseTracklist never sets the flag",
  parseTracklist("0:00 A\n2:00 B", 300).map(
    (s) => s.mightNotBeSong ?? null
  ),
  [null, null]
);

check(
  "normalizeHandle",
  [
    normalizeHandle("@TedisRozenfelds7630"),
    normalizeHandle("https://www.youtube.com/@TedisRozenfelds7630"),
    normalizeHandle("tedisrozenfelds7630"),
  ],
  ["tedisrozenfelds7630", "tedisrozenfelds7630", "tedisrozenfelds7630"]
);

const VID = "hcQavDc2qv0";
check(
  "parseYouTubeVideoId",
  [
    parseYouTubeVideoId(`https://www.youtube.com/watch?v=${VID}`),
    parseYouTubeVideoId(`https://youtu.be/${VID}?si=abc123`),
    parseYouTubeVideoId(`https://www.youtube.com/live/${VID}`),
    parseYouTubeVideoId(`https://www.youtube.com/shorts/${VID}`),
    parseYouTubeVideoId(`https://www.youtube.com/embed/${VID}?rel=0`),
    parseYouTubeVideoId(`https://music.youtube.com/watch?v=${VID}&si=x`),
    parseYouTubeVideoId(VID),
    parseYouTubeVideoId(`youtube.com/watch?v=${VID}&t=10`),
    parseYouTubeVideoId("not a url"),
    parseYouTubeVideoId("https://youtube.com/watch?v=tooshort"),
    parseYouTubeVideoId("https://vimeo.com/12345"),
  ],
  [VID, VID, VID, VID, VID, VID, VID, VID, null, null, null]
);

console.log(failures === 0 ? "\nAll checks passed" : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
