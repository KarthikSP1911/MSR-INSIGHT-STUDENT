import { sql } from "drizzle-orm";

import type { Db } from "@/lib/db/client";

export const HEALTH_DB_TIMEOUT_MS = 5_000;

export type HealthReport = { ok: true } | { ok: false; reason: "database_unreachable" | "database_timeout" };

/**
 * Proves the app can reach its database with a trivial query. It deliberately never calls the college
 * portal: the portal being down must not make this look like an outage of the app itself (the dashboard
 * keeps working from saved data and shows its own notice).
 */
export async function checkHealth(db: Db, timeoutMs = HEALTH_DB_TIMEOUT_MS): Promise<HealthReport> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
  });

  try {
    const outcome = await Promise.race([db.execute(sql`select 1`).then(() => "ok" as const), timedOut]);
    return outcome === "ok" ? { ok: true } : { ok: false, reason: "database_timeout" };
  } catch (err) {
    console.error("[health] database check failed:", err);
    return { ok: false, reason: "database_unreachable" };
  } finally {
    clearTimeout(timer);
  }
}
