"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import {
  activeProfileCookieOptions,
  clearParentUnlocked,
  getSession,
  isKidSession,
  setParentUnlocked,
} from "@/lib/auth";
import { assertCanManageProfile } from "@/lib/profiles";

export async function selectProfile(profileId: string) {
  try {
    const session = await getSession();
    // Only profiles the signed-in parent owns or has shared access to can
    // be locked onto a device; sends the user back to the picker instead
    // of surfacing a raw error.
    await assertCanManageProfile(session, profileId);
  } catch {
    redirect("/kids");
  }

  const cookieStore = await cookies();
  cookieStore.set("activeProfileId", profileId, activeProfileCookieOptions);
  redirect(`/kids/${profileId}`);
}

// Server-side PIN check for the parent gate — the PIN lives only in
// the DB, never in the session JWT or on the client. Returns an error
// string to keep the gate open; on success sets the signed
// parentUnlocked cookie, lifts the kid lock, and redirects to the
// parent dashboard.
export async function verifyParentPin(pin: string) {
  const session = await getSession();
  if (!session) redirect("/login");
  // Kid sessions carry no `user` — there is no PIN to check them
  // against, so bounce straight back to their feed.
  if (isKidSession(session)) redirect(`/kids/${session.profileId}`);

  const user = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
    columns: { parentPin: true },
  });

  if (!user || pin !== user.parentPin) {
    // Slow down brute-force attempts on the 4-digit PIN.
    await new Promise((r) => setTimeout(r, 500));
    return { error: "Incorrect PIN. Try again." };
  }

  await setParentUnlocked();
  // Unlocking the parent portal also lifts the kid lock — this device
  // is now parent-controlled until "Kids Corner" re-locks it.
  (await cookies()).delete("activeProfileId");
  redirect("/parent/dashboard");
}

export async function lockParentPortal() {
  await clearParentUnlocked();
  redirect("/kids");
}
