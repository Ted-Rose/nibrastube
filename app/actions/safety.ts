"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { assertCanManageProfile } from "@/lib/profiles";

export async function selectProfile(profileId: string) {
  const session = await getSession();
  // Only profiles the signed-in parent owns or has shared access to can be
  // locked onto a device; throws otherwise.
  await assertCanManageProfile(session, profileId);

  const cookieStore = await cookies();
  cookieStore.set("activeProfileId", profileId, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365, // 1 year — matches the session lifetime
    httpOnly: true,
  });
  redirect(`/kids/${profileId}`);
}

export async function unlockParentPortal() {
  const cookieStore = await cookies();
  cookieStore.delete("activeProfileId");
  redirect("/parent/dashboard");
}
