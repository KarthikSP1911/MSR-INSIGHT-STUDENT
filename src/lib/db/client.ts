import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleHttp } from "drizzle-orm/neon-http";

import * as schema from "./schema";

function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and fill in your Neon connection string.",
    );
  }
  return url;
}

/**
 * Short-lived HTTP client for use inside Next.js route handlers (one query per
 * request, no persistent connection needed). Use `getWorkerDb()` from
 * `db/workerClient.ts` instead for the long-running scraper worker process.
 */
export function getDb() {
  const sql = neon(getDatabaseUrl());
  return drizzleHttp({ client: sql, schema });
}

export type Db = ReturnType<typeof getDb>;
