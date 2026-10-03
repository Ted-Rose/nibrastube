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
  const callback = formData.get("callback") as string;

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
  await setParentUnlocked();
  const target =
    callback?.startsWith("/") && !callback.startsWith("//")
      ? callback
      : "/kids";
  redirect(target);
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
  const callback = formData.get("callback") as string;

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
  await setParentUnlocked();
  const target =
    callback?.startsWith("/") && !callback.startsWith("//")
      ? callback
      : "/kids";
  redirect(target);
}

export async function logoutAction() {
  const { logout } = await import("@/lib/auth");
  await logout();
  redirect("/login");
}
