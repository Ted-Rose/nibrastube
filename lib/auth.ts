import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

const secretKey = "secret"; // Fallback for type safety, should use env
const key = new TextEncoder().encode(process.env.JWT_SECRET || secretKey);

// Parents stay logged in per device; reissued by proxy.ts as a rolling
// refresh once the JWT is older than SESSION_REFRESH_AGE.
export const SESSION_MAX_AGE = 365 * 24 * 60 * 60 * 1000; // 1 year, ms
const SESSION_REFRESH_AGE = 24 * 60 * 60 * 1000; // 1 day, ms

const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

export interface SessionPayload extends JWTPayload {
  user: { id: string; email: string; name: string | null };
}

export async function encrypt(payload: SessionPayload) {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(
      Math.floor((Date.now() + SESSION_MAX_AGE) / 1000)
    )
    .sign(key);
}

export async function decrypt(input: string): Promise<SessionPayload> {
  const { payload } = await jwtVerify(input, key, {
    algorithms: ["HS256"],
  });
  return payload as SessionPayload;
}

export async function login(user: {
  id: string;
  email: string;
  name: string | null;
}) {
  const expires = new Date(Date.now() + SESSION_MAX_AGE);
  const session = await encrypt({ user, expires });

  (await cookies()).set("session", session, { ...cookieOptions, expires });
}

export async function logout() {
  const cookieStore = await cookies();
  cookieStore.set("session", "", { ...cookieOptions, expires: new Date(0) });
  cookieStore.delete("parentUnlocked");
  cookieStore.delete("activeProfileId");
}

export async function getSession() {
  const session = (await cookies()).get("session")?.value;
  if (!session) return null;
  try {
    return await decrypt(session);
  } catch {
    return null;
  }
}

export async function getRequestSession(request: NextRequest) {
  const session = request.cookies.get("session")?.value;
  if (!session) return null;
  try {
    return await decrypt(session);
  } catch {
    return null;
  }
}

// Rolling refresh: reissue the session cookie when the JWT is older
// than SESSION_REFRESH_AGE. Called from proxy.ts on matched requests.
export async function refreshSessionCookie(
  request: NextRequest,
  response: NextResponse
) {
  const session = await getRequestSession(request);
  if (!session) return;

  const issuedAt = typeof session.iat === "number" ? session.iat * 1000 : 0;
  if (Date.now() - issuedAt < SESSION_REFRESH_AGE) return;

  const expires = new Date(Date.now() + SESSION_MAX_AGE);
  response.cookies.set(
    "session",
    await encrypt({ user: session.user, expires }),
    { ...cookieOptions, expires }
  );
}

// Browser-session cookie: set when the parent proves identity (password
// or PIN), cleared by "Kids Corner"/logout or when the browser closes.
export async function setParentUnlocked() {
  (await cookies()).set("parentUnlocked", "1", cookieOptions);
}

export async function clearParentUnlocked() {
  (await cookies()).delete("parentUnlocked");
}
