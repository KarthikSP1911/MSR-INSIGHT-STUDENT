import { NextResponse } from "next/server";

import { clearSessionCookie } from "@/lib/auth/cookies";

/** Stateless JWT — logout just clears the cookie, no revocation list to update. */
export async function POST() {
  await clearSessionCookie();
  return NextResponse.json({ success: true, message: "Logged out successfully" });
}
