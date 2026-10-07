import { describe, expect, it } from "vitest";

import { DatabaseTimeoutError, isDatabaseUnavailable, withDbTimeout } from "./availability";

const withCode = (name: string, code: string | undefined, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error(`${name} error`), { name, code, ...extra });

describe("isDatabaseUnavailable", () => {
  it.each([
    ["a fetch failure", Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } })],
    ["an aborted request", Object.assign(new Error("aborted"), { name: "AbortError" })],
    ["a timed-out request", Object.assign(new Error("timed out"), { name: "TimeoutError" })],
    ["our own timeout", new DatabaseTimeoutError(5000)],
    ["a refused connection", withCode("Error", "ECONNREFUSED")],
    ["a Neon HTTP-level failure with no SQLSTATE", withCode("NeonDbError", undefined)],
    ["a connection exception (class 08)", withCode("NeonDbError", "08006")],
    ["insufficient resources (class 53)", withCode("NeonDbError", "53300")],
    ["an admin shutdown (class 57P)", withCode("NeonDbError", "57P01")],
    ["an outage wrapped by Drizzle", Object.assign(new Error("Failed query"), { cause: withCode("NeonDbError", undefined) })],
    ["an outage reported through sourceError", Object.assign(new Error("wrapped"), { name: "Wrapper", sourceError: new TypeError("fetch failed") })],
  ])("is true for %s", (_label, err) => {
    expect(isDatabaseUnavailable(err)).toBe(true);
  });

  it.each([
    ["a unique violation", withCode("NeonDbError", "23505")],
    ["a syntax error", withCode("NeonDbError", "42601")],
    ["a missing table", withCode("NeonDbError", "42P01")],
    ["a unique violation wrapped by Drizzle", Object.assign(new Error("Failed query"), { cause: withCode("NeonDbError", "23505") })],
    ["an ordinary error", new Error("boom")],
    ["a missing DATABASE_URL", new Error("DATABASE_URL is not set.")],
    ["a non-error value", "nope"],
    ["null", null],
  ])("is false for %s", (_label, err) => {
    expect(isDatabaseUnavailable(err)).toBe(false);
  });

  it("does not loop forever on a cyclic cause chain", () => {
    const a: Record<string, unknown> = { name: "Error" };
    a.cause = a;
    expect(isDatabaseUnavailable(a)).toBe(false);
  });
});

describe("withDbTimeout", () => {
  it("resolves with the value when the database answers in time", async () => {
    await expect(withDbTimeout(Promise.resolve(42), 1000)).resolves.toBe(42);
  });

  it("passes through the original rejection", async () => {
    await expect(withDbTimeout(Promise.reject(new Error("bad query")), 1000)).rejects.toThrow("bad query");
  });

  it("rejects with a DatabaseTimeoutError that counts as an outage", async () => {
    const never = new Promise<never>(() => {});
    const error = await withDbTimeout(never, 10).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DatabaseTimeoutError);
    expect(isDatabaseUnavailable(error)).toBe(true);
  });
});
