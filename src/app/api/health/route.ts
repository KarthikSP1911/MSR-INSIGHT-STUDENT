import { NextResponse } from "next/server";

import { getDb } from "@/lib/db/client";
import { checkHealth } from "@/lib/health";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Public liveness check for an uptime monitor (see DEPLOYMENT.md). 200 when the app can reach its
 * database, 503 when it cannot. Returns no student data and no error details.
 */
export async function GET() {
  try {
    const report = await checkHealth(getDb());
    if (report.ok) return NextResponse.json({ status: "ok" }, { headers: NO_STORE });
    return NextResponse.json({ status: "unavailable", reason: report.reason }, { status: 503, headers: NO_STORE });
  } catch (err) {
    // getDb() throws when DATABASE_URL is missing — still an outage, and still not worth leaking details.
    console.error("[api/health] could not check the database:", err);
    return NextResponse.json({ status: "unavailable", reason: "database_unreachable" }, { status: 503, headers: NO_STORE });
  }
}
