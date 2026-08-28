import { NextResponse } from "next/server";

import { clearSessionCookie } from "@/lib/auth/cookies";

/** Stateless JWT — logout just clears the cookie, no revocation list to update. */
export async function POST() {
  try {
    await clearSessionCookie();
    return NextResponse.json({ success: true, message: "Logged out successfully" });
  } catch (err) {
    console.error("[api/auth/logout] failed:", err);
    return NextResponse.json({ success: false, message: "Logout failed. Please try again." }, { status: 500 });
  }
}
