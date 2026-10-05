import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  getRequestSession,
  isParentUnlocked,
  updateSession,
} from "@/lib/auth";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const session = await getRequestSession(request);
  const activeProfileId = request.cookies.get("activeProfileId")?.value;
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
    if (activeProfileId && profileIdInUrl && activeProfileId !== profileIdInUrl) {
      return NextResponse.redirect(new URL(`/kids/${activeProfileId}`, request.url));
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
