import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { videoReactions, whitelistedVideos } from "@/lib/db/schema";
import { assertCanManageProfile } from "@/lib/profiles";

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

  // Auth: device locked to this profile, or a managing parent session
  const activeProfileId = (await cookies()).get("activeProfileId")?.value;
  if (activeProfileId !== profileId) {
    try {
      const session = await getSession();
      await assertCanManageProfile(session, profileId);
    } catch {
      return NextResponse.json({ ok: false }, { status: 403 });
    }
  }

  // Whitelist is absolute — reactions only on approved videos.
  const approved = await db.query.whitelistedVideos.findFirst({
    where: and(
      eq(whitelistedVideos.profileId, profileId),
      eq(whitelistedVideos.videoId, videoId)
    ),
  });
  if (!approved) return NextResponse.json({ ok: false }, { status: 403 });

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
