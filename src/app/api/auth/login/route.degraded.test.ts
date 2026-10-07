import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { setSessionCookie } from "@/lib/auth/cookies";
import { getDb } from "@/lib/db/client";
import { loginWithoutDatabase } from "@/lib/scraper/degradedLogin";
import { PortalAuthError } from "@/lib/scraper/portalHttpClient";
import { POST } from "./route";

vi.mock("@/lib/db/client", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/auth/cookies", () => ({ setSessionCookie: vi.fn() }));
vi.mock("@/lib/auth/jwt", () => ({ signStudentToken: vi.fn(async () => "test-token") }));
vi.mock("@/lib/scraper/scheduleJob", () => ({ runJobAfterResponse: vi.fn() }));
vi.mock("@/lib/scraper/degradedLogin", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/scraper/degradedLogin")>()),
  loginWithoutDatabase: vi.fn(),
}));

const database = vi.mocked(getDb);
const degraded = vi.mocked(loginWithoutDatabase);
const cookie = vi.mocked(setSessionCookie);

const USN = "1MS23IS051";
const insert = vi.fn();
const update = vi.fn();

/** A db whose lookup rejects with `error`; any write is a test failure. */
const dbFailingWith = (error: unknown) =>
  ({
    select: () => ({ from: () => ({ where: () => Promise.reject(error) }) }),
    insert,
    update,
  }) as unknown as ReturnType<typeof getDb>;

const outage = () => Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } });

const login = (body: Record<string, unknown>) =>
  POST(
    new NextRequest("http://localhost:3000/api/auth/login", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
  );

const withPin = { usn: USN, dob: "19-11-2004", authType: "Mother's Mobile", last4Digits: "1234", rememberMe: true };

beforeEach(() => {
  database.mockReset();
  degraded.mockReset();
  cookie.mockReset();
  insert.mockReset();
  update.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/auth/login while the database is unreachable", () => {
  it("asks for the PIN, without contacting the portal, when none was supplied", async () => {
    database.mockReturnValue(dbFailingWith(outage()));

    const res = await login({ usn: USN, dob: "19-11-2004" });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ success: false, requiresSecondaryAuth: true, databaseOffline: true });
    expect(degraded).not.toHaveBeenCalled();
    expect(cookie).not.toHaveBeenCalled();
  });

  it("signs in through the portal, returns the student, and writes nothing", async () => {
    database.mockReturnValue(dbFailingWith(outage()));
    const student = { usn: USN, name: "Asha", details: { subjects: [] } };
    degraded.mockResolvedValue(student as never);

    const res = await login(withPin);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ success: true, degraded: true, data: { usn: USN, jobId: null, student } });
    expect(degraded).toHaveBeenCalledWith({ usn: USN, dob: "19-11-2004", authType: "Mother's Mobile", pin: "1234" });
    expect(cookie).toHaveBeenCalledWith("test-token", true);
    expect(insert).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects wrong credentials without issuing a session", async () => {
    database.mockReturnValue(dbFailingWith(outage()));
    degraded.mockRejectedValue(new PortalAuthError());

    const res = await login(withPin);

    expect(res.status).toBe(400);
    expect((await res.json()).message).toMatch(/Invalid portal credentials/);
    expect(cookie).not.toHaveBeenCalled();
  });

  it("does not blame the student when the portal is unreachable too", async () => {
    database.mockReturnValue(dbFailingWith(outage()));
    degraded.mockRejectedValue(new Error("ECONNRESET"));

    const res = await login(withPin);

    expect(res.status).toBe(502);
    expect(cookie).not.toHaveBeenCalled();
  });

  it("keeps a plain 500 for a database error that is not an outage", async () => {
    database.mockReturnValue(dbFailingWith(Object.assign(new Error("syntax error"), { name: "NeonDbError", code: "42601" })));

    const res = await login(withPin);

    expect(res.status).toBe(500);
    expect(degraded).not.toHaveBeenCalled();
  });
});
