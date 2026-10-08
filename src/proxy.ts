import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { SESSION_COOKIE_NAME } from "@/lib/auth/cookies";
import { verifyStudentToken } from "@/lib/auth/jwt";
import { isSiteShutdown, SITE_SHUTDOWN_MESSAGE } from "@/lib/siteShutdown";

/** Stay up while paused: monitoring, the DB-only yearly job, and logout so a student can still clear their cookie. */
const SHUTDOWN_ALLOWED_API = [/^\/api\/health$/, /^\/api\/cron\//, /^\/api\/auth\/logout$/];

/**
 * Next.js 16 Proxy (replaces middleware).
 * Guards dashboard routes to prevent unauthenticated access, and enforces the SITE_SHUTDOWN kill switch.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isSiteShutdown()) {
    if (pathname.startsWith("/api/")) {
      if (SHUTDOWN_ALLOWED_API.some((allowed) => allowed.test(pathname))) return NextResponse.next();
      return NextResponse.json(
        { success: false, message: SITE_SHUTDOWN_MESSAGE },
        { status: 503, headers: { "Retry-After": "86400", "Cache-Control": "no-store" } },
      );
    }
    // The login page shows the paused overlay; it does not bounce a signed-in student back here.
    return NextResponse.redirect(new URL("/student-login", request.url));
  }

  if (pathname.startsWith("/api/")) return NextResponse.next();

  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME);

  // Verify the JWT to ensure it's not missing, expired, or tampered with
  const payload = await verifyStudentToken(sessionCookie?.value);

  if (!payload) {
    const loginUrl = new URL("/student-login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  // Dashboard pages (/student/...) need a session; /api/... is only checked for the shutdown switch.
  matcher: ["/student/:path*", "/api/:path*"],
};
