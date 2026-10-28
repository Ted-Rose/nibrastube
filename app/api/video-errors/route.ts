import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession, isKidSession, parentSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { videos, whitelistedVideos } from "@/lib/db/schema";
import { assertCanManageProfile } from "@/lib/profiles";

// Player-observed permanent IFrame failures → a global block flag on
// the videos row, which suitableVideo then hides on every surface.
// Transient codes (2 invalid param, 5 HTML5 error) and stall skips
// never reach this route — and are rejected by the schema anyway.
const BLOCKED_REASONS = {
  100: "unavailable", // removed / private
  101: "embed-disabled", // owner disallows embedding
  150: "age-gated", // embed requires sign-in (also region locks)
} as const;

const bodySchema = z.object({
  videoId: z.string().min(1),
  code: z.union([z.literal(100), z.literal(101), z.literal(150)]),
  // Absent on no-profile surfaces (dashboard ?video= preview, /songs
  // overlay) — those authenticate as a parent session instead.
  profileId: z.string().uuid().optional(),
});

export async function POST(request: NextRequest) {
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const { videoId, code, profileId } = body;

  const session = await getSession();
  if (profileId) {
    // Auth: the signed session wins over the forgeable
    // activeProfileId cookie — a kid session may only write its own
    // profile. Otherwise: device locked to this profile or a
    // managing parent session.
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

    // The video must be approved for this profile — a rogue "More
    // videos" suggestion erroring inside the embed produces a POST
    // this check 403s, so unapproved content can never be flagged.
    // No suitableVideo in this join: re-flagging an already-blocked
    // row is idempotent and keeps blocked_reason updatable.
    const approved = await db
      .select({ videoId: whitelistedVideos.videoId })
      .from(whitelistedVideos)
      .where(
        and(
          eq(whitelistedVideos.profileId, profileId),
          eq(whitelistedVideos.videoId, videoId)
        )
      )
      .limit(1);
    if (approved.length === 0)
      return NextResponse.json({ ok: false }, { status: 403 });
  } else if (!parentSession(session)) {
    // No profile to check the whitelist against — only a signed-in
    // parent (dashboard preview, /songs) may flag a video directly.
    return NextResponse.json({ ok: false }, { status: 403 });
  }

  const updated = await db
    .update(videos)
    .set({
      playbackBlocked: true,
      blockedReason: BLOCKED_REASONS[code],
      blockedAt: new Date(),
    })
    .where(eq(videos.id, videoId))
    .returning({ id: videos.id });
  // The row may never have been cached (a rogue suggestion flagged
  // from a no-whitelist surface) — nothing to flag.
  if (updated.length === 0)
    return NextResponse.json({ ok: false }, { status: 404 });

  // No pusher, no revalidatePath — the flag is global and the next
  // render of any surface picks it up via suitableVideo.
  return NextResponse.json({ ok: true });
}
