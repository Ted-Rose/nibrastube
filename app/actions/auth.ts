"use server";

import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { login as authLogin, setParentUnlocked } from "@/lib/auth";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
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

  // Check if user exists
  const existingUser = await db.query.users.findFirst({
    where: eq(users.email, email),
  });

  if (existingUser) {
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
  email: z.string().email(),
  password: z.string(),
});

export async function login(
  _prevState: AuthFormState | null,
  formData: FormData
): Promise<AuthFormState> {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const callback = safeCallback(formData.get("callback"));

  const validated = loginSchema.safeParse({ email, password });
  if (!validated.success) {
    return { error: "Please enter a valid email and password." };
  }

  const user = await db.query.users.findFirst({
    where: eq(users.email, email),
  });

  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return { error: "Invalid email or password." };
  }

  await authLogin({ id: user.id, email: user.email, name: user.name });
  // A successful password login counts as proof of identity — unlock
  // the parent portal on this device too.
  await setParentUnlocked();
  redirect(callback);
}

export async function logoutAction() {
  const { logout } = await import("@/lib/auth");
  await logout();
  redirect("/login");
}
