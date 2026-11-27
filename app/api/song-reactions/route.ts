import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession, isKidSession } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  profiles,
  songReactions,
  songs,
  videos,
} from "@/lib/db/schema";
import {
  assertCanManageProfile,
  ProfileAccessError,
} from "@/lib/profiles";
import { captureInternalException } from "@/lib/report";
import { visibleVideo } from "@/lib/songs-feed";
import { suitableVideo } from "@/lib/video-suitability";

const bodySchema = z.object({
  profileId: z.string().uuid(),
  songId: z.string().uuid(),
  reaction: z.enum(["like", "dislike"]).nullable(), // null = clear
});

export async function POST(request: NextRequest) {
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const { profileId, songId, reaction } = body;

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
    } catch (err) {
      // Denials are routine; anything else (e.g. a DB outage masked
      // as one) is a real failure worth reporting.
      if (!(err instanceof ProfileAccessError)) {
        captureInternalException(err);
      }
      return NextResponse.json({ ok: false }, { status: 403 });
    }
  }

  // Gate the write on both FK targets in one query: the profile row
  // must exist (the auth chain verifies authority, not existence —
  // a forged activeProfileId cookie or a JWT outliving a deleted
  // profile would otherwise reach the insert and die on the FK),
  // and the song must be one the catalog could actually surface
  // (visibleVideo made-for-kids + suitableVideo 18+/playback-block,
  // the same gate every /songs read applies).
  const visible = await db
    .select({ songId: songs.id })
    .from(songs)
    .innerJoin(videos, eq(videos.id, songs.videoId))
    .innerJoin(profiles, eq(profiles.id, profileId))
    .where(
      and(eq(songs.id, songId), visibleVideo, suitableVideo)
    )
    .limit(1);
  if (visible.length === 0)
    return NextResponse.json({ ok: false }, { status: 403 });

  if (reaction === null) {
    await db
      .delete(songReactions)
      .where(
        and(
          eq(songReactions.profileId, profileId),
          eq(songReactions.songId, songId)
        )
      );
  } else {
    await db
      .insert(songReactions)
      .values({ profileId, songId, reaction })
      .onConflictDoUpdate({
        target: [songReactions.profileId, songReactions.songId],
        set: { reaction: sql`excluded.reaction`, reactedAt: sql`now()` },
      });
  }

  // Silent write like feed impressions: /songs reads are never
  // unstable_cache'd and nothing but the catalog shows song
  // reactions, so there is no profile feed tag to bust and no
  // PusherListener on this route to ping. revalidatePath marks the
  // catalog dirty for the next visit; the acting client already has
  // the optimistic state.
  revalidatePath("/songs");

  return NextResponse.json({ ok: true });
}
