import { inArray } from "drizzle-orm";
import { revalidateTag } from "next/cache";
import { db } from "@/lib/db";
import { whitelistedVideos } from "@/lib/db/schema";

// Shared constants for the kids feed data cache (lib/kids-feed.ts).
// One tag per profile covers every cached feed read: whitelisted-video
// rows, liked rows, channel/playlist tiles, playlist contents. Watch
// progress and For-You ranking are deliberately never cached — see
// kids-feed.ts.
export const FEED_REVALIDATE_SECONDS = 600;

export const feedCacheTag = (profileId: string) => `feed:${profileId}`;

// Call beside every mutation that changes what a profile's feed or
// watch queue may contain (pin/unpin, channel approve/un-approve,
// playlist writes, reactions, sync inserts, profile delete).
// "Mutations" also covers writes to the SHARED `videos` table — a
// refresh delete (FK-cascades every profile's pins) or a metadata
// overwrite (watch-progress duration repair, song-import/pin
// self-heal, sync upserts) lands on every profile whitelisting the
// id, so those paths look up the whitelisting profiles and bust each
// tag, not just the acting profile's. The `{ expire: 0 }` profile is
// a HARD expiry — not "max" (SWR) — so a removed video can never be
// served from cache to an open kid session on the very next read
// (whitelist-safety invariant).
export function invalidateProfileFeed(profileId: string) {
  revalidateTag(feedCacheTag(profileId), { expire: 0 });
}

// `videos` is a SHARED table — an upsert/overwrite/delete lands on
// every profile whitelisting the id, not just the acting one. Select
// the distinct whitelisting profileIds and hard-expire each feed tag.
// Returns the affected profileIds for callers that also fan out a
// Pusher ping to the same set. Empty input is a no-op.
export async function invalidateProfilesWhitelisting(
  videoIds: string[]
): Promise<string[]> {
  if (videoIds.length === 0) return [];
  const affected = await db
    .selectDistinct({ profileId: whitelistedVideos.profileId })
    .from(whitelistedVideos)
    .where(inArray(whitelistedVideos.videoId, videoIds));
  for (const row of affected) invalidateProfileFeed(row.profileId);
  return affected.map((r) => r.profileId);
}
