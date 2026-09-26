import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";

export async function proxy(request: NextRequest) {
  const session = await getSession();
  const activeProfileId = request.cookies.get("activeProfileId")?.value;

  // 0. Landing page: authenticated parents and kid-locked devices go straight to /kids
  if (request.nextUrl.pathname === "/" && (session || activeProfileId)) {
    return NextResponse.redirect(new URL("/kids", request.url));
  }

  // 1. If trying to access a profile that isn't the active one
  if (request.nextUrl.pathname.startsWith("/kids/")) {
    const profileIdInUrl = request.nextUrl.pathname.split("/")[2];
    if (activeProfileId && profileIdInUrl && activeProfileId !== profileIdInUrl) {
      return NextResponse.redirect(new URL(`/kids/${activeProfileId}`, request.url));
    }
  }

  // 2. If trying to access parent portal while child profile is active
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

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/parent/:path*", "/kids/:path*", "/login", "/signup"],
};
