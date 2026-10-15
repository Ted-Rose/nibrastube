// Throwaway verification for the song parser + URL matcher — no test
// suite exists; run with `npx tsx scripts/test-song-parser.ts`.
import { parseTracklist, normalizeHandle } from "../lib/song-timestamps";
import { parseYouTubeVideoId } from "../lib/youtube";

let failures = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(
    `${ok ? "PASS" : "FAIL"} ${name}`,
    ok ? "" : `\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`
  );
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
  parseTracklist("1:00 - 5:00 A\n5:00 - 9:99:00 B".replace("9:99", "9:59"), 540),
  [
    { title: "A", startSeconds: 60, endSeconds: 300 },
    { title: "B", startSeconds: 300, endSeconds: 540 },
  ]
);

check("single line = not a tracklist", parseTracklist("my fave at 3:20", null), []);
check("one parsed line = not a tracklist", parseTracklist("3:20 Only", null), []);

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
