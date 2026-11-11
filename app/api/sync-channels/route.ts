import { eq } from "drizzle-orm";
import { NextRequest, NextResponse, after } from "next/server";
import { db } from "@/lib/db";
import { dailySyncs } from "@/lib/db/schema";
import { syncAllChannels } from "@/lib/channel-sync";
import { captureInternalException } from "@/lib/report";

// Vercel Cron sends `Authorization: Bearer $CRON_SECRET` when the env
// var is set — that is the canonical daily trigger. Unauthenticated
// calls (the once/day client ping, manual curl) still run the same
// flow: the daily_syncs row dedups them, so no extra syncs are possible.
function isCronTrigger(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

async function runDailySync(request: NextRequest) {
  const trigger = isCronTrigger(request) ? "cron" : "client";
  // UTC date YYYY-MM-DD — one row per day doubles as the dedup lock
  const today = new Date().toISOString().slice(0, 10);

  const inserted = await db
    .insert(dailySyncs)
    .values({ syncDate: today, startedAt: new Date() })
    .onConflictDoNothing()
    .returning({ syncDate: dailySyncs.syncDate });

  if (inserted.length === 0) {
    return NextResponse.json({ ok: true, alreadyDone: true });
  }

  console.info(`Daily channel sync started (trigger: ${trigger})`);

  // Respond immediately; the sync continues in the background.
  after(async () => {
    let synced = 0;
    try {
      synced = await syncAllChannels();
    } catch (err) {
      console.error("Daily channel sync failed:", err);
      captureInternalException(err);
    } finally {
      await db
        .update(dailySyncs)
        .set({ finishedAt: new Date(), channelsSynced: synced })
        .where(eq(dailySyncs.syncDate, today));
    }
  });

  return NextResponse.json({ ok: true, alreadyDone: false });
}

export async function POST(request: NextRequest) {
  return runDailySync(request);
}

// GET for manual triggering + the Vercel Cron job (crons send GET):
// curl localhost:3100/api/sync-channels
export async function GET(request: NextRequest) {
  return runDailySync(request);
}
