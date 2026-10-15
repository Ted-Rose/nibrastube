"use server";

import { db } from "@/lib/db";
import { profiles, users } from "@/lib/db/schema";
import {
  activeProfileCookieOptions,
  login as authLogin,
  loginKid,
  setParentUnlocked,
} from "@/lib/auth";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

export interface AuthFormState {
  error?: string;
}

// `callback` is user-controlled — parse it against a dummy origin and
// only honor it when it stays on that origin. A bare startsWith("/")
// check is bypassable: "/\evil.com" treats "\" as a path separator and
// "/%09/evil.com" hides a tab that collapses to "//evil.com", both of
// which resolve cross-origin. ".." normalization can likewise yield a
// "//host" pathname ("/..//evil.com"), which redirect() treats as
// scheme-relative — reject it too. Fragments are dropped — app routes
// don't need them.
function safeCallback(callback: unknown): string {
  if (typeof callback !== "string") return "/parent/dashboard";
  try {
    const url = new URL(callback, "https://internal.invalid");
    if (
      url.origin !== "https://internal.invalid" ||
      url.pathname.startsWith("//")
    ) {
      return "/parent/dashboard";
    }
    return url.pathname + url.search;
  } catch {
    return "/parent/dashboard";
  }
}

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().min(2),
  // 4-digit PIN; optional in schema, "0000" default applied on
  // extraction below.
  pin: z.string().regex(/^\d{4}$/).optional(),
});

export async function signup(
  _prevState: AuthFormState | null,
  formData: FormData
): Promise<AuthFormState> {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const name = formData.get("name") as string;
  const pin = (formData.get("pin") as string) || "0000"; // Defaulting to 0000 if not provided
  const callback = safeCallback(formData.get("callback"));

  const validated = signupSchema.safeParse({ email, password, name, pin });
  if (!validated.success) {
    return {
      error:
        validated.error.issues[0]?.message ??
        "Please check your details and try again.",
    };
  }

  // Check if user exists. Emails and kid usernames share one login
  // identifier namespace, so an email already claimed as a kid's
  // username is taken too — that kid's login would shadow the signup.
  const [existingUser, usernameTaken] = await Promise.all([
    db.query.users.findFirst({
      where: eq(users.email, email),
      columns: { id: true },
    }),
    db.query.profiles.findFirst({
      where: eq(profiles.username, email),
      columns: { id: true },
    }),
  ]);

  if (existingUser || usernameTaken) {
    return { error: "An account with this email already exists." };
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const [newUser] = await db
    .insert(users)
    .values({
      email,
      passwordHash,
      name,
      parentPin: pin,
    })
    .returning();

  await authLogin({ id: newUser.id, email: newUser.email, name: newUser.name });
  // Signing up already proves the password — treat the parent portal as
  // unlocked on this device.
  await setParentUnlocked();
  redirect(callback);
}

const loginSchema = z.object({
  identifier: z.string().min(1),
  password: z.string().min(1),
});

export async function login(
  _prevState: AuthFormState | null,
  formData: FormData
): Promise<AuthFormState> {
  // Usernames are stored trimmed (setKidCredentials/createProfile) —
  // trim here too so stray whitespace doesn't fail the login.
  const identifier = ((formData.get("identifier") as string) || "").trim();
  const password = formData.get("password") as string;
  const callback = safeCallback(formData.get("callback"));

  const validated = loginSchema.safeParse({ identifier, password });
  if (!validated.success) {
    return { error: "Please enter your email or username and password." };
  }

  // One form, two account types: the identifier is a parent's email or
  // a kid profile's username — they share one namespace, enforced at
  // write time (signup, setKidCredentials). Parents match first.
  const user = await db.query.users.findFirst({
    where: eq(users.email, identifier),
  });

  if (user && (await bcrypt.compare(password, user.passwordHash))) {
    await authLogin({ id: user.id, email: user.email, name: user.name });
    // A successful password login counts as proof of identity — unlock
    // the parent portal on this device too.
    await setParentUnlocked();
    redirect(callback);
  }

  const profile = await db.query.profiles.findFirst({
    where: eq(profiles.username, identifier),
  });

  if (
    profile?.passwordHash &&
    (await bcrypt.compare(password, profile.passwordHash))
  ) {
    await loginKid(profile);
    // The unsigned kid lock stays as a compat shim for the read/write
    // guards that still key off it — the signed session is
    // authoritative wherever the two disagree.
    (await cookies()).set(
      "activeProfileId",
      profile.id,
      activeProfileCookieOptions
    );
    // Scope-filter the callback: a kid may only be sent to their own
    // feed — anything else (e.g. a crafted /parent/* target) falls
    // back to the feed root.
    const feed = `/kids/${profile.id}`;
    redirect(
      callback === feed ||
        callback.startsWith(`${feed}/`) ||
        callback.startsWith(`${feed}?`)
        ? callback
        : feed
    );
  }

  // Same generic error for both lookups (no account enumeration),
  // throttled like the PIN gate — kid passwords are deliberately short.
  await new Promise((r) => setTimeout(r, 500));
  return { error: "Invalid email or password." };
}

export async function logoutAction() {
  const { logout } = await import("@/lib/auth");
  await logout();
  redirect("/login");
}
