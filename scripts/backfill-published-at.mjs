// One-off backfill: fills videos.published_at (and channel_id where missing)
// from the YouTube Data API for rows cached before those columns existed.
// Run: node scripts/backfill-published-at.mjs
import pg from "pg";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
process.loadEnvFile(join(root, ".env"));

const { DATABASE_URL, YOUTUBE_API_KEY } = process.env;
if (!DATABASE_URL || !YOUTUBE_API_KEY) {
  console.error("DATABASE_URL and YOUTUBE_API_KEY must be set (see .env)");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: DATABASE_URL });

const { rows } = await pool.query(
  `select id from videos where published_at is null or channel_id is null`
);
console.log(`${rows.length} video(s) need backfilling`);

let updated = 0;
for (let i = 0; i < rows.length; i += 50) {
  const ids = rows.slice(i, i + 50).map((r) => r.id);
  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.search = new URLSearchParams({
    part: "snippet",
    id: ids.join(","),
    key: YOUTUBE_API_KEY,
  }).toString();

  const res = await fetch(url);
  if (!res.ok) {
    console.error(`YouTube API error ${res.status}: ${await res.text()}`);
    break; // quota or auth failure — safe to re-run later
  }

  for (const item of (await res.json()).items ?? []) {
    const publishedAt = item.snippet?.publishedAt ?? null;
    const channelId = item.snippet?.channelId ?? null;
    if (!publishedAt && !channelId) continue;
    await pool.query(
      `update videos set
         published_at = coalesce(published_at, $2),
         channel_id = coalesce(channel_id, $3)
       where id = $1`,
      [item.id, publishedAt, channelId]
    );
    updated++;
  }
  console.log(`processed ${Math.min(i + 50, rows.length)}/${rows.length}`);
}

await pool.end();
console.log(`done — updated ${updated} video(s)`);
