"use server";

import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { encrypt, login as authLogin } from "@/lib/auth";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";

// `callback` is user-controlled — only honor same-origin relative paths
// so it can't be used as an open redirect off-site.
function safeCallback(callback: unknown): string {
  return typeof callback === "string" &&
    callback.startsWith("/") &&
    !callback.startsWith("//")
    ? callback
    : "/parent/dashboard";
}

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().min(2),
  pin: z.string().optional(), // Pin is optional in schema, default handled in formData extraction
});

export async function signup(formData: FormData): Promise<void> {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const name = formData.get("name") as string;
  const pin = (formData.get("pin") as string) || "0000"; // Defaulting to 0000 if not provided
  const callback = safeCallback(formData.get("callback"));

  const validated = signupSchema.safeParse({ email, password, name, pin });
  if (!validated.success) {
    return;
  }

  // Check if user exists
  const existingUser = await db.query.users.findFirst({
    where: eq(users.email, email),
  });

  if (existingUser) {
    return;
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

  await authLogin({ id: newUser.id, email: newUser.email, name: newUser.name, parentPin: newUser.parentPin });
  redirect(callback);
}

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export async function login(formData: FormData): Promise<void> {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const callback = safeCallback(formData.get("callback"));

  const validated = loginSchema.safeParse({ email, password });
  if (!validated.success) {
    return;
  }

  const user = await db.query.users.findFirst({
    where: eq(users.email, email),
  });

  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return;
  }

  await authLogin({ id: user.id, email: user.email, name: user.name, parentPin: user.parentPin });
  redirect(callback);
}

export async function logoutAction() {
  const { logout } = await import("@/lib/auth");
  await logout();
  redirect("/login");
}
