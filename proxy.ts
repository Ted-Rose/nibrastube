import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSession, updateSession } from "@/lib/auth";

export async function proxy(request: NextRequest) {
  const session = await getSession();
  const activeProfileId = request.cookies.get("activeProfileId")?.value;

  // 0. No landing page: `/` sends signed-in parents to their dashboard,
  // kid-locked devices back to their locked profile (PWA start_url is
  // `/`, so a cleared session must not strand them on /signup), and
  // everyone else to signup.
  if (request.nextUrl.pathname === "/") {
    const destination = session
      ? "/parent/dashboard"
      : activeProfileId
        ? `/kids/${activeProfileId}`
        : "/signup";
    return NextResponse.redirect(new URL(destination, request.url));
  }

  // 1. The profile picker itself requires a parent session — the
  // activeProfileId "kid lock" only unlocks that one profile's pages.
  if (request.nextUrl.pathname === "/kids" && !session) {
    return NextResponse.redirect(
      new URL("/login?callback=/kids", request.url)
    );
  }

  // 2. Kid-locked device: /kids/<other> snaps back to the locked profile.
  //    Without a session AND without a matching lock, it's off-limits.
  if (request.nextUrl.pathname.startsWith("/kids/")) {
    const profileIdInUrl = request.nextUrl.pathname.split("/")[2];
    if (activeProfileId && profileIdInUrl && activeProfileId !== profileIdInUrl) {
      return NextResponse.redirect(new URL(`/kids/${activeProfileId}`, request.url));
    }
    if (!session && activeProfileId !== profileIdInUrl) {
      return NextResponse.redirect(
        new URL(
          `/login?callback=${encodeURIComponent(request.nextUrl.pathname)}`,
          request.url
        )
      );
    }
  }

  // 3. If trying to access parent portal while child profile is active
  if (request.nextUrl.pathname.startsWith("/parent") && activeProfileId) {
    return NextResponse.redirect(new URL("/kids", request.url));
  }

  // Auth logic
  if (!session && request.nextUrl.pathname.startsWith("/parent")) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (session && (request.nextUrl.pathname === "/login" || request.nextUrl.pathname === "/signup")) {
    return NextResponse.redirect(new URL("/parent/dashboard", request.url));
  }

  // Refresh the ~1y session on activity so it effectively never expires.
  return (await updateSession(request)) ?? NextResponse.next();
}

export const config = {
  matcher: ["/", "/parent/:path*", "/kids/:path*", "/login", "/signup"],
};
