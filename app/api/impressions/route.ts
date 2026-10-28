import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession, isKidSession } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  videoImpressions,
  videos,
  whitelistedVideos,
} from "@/lib/db/schema";
import { assertCanManageProfile } from "@/lib/profiles";
import { suitableVideo } from "@/lib/video-suitability";

// "Shown but ignored" feed impressions (lib/feed-impressions.ts). A
// silent write: no revalidatePath, no Pusher — a router.refresh() per
// flush would re-render the grid under the kid. Ranking picks the rows
// up on the next natural render.

const MAX_BATCH = 500;
// Rows not re-seen for this many days are dead weight — the penalty
// has decayed to ~0 by then (14-day half-life in lib/kids-feed.ts).
const PRUNE_AFTER_DAYS = 45;

const bodySchema = z.object({
  profileId: z.string().uuid(),
  // YouTube ids are 11 chars; 32 leaves slack without letting a
  // forged batch smuggle megabyte strings into the IN list.
  videoIds: z.array(z.string().min(1).max(32)).min(1).max(MAX_BATCH),
  // z.iso.date (not a bare regex) so impossible dates like 2026-02-30
  // get a 400 instead of a Postgres date/time-out-of-range 500.
  day: z.iso.date(), // kid-local date — the per-day dedup key
});

// YYYY-MM-DD of server now shifted by `days`, in UTC.
const utcDay = (now: number, days: number) =>
  new Date(now + days * 86_400_000).toISOString().slice(0, 10);

export async function POST(request: NextRequest) {
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  // Auth (same gate as /api/watch-progress — this is a write): the
  // signed session wins over the forgeable activeProfileId cookie — a
  // kid session may only write its own profile. Otherwise: device
  // locked to this profile or a managing parent session.
  const session = await getSession();
  if (isKidSession(session)) {
    if (session.profileId !== body.profileId) {
      return NextResponse.json({ ok: false }, { status: 403 });
    }
  } else if (
    (await cookies()).get("activeProfileId")?.value !== body.profileId
  ) {
    try {
      await assertCanManageProfile(session, body.profileId);
    } catch {
      return NextResponse.json({ ok: false }, { status: 403 });
    }
  }

  // Filter, don't 403: a batch mixes ids from cards mounted earlier,
  // and one unpin mid-scroll must not fail the whole batch. Only
  // whitelisted, kid-suitable ids (the `suitableVideo` 18+ floor) are
  // recorded; the rest are dropped silently.
  const ids = [...new Set(body.videoIds)];
  const approved = await db
    .select({ videoId: whitelistedVideos.videoId })
    .from(whitelistedVideos)
    .innerJoin(videos, eq(videos.id, whitelistedVideos.videoId))
    .where(
      and(
        eq(whitelistedVideos.profileId, body.profileId),
        inArray(whitelistedVideos.videoId, ids),
        suitableVideo
      )
    );
  if (approved.length === 0) return NextResponse.json({ ok: true });

  // last_seen_at is SERVER time (never the client clock): the feed
  // epoch it is compared against (impressionPenalty in
  // lib/kids-feed.ts) is also server Date.now(), same clock.
  const now = Date.now();
  // Clamp (not reject) the kid-local day to server UTC date ±1 day —
  // every real timezone lands inside that band, so only a skewed or
  // forged clock is affected; a far-future day would otherwise
  // freeze the row (setWhere rejects every later "earlier" day).
  // Clamping keeps a skewed device's impressions instead of dropping
  // the whole batch with a 400.
  const minDay = utcDay(now, -1);
  const maxDay = utcDay(now, 1);
  const day =
    body.day < minDay ? minDay : body.day > maxDay ? maxDay : body.day;

  await db
    .insert(videoImpressions)
    .values(
      approved.map(({ videoId }) => ({
        profileId: body.profileId,
        videoId,
        lastSeenAt: new Date(now),
        lastSeenOn: day,
      }))
    )
    .onConflictDoUpdate({
      target: [videoImpressions.profileId, videoImpressions.videoId],
      set: {
        // Capped so ln(1 + seen_days) stays bounded.
        seenDays: sql`least(30, "video_impressions"."seen_days" + 1)`,
        lastSeenAt: sql`excluded.last_seen_at`,
        lastSeenOn: sql`excluded.last_seen_on`,
      },
      // One counted impression per kid-local day: drops same-day
      // repeats AND late/out-of-order beacons in one clause.
      setWhere: sql`"video_impressions"."last_seen_on"
        < excluded.last_seen_on`,
    });

  // Opportunistic pruning — keeps the table bounded without a cron.
  await db
    .delete(videoImpressions)
    .where(
      and(
        eq(videoImpressions.profileId, body.profileId),
        lt(
          videoImpressions.lastSeenOn,
          sql`current_date - ${PRUNE_AFTER_DAYS}::int`
        )
      )
    );

  return NextResponse.json({ ok: true });
}
