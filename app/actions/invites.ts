"use server";

import { db } from "@/lib/db";
import { invites, sharedAccess, users } from "@/lib/db/schema";
import { getSession, requireParentUnlocked } from "@/lib/auth";
import { eq, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import crypto from "crypto";

export async function inviteParent(profileId: string, email: string) {
  const session = await getSession();
  if (!session) return;
  await requireParentUnlocked();

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

  await db.insert(invites).values({
    email,
    profileId,
    fromParentId: session.user.id,
    token,
    expiresAt,
  });

  // In a real app, send an email here.
  // For this task, we'll just return the link so the user can "copy" it.
  console.log(`Invitation link: /invite/${token}`);
  
  revalidatePath(`/parent/profiles`);
}

export async function createInviteAction(formData: FormData) {
  const profileId = formData.get("profileId") as string;
  const email = formData.get("email") as string;
  if (profileId && email) {
    await inviteParent(profileId, email);
  }
}

export async function acceptInvite(token: string) {
  const session = await getSession();
  if (!session) redirect(`/login?callback=/invite/${token}`);

  const invite = await db.query.invites.findFirst({
    where: eq(invites.token, token),
  });

  if (!invite || invite.expiresAt < new Date()) {
    return;
  }

  // Grant access
  await db.insert(sharedAccess).values({
    parentId: session.user.id,
    profileId: invite.profileId,
    role: "editor",
  });

  // Update invite status
  await db.update(invites).set({ status: "accepted" }).where(eq(invites.id, invite.id));

  revalidatePath("/parent/profiles");
  redirect("/parent/dashboard");
}
