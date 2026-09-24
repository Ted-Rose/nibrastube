import { eq } from "drizzle-orm";
import { NextResponse, after } from "next/server";
import { db } from "@/lib/db";
import { dailySyncs } from "@/lib/db/schema";
import { syncAllChannels } from "@/lib/channel-sync";

async function runDailySync() {
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

  // Respond immediately; the sync continues in the background.
  after(async () => {
    let synced = 0;
    try {
      synced = await syncAllChannels();
    } catch (err) {
      console.error("Daily channel sync failed:", err);
    } finally {
      await db
        .update(dailySyncs)
        .set({ finishedAt: new Date(), channelsSynced: synced })
        .where(eq(dailySyncs.syncDate, today));
    }
  });

  return NextResponse.json({ ok: true, alreadyDone: false });
}

export async function POST() {
  return runDailySync();
}

// GET for manual triggering: curl localhost:3000/api/sync-channels
export async function GET() {
  return runDailySync();
}
