"use server";

import { cookies } from "next/headers";
import { getSession } from "@/lib/auth";
import { getRecommendedVideos, type KidsType } from "@/lib/kids-feed";
import { canViewProfile } from "@/lib/profiles";

// Client-supplied filters — clamp to a valid KidsType, and ?min=/?max=
// to positive-integer seconds bounds (24h ceiling, like
// parseKidsFeedParams).
const asKidsType = (t: string): KidsType =>
  t === "videos" || t === "shorts" ? t : "all";
const asLenBound = (n: number | null): number | null =>
  typeof n === "number" && Number.isFinite(n) && n > 0
    ? Math.min(Math.floor(n), 86400)
    : null;

// Infinite-scroll paging for the For You tab. A read, not a mutation,
// so it passes the same canViewProfile gate as the portal page itself
// (kid lock, matching kid session, or managing parent) instead of
// assertCanManageProfile. Returns [] past the end of the whitelist —
// the grid treats an empty page as the end of the feed.
export async function loadMoreForYou(
  profileId: string,
  q: string,
  type: KidsType,
  minLen: number | null,
  maxLen: number | null,
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
    minLen: asLenBound(minLen),
    maxLen: asLenBound(maxLen),
    offset: Math.max(0, Math.floor(offset) || 0),
  });
}

// Same paging gate as loadMoreForYou, restricted to Shorts — backs the
// Shorts feed's infinite scroll.
export async function loadMoreShorts(
  profileId: string,
  q: string,
  minLen: number | null,
  maxLen: number | null,
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
    minLen: asLenBound(minLen),
    maxLen: asLenBound(maxLen),
  });
}
