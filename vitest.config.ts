import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    // Several test files build an in-memory Postgres (every migration) in parallel; that can take longer
    // than the 5s default on a busy machine, which is slow, not broken.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    include: ["src/**/*.test.ts"],
  },
});
