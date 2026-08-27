import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getCurrentUsn } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { scrapeJobs } from "@/lib/db/schema";

/** Polled by the frontend (~2s interval) until the job reaches a terminal status. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const sessionUsn = await getCurrentUsn();
  if (!sessionUsn) {
    return NextResponse.json({ success: false, message: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;
  const db = getDb();
  const [job] = await db.select().from(scrapeJobs).where(eq(scrapeJobs.id, id));
  if (!job || job.usn !== sessionUsn) {
    return NextResponse.json({ success: false, message: "Job not found" }, { status: 404 });
  }

  return NextResponse.json({
    success: true,
    data: {
      id: job.id,
      status: job.status,
      error: job.error,
      resultSummary: job.resultSummary,
    },
  });
}
