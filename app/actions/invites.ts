"use server";

import { db } from "@/lib/db";
import { invites, sharedAccess } from "@/lib/db/schema";
import { getSession, parentSession, requireParentUnlocked } from "@/lib/auth";
import { assertCanManageProfile } from "@/lib/profiles";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import crypto from "crypto";

export async function inviteParent(profileId: string, email: string) {
  const session = await getSession();
  if (!session || session.role !== "parent") return;
  await requireParentUnlocked();
  await assertCanManageProfile(session, profileId);

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
  const user = parentSession(session);
  // A kid session can't accept an invite — proxy.ts will route the
  // resulting /login hit back to their feed.
  if (!user) redirect(`/login?callback=/invite/${token}`);

  const invite = await db.query.invites.findFirst({
    where: eq(invites.token, token),
  });

  if (!invite || invite.status !== "pending" || invite.expiresAt < new Date()) {
    return;
  }

  // Grant access (idempotent — a re-accept or double-submit is a no-op)
  await db
    .insert(sharedAccess)
    .values({
      parentId: user.id,
      profileId: invite.profileId,
      role: "editor",
    })
    .onConflictDoNothing();

  // Update invite status
  await db.update(invites).set({ status: "accepted" }).where(eq(invites.id, invite.id));

  revalidatePath("/parent/profiles");
  redirect("/parent/dashboard");
}
