"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export async function selectProfile(profileId: string) {
  const cookieStore = await cookies();
  cookieStore.set("activeProfileId", profileId, {
    path: "/",
    maxAge: 60 * 60 * 24, // 24 hours
    httpOnly: true,
  });
  redirect(`/kids/${profileId}`);
}

export async function unlockParentPortal() {
  const cookieStore = await cookies();
  cookieStore.delete("activeProfileId");
  redirect("/parent/dashboard");
}
