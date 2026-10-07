"use server";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { videos, whitelistedVideos } from "@/lib/db/schema";
import { getSession, requireParentUnlocked } from "@/lib/auth";
import { assertCanManageProfile } from "@/lib/profiles";
import { refreshVideoIds } from "@/lib/video-cache";

// Dashboard "Refresh videos" button: re-fetch YouTube metadata for this
// profile's whitelisted videos that predate the rich-metadata columns
// (fetched_at IS NULL — the same set `npm run videos:refresh` targets).
// Videos YouTube no longer returns (deleted/private/non-embeddable)
// can't play in the kid embed, so they're deleted — the FK cascade
// unpins them everywhere.
export async function refreshStaleVideos(profileId: string, formData: FormData) {
  const session = await getSession();
  if (!session) return;
  await requireParentUnlocked();
  await assertCanManageProfile(session, profileId);

  const stale = await db
    .select({ id: videos.id })
    .from(whitelistedVideos)
    .innerJoin(videos, eq(videos.id, whitelistedVideos.videoId))
    .where(
      and(
        eq(whitelistedVideos.profileId, profileId),
        isNull(videos.fetchedAt)
      )
    );

  let removed = 0;
  if (stale.length) {
    const { missing } = await refreshVideoIds(stale.map((r) => r.id));
    if (missing.length) {
      await db.delete(videos).where(inArray(videos.id, missing));
      removed = missing.length;

      // Pins disappeared — kids' devices need a feed refresh.
      const { pusherServer } = await import("@/lib/pusher");
      await pusherServer.trigger(`profile-${profileId}`, "video-unpinned", {
        removed,
      });
    }
  }

  revalidatePath("/parent/dashboard");
  revalidatePath(`/kids/${profileId}`);

  // Preserve the dashboard's search/type params across the redirect.
  const returnTo = formData.get("returnTo");
  const base =
    typeof returnTo === "string" && returnTo.startsWith("/parent/dashboard")
      ? returnTo
      : `/parent/dashboard?profileId=${profileId}`;
  const sep = base.includes("?") ? "&" : "?";
  redirect(
    `${base}${sep}refreshed=${stale.length - removed}&removed=${removed}`
  );
}
