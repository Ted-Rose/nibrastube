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

export interface ParentClaims extends JWTPayload {
  role: "parent";
  user: { id: string; email: string; name: string | null };
}

export interface KidClaims extends JWTPayload {
  role: "kid";
  profileId: string;
  name: string;
}

// One `session` cookie, two scopes: a parent JWT identifies a `users`
// row and can reach /parent/* (with the PIN unlock), a kid JWT is bound
// to a single profileId and can only see that profile's pages. Kid
// sessions fail closed on every parent check — none read `user`.
export type SessionPayload = ParentClaims | KidClaims;

export function isKidSession(
  session: SessionPayload | null | undefined
): session is KidClaims {
  return session?.role === "kid";
}

// The parent identity carried by the session, or null for kid-scoped
// (and absent) sessions — call sites that need `session.user.id` should
// go through this so the kid variant can't leak through.
export function parentSession(
  session: SessionPayload | null | undefined
): ParentClaims["user"] | null {
  return session?.role === "parent" ? session.user : null;
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

export async function decrypt(
  input: string
): Promise<SessionPayload | null> {
  const { payload } = await jwtVerify(input, key, {
    algorithms: ["HS256"],
  });
  // Tokens minted before the role claim existed are parent sessions —
  // normalize so deployed JWTs survive the rollout.
  if (!payload.role && payload.user) payload.role = "parent";
  // Fail closed on a well-signed token of the wrong shape (e.g. a
  // parentUnlocked JWT pasted into the session cookie): callers treat
  // null as signed-out rather than trusting a partial payload.
  const user = payload.user;
  if (
    payload.role === "parent" &&
    typeof user === "object" &&
    user !== null &&
    typeof (user as { id?: unknown }).id === "string"
  ) {
    return payload as ParentClaims;
  }
  if (payload.role === "kid" && typeof payload.profileId === "string") {
    return payload as KidClaims;
  }
  return null;
}

export async function login(user: {
  id: string;
  email: string;
  name: string | null;
}) {
  const expires = new Date(Date.now() + SESSION_MAX_AGE);
  const session = await encrypt({ role: "parent", user });

  (await cookies()).set("session", session, { ...cookieOptions, expires });
}

export async function loginKid(profile: { id: string; name: string }) {
  const expires = new Date(Date.now() + SESSION_MAX_AGE);
  const session = await encrypt({
    role: "kid",
    profileId: profile.id,
    name: profile.name,
  });

  const cookieStore = await cookies();
  cookieStore.set("session", session, { ...cookieOptions, expires });
  // The kid session replaces any parent session on this device — clear
  // a stale parentUnlocked token so it can't silently re-unlock the
  // portal if the same parent logs back in within the token's 24h.
  cookieStore.delete("parentUnlocked");
}

// Options shared by every writer of the `activeProfileId` kid-lock
// cookie (profile picker, kid login, proxy re-set for stale values).
export const activeProfileCookieOptions = {
  path: "/",
  maxAge: 60 * 60 * 24 * 365, // 1 year — matches the session lifetime
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
};

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
  // Re-sign the whole payload — re-encrypting only `user` would strip
  // the kid claims on the daily rolling refresh.
  response.cookies.set("session", await encrypt(session), {
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
  // Unlock tokens are bound to a real users.id via `sub` — never mint
  // one for a kid-scoped session.
  const user = parentSession(await getSession());
  if (!user) return;
  const token = await new SignJWT({ scope: "parent-unlock" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
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
    // Not a SessionPayload — verify directly instead of going through
    // decrypt, which rejects any payload that isn't a session shape.
    const { payload } = await jwtVerify(token, key, {
      algorithms: ["HS256"],
    });
    return payload.scope === "parent-unlock" && payload.sub === userId;
  } catch {
    return false;
  }
}

export async function isParentUnlocked(
  request: NextRequest,
  session: SessionPayload | null
): Promise<boolean> {
  const user = parentSession(session);
  if (!user) return false;
  return verifyUnlockToken(
    request.cookies.get("parentUnlocked")?.value,
    user.id
  );
}

// Cookie-store variant for server components and actions (no
// NextRequest available there).
export async function isParentUnlockedCookie(
  session: SessionPayload | null
): Promise<boolean> {
  const user = parentSession(session);
  if (!user) return false;
  return verifyUnlockToken(
    (await cookies()).get("parentUnlocked")?.value,
    user.id
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
