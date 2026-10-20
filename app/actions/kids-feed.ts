"use server";

import { cookies } from "next/headers";
import { getSession } from "@/lib/auth";
import { getRecommendedVideos, type KidsType } from "@/lib/kids-feed";
import { canViewProfile } from "@/lib/profiles";

// Client-supplied filter — clamp to a valid KidsType before querying.
const asKidsType = (t: string): KidsType =>
  t === "videos" || t === "shorts" ? t : "all";

// Infinite-scroll paging for the For You tab. A read, not a mutation,
// so it passes the same canViewProfile gate as the portal page itself
// (kid lock, matching kid session, or managing parent) instead of
// assertCanManageProfile. Returns [] past the end of the whitelist —
// the grid treats an empty page as the end of the feed.
export async function loadMoreForYou(
  profileId: string,
  q: string,
  type: KidsType,
  offset: number
) {
  const session = await getSession();
  const activeProfileId = (await cookies()).get("activeProfileId")?.value;
  if (!(await canViewProfile(session, profileId, activeProfileId))) {
    throw new Error("Not authorized for this profile");
  }
  return getRecommendedVideos(profileId, {
    q,
    type: asKidsType(type),
    offset: Math.max(0, Math.floor(offset) || 0),
  });
}

// Same paging gate as loadMoreForYou, restricted to Shorts — backs the
// Shorts feed's infinite scroll.
export async function loadMoreShorts(
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
    type: "shorts",
  });
}
