import axios from "axios";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  channels,
  channelVideoExclusions,
  videos,
  whitelistedChannels,
  whitelistedVideos,
} from "@/lib/db/schema";
import { getUploadsPage, getVideosBatch } from "@/lib/youtube";

const MAX_CHANNELS_PER_RUN = 50;
const MAX_BACKFILL_PAGES_PER_RUN = 40; // ~2000 videos per run; resume via backfillPageToken
const MAX_POLL_PAGES_PER_RUN = 5; // ~250 newest uploads checked per poll

export class QuotaExceededError extends Error {}

type ChannelRow = typeof channels.$inferSelect;

export interface ChannelJoin {
  whitelist: typeof whitelistedChannels.$inferSelect;
  channel: ChannelRow;
}

function isQuotaError(err: unknown): boolean {
  return (
    axios.isAxiosError(err) &&
    err.response?.status === 403 &&
    JSON.stringify(err.response.data).includes("quotaExceeded")
  );
}

async function getExcludedVideoIds(profileId: string, videoIds: string[]) {
  if (videoIds.length === 0) return new Set<string>();
  const rows = await db.query.channelVideoExclusions.findMany({
    where: and(
      eq(channelVideoExclusions.profileId, profileId),
      inArray(channelVideoExclusions.videoId, videoIds)
    ),
  });
  return new Set(rows.map((r) => r.videoId));
}

// An un-approve can land while a backfill/poll is mid-flight; without this
// check the in-flight sync keeps inserting pins unapproveChannel deleted.
async function isChannelApproved(profileId: string, channelId: string) {
  const row = await db.query.whitelistedChannels.findFirst({
    where: and(
      eq(whitelistedChannels.profileId, profileId),
      eq(whitelistedChannels.channelId, channelId)
    ),
  });
  return !!row;
}

// Fetch full metadata, upsert into `videos`, then insert whitelist rows
// (skipping tombstoned exclusions). Returns number of videos added.
async function upsertVideosAndWhitelist(
  profileId: string,
  channelId: string,
  videoIds: string[]
) {
  if (videoIds.length === 0) return 0;

  const details = await getVideosBatch(videoIds);
  if (details.length === 0) return 0;

  await db
    .insert(videos)
    .values(
      details.map((v) => ({
        id: v.id,
        title: v.title,
        thumbnail: v.thumbnail,
        channelTitle: v.channelTitle,
        channelId: v.channelId,
        publishedAt: v.publishedAt,
        durationSeconds: v.durationSeconds,
      }))
    )
    .onConflictDoUpdate({
      target: videos.id,
      set: {
        title: sql`excluded.title`,
        thumbnail: sql`excluded.thumbnail`,
        channelTitle: sql`excluded.channel_title`,
        channelId: sql`excluded.channel_id`,
        publishedAt: sql`excluded.published_at`,
        durationSeconds: sql`excluded.duration_seconds`,
      },
    });

  const excluded = await getExcludedVideoIds(
    profileId,
    details.map((v) => v.id)
  );
  const toInsert = details.filter((v) => !excluded.has(v.id));
  if (toInsert.length === 0) return 0;

  // Re-check approval right before pinning so a concurrent un-approve can't
  // be overwritten by this batch.
  if (!(await isChannelApproved(profileId, channelId))) return 0;

  await db
    .insert(whitelistedVideos)
    .values(
      toInsert.map((v) => ({
        profileId,
        videoId: v.id,
        viaChannelId: channelId,
      }))
    )
    .onConflictDoNothing();

  return toInsert.length;
}

async function triggerPinned(profileId: string, channelId: string) {
  const { pusherServer } = await import("@/lib/pusher");
  await pusherServer.trigger(`profile-${profileId}`, "video-pinned", {
    channelId,
  });
}

/**
 * Backfill a channel's full uploads playlist into whitelisted_videos.
 * Resumable via whitelisted_channels.backfillPageToken.
 * Returns number of videos added this call.
 */
export async function backfillChannel(
  profileId: string,
  row: ChannelJoin
): Promise<number> {
  const { whitelist, channel } = row;
  if (!channel.uploadsPlaylistId) {
    await db
      .update(whitelistedChannels)
      .set({ backfillComplete: true })
      .where(
        and(
          eq(whitelistedChannels.profileId, profileId),
          eq(whitelistedChannels.channelId, channel.id)
        )
      );
    return 0;
  }

  let pageToken = whitelist.backfillPageToken ?? undefined;
  let added = 0;

  for (let page = 0; page < MAX_BACKFILL_PAGES_PER_RUN; page++) {
    if (!(await isChannelApproved(profileId, channel.id))) break;
    const result = await getUploadsPage(channel.uploadsPlaylistId, pageToken);
    added += await upsertVideosAndWhitelist(
      profileId,
      channel.id,
      result.videoIds
    );

    pageToken = result.nextPageToken;
    const complete = !pageToken;
    await db
      .update(whitelistedChannels)
      .set({
        backfillPageToken: pageToken ?? null,
        backfillComplete: complete,
        lastSyncAt: new Date(),
      })
      .where(
        and(
          eq(whitelistedChannels.profileId, profileId),
          eq(whitelistedChannels.channelId, channel.id)
        )
      );

    if (complete) break;
  }

  if (added > 0) await triggerPinned(profileId, channel.id);
  return added;
}

/**
 * Incremental poll: fetch newest uploads until hitting a videoId already
 * whitelisted for the profile, then insert the new batch.
 */
export async function pollChannel(
  profileId: string,
  row: ChannelJoin
): Promise<number> {
  const { channel } = row;
  if (!channel.uploadsPlaylistId) return 0;

  const newIds: string[] = [];
  let pageToken: string | undefined;
  let hitKnown = false;

  for (let page = 0; page < MAX_POLL_PAGES_PER_RUN && !hitKnown; page++) {
    const result = await getUploadsPage(channel.uploadsPlaylistId, pageToken);
    if (result.videoIds.length === 0) break;

    const known = await db.query.whitelistedVideos.findMany({
      where: and(
        eq(whitelistedVideos.profileId, profileId),
        inArray(whitelistedVideos.videoId, result.videoIds)
      ),
    });
    const knownIds = new Set(known.map((r) => r.videoId));

    for (const id of result.videoIds) {
      if (knownIds.has(id)) {
        hitKnown = true;
        break;
      }
      newIds.push(id);
    }

    pageToken = result.nextPageToken;
    if (!pageToken) break;
  }

  const added =
    newIds.length > 0
      ? await upsertVideosAndWhitelist(profileId, channel.id, newIds)
      : 0;

  await db
    .update(whitelistedChannels)
    .set({ lastSyncAt: new Date() })
    .where(
      and(
        eq(whitelistedChannels.profileId, profileId),
        eq(whitelistedChannels.channelId, channel.id)
      )
    );

  if (added > 0) await triggerPinned(profileId, channel.id);
  return added;
}

/**
 * Sync every approved channel: resume incomplete backfills first, then poll
 * for new uploads. Capped per run; ordered by lastSyncAt nulls-first.
 * Returns the number of channels synced.
 */
export async function syncAllChannels(): Promise<number> {
  const rows = await db
    .select({ whitelist: whitelistedChannels, channel: channels })
    .from(whitelistedChannels)
    .innerJoin(channels, eq(whitelistedChannels.channelId, channels.id))
    .orderBy(asc(whitelistedChannels.lastSyncAt))
    .limit(MAX_CHANNELS_PER_RUN);

  // Postgres asc() puts NULLs last; sort in JS so never-synced channels go first.
  rows.sort((a, b) => {
    const at = a.whitelist.lastSyncAt?.getTime() ?? 0;
    const bt = b.whitelist.lastSyncAt?.getTime() ?? 0;
    return at - bt;
  });

  let synced = 0;
  for (const row of rows) {
    try {
      if (!row.whitelist.backfillComplete) {
        await backfillChannel(row.whitelist.profileId, row);
      } else {
        await pollChannel(row.whitelist.profileId, row);
      }
      synced++;
    } catch (err) {
      if (err instanceof QuotaExceededError || isQuotaError(err)) {
        console.error("YouTube quota exceeded — aborting sync run early");
        break;
      }
      console.error(
        `Channel sync failed for ${row.channel.id} (profile ${row.whitelist.profileId}):`,
        err
      );
    }
  }

  return synced;
}
