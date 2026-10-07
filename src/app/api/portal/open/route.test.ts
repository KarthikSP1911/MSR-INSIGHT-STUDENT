import { NextRequest } from "next/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { encryptText } from "@/lib/auth/crypto";
import { getCurrentUsn } from "@/lib/auth/session";
import type { Db } from "@/lib/db/client";
import { students } from "@/lib/db/schema";
import { createTestDb } from "@/test/pgliteDb";
import { POST } from "./route";

let db: Db;
vi.mock("@/lib/db/client", () => ({ getDb: () => db }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUsn: vi.fn() }));

const session = vi.mocked(getCurrentUsn);
const PIN = "4821";

const request = (headers: Record<string, string> = {}) =>
  new NextRequest("http://localhost:3000/api/portal/open", { method: "POST", headers });

/** The portal's login page as the route sees it: option values are NOT zero-padded here. */
const portalPage = `<select id="dd"><option value="5">5</option><option value="19">19</option></select>
<select id="mm"><option value="1">Jan</option><option value="11">Nov</option></select>
<select id="yyyy"><option value="2004">2004</option></select>`;

beforeAll(async () => {
  db = (await createTestDb()).db;
});

beforeEach(async () => {
  await db.delete(students);
  session.mockResolvedValue("1MS23IS051");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(portalPage, { status: 200 })));
});

afterEach(() => vi.unstubAllGlobals());

const addStudent = (overrides: Partial<typeof students.$inferInsert> = {}) =>
  db.insert(students).values({
    usn: "1MS23IS051",
    dob: "05-01-2004",
    authType: "Mother's Mobile",
    encryptedPin: encryptText(PIN),
    ...overrides,
  });

describe("POST /api/portal/open", () => {
  it("returns an auto-submitting page built from the student's USN and date of birth", async () => {
    await addStudent();

    const res = await POST(request({ "sec-fetch-site": "same-origin" }));
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(html).toContain('action="https://parents.msrit.edu/newparents/index.php"');
    expect(html).toContain('name="username" value="1MS23IS051"');
    // The portal's own (unpadded) option values are used, exactly as its page would.
    expect(html).toContain('name="passwd" value="2004-1-5"');
  });

  it("never puts the saved PIN or verification type in the page", async () => {
    await addStudent();

    const html = await (await POST(request())).text();

    expect(html).not.toContain(PIN);
    expect(html).not.toContain("enteredid");
    expect(html).not.toContain("idType");
  });

  it("works for students who have no saved PIN", async () => {
    await addStudent({ encryptedPin: null, authType: null });

    const res = await POST(request());

    expect(res.status).toBe(200);
    expect(await res.text()).toContain('name="username" value="1MS23IS051"');
  });

  it("never caches the page and only lets it post to the portal", async () => {
    await addStudent();

    const res = await POST(request());

    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("content-security-policy")).toContain("form-action https://parents.msrit.edu");
  });

  it("falls back to padded date values when the portal page can't be fetched", async () => {
    await addStudent();
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));

    const html = await (await POST(request())).text();

    expect(html).toContain('name="passwd" value="2004-01-05"');
  });

  it("rejects callers without a session", async () => {
    session.mockResolvedValue(null);
    expect((await POST(request())).status).toBe(401);
  });

  it("rejects requests that originate from another site", async () => {
    await addStudent();
    const res = await POST(request({ "sec-fetch-site": "cross-site" }));
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain("1MS23IS051");
  });

  it("sends students with no date of birth on file to the portal's normal login page", async () => {
    await addStudent({ dob: null });

    const res = await POST(request());

    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://parents.msrit.edu/newparents/");
  });

  it("does the same for an unknown student, and when the stored date is unusable", async () => {
    expect((await POST(request())).status).toBe(303);

    await addStudent({ dob: "not a date" });
    expect((await POST(request())).status).toBe(303);
  });
});
