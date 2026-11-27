/**
 * Backfill songs.artists by re-parsing the singers credit line
 * ("Slavēšanu vada: …") in each imported compilation's YouTube
 * description — see lib/song-artists.ts.
 *
 * Run via npm so .env is loaded:
 *   npm run songs:backfill-artists -- [--dry-run] [--ids id,...]
 *
 * Defaults to every video that has imported songs. Reads the cached
 * videos.description; rows missing one are healed with a batched
 * videos.list call (~1 quota unit per 50) and an upsert — the same
 * refresh path scripts/refresh-videos.ts uses.
 *
 * Only non-empty parses are written: a video with no credit line
 * leaves artists NULL ("unknown"), and a re-run can't erase artists
 * a since-edited description no longer carries.
 */

import { parseArgs } from "node:util";

// .env isn't auto-loaded outside Next.js. Dynamic imports in main()
// keep lib/db and lib/youtube from reading env vars before this runs.
try {
  process.loadEnvFile(".env");
} catch {
  // no .env — rely on real environment variables
}

const { values: args } = parseArgs({
  options: {
    ids: { type: "string" },
    "dry-run": { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});

const USAGE =
  "npm run songs:backfill-artists -- [--dry-run] [--ids id,...]";

async function main() {
  const { count, eq, inArray } = await import("drizzle-orm");
  const { db } = await import("@/lib/db");
  const { songs, videos } = await import("@/lib/db/schema");
  const { upsertVideoRows } = await import("@/lib/video-cache");
  const { getVideosBatch, captureYouTubeException } = await import(
    "@/lib/youtube"
  );
  const { parseSongArtists } = await import("@/lib/song-artists");

  if (args.help) {
    console.log(USAGE);
    return;
  }

  const ids =
    args.ids
      ?.split(",")
      .map((s) => s.trim())
      .filter(Boolean) ?? [];

  // One row per compilation that has imported songs.
  const targets = await db
    .selectDistinct({ videoId: songs.videoId })
    .from(songs)
    .where(ids.length ? inArray(songs.videoId, ids) : undefined)
    .then((rows) => rows.map((r) => r.videoId));

  console.log(`${targets.length} compilation video(s) matched.`);
  if (targets.length === 0) return;

  const rows = await db
    .select({ id: videos.id, description: videos.description })
    .from(videos)
    .where(inArray(videos.id, targets));
  const descriptions = new Map(rows.map((r) => [r.id, r.description]));

  // Videos whose cached description is missing get one batched
  // videos.list fetch — the same self-heal refresh-videos runs.
  const stale = targets.filter((id) => descriptions.get(id) == null);
  if (stale.length) {
    let details: Awaited<ReturnType<typeof getVideosBatch>> = [];
    try {
      details = await getVideosBatch(stale);
    } catch (err) {
      captureYouTubeException(err);
      console.log(
        `${stale.length} video(s) could not be re-fetched ` +
          "(deleted/private or API error) — skipping their songs."
      );
    }
    for (const d of details) descriptions.set(d.id, d.description);
    if (!args["dry-run"] && details.length) {
      await upsertVideoRows(details);
      console.log(`Healed ${details.length} stale videos row(s).`);
    }
  }

  let videosWithArtists = 0;
  let songsUpdated = 0;
  for (const videoId of targets) {
    const description = descriptions.get(videoId) ?? null;
    if (description == null) {
      console.log(`  ${videoId}  no description — skipped`);
      continue;
    }
    const artists = parseSongArtists(description);
    if (artists.length === 0) {
      console.log(`  ${videoId}  no credit line — left NULL`);
      continue;
    }

    const [{ n }] = await db
      .select({ n: count() })
      .from(songs)
      .where(eq(songs.videoId, videoId));
    videosWithArtists++;
    console.log(
      `  ${videoId}  ${artists.join(", ")}  → ${n} song(s)`
    );
    if (!args["dry-run"]) {
      const res = await db
        .update(songs)
        .set({ artists })
        .where(eq(songs.videoId, videoId));
      songsUpdated += res.rowCount ?? 0;
    }
  }

  console.log(
    args["dry-run"]
      ? `\nDry run — ${videosWithArtists}/${targets.length} ` +
          "video(s) yielded artists; nothing written."
      : `\nDone — artists written for ${videosWithArtists}/` +
          `${targets.length} video(s), ${songsUpdated} song row(s).`
  );
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
