import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  getRequestSession,
  isParentUnlocked,
  refreshSessionCookie,
} from "@/lib/auth";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const session = await getRequestSession(request);
  const parentUnlocked = await isParentUnlocked(request, session);

  // 1. No landing page: `/` is the app's front door (PWA start_url) —
  //    signed-in devices go to the kids picker, signed-out to signup.
  if (pathname === "/") {
    const destination = session ? "/kids" : "/signup";
    return NextResponse.redirect(new URL(destination, request.url));
  }

  // 2. Auth pages are only for logged-out devices
  if (pathname === "/login" || pathname === "/signup") {
    if (session) {
      return NextResponse.redirect(new URL("/kids", request.url));
    }
    return NextResponse.next();
  }

  // 3. Kids area needs a session; kids may use any of the family's
  //    profiles — no per-profile lock.
  if (pathname === "/kids" || pathname.startsWith("/kids/")) {
    if (!session) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
    const res = NextResponse.next();
    await refreshSessionCookie(session, res);
    return res;
  }

  // 4. Parent area needs a session AND a fresh PIN unlock
  if (pathname.startsWith("/parent")) {
    if (!session) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
    if (!parentUnlocked) {
      const res = NextResponse.redirect(
        new URL("/kids?gate=1", request.url)
      );
      // Drop a stale/forged unlock cookie so /kids sees it as absent and
      // auto-opens the PIN modal instead of dead-ending on the picker.
      res.cookies.delete("parentUnlocked");
      return res;
    }
    const res = NextResponse.next();
    await refreshSessionCookie(session, res);
    return res;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/parent/:path*", "/kids/:path*", "/login", "/signup"],
};
