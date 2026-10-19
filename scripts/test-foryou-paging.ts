// Ad-hoc check for For-You infinite scroll + depth-decayed ranking —
// run with: npx tsx --env-file=.env scripts/test-foryou-paging.ts
// Prints, per 60-row page of getRecommendedVideos, the top channels and
// a breakdown of rows by channel-affinity tier (unwatched / low /
// high), then verifies consecutive pages share no video ids.
import { count, desc, eq, sql } from "drizzle-orm";
import { db } from "../lib/db";
import { profiles, videos, watchHistory } from "../lib/db/schema";
import { getRecommendedVideos } from "../lib/kids-feed";

const [top] = await db
  .select({ id: profiles.id, name: profiles.name, n: count() })
  .from(profiles)
  .leftJoin(watchHistory, eq(watchHistory.profileId, profiles.id))
  .groupBy(profiles.id)
  .orderBy(desc(count()))
  .limit(1);

console.log(`Profile: ${top.name} (${top.id}), ${top.n} history rows\n`);

const affinityRows = await db
  .select({
    channelId: videos.channelId,
    affinity: sql<number>`sum(case
      when ${watchHistory.watchedOn} >= current_date - 7 then 3
      when ${watchHistory.watchedOn} >= current_date - 30 then 2
      else 1 end)`,
  })
  .from(watchHistory)
  .innerJoin(videos, eq(videos.id, watchHistory.videoId))
  .where(eq(watchHistory.profileId, top.id))
  .groupBy(videos.channelId);
// channelTitle → affinity (titles suffice for an eyeball check)
const titleAffinity = new Map<string, number>();
for (const r of affinityRows) {
  const [v] = await db
    .select({ t: videos.channelTitle })
    .from(videos)
    .where(eq(videos.channelId, r.channelId!))
    .limit(1);
  if (v) titleAffinity.set(v.t, r.affinity);
}
const tier = (t: string) => {
  const a = titleAffinity.get(t) ?? 0;
  return a === 0 ? "unwatched" : a < 10 ? "low" : "high";
};

const seen = new Set<string>();
for (let offset = 0; offset <= 1200; offset += 60) {
  const rows = await getRecommendedVideos(top.id, { offset, limit: 60 });
  if (rows.length === 0) {
    console.log(`offset ${offset}: empty — end of feed`);
    break;
  }
  const dupes = rows.filter((r) => seen.has(r.video.id));
  rows.forEach((r) => seen.add(r.video.id));

  const channels = new Map<string, number>();
  const tiers = { unwatched: 0, low: 0, high: 0 };
  for (const r of rows) {
    channels.set(
      r.video.channelTitle,
      (channels.get(r.video.channelTitle) ?? 0) + 1
    );
    tiers[tier(r.video.channelTitle)]++;
  }
  const topChannels = [...channels.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([t, n]) => `${t}×${n}`)
    .join(", ");
  console.log(
    `offset ${offset}: ${dupes.length} dupes | ` +
      `unwatched ${tiers.unwatched}, low ${tiers.low}, high ${tiers.high} | ` +
      `${topChannels}`
  );
}
process.exit(0);
