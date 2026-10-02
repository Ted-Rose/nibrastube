"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { assertCanManageProfile } from "@/lib/profiles";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

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
  cookieStore.set("activeProfileId", profileId, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365, // 1 year — matches the session lifetime
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  redirect(`/kids/${profileId}`);
}

export async function unlockParentPortal(pin: string) {
  const session = await getSession();
  if (!session) redirect("/login");

  // The PIN is still a soft family gate, but lifting the kid lock on a
  // device holding a ~1y session must be verified server-side, not just
  // in the client gate. parentPin rides in the JWT payload (set at
  // login); fall back to the users row so sessions minted before that
  // was included — or with a since-changed PIN — still verify against
  // the source of truth.
  let expectedPin = session.user?.parentPin as string | undefined;
  if (!expectedPin && session.user?.id) {
    const user = await db.query.users.findFirst({
      where: eq(users.id, session.user.id),
      columns: { parentPin: true },
    });
    expectedPin = user?.parentPin;
  }

  if (!expectedPin || pin !== expectedPin) {
    return { error: "Incorrect PIN" };
  }

  const cookieStore = await cookies();
  cookieStore.delete("activeProfileId");
  redirect("/parent/dashboard");
}
