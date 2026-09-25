"use server";

import { db } from "@/lib/db";
import {
  channelVideoExclusions,
  videos,
  whitelistedVideos,
} from "@/lib/db/schema";
import { getSession } from "@/lib/auth";
import { assertCanManageProfile } from "@/lib/profiles";
import { getVideoDetails, videoRowValues } from "@/lib/youtube";
import { eq, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";

export async function pinVideo(profileId: string, videoId: string) {
  const session = await getSession();
  if (!session) {
    console.log("Pinning failed: Not authenticated");
    return;
  }
  await assertCanManageProfile(session, profileId);
  console.log("Pinning video:", videoId, "for profile:", profileId);

  // 1. Ensure video exists in our 'videos' cache
  const existingVideo = await db.query.videos.findFirst({
    where: eq(videos.id, videoId),
  });

  if (!existingVideo) {
    const details = await getVideoDetails(videoId);
    await db.insert(videos).values(videoRowValues(details));
  } else if (!existingVideo.fetchedAt) {
    // Self-heal rows cached before the rich-metadata columns existed
    const details = await getVideoDetails(videoId);
    await db
      .update(videos)
      .set(videoRowValues(details))
      .where(eq(videos.id, videoId));
  }

  // 2. Pin the video to the profile (manual pin: viaChannelId stays null)
  await db
    .insert(whitelistedVideos)
    .values({
      profileId,
      videoId,
    })
    .onConflictDoNothing();

  // 3. A manual pin clears any channel-sync exclusion for this video
  await db
    .delete(channelVideoExclusions)
    .where(
      and(
        eq(channelVideoExclusions.profileId, profileId),
        eq(channelVideoExclusions.videoId, videoId)
      )
    );

  // 4. Trigger Real-time sync
  const { pusherServer } = await import("@/lib/pusher");
  await pusherServer.trigger(`profile-${profileId}`, "video-pinned", { videoId });

  revalidatePath(`/parent/dashboard`);
  revalidatePath(`/kids/${profileId}`);
}

export async function unpinVideo(profileId: string, videoId: string) {
  const session = await getSession();
  if (!session) {
    console.log("Unpinning failed: Not authenticated");
    return;
  }
  await assertCanManageProfile(session, profileId);
  console.log("Unpinning video:", videoId, "from profile:", profileId);

  const existing = await db.query.whitelistedVideos.findFirst({
    where: and(
      eq(whitelistedVideos.profileId, profileId),
      eq(whitelistedVideos.videoId, videoId)
    ),
  });

  await db
    .delete(whitelistedVideos)
    .where(
      and(
        eq(whitelistedVideos.profileId, profileId),
        eq(whitelistedVideos.videoId, videoId)
      )
    );

  // If the pin came from an approved channel, leave a tombstone so the
  // channel sync doesn't resurrect it
  if (existing?.viaChannelId) {
    await db
      .insert(channelVideoExclusions)
      .values({ profileId, videoId })
      .onConflictDoNothing();
  }

  // Trigger Real-time sync
  const { pusherServer } = await import("@/lib/pusher");
  await pusherServer.trigger(`profile-${profileId}`, "video-unpinned", {
    videoId,
  });

  revalidatePath(`/parent/dashboard`);
  revalidatePath(`/kids/${profileId}`);
}
