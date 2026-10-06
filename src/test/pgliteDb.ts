import fs from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";

import type { Db } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";

/** Test-only: an in-memory Postgres built from the real committed migrations. */

const MIGRATIONS_DIR = path.join(process.cwd(), "drizzle");

export function migrationFiles(): string[] {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort();
}

export async function applyMigration(pg: PGlite, file: string): Promise<void> {
  const statements = fs
    .readFileSync(path.join(MIGRATIONS_DIR, file), "utf8")
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const statement of statements) await pg.exec(statement);
}

/** Applies every migration whose file name sorts before `before` (all of them when omitted). */
export async function createTestDb(before?: string) {
  const pg = new PGlite();
  for (const file of migrationFiles()) {
    if (before && file >= before) break;
    await applyMigration(pg, file);
  }
  // The app's Db type is the Neon HTTP driver; pglite exposes the same query-builder surface.
  const db = drizzle(pg, { schema }) as unknown as Db;
  return { pg, db };
}
