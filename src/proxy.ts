import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { SESSION_COOKIE_NAME } from "@/lib/auth/cookies";
import { verifyStudentToken } from "@/lib/auth/jwt";

/**
 * Next.js 16 Proxy (replaces middleware).
 * Guards dashboard routes to prevent unauthenticated access.
 */
export async function proxy(request: NextRequest) {
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
  // Only protect routes under /student/ (e.g., /student/dashboard)
  matcher: ["/student/:path*"],
};
