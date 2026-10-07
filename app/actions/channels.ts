"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { db } from "@/lib/db";
import {
  channels,
  channelSyncExclusions,
  channelVideoExclusions,
  profiles,
  videos,
  whitelistedChannels,
  whitelistedVideos,
} from "@/lib/db/schema";
import { getSession, requireParentUnlocked } from "@/lib/auth";
import {
  assertCanManageProfile,
  getManageableProfiles,
} from "@/lib/profiles";
import { channelRowValues, getChannelDetails } from "@/lib/youtube";
import { backfillChannel } from "@/lib/channel-sync";

export async function approveChannel(profileId: string, channelId: string) {
  const session = await getSession();
  if (!session) return;
  await requireParentUnlocked();
  await assertCanManageProfile(session, profileId);

  // 1. Ensure the channel exists in our registry
  const details = await getChannelDetails(channelId);
  if (!details) throw new Error("Channel not found on YouTube");

  await db
    .insert(channels)
    .values(channelRowValues(details))
    .onConflictDoUpdate({
      target: channels.id,
      set: {
        title: sql`excluded.title`,
        thumbnail: sql`excluded.thumbnail`,
        uploadsPlaylistId: sql`excluded.uploads_playlist_id`,
        description: sql`excluded.description`,
        country: sql`excluded.country`,
        publishedAt: sql`excluded.published_at`,
        subscriberCount: sql`excluded.subscriber_count`,
        videoCount: sql`excluded.video_count`,
        fetchedAt: sql`excluded.fetched_at`,
        raw: sql`excluded.raw`,
      },
    });

  // 2. Approve the channel for the profile
  await db
    .insert(whitelistedChannels)
    .values({ profileId, channelId })
    .onConflictDoNothing();

  // 3. Backfill existing uploads in the background; the daily sync resumes
  //    via backfillPageToken if this doesn't finish. Skipped entirely when
  //    the profile's owner has paused sync for this channel — approving a
  //    paused channel contributes no videos until resumed.
  after(async () => {
    try {
      const channel = await db.query.channels.findFirst({
        where: eq(channels.id, channelId),
      });
      const whitelist = await db.query.whitelistedChannels.findFirst({
        where: and(
          eq(whitelistedChannels.profileId, profileId),
          eq(whitelistedChannels.channelId, channelId)
        ),
      });
      const profile = await db.query.profiles.findFirst({
        where: eq(profiles.id, profileId),
      });
      const exclusion = profile
        ? await db.query.channelSyncExclusions.findFirst({
            where: and(
              eq(channelSyncExclusions.parentId, profile.parentId),
              eq(channelSyncExclusions.channelId, channelId)
            ),
          })
        : undefined;
      if (channel && whitelist && profile && !exclusion) {
        await backfillChannel(profileId, { whitelist, channel });
      }
    } catch (err) {
      console.error(`Backfill failed for channel ${channelId}:`, err);
    }
  });

  revalidatePath(`/parent/dashboard`);
}

/**
 * Pause/resume automatic sync for a channel, scoped to the owner(s) of
 * the profiles this parent manages that whitelist it. One exclusion row
 * per owner mutes the channel for every kid under that owner; a shared-
 * access parent writes the owner's row — exactly the profiles they see.
 */
export async function setChannelSyncExcluded(
  channelId: string,
  excluded: boolean
) {
  const session = await getSession();
  if (!session) return;
  await requireParentUnlocked();

  const manageable = await getManageableProfiles(session.user.id);
  const manageableIds = new Set(manageable.map((p) => p.id));
  const rows = await db
    .select({
      profileId: whitelistedChannels.profileId,
      ownerId: profiles.parentId,
    })
    .from(whitelistedChannels)
    .innerJoin(profiles, eq(whitelistedChannels.profileId, profiles.id))
    .where(eq(whitelistedChannels.channelId, channelId));
  const ownerIds = [
    ...new Set(
      rows
        .filter((r) => manageableIds.has(r.profileId))
        .map((r) => r.ownerId)
    ),
  ];
  if (ownerIds.length === 0) return; // channel not approved under us

  if (excluded) {
    await db
      .insert(channelSyncExclusions)
      .values(ownerIds.map((parentId) => ({ parentId, channelId })))
      .onConflictDoNothing();
  } else {
    await db
      .delete(channelSyncExclusions)
      .where(
        and(
          inArray(channelSyncExclusions.parentId, ownerIds),
          eq(channelSyncExclusions.channelId, channelId)
        )
      );
  }

  revalidatePath(`/parent/dashboard`);
}

export async function unapproveChannel(profileId: string, channelId: string) {
  const session = await getSession();
  if (!session) return;
  await requireParentUnlocked();
  await assertCanManageProfile(session, profileId);

  // 1. Remove the approval
  await db
    .delete(whitelistedChannels)
    .where(
      and(
        eq(whitelistedChannels.profileId, profileId),
        eq(whitelistedChannels.channelId, channelId)
      )
    );

  // 2. Remove channel-auto-added pins; manual pins survive
  await db
    .delete(whitelistedVideos)
    .where(
      and(
        eq(whitelistedVideos.profileId, profileId),
        eq(whitelistedVideos.viaChannelId, channelId)
      )
    );

  // 3. Drop the channel's exclusion tombstones (re-approving restores all)
  await db
    .delete(channelVideoExclusions)
    .where(
      and(
        eq(channelVideoExclusions.profileId, profileId),
        inArray(
          channelVideoExclusions.videoId,
          db
            .select({ id: videos.id })
            .from(videos)
            .where(eq(videos.channelId, channelId))
        )
      )
    );

  const { pusherServer } = await import("@/lib/pusher");
  await pusherServer.trigger(`profile-${profileId}`, "video-unpinned", {
    channelId,
  });

  revalidatePath(`/parent/dashboard`);
  revalidatePath(`/kids/${profileId}`);
}
