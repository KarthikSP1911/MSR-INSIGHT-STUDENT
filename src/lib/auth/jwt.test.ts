import { SignJWT } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SESSIONS_VALID_FROM, signStudentToken, verifyStudentToken } from "./jwt";

const SECRET = "test-secret-test-secret-test-secret";

const tokenIssuedAt = (issuedAt: number) =>
  new SignJWT({ usn: "1MS23IS051" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(issuedAt)
    .setExpirationTime("160d")
    .sign(new TextEncoder().encode(SECRET));

describe("verifyStudentToken", () => {
  beforeEach(() => {
    vi.stubEnv("JWT_SECRET", SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts a session issued now", async () => {
    expect(await verifyStudentToken(await signStudentToken("1ms23is051"))).toEqual({ usn: "1MS23IS051" });
  });

  it("accepts a session issued exactly at the cutoff", async () => {
    expect(await verifyStudentToken(await tokenIssuedAt(SESSIONS_VALID_FROM))).toEqual({ usn: "1MS23IS051" });
  });

  it("rejects a session issued before the cutoff, so that student signs in again", async () => {
    expect(await verifyStudentToken(await tokenIssuedAt(SESSIONS_VALID_FROM - 1))).toBeNull();
  });

  it("rejects missing and tampered tokens", async () => {
    expect(await verifyStudentToken(undefined)).toBeNull();
    expect(await verifyStudentToken("not-a-token")).toBeNull();
  });
});
