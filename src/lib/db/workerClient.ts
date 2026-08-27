import { Pool } from "pg";
import { drizzle as drizzleNodePostgres } from "drizzle-orm/node-postgres";

import * as schema from "./schema";

function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env and fill in your Neon connection string.",
    );
  }
  return url;
}

/**
 * Persistent-connection client for the standalone worker process
 * (worker/scraper-worker.ts), which polls the DB continuously rather than
 * making one-off requests like a Next.js route handler.
 */
export function getWorkerDb() {
  const pool = new Pool({ connectionString: getDatabaseUrl() });
  return drizzleNodePostgres({ client: pool, schema });
}

export type WorkerDb = ReturnType<typeof getWorkerDb>;
