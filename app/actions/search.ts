"use server";

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  whitelistedChannels,
  whitelistedVideos,
} from "@/lib/db/schema";
import {
  getSession,
  isParentUnlockedCookie,
  parentSession,
} from "@/lib/auth";
import { assertCanManageProfile } from "@/lib/profiles";
import {
  searchChannels,
  searchYouTube,
  toDashboardVideo,
  type DashboardVideo,
  type YouTubeChannel,
} from "@/lib/youtube";

export interface SearchVideosPage {
  items: DashboardVideo[];
  // Subset of `items` already pinned for the profile — appended cards
  // render their Approved state without a refresh.
  pinnedIds: string[];
  nextPageToken: string | null;
}

export interface SearchChannelsPage {
  items: YouTubeChannel[];
  approvedIds: string[];
  nextPageToken: string | null;
}

// Read-side gate for the dashboard's paging actions: an unlocked parent
// session that manages the profile (pin/approve state is profile-scoped,
// so the profileId arg must be verified, not trusted). NOT
// requireParentUnlocked — that redirects, which is meaningless inside a
// fetch-style action; the client's .catch marks the feed exhausted.
async function assertDashboardReader(profileId: string) {
  const session = await getSession();
  if (!parentSession(session)) throw new Error("Not authorized");
  if (!(await isParentUnlockedCookie(session))) {
    throw new Error("Not authorized");
  }
  await assertCanManageProfile(session, profileId);
}

// searchYouTube's second page onward. The first page is fetched by the
// page's server component — this action only backs the "Show more"
// sentinel.
export async function loadMoreSearchVideos(
  profileId: string,
  query: string,
  pageToken: string | null
): Promise<SearchVideosPage> {
  await assertDashboardReader(profileId);

  const page = await searchYouTube(query.slice(0, 200), pageToken);
  const ids = page.items.map((v) => v.id);
  const pinned = ids.length
    ? await db
        .select({ videoId: whitelistedVideos.videoId })
        .from(whitelistedVideos)
        .where(
          and(
            eq(whitelistedVideos.profileId, profileId),
            inArray(whitelistedVideos.videoId, ids)
          )
        )
    : [];
  const pinnedIds = new Set(pinned.map((r) => r.videoId));
  return {
    items: page.items.map(toDashboardVideo),
    pinnedIds: ids.filter((id) => pinnedIds.has(id)),
    nextPageToken: page.nextPageToken,
  };
}

export async function loadMoreSearchChannels(
  profileId: string,
  query: string,
  pageToken: string | null
): Promise<SearchChannelsPage> {
  await assertDashboardReader(profileId);

  const page = await searchChannels(query.slice(0, 200), pageToken);
  const ids = page.items.map((c) => c.id);
  const approved = ids.length
    ? await db
        .select({ channelId: whitelistedChannels.channelId })
        .from(whitelistedChannels)
        .where(
          and(
            eq(whitelistedChannels.profileId, profileId),
            inArray(whitelistedChannels.channelId, ids)
          )
        )
    : [];
  const approvedIds = new Set(approved.map((r) => r.channelId));
  return {
    items: page.items,
    approvedIds: ids.filter((id) => approvedIds.has(id)),
    nextPageToken: page.nextPageToken,
  };
}
