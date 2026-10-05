import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
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
  const session = await encrypt({ user });

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
// than SESSION_REFRESH_AGE. Called from proxy.ts with the session it
// already decrypted.
export async function refreshSessionCookie(
  session: SessionPayload | null,
  response: NextResponse
) {
  if (!session) return;

  const issuedAt = typeof session.iat === "number" ? session.iat * 1000 : 0;
  if (Date.now() - issuedAt < SESSION_REFRESH_AGE) return;

  const expires = new Date(Date.now() + SESSION_MAX_AGE);
  response.cookies.set("session", await encrypt({ user: session.user }), {
    ...cookieOptions,
    expires,
  });
}

// proxy.ts fallthrough for routes that didn't handle the session
// themselves: refresh the ~1y session on activity so it effectively
// never expires. Returns null when there is no session to refresh.
export async function updateSession(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session) return;

  const res = NextResponse.next();
  await refreshSessionCookie(session, res);
  return res;
}

// Browser-session cookie holding a signed JWT (scope "parent-unlock",
// bound to the session user, 24h exp): set when the parent proves
// identity (password or PIN), cleared by "Kids Corner"/logout or when
// the browser closes. Signed so it can't be forged in devtools.
export async function setParentUnlocked() {
  const session = await getSession();
  if (!session) return;
  const token = await new SignJWT({ scope: "parent-unlock" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(session.user.id)
    .setIssuedAt()
    .setExpirationTime("24h")
    .sign(key);
  (await cookies()).set("parentUnlocked", token, cookieOptions);
}

async function verifyUnlockToken(
  token: string | undefined,
  userId: string
): Promise<boolean> {
  if (!token) return false;
  try {
    const payload = await decrypt(token);
    return payload.scope === "parent-unlock" && payload.sub === userId;
  } catch {
    return false;
  }
}

export async function isParentUnlocked(
  request: NextRequest,
  session: SessionPayload | null
): Promise<boolean> {
  if (!session) return false;
  return verifyUnlockToken(
    request.cookies.get("parentUnlocked")?.value,
    session.user.id
  );
}

// Cookie-store variant for server components and actions (no
// NextRequest available there).
export async function isParentUnlockedCookie(
  session: SessionPayload | null
): Promise<boolean> {
  if (!session) return false;
  return verifyUnlockToken(
    (await cookies()).get("parentUnlocked")?.value,
    session.user.id
  );
}

// Guard for parent-mutating server actions: redirects to the PIN gate
// unless the request carries a valid parentUnlocked token for the
// current session user. (redirect() throws, so keep it out of try.)
export async function requireParentUnlocked(): Promise<void> {
  const session = await getSession();
  if (!(await isParentUnlockedCookie(session))) {
    // Clear the stale/forged cookie so /kids auto-opens the PIN modal
    // instead of dead-ending on the picker.
    (await cookies()).delete("parentUnlocked");
    redirect("/kids?gate=1");
  }
}

export async function clearParentUnlocked() {
  (await cookies()).delete("parentUnlocked");
}
