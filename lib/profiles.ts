import { and, eq, inArray, or } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  getSession,
  isKidSession,
  parentSession,
  type SessionPayload,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { profiles, sharedAccess } from "@/lib/db/schema";

/**
 * Returns the profile if the session user owns it or has a shared_access row;
 * throws otherwise. Use in server actions that mutate a profile's whitelist.
 * Kid-scoped sessions fail closed here — they carry no `user`.
 */
export async function assertCanManageProfile(
  session: SessionPayload | null,
  profileId: string
) {
  const userId = parentSession(session)?.id;
  if (!userId) throw new Error("Not authenticated");

  const profile = await db.query.profiles.findFirst({
    where: eq(profiles.id, profileId),
  });
  if (!profile) throw new Error("Profile not found");
  if (profile.parentId === userId) return profile;

  const shared = await db.query.sharedAccess.findFirst({
    where: and(
      eq(sharedAccess.parentId, userId),
      eq(sharedAccess.profileId, profileId)
    ),
  });
  if (!shared) throw new Error("Not authorized for this profile");
  return profile;
}

/**
 * Kid-scope writes (playlists, reactions, watch progress): allowed when the
 * device is kid-locked to this profile (activeProfileId cookie match), a
 * kid session for this profile, OR a managing parent session exists.
 * Throws like assertCanManageProfile. The signed session is checked
 * first — it is authoritative wherever it disagrees with the forgeable
 * activeProfileId cookie.
 */
export async function assertCanEditKidData(profileId: string) {
  const session = await getSession();
  if (isKidSession(session)) {
    if (session.profileId !== profileId) {
      throw new Error("Not authorized for this profile");
    }
    // Same existence check as canViewProfile — a kid JWT for a deleted
    // profile shouldn't be able to write either. Proxy clears the
    // stale session cookies on the next navigation.
    const exists = await db.query.profiles.findFirst({
      where: eq(profiles.id, profileId),
      columns: { id: true },
    });
    if (!exists) redirect("/kids");
    return;
  }
  const activeProfileId = (await cookies()).get("activeProfileId")?.value;
  if (activeProfileId === profileId) return;
  await assertCanManageProfile(session, profileId);
}

/**
 * Read-side counterpart of assertCanManageProfile: a profile page may be
 * viewed if the device is kid-locked to it (activeProfileId matches), a
 * kid session is bound to it, or the signed-in parent can manage it.
 * Returns a boolean instead of throwing.
 */
export async function canViewProfile(
  session: SessionPayload | null,
  profileId: string,
  activeProfileId: string | undefined
) {
  if (isKidSession(session)) {
    if (session.profileId !== profileId) return false;
    // Verify the profile still exists — a deleted profile with a live
    // JWT would otherwise bounce between /kids redirects forever. The
    // session cookie itself is cleared by proxy.ts (RSC renders can't
    // delete cookies).
    const exists = await db.query.profiles.findFirst({
      where: eq(profiles.id, profileId),
      columns: { id: true },
    });
    return !!exists;
  }
  if (activeProfileId === profileId) return true;
  try {
    await assertCanManageProfile(session, profileId);
    return true;
  } catch {
    return false;
  }
}

/** All profiles the user can manage: owned + shared with them. */
export async function getManageableProfiles(userId: string) {
  const shared = await db.query.sharedAccess.findMany({
    where: eq(sharedAccess.parentId, userId),
  });
  const sharedIds = shared.map((s) => s.profileId);

  return db.query.profiles.findMany({
    where:
      sharedIds.length > 0
        ? or(eq(profiles.parentId, userId), inArray(profiles.id, sharedIds))
        : eq(profiles.parentId, userId),
  });
}
