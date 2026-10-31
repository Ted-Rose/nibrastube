"use server";

import { db } from "@/lib/db";
import { profiles, users } from "@/lib/db/schema";
import { getSession, requireParentUnlocked } from "@/lib/auth";
import {
  assertCanEditKidData,
  assertCanManageProfile,
} from "@/lib/profiles";
import { isKidAvatar } from "@/lib/kid-avatars";
import bcrypt from "bcryptjs";
import { eq, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";

export interface ProfileFormState {
  error?: string;
}

const profileSchema = z.object({
  name: z.string().min(2),
  avatar: z.string().optional(),
});

export async function createProfile(
  _prevState: ProfileFormState | null,
  formData: FormData
): Promise<ProfileFormState> {
  const session = await getSession();
  if (!session || session.role !== "parent") {
    return { error: "Not authorized." };
  }
  await requireParentUnlocked();

  const name = formData.get("name") as string;
  const avatar = formData.get("avatar") as string;

  const validated = profileSchema.safeParse({ name, avatar });
  if (!validated.success) {
    return {
      error:
        validated.error.issues[0]?.message ??
        "Please check the profile details and try again.",
    };
  }

  // Optional login credentials — both or neither; kid passwords may be
  // as short as 4 (kid-typeable) vs the 6 required of parents.
  const username = ((formData.get("username") as string) || "").trim();
  const password = (formData.get("password") as string) || "";
  let passwordHash: string | undefined;
  if (username || password) {
    if (!username || !password) {
      return {
        error: "Set both a username and a password to enable login.",
      };
    }
    if (!kidUsernameSchema.safeParse(username).success) {
      return { error: "Username must be at least 3 characters." };
    }
    if (password.length < 4) {
      return { error: "Password must be at least 4 characters." };
    }
    if (await kidIdentifierTaken(username)) {
      return { error: "That username is already taken." };
    }
    passwordHash = await bcrypt.hash(password, 10);
  }

  await db.insert(profiles).values({
    name,
    avatar: avatar || "👶",
    parentId: session.user.id,
    username: username || null,
    passwordHash,
  });

  revalidatePath("/parent/profiles");
  return {};
}

export async function deleteProfile(profileId: string) {
  const session = await getSession();
  if (!session || session.role !== "parent") return;
  await requireParentUnlocked();

  await db
    .delete(profiles)
    .where(
      and(
        eq(profiles.id, profileId),
        eq(profiles.parentId, session.user.id)
      )
    );

  revalidatePath("/parent/profiles");
}

// The login identifier namespace is shared between users.email and
// profiles.username — a kid username matching an existing account in
// either table would shadow or collide at login time.
// The check-then-insert across the two tables races — a concurrent
// signup and credential write can both pass this check. Accepted: it
// fails closed because login consults users.email first, so the users
// row wins and the parent can simply rename the kid's username.
async function kidIdentifierTaken(
  username: string,
  excludeProfileId?: string
): Promise<boolean> {
  const [emailTaken, usernameTaken] = await Promise.all([
    db.query.users.findFirst({
      where: eq(users.email, username),
      columns: { id: true },
    }),
    db.query.profiles.findFirst({
      where: eq(profiles.username, username),
      columns: { id: true },
    }),
  ]);
  return (
    !!emailTaken ||
    (!!usernameTaken && usernameTaken.id !== excludeProfileId)
  );
}

// Shared kid-username rule: emails are valid usernames too (e.g. a
// parent's +alias) — no charset restriction beyond length.
const kidUsernameSchema = z.string().trim().min(3).max(254);

const kidCredentialsSchema = z.object({
  profileId: z.string().uuid(),
  // "" means "remove the login" — setKidCredentials handles it before
  // the credential write.
  username: kidUsernameSchema.or(z.literal("")),
  password: z.string().min(4).max(128).optional(),
});

// Sets or replaces a kid profile's login. Blank password keeps the
// current one; only usable while credentials already exist — the form
// requires it for a first-time setup anyway. Owner-only (not shared
// access): like deleteProfile, a shared parent could lock the kid out.
export async function setKidCredentials(
  _prevState: ProfileFormState | null,
  formData: FormData
): Promise<ProfileFormState> {
  const session = await getSession();
  if (!session || session.role !== "parent") {
    return { error: "Not authorized." };
  }
  await requireParentUnlocked();

  const submittedUsername = (formData.get("username") as string) || "";
  const raw = {
    profileId: formData.get("profileId"),
    username: submittedUsername.trim(),
    password: (formData.get("password") as string) || undefined,
  };

  // Validate before any DB work — a non-uuid profileId would make
  // Postgres throw `invalid input syntax for type uuid` and 500.
  const parsed = kidCredentialsSchema.safeParse(raw);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    if (field === "profileId") {
      return { error: "Profile not found." };
    }
    return {
      error:
        field === "password"
          ? "Password must be 4-128 characters."
          : "Username must be 3-254 characters.",
    };
  }

  // A whitespace-only username trims to "" — that's a typo, not a
  // request to remove the login.
  if (submittedUsername !== "" && parsed.data.username === "") {
    return { error: "Username must be at least 3 characters." };
  }

  const profile = await db.query.profiles.findFirst({
    where: eq(profiles.id, parsed.data.profileId),
  });
  if (!profile || profile.parentId !== session.user.id) {
    return { error: "Profile not found." };
  }

  // Empty username removes the kid login entirely.
  if (!parsed.data.username) {
    if (profile.username) {
      await db
        .update(profiles)
        .set({ username: null, passwordHash: null })
        .where(eq(profiles.id, profile.id));
      revalidatePath("/parent/profiles");
    }
    return {};
  }

  if (await kidIdentifierTaken(parsed.data.username, profile.id)) {
    return { error: "That username is already taken." };
  }

  const passwordHash = parsed.data.password
    ? await bcrypt.hash(parsed.data.password, 10)
    : profile.passwordHash;
  if (!passwordHash) {
    // First-time setup requires a password — a blank one would leave a
    // username that can never log in.
    return { error: "Set a password to enable login." };
  }

  await db
    .update(profiles)
    .set({ username: parsed.data.username, passwordHash })
    .where(eq(profiles.id, profile.id));

  revalidatePath("/parent/profiles");
  return {};
}

export interface AvatarFormState {
  error?: string;
  saved?: boolean;
}

const kidAvatarSchema = z.object({
  profileId: z.string().uuid(),
  avatar: z.string().min(1),
});

// Kid-facing avatar picker on /kids/<id>/settings. Kid-scope auth via
// assertCanEditKidData (matching kid session, activeProfileId lock, or
// managing parent) — never requireParentUnlocked, so a locked kid
// device can use it. KID_AVATARS is the allow-list: values outside the
// preset are rejected before any DB write, so stored avatars stay
// render-safe short strings.
export async function updateKidAvatar(
  _prevState: AvatarFormState | null,
  formData: FormData
): Promise<AvatarFormState> {
  const parsed = kidAvatarSchema.safeParse({
    profileId: formData.get("profileId"),
    avatar: formData.get("avatar"),
  });
  if (!parsed.success) {
    return {
      error:
        parsed.error.issues[0]?.path[0] === "profileId"
          ? "Profile not found."
          : "Pick an avatar from the list.",
    };
  }
  if (!isKidAvatar(parsed.data.avatar)) {
    return { error: "Pick an avatar from the list." };
  }
  const { profileId, avatar } = parsed.data;

  try {
    await assertCanEditKidData(profileId);
  } catch (error) {
    unstable_rethrow(error);
    return { error: "Not authorized." };
  }

  await db
    .update(profiles)
    .set({ avatar })
    .where(eq(profiles.id, profileId));

  // "layout" revalidates the whole /kids/<id> subtree — the feed
  // header, this settings page, and watch pages all render the avatar.
  // /kids, /parent/profiles, and the parent dashboard's Select Kid
  // sidebar render it too.
  revalidatePath(`/kids/${profileId}`, "layout");
  revalidatePath("/kids");
  revalidatePath("/parent/profiles");
  revalidatePath("/parent/dashboard");
  return { saved: true };
}

const swipeSchema = z.object({
  profileId: z.string().uuid(),
  enabled: z.boolean(),
});

export async function setSwipeEnabled(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) return;
  await requireParentUnlocked();

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
