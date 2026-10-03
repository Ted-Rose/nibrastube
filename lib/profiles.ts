import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { profiles, sharedAccess } from "@/lib/db/schema";

interface SessionLike {
  user?: { id?: string };
}

/**
 * Returns the profile if the session user owns it or has a shared_access row;
 * throws otherwise. Use in server actions that mutate a profile's whitelist.
 */
export async function assertCanManageProfile(
  session: SessionLike | null,
  profileId: string
) {
  const userId = session?.user?.id;
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
 * Read-side counterpart of assertCanManageProfile: a profile page may be
 * viewed if the device is kid-locked to it (activeProfileId matches) or the
 * signed-in parent can manage it. Returns a boolean instead of throwing.
 */
export async function canViewProfile(
  session: SessionLike | null,
  profileId: string,
  activeProfileId: string | undefined
) {
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
