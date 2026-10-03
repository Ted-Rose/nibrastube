"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import {
  clearParentUnlocked,
  getSession,
  setParentUnlocked,
} from "@/lib/auth";
import { assertCanManageProfile } from "@/lib/profiles";

export async function selectProfile(profileId: string) {
  const session = await getSession();
  try {
    await assertCanManageProfile(session, profileId);
  } catch {
    redirect("/kids");
  }

  const cookieStore = await cookies();
  cookieStore.set("activeProfileId", profileId, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365, // 1 year — informational only
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  redirect(`/kids/${profileId}`);
}

interface VerifyPinState {
  error?: string;
}

export async function verifyParentPin(
  _prevState: VerifyPinState | null,
  formData: FormData
): Promise<VerifyPinState> {
  const session = await getSession();
  if (!session) redirect("/login");

  const pin = formData.get("pin");
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
  redirect("/parent/dashboard");
}

export async function lockParentPortal() {
  await clearParentUnlocked();
  redirect("/kids");
}
