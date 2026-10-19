"use server";

import { cookies } from "next/headers";
import { getSession } from "@/lib/auth";
import { getRecommendedVideos } from "@/lib/kids-feed";
import { canViewProfile } from "@/lib/profiles";

// Infinite-scroll paging for the For You tab. A read, not a mutation,
// so it passes the same canViewProfile gate as the portal page itself
// (kid lock, matching kid session, or managing parent) instead of
// assertCanManageProfile. Returns [] past the end of the whitelist —
// the grid treats an empty page as the end of the feed.
export async function loadMoreForYou(
  profileId: string,
  q: string,
  offset: number
) {
  const session = await getSession();
  const activeProfileId = (await cookies()).get("activeProfileId")?.value;
  if (!(await canViewProfile(session, profileId, activeProfileId))) {
    throw new Error("Not authorized for this profile");
  }
  return getRecommendedVideos(profileId, {
    q,
    offset: Math.max(0, Math.floor(offset) || 0),
  });
}
