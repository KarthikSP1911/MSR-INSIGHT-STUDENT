import "dotenv/config";
import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  // drizzle-kit commands (generate/migrate/studio) need a real connection string;
  // schema typechecking and app code don't load this file at all.
  console.warn(
    "DATABASE_URL is not set — drizzle-kit commands will fail until .env is configured.",
  );
}

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
});
