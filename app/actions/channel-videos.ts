"use server";

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { channels, whitelistedVideos } from "@/lib/db/schema";
import {
  getSession,
  isParentUnlockedCookie,
  parentSession,
} from "@/lib/auth";
import { assertCanManageProfile } from "@/lib/profiles";
import {
  getChannelDetails,
  getUploadsPage,
  getVideosBatch,
  toDashboardVideo,
  type DashboardVideo,
} from "@/lib/youtube";
import { upsertVideoRows } from "@/lib/video-cache";

export interface ChannelUploadsPage {
  items: DashboardVideo[];
  pinnedIds: string[];
  nextPageToken: string | null;
}

// Paging for the dashboard channel drill-in. Shares the search
// actions' unlocked-parent + manageable-profile gate. This is a parent
// vetting surface, so made-for-kids rows are NOT filtered — a kids
// channel is almost entirely MFK. Age-restricted rows are returned and
// badged "Blocked" by the card.
export async function loadChannelUploads(
  profileId: string,
  channelId: string,
  pageToken: string | null
): Promise<ChannelUploadsPage> {
  const session = await getSession();
  if (!parentSession(session)) throw new Error("Not authorized");
  if (!(await isParentUnlockedCookie(session))) {
    throw new Error("Not authorized");
  }
  await assertCanManageProfile(session, profileId);

  // Resolve the uploads playlist — the cached channels row first (free),
  // then a 1-unit channels.list call. Never write the row here:
  // approveChannel owns the channels registry.
  const cached = await db.query.channels.findFirst({
    where: eq(channels.id, channelId),
    columns: { uploadsPlaylistId: true },
  });
  let uploadsPlaylistId = cached?.uploadsPlaylistId ?? null;
  if (!uploadsPlaylistId) {
    const details = await getChannelDetails(channelId);
    uploadsPlaylistId = details?.uploadsPlaylistId ?? null;
  }
  if (!uploadsPlaylistId) {
    return { items: [], pinnedIds: [], nextPageToken: null };
  }

  const page = await getUploadsPage(
    uploadsPlaylistId,
    pageToken ?? undefined
  );
  // Hydrate in playlist order (getVideosBatch returns API order and
  // drops non-embeddable items — "showing playable videos").
  const byId = new Map(
    (await getVideosBatch(page.videoIds)).map((v) => [v.id, v])
  );
  const hydrated = page.videoIds.flatMap((id) => {
    const v = byId.get(id);
    return v ? [v] : [];
  });
  // Warm the videos cache so a subsequent pinVideo skips its own
  // videos.list fetch.
  await upsertVideoRows(hydrated);

  const pinned = hydrated.length
    ? await db
        .select({ videoId: whitelistedVideos.videoId })
        .from(whitelistedVideos)
        .where(
          and(
            eq(whitelistedVideos.profileId, profileId),
            inArray(
              whitelistedVideos.videoId,
              hydrated.map((v) => v.id)
            )
          )
        )
    : [];
  const pinnedIds = new Set(pinned.map((r) => r.videoId));
  return {
    items: hydrated.map(toDashboardVideo),
    pinnedIds: hydrated
      .map((v) => v.id)
      .filter((id) => pinnedIds.has(id)),
    nextPageToken: page.nextPageToken ?? null,
  };
}
