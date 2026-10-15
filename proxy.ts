import { unstable_cache } from "next/cache";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import {
  activeProfileCookieOptions,
  getRequestSession,
  isKidSession,
  isParentUnlocked,
  updateSession,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { profiles } from "@/lib/db/schema";

// Kid sessions probe profile existence on every matched request —
// caching the result for 60 s avoids a DB round-trip (and a checked-out
// pool connection for the lambda's warm lifetime) per navigation. Args
// are part of the cache key, so each profileId gets its own entry. A
// deleted profile is detected at most 60 s late; the redirect below
// still clears the stale cookies on the next nav after the entry
// expires.
const profileExists = unstable_cache(
  async (profileId: string) =>
    !!(await db.query.profiles.findFirst({
      where: eq(profiles.id, profileId),
      columns: { id: true },
    })),
  ["profile-exists"],
  { revalidate: 60 }
);

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const session = await getRequestSession(request);
  const activeProfileId = request.cookies.get("activeProfileId")?.value;

  // Kid sessions get their own routing table: the signed JWT pins the
  // device to one profile's pages, and every other matched path
  // redirects to that feed. Parents fall through to the rules below.
  if (isKidSession(session)) {
    // A deleted profile with a live JWT would redirect-loop forever —
    // treat the device as signed-out. Server components can't delete
    // cookies, so this is the only place the JWT gets revoked. (Proxy
    // always runs on the Node.js runtime, so the DB lookup is safe.)
    // The cached existence result can lag ≤60 s behind a deletion —
    // acceptable, since the next nav after expiry still lands here and
    // clears the stale cookies.
    if (!(await profileExists(session.profileId))) {
      const res = NextResponse.redirect(new URL("/login", request.url));
      res.cookies.delete("session");
      res.cookies.delete("activeProfileId");
      return res;
    }

    const feed = `/kids/${session.profileId}`;
    if (pathname === feed || pathname.startsWith(`${feed}/`)) {
      // Own feed (and the watch pages under it) — allowed through. The
      // session wins over a stale/forgeable activeProfileId cookie, so
      // re-pin it here.
      const res = (await updateSession(request)) ?? NextResponse.next();
      if (activeProfileId !== session.profileId) {
        res.cookies.set(
          "activeProfileId",
          session.profileId,
          activeProfileCookieOptions
        );
      }
      return res;
    }
    // /, the /kids picker, another kid's pages, /parent/* (no PIN gate —
    // a kid has no unlock path), /login, /signup.
    return NextResponse.redirect(new URL(feed, request.url));
  }

  const parentUnlocked = await isParentUnlocked(request, session);

  // 0. No landing page: `/` sends kid-locked devices straight back to
  // their locked profile's feed — the lock wins over a lingering
  // session (PWA start_url is `/`, so a locked device must land on its
  // feed, not the picker) — signed-in parents to their dashboard (the
  // /parent rules below bounce them to the PIN gate when the device
  // isn't unlocked), and everyone else to signup.
  if (pathname === "/") {
    const destination = activeProfileId
      ? `/kids/${activeProfileId}`
      : session
        ? "/parent/dashboard"
        : "/signup";
    return NextResponse.redirect(new URL(destination, request.url));
  }

  // 1. The profile picker itself requires a parent session — the
  // activeProfileId "kid lock" only unlocks that one profile's pages.
  if (pathname === "/kids" && !session) {
    return NextResponse.redirect(
      new URL("/login?callback=/kids", request.url)
    );
  }

  // 2. Kid-locked device: /kids/<other> snaps back to the locked profile.
  //    Without a session AND without a matching lock, it's off-limits.
  if (pathname.startsWith("/kids/")) {
    const profileIdInUrl = pathname.split("/")[2];
    if (
      activeProfileId &&
      profileIdInUrl &&
      activeProfileId !== profileIdInUrl
    ) {
      return NextResponse.redirect(
        new URL(`/kids/${activeProfileId}`, request.url)
      );
    }
    if (!session && activeProfileId !== profileIdInUrl) {
      return NextResponse.redirect(
        new URL(
          `/login?callback=${encodeURIComponent(pathname)}`,
          request.url
        )
      );
    }
  }

  // 3. If trying to access parent portal while child profile is active,
  //    bounce to the picker with the PIN gate auto-opened — a successful
  //    verify lifts the lock (verifyParentPin deletes activeProfileId).
  if (pathname.startsWith("/parent") && activeProfileId) {
    return NextResponse.redirect(new URL("/kids?gate=1", request.url));
  }

  // 4. Parent area needs a session…
  if (!session && pathname.startsWith("/parent")) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // 5. …AND a fresh PIN unlock. A stale/forged cookie is dropped so
  //    /kids sees it as absent and auto-opens the PIN modal instead of
  //    dead-ending on the picker.
  if (pathname.startsWith("/parent") && !parentUnlocked) {
    const res = NextResponse.redirect(
      new URL("/kids?gate=1", request.url)
    );
    res.cookies.delete("parentUnlocked");
    return res;
  }

  // 6. Auth pages are only for logged-out devices
  if (session && (pathname === "/login" || pathname === "/signup")) {
    return NextResponse.redirect(new URL("/parent/dashboard", request.url));
  }

  // Refresh the ~1y session on activity so it effectively never expires.
  return (await updateSession(request)) ?? NextResponse.next();
}

export const config = {
  matcher: ["/", "/parent/:path*", "/kids/:path*", "/login", "/signup"],
};
