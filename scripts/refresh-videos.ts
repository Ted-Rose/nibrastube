/**
 * Re-fetch YouTube metadata for `videos` cache rows that are missing
 * fields (or otherwise match a filter) and overwrite them — the same
 * videos.list → upsert path channel sync uses.
 *
 * Run via npm so .env is loaded:
 *   npm run videos:refresh -- [filters] [--dry-run] [--prune] [--limit N]
 *
 * Selectors (AND-combined; default is --stale when none are given):
 *   --stale                 fetched_at IS NULL — rows from before the
 *                           rich-metadata columns existed
 *   --missing <col,...>     any listed nullable column IS NULL
 *                           (e.g. --missing duration_seconds,published_at)
 *   --ids <id,...>          explicit YouTube video ids
 *   --channel <UC...>       videos uploaded by that channel
 *   --whitelisted           only videos pinned to some profile
 *   --all                   every cached video (~1 quota unit per 50)
 *   --where "<sql>"         raw SQL predicate escape hatch
 *
 * Actions:
 *   --dry-run               list matching videos; no API calls, no writes
 *   --prune                 after refreshing, DELETE the rows YouTube did
 *                           not return (deleted/private/non-embeddable
 *                           upstream) — cascades whitelisted_videos,
 *                           watch_progress, video_reactions,
 *                           channel_video_exclusions, playlist_items
 *
 * Adding a filter: declare the flag in parseArgs and append a predicate
 * in buildPredicates — no other wiring needed.
 */

import { parseArgs } from "node:util";

// .env isn't auto-loaded outside Next.js. Dynamic imports in main() keep
// lib/db and lib/youtube from reading env vars before this runs, so the
// script also works as plain `npx tsx scripts/refresh-videos.ts`.
try {
  process.loadEnvFile(".env");
} catch {
  // no .env — rely on real environment variables
}

const { values: args } = parseArgs({
  options: {
    stale: { type: "boolean", default: false },
    missing: { type: "string" },
    ids: { type: "string" },
    channel: { type: "string" },
    whitelisted: { type: "boolean", default: false },
    all: { type: "boolean", default: false },
    where: { type: "string" },
    limit: { type: "string" },
    "dry-run": { type: "boolean", default: false },
    prune: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});

const USAGE = `npm run videos:refresh -- [--stale|--missing cols|--ids ids
  |--channel UC...|--whitelisted|--all|--where "sql"] [--limit N]
  [--dry-run] [--prune]`;

async function main() {
  const { and, count, eq, getTableColumns, inArray, isNull, or, sql } =
    await import("drizzle-orm");
  const { db } = await import("@/lib/db");
  const { videos, whitelistedVideos } = await import("@/lib/db/schema");
  const { refreshVideoIds } = await import("@/lib/video-cache");

  if (args.help) {
    console.log(USAGE);
    return;
  }

  // --missing accepts JS or DB column names of NULLABLE videos columns.
  const columns = getTableColumns(videos);
  const nullableByName = new Map<
    string,
    (typeof columns)[keyof typeof columns]
  >();
  for (const [jsName, col] of Object.entries(columns)) {
    if (col.notNull) continue;
    nullableByName.set(jsName, col);
    nullableByName.set(col.name, col);
  }

  const split = (v?: string) =>
    v
      ?.split(",")
      .map((s) => s.trim())
      .filter(Boolean) ?? [];

  const missingCols = split(args.missing).map((name) => {
    const col = nullableByName.get(name);
    if (!col) {
      throw new Error(
        `Unknown or non-nullable column "${name}". Nullable: ` +
          [...new Set([...nullableByName.values()].map((c) => c.name))]
            .sort()
            .join(", ")
      );
    }
    return col;
  });

  // Selector → SQL predicate. New filters get one line here.
  const preds = [];
  if (args.stale) preds.push(isNull(videos.fetchedAt));
  if (missingCols.length)
    preds.push(or(...missingCols.map((c) => isNull(c))));
  const ids = split(args.ids);
  if (ids.length) preds.push(inArray(videos.id, ids));
  if (args.channel) preds.push(eq(videos.channelId, args.channel));
  if (args.whitelisted)
    preds.push(
      sql`exists (
        select 1 from whitelisted_videos wv
        where wv.video_id = ${videos.id}
      )`
    );
  if (args.where) preds.push(sql.raw(args.where));

  if (args.all) {
    if (preds.length)
      throw new Error("--all cannot be combined with other selectors");
  } else if (preds.length === 0) {
    // No selector given: refresh the rows from before the rich-metadata
    // columns existed — the common "lacks information" case.
    preds.push(isNull(videos.fetchedAt));
  }

  const limit = args.limit ? Number(args.limit) : undefined;
  if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0))
    throw new Error("--limit must be a positive integer");

  const selectQ = db
    .select({ id: videos.id, title: videos.title })
    .from(videos)
    .where(preds.length ? and(...preds) : undefined)
    .$dynamic();
  if (limit) selectQ.limit(limit);
  const targets = await selectQ;

  console.log(`${targets.length} video(s) matched.`);
  if (targets.length === 0) return;

  if (args["dry-run"]) {
    for (const t of targets) console.log(`  ${t.id}  ${t.title}`);
    console.log("Dry run — nothing fetched or written.");
    return;
  }

  console.log(
    `Fetching metadata (${Math.ceil(targets.length / 50)} videos.list ` +
      `call(s))…`
  );
  const { refreshed, missing } = await refreshVideoIds(
    targets.map((t) => t.id)
  );
  console.log(`Refreshed ${refreshed.length} video(s).`);

  if (missing.length) {
    const byId = new Map(targets.map((t) => [t.id, t.title]));
    console.log(
      `${missing.length} video(s) not returned by YouTube ` +
        `(deleted/private/non-embeddable):`
    );
    for (const id of missing)
      console.log(`  ${id}  ${byId.get(id) ?? ""}`);

    if (args.prune) {
      const [{ n: pins }] = await db
        .select({ n: count() })
        .from(whitelistedVideos)
        .where(inArray(whitelistedVideos.videoId, missing));
      await db.delete(videos).where(inArray(videos.id, missing));
      console.log(
        `Pruned ${missing.length} video(s) (${pins} whitelist pin(s) ` +
          `cascade-removed).`
      );
    } else {
      console.log("Re-run with --prune to delete them from the cache.");
    }
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
