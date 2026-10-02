"use server";

import { db } from "@/lib/db";
import { profiles } from "@/lib/db/schema";
import { getSession } from "@/lib/auth";
import { assertCanManageProfile } from "@/lib/profiles";
import { eq, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const profileSchema = z.object({
  name: z.string().min(2),
  avatar: z.string().optional(),
});

export async function createProfile(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) return;

  const name = formData.get("name") as string;
  const avatar = formData.get("avatar") as string;

  const validated = profileSchema.safeParse({ name, avatar });
  if (!validated.success) return;

  await db.insert(profiles).values({
    name,
    avatar: avatar || "👶",
    parentId: session.user.id,
  });

  revalidatePath("/parent/profiles");
}

export async function deleteProfile(profileId: string) {
  const session = await getSession();
  if (!session) return;

  await db
    .delete(profiles)
    .where(and(eq(profiles.id, profileId), eq(profiles.parentId, session.user.id)));

  revalidatePath("/parent/profiles");
}

const swipeSchema = z.object({
  profileId: z.string().uuid(),
  enabled: z.boolean(),
});

export async function setSwipeEnabled(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) return;

  const parsed = swipeSchema.safeParse({
    profileId: formData.get("profileId"),
    enabled: formData.get("enabled") === "true",
  });
  if (!parsed.success) return;

  await assertCanManageProfile(session, parsed.data.profileId);
  await db
    .update(profiles)
    .set({ swipeEnabled: parsed.data.enabled })
    .where(eq(profiles.id, parsed.data.profileId));

  revalidatePath("/parent/profiles");
}
