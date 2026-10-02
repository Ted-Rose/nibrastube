"use server";

import { db } from "@/lib/db";
import { videoReactions, whitelistedVideos } from "@/lib/db/schema";
import { getSession } from "@/lib/auth";
import { assertCanManageProfile } from "@/lib/profiles";
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";

const reactionSchema = z.object({
  profileId: z.string().uuid(),
  videoId: z.string().min(1),
  reaction: z.enum(["like", "dislike"]).nullable(), // null = clear
});

export async function setVideoReaction(input: unknown) {
  const parsed = reactionSchema.safeParse(input);
  if (!parsed.success) return;
  const { profileId, videoId, reaction } = parsed.data;

  // Dual auth, mirroring /api/watch-progress: kid-locked device OR
  // managing parent session.
  const activeProfileId = (await cookies()).get("activeProfileId")?.value;
  if (activeProfileId !== profileId) {
    const session = await getSession();
    await assertCanManageProfile(session, profileId);
  }

  // Whitelist is absolute — reactions only on approved videos.
  const approved = await db.query.whitelistedVideos.findFirst({
    where: and(
      eq(whitelistedVideos.profileId, profileId),
      eq(whitelistedVideos.videoId, videoId)
    ),
  });
  if (!approved) return;

  if (reaction === null) {
    await db
      .delete(videoReactions)
      .where(
        and(
          eq(videoReactions.profileId, profileId),
          eq(videoReactions.videoId, videoId)
        )
      );
  } else {
    await db
      .insert(videoReactions)
      .values({ profileId, videoId, reaction })
      .onConflictDoUpdate({
        target: [videoReactions.profileId, videoReactions.videoId],
        set: { reaction: sql`excluded.reaction`, reactedAt: sql`now()` },
      });
  }

  const { pusherServer } = await import("@/lib/pusher");
  await pusherServer.trigger(`profile-${profileId}`, "video-reacted", {
    videoId,
  });

  revalidatePath(`/kids/${profileId}`);
}
