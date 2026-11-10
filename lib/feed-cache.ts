import { revalidateTag } from "next/cache";

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
