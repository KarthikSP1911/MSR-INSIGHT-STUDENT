import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { decryptText, encryptText } from "@/lib/auth/crypto";
import type { Db } from "@/lib/db/client";
import { scrapeJobs, students } from "@/lib/db/schema";
import { loginToPortal, PortalAuthError, PortalLoginUnsupportedError } from "@/lib/scraper/portalHttpClient";
import { runJobAfterResponse } from "@/lib/scraper/scheduleJob";
import { createTestDb } from "@/test/pgliteDb";
import { POST } from "./route";

let db: Db;
vi.mock("@/lib/db/client", () => ({ getDb: () => db }));
// Cookies and background scheduling need a live Next request; the portal must never be contacted for real.
vi.mock("@/lib/auth/cookies", () => ({ setSessionCookie: vi.fn() }));
vi.mock("@/lib/auth/jwt", () => ({ signStudentToken: vi.fn(async () => "test-token") }));
vi.mock("@/lib/scraper/scheduleJob", () => ({ runJobAfterResponse: vi.fn() }));
vi.mock("@/lib/scraper/portalHttpClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/scraper/portalHttpClient")>()),
  loginToPortal: vi.fn(),
}));

const portal = vi.mocked(loginToPortal);
const schedule = vi.mocked(runJobAfterResponse);

const USN = "1MS23IS051";
const login = (body: Record<string, unknown>) =>
  POST(
    new NextRequest("http://localhost:3000/api/auth/login", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
  );

const firstTime = { usn: USN, dob: "19-11-2004", authType: "Mother's Mobile", last4Digits: "1234" };

const rowCounts = async () => ({
  students: (await db.select().from(students)).length,
  jobs: (await db.select().from(scrapeJobs)).length,
});

beforeAll(async () => {
  db = (await createTestDb()).db;
});

beforeEach(async () => {
  await db.delete(scrapeJobs);
  await db.delete(students);
  portal.mockReset();
  schedule.mockReset();
});

describe("POST /api/auth/login: nothing is stored for details that aren't valid", () => {
  it.each([
    ["an empty USN", { ...firstTime, usn: "" }],
    ["a USN that is clearly not one", { ...firstTime, usn: "HELLO" }],
    ["a USN missing its serial", { ...firstTime, usn: "1MS23IS" }],
    ["a USN with extra characters", { ...firstTime, usn: "1MS23IS051; DROP TABLE" }],
    ["a temporary suffix with no letter", { ...firstTime, usn: "1MS23IS051-" }],
    ["an unknown suffix letter", { ...firstTime, usn: "1MS23IS051-X" }],
    ["a suffix without the hyphen", { ...firstTime, usn: "1MS23IS051T" }],
    ["a doubled suffix", { ...firstTime, usn: "1MS23IS051-T-T" }],
    ["a malformed date of birth", { ...firstTime, dob: "2004/11/19" }],
    ["a date that doesn't exist", { ...firstTime, dob: "31-02-2004" }],
  ])("rejects %s without touching the portal or the database", async (_label, body) => {
    const res = await login(body);

    expect(res.status).toBe(400);
    expect((await res.json()).success).toBe(false);
    expect(portal).not.toHaveBeenCalled();
    expect(await rowCounts()).toEqual({ students: 0, jobs: 0 });
  });

  it("stores nothing when the portal rejects the USN, date of birth or PIN", async () => {
    portal.mockRejectedValue(new PortalAuthError());

    const res = await login(firstTime);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.message).toMatch(/Invalid portal credentials/);
    expect(await rowCounts()).toEqual({ students: 0, jobs: 0 });
    expect(schedule).not.toHaveBeenCalled();
  });

  it("stores nothing, and does not blame the student, when the portal can't be reached", async () => {
    portal.mockRejectedValue(new Error("ECONNRESET"));

    const res = await login(firstTime);

    expect(res.status).toBe(502);
    expect((await res.json()).message).toMatch(/Could not reach the college portal/);
    expect(await rowCounts()).toEqual({ students: 0, jobs: 0 });
  });

  it("stores nothing when the portal's login page has changed", async () => {
    portal.mockRejectedValue(new PortalLoginUnsupportedError());

    expect((await login(firstTime)).status).toBe(503);
    expect(await rowCounts()).toEqual({ students: 0, jobs: 0 });
  });

  it("asks for the PIN first, without contacting the portal or storing anything", async () => {
    const res = await login({ usn: USN, dob: "19-11-2004" });

    expect((await res.json()).requiresSecondaryAuth).toBe(true);
    expect(portal).not.toHaveBeenCalled();
    expect(await rowCounts()).toEqual({ students: 0, jobs: 0 });
  });

  it("leaves an existing unverified row untouched when new details fail", async () => {
    await db.insert(students).values({ usn: USN, dob: "01-01-2000" });
    portal.mockRejectedValue(new PortalAuthError());

    await login(firstTime);

    const [row] = await db.select().from(students).where(eq(students.usn, USN));
    expect(row.dob).toBe("01-01-2000");
    expect(await db.select().from(scrapeJobs)).toHaveLength(0);
  });
});

describe("POST /api/auth/login: verified students", () => {
  it("verifies with the portal first, then creates the student and queues the first sync", async () => {
    portal.mockResolvedValue({ dashboardHtml: "", cookieString: "", requestCount: 3, loginMs: 1, pinMs: 1 });

    const res = await login({ ...firstTime, usn: USN.toLowerCase() });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(portal).toHaveBeenCalledWith(
      expect.objectContaining({ usn: USN, day: "19", month: "11", year: "2004", authType: "Mother's Mobile", pin: "1234" }),
      expect.anything(),
    );

    const [student] = await db.select().from(students);
    expect(student).toMatchObject({ usn: USN, dob: "19-11-2004" });
    const [job] = await db.select().from(scrapeJobs);
    expect(job).toMatchObject({ usn: USN, scope: "full", trigger: "login" });
    expect(decryptText(job.encryptedPin!)).toBe("1234");
    expect(schedule).toHaveBeenCalledWith(db, job.id);
  });

  it("accepts a first-year temporary USN and keeps it as its own student", async () => {
    portal.mockResolvedValue({ dashboardHtml: "", cookieString: "", requestCount: 3, loginMs: 1, pinMs: 1 });

    const res = await login({ ...firstTime, usn: "1ms23is051-t" });

    expect(res.status).toBe(200);
    expect(portal).toHaveBeenCalledWith(expect.objectContaining({ usn: "1MS23IS051-T" }), expect.anything());
    const [student] = await db.select().from(students);
    expect(student.usn).toBe("1MS23IS051-T");
    const [job] = await db.select().from(scrapeJobs);
    expect(job.usn).toBe("1MS23IS051-T");
  });

  it("lets the same new student log in from several tabs at once without a failure", async () => {
    portal.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 5));
      return { dashboardHtml: "", cookieString: "", requestCount: 3, loginMs: 1, pinMs: 1 };
    });

    const responses = await Promise.all([login(firstTime), login(firstTime), login(firstTime)]);

    expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(await rowCounts()).toEqual({ students: 1, jobs: 1 });
  });

  it("does not contact the portal for a returning student with fresh data", async () => {
    const fresh = new Date().toISOString();
    await db.insert(students).values({
      usn: USN,
      dob: "19-11-2004",
      authType: "Mother's Mobile",
      encryptedPin: encryptText("1234"),
      details: { last_updated: fresh, subjects: [{ code: "A", name: "A", marks: 0, attendance: 0, attendance_details: {} as never, assessments: [] }] },
      examHistoryUpdatedAt: new Date(),
    });

    const res = await login({ usn: USN, dob: "19-11-2004" });

    expect((await res.json()).success).toBe(true);
    expect(portal).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
  });
});
