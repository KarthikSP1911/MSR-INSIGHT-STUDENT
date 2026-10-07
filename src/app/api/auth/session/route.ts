import { NextResponse } from "next/server";

import { getCurrentUsn } from "@/lib/auth/session";

/**
 * Who is signed in, answered from the session cookie alone. It never touches the database, so the dashboard
 * can still tell which student's saved copy to show when the database is down.
 */
export async function GET() {
  const usn = await getCurrentUsn();
  if (!usn) {
    return NextResponse.json({ success: false, message: "Not authenticated" }, { status: 401 });
  }
  return NextResponse.json({ success: true, data: { usn } }, { headers: { "Cache-Control": "no-store" } });
}
