import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession, isKidSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { videoReactions, videos, whitelistedVideos } from "@/lib/db/schema";
import { assertCanManageProfile } from "@/lib/profiles";
import { suitableVideo } from "@/lib/video-suitability";

const bodySchema = z.object({
  profileId: z.string().uuid(),
  videoId: z.string().min(1),
  reaction: z.enum(["like", "dislike"]).nullable(), // null = clear
});

export async function POST(request: NextRequest) {
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const { profileId, videoId, reaction } = body;

  // Auth: the signed session wins over the forgeable activeProfileId
  // cookie — a kid session may only write its own profile. Otherwise:
  // device locked to this profile or a managing parent session.
  const session = await getSession();
  if (isKidSession(session)) {
    if (session.profileId !== profileId) {
      return NextResponse.json({ ok: false }, { status: 403 });
    }
  } else if (
    (await cookies()).get("activeProfileId")?.value !== profileId
  ) {
    try {
      await assertCanManageProfile(session, profileId);
    } catch {
      return NextResponse.json({ ok: false }, { status: 403 });
    }
  }

  // Whitelist is absolute — reactions only on approved videos. The
  // `suitableVideo` 18+ floor rejects even parent-approved
  // age-restricted videos.
  const approved = await db
    .select({ videoId: whitelistedVideos.videoId })
    .from(whitelistedVideos)
    .innerJoin(videos, eq(videos.id, whitelistedVideos.videoId))
    .where(
      and(
        eq(whitelistedVideos.profileId, profileId),
        eq(whitelistedVideos.videoId, videoId),
        suitableVideo
      )
    )
    .limit(1);
  if (approved.length === 0)
    return NextResponse.json({ ok: false }, { status: 403 });

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

  return NextResponse.json({ ok: true });
}
