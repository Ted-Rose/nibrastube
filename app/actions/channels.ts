"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { db } from "@/lib/db";
import {
  channels,
  channelVideoExclusions,
  videos,
  whitelistedChannels,
  whitelistedVideos,
} from "@/lib/db/schema";
import { getSession } from "@/lib/auth";
import { assertCanManageProfile } from "@/lib/profiles";
import { getChannelDetails } from "@/lib/youtube";
import { backfillChannel } from "@/lib/channel-sync";

export async function approveChannel(profileId: string, channelId: string) {
  const session = await getSession();
  if (!session) return;
  await assertCanManageProfile(session, profileId);

  // 1. Ensure the channel exists in our registry
  const details = await getChannelDetails(channelId);
  if (!details) throw new Error("Channel not found on YouTube");

  await db
    .insert(channels)
    .values({
      id: details.id,
      title: details.title,
      thumbnail: details.thumbnail,
      uploadsPlaylistId: details.uploadsPlaylistId,
    })
    .onConflictDoNothing();

  // 2. Approve the channel for the profile
  await db
    .insert(whitelistedChannels)
    .values({ profileId, channelId })
    .onConflictDoNothing();

  // 3. Backfill existing uploads in the background; the daily sync resumes
  //    via backfillPageToken if this doesn't finish.
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
      if (channel && whitelist) {
        await backfillChannel(profileId, { whitelist, channel });
      }
    } catch (err) {
      console.error(`Backfill failed for channel ${channelId}:`, err);
    }
  });

  revalidatePath(`/parent/dashboard`);
}

export async function unapproveChannel(profileId: string, channelId: string) {
  const session = await getSession();
  if (!session) return;
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
