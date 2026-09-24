import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { videos, watchProgress, whitelistedVideos } from "@/lib/db/schema";
import { assertCanManageProfile } from "@/lib/profiles";

const bodySchema = z.object({
  profileId: z.string().uuid(),
  videoId: z.string().min(1),
  positionSeconds: z.number().int().min(0),
  durationSeconds: z.number().int().min(0).nullable(),
  completed: z.boolean(),
  sentAt: z.number(), // client epoch ms — guards against out-of-order beacons
});

export async function POST(request: NextRequest) {
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  // Auth: device locked to this profile, or a managing parent session
  const activeProfileId = (await cookies()).get("activeProfileId")?.value;
  if (activeProfileId !== body.profileId) {
    try {
      const session = await getSession();
      await assertCanManageProfile(session, body.profileId);
    } catch {
      return NextResponse.json({ ok: false }, { status: 403 });
    }
  }

  // Only track whitelisted content
  const approved = await db.query.whitelistedVideos.findFirst({
    where: and(
      eq(whitelistedVideos.profileId, body.profileId),
      eq(whitelistedVideos.videoId, body.videoId)
    ),
  });
  if (!approved) return NextResponse.json({ ok: false }, { status: 403 });

  // Lazily repair videos rows missing duration (pre-duration-fix pins)
  if (body.durationSeconds) {
    await db
      .update(videos)
      .set({ durationSeconds: body.durationSeconds })
      .where(and(eq(videos.id, body.videoId), isNull(videos.durationSeconds)));
  }

  await db
    .insert(watchProgress)
    .values({
      profileId: body.profileId,
      videoId: body.videoId,
      positionSeconds: body.positionSeconds,
      completed: body.completed,
      watchedAt: new Date(body.sentAt),
    })
    .onConflictDoUpdate({
      target: [watchProgress.profileId, watchProgress.videoId],
      set: {
        positionSeconds: sql`excluded.position_seconds`,
        completed: sql`excluded.completed`,
        watchedAt: sql`excluded.watched_at`,
      },
      // Drop late/out-of-order beacons (e.g. periodic fetch landing after
      // a pagehide beacon): only apply if the payload is newer.
      setWhere: lt(watchProgress.watchedAt, new Date(body.sentAt)),
    });

  return NextResponse.json({ ok: true });
}
