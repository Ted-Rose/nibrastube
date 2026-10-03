import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getRequestSession, refreshSessionCookie } from "@/lib/auth";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const session = await getRequestSession(request);
  const parentUnlocked =
    request.cookies.get("parentUnlocked")?.value === "1";

  // 1. Landing page: logged-in devices go straight to the kids picker
  if (pathname === "/") {
    if (session) {
      return NextResponse.redirect(new URL("/kids", request.url));
    }
    return NextResponse.next();
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
    await refreshSessionCookie(request, res);
    return res;
  }

  // 4. Parent area needs a session AND a fresh PIN unlock
  if (pathname.startsWith("/parent")) {
    if (!session) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
    if (!parentUnlocked) {
      return NextResponse.redirect(new URL("/kids?gate=1", request.url));
    }
    const res = NextResponse.next();
    await refreshSessionCookie(request, res);
    return res;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/parent/:path*", "/kids/:path*", "/login", "/signup"],
};
