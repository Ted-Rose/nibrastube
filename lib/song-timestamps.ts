// Pure parser for timestamped tracklist comments on compilation videos.
// Two real-world formats, mixed freely:
//   "11:40 - 16:20 Godības ķēniņ (David Gate & Matt Redman)"  — range
//   "0:00 Intro"                                             — start only
// For start-only lines the song runs until the next parsed line's
// start; the last one keeps endSeconds=null meaning "the rest of the
// video" (playback stops at the natural end, more robust than clamping
// to the API's durationSeconds which can be a second off).

export interface ParsedSong {
  title: string;
  startSeconds: number;
  endSeconds: number | null;
  // Set only by parseChapters: the sermon chapter and everything
  // after it on service videos is probably not a song — kept because
  // some are, hidden from the shared catalog until the parent
  // confirms.
  mightNotBeSong?: boolean;
}

// Title prefixes that mark the sermon chapter on service videos.
// Lowercase; matched case-insensitively at the title's start, so
// "Sprediķis: Atļauj sevi pārbaudīt" cuts while "Uz Krustu" doesn't.
export const SERMON_MARKERS = ["sprediķis", "sermon"];

// M:SS / MM:SS / H:MM:SS (up to 3-digit hours)
const TS = "(?:\\d{1,3}:)?\\d{1,2}:\\d{2}";
const SEP = "[-–—:]";
// Optional leading track numbering: "3. " / "03) "
const NUM = "(?:\\d{1,3}\\s*[.)]\\s+)?";

const RANGE_LINE = new RegExp(
  `^\\s*${NUM}(${TS})\\s*${SEP}\\s*(${TS})\\s*${SEP}?\\s*(.+)$`
);
const START_LINE = new RegExp(
  `^\\s*${NUM}(${TS})\\s*${SEP}?\\s*(.+)$`
);

function timestampToSeconds(ts: string): number {
  return ts
    .split(":")
    .map(Number)
    .reduce((acc, part) => acc * 60 + part, 0);
}

function cleanTitle(raw: string): string {
  return raw
    .replace(/^\d{1,3}\s*[.)]\s+/, "") // "3. " / "03) " after the timestamp
    .replace(/^[-–—:·\s]+/, "") // leftover separators before the title
    .trim();
}

export function parseTracklist(
  commentText: string,
  videoDurationSeconds: number | null
): ParsedSong[] {
  const lines: ParsedSong[] = [];

  for (const raw of commentText.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    const range = RANGE_LINE.exec(line);
    if (range) {
      const title = cleanTitle(range[3]);
      if (!title) continue;
      lines.push({
        title,
        startSeconds: timestampToSeconds(range[1]),
        endSeconds: timestampToSeconds(range[2]),
      });
      continue;
    }

    const start = START_LINE.exec(line);
    if (start) {
      const title = cleanTitle(start[2]);
      if (!title) continue;
      lines.push({
        title,
        startSeconds: timestampToSeconds(start[1]),
        endSeconds: null, // start-only: filled by the next line's start
      });
    }
  }

  // One lone timestamp ("my favourite at 3:20!") is not a tracklist.
  if (lines.length < 2) return [];

  // Start-only lines end where the next parsed line begins. The last
  // song keeps null — "play to the end of the video".
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].endSeconds === null && i + 1 < lines.length) {
      lines[i].endSeconds = lines[i + 1].startSeconds;
    }
  }

  const songs = lines
    .filter((s) => s.endSeconds === null || s.endSeconds > s.startSeconds)
    .sort((a, b) => a.startSeconds - b.startSeconds)
    .filter(
      // Shared start = same song listed twice; keep the first.
      (s, i, arr) => i === 0 || s.startSeconds !== arr[i - 1].startSeconds
    )
    .map((s) => ({
      ...s,
      endSeconds:
        s.endSeconds !== null && videoDurationSeconds !== null
          ? Math.min(s.endSeconds, videoDurationSeconds)
          : s.endSeconds,
    }))
    .filter((s) => s.endSeconds === null || s.endSeconds > s.startSeconds);

  return songs.length >= 2 ? songs : [];
}

// Description-chapters fallback for the song importer: YouTube
// chapters live in the uploader's own description text in the same
// "0:00 Title" shape parseTracklist handles, but descriptions are
// noisier than tracklist comments, so extra rules apply:
//   - gate: the first timestamp-shaped line must start at 0:00 and
//     it must survive as the first parsed chapter (YouTube's own
//     chapter rule — a stray "3:20 my favorite" line above the block
//     rejects the whole description instead of importing as a song);
//   - the first chapter is the intro/ievads, never a song — dropped;
//   - from the first chapter whose title starts with a sermon marker
//     onward, rows import flagged mightNotBeSong (kept because some
//     post-sermon chapters still are songs).
export function parseChapters(
  description: string,
  videoDurationSeconds: number | null
): ParsedSong[] {
  let firstStart: number | null = null;
  for (const raw of description.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const match = RANGE_LINE.exec(line) ?? START_LINE.exec(line);
    if (match) {
      firstStart = timestampToSeconds(match[1]);
      break;
    }
  }
  if (firstStart !== 0) return [];

  const chapters = parseTracklist(description, videoDurationSeconds);
  if (chapters.length === 0 || chapters[0].startSeconds !== 0) {
    return [];
  }

  const songs = chapters.slice(1);
  const sermonAt = songs.findIndex((s) => {
    const title = s.title.toLowerCase();
    return SERMON_MARKERS.some((marker) => title.startsWith(marker));
  });
  if (sermonAt === -1) return songs;
  return songs.map((s, i) =>
    i >= sermonAt ? { ...s, mightNotBeSong: true } : s
  );
}

// "@Foo", "https://youtube.com/@Foo", "foo" → "foo". Stored and compared
// lowercase; YouTube handles are case-insensitive.
export function normalizeHandle(input: string): string {
  let handle = input.trim();
  const url = /(?:youtube\.com|youtu\.be)\/@([^/?\s]+)/i.exec(handle);
  if (url) handle = url[1];
  return handle.replace(/^@/, "").toLowerCase();
}
