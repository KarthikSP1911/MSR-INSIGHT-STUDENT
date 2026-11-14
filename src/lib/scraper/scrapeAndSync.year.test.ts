import { eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { Db } from "@/lib/db/client";
import { appStats, students } from "@/lib/db/schema";
import { createTestDb } from "@/test/pgliteDb";
import { getCompleteStudentData, type CompleteStudentData } from "./portalScraper";
import { scrapeAndSyncStudent } from "./scrapeAndSync";

vi.mock("./portalScraper", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./portalScraper")>()),
  getCompleteStudentData: vi.fn(),
}));
const portal = vi.mocked(getCompleteStudentData);

// What the portal started sending on 2026-10-07: "Attendance" and a notice come before the real details.
const dashboard = (classLine: string) => `
<h2>Attendance</h2>
<p>More than 85% of Attendance is must in each subject to write final exam.</p>
<h3>Asha Rao</h3>${classLine}
<table class="dash_od_row"><tbody>
  <tr><td>23IS62</td><td>Software Engineering</td><td><a href="index.php?task=attendencelist&c=1">att</a></td></tr>
</tbody></table>`;

const result = (html: string): CompleteStudentData => ({
  data: { dashboard: html, attendance: {}, cie: {}, exams: "<p>8.52</p>" },
  timings: { method: "browserless", browserMs: 0, loginMs: 1, pinMs: 1, fetchMs: { p50: 1, max: 1, total: 1 }, requestCount: 2, bytesDownloaded: 10 },
});

let db: Db;
beforeAll(async () => {
  db = (await createTestDb()).db;
});

beforeEach(async () => {
  // Only Date is faked, so the in-memory database keeps working. October 2026 is academic year 2026-27.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(Date.UTC(2026, 9, 8)));
  portal.mockReset();
  await db.delete(students);
});

afterEach(() => {
  vi.useRealTimers();
});

const sync = (usn: string, scope: "current" | "exam_history" | "full" = "full") =>
  scrapeAndSyncStudent(db, usn, "19-11-2004", "Mother's Mobile", "1234", "bl-token", scope);

const rowOf = async (usn: string) => (await db.select().from(students).where(eq(students.usn, usn)))[0];

describe("a sync records the year from the USN, whatever the page looks like", () => {
  it("fixes a student stuck at year 0 even though the portal's page no longer carries the class line", async () => {
    await db.insert(students).values({ usn: "1MS23IS051", dob: "19-11-2004", currentYear: 0 });
    portal.mockResolvedValue(result(dashboard("")));

    await sync("1MS23IS051");

    const row = await rowOf("1MS23IS051");
    expect(row.currentYear).toBe(4);
    expect(row.details.current_year).toBe(4);
  });

  it("stores the USN we logged in with, not the 'Attendance' heading the page showed", async () => {
    await db.insert(students).values({ usn: "1MS24CS010", dob: "19-11-2004" });
    portal.mockResolvedValue(result(dashboard("")));

    await sync("1MS24CS010");

    expect((await rowOf("1MS24CS010")).details.usn).toBe("1MS24CS010");
  });

  it("uses the USN's batch even when the page's own class line says something different", async () => {
    await db.insert(students).values({ usn: "1MS23IS051", dob: "19-11-2004" });
    portal.mockResolvedValue(result(dashboard("<p>B.E-IS, SEM 03, SEC A</p>")));

    await sync("1MS23IS051");

    expect((await rowOf("1MS23IS051")).currentYear).toBe(4);
  });

  it("falls back to the page's class line only for a USN that does not look like one", async () => {
    await db.insert(students).values({ usn: "ODD-USN", dob: "19-11-2004" });
    portal.mockResolvedValue(result(dashboard("<p>B.E-IS, SEM 05, SEC C</p>")));

    await sync("ODD-USN");

    expect((await rowOf("ODD-USN")).currentYear).toBe(3);
  });

  it("leaves the year alone when only the exam history is refreshed", async () => {
    await db.insert(students).values({ usn: "1MS23IS051", dob: "19-11-2004", currentYear: 2 });
    portal.mockResolvedValue(result(dashboard("")));

    await sync("1MS23IS051", "exam_history");

    expect((await rowOf("1MS23IS051")).currentYear).toBe(2);
  });

  it("moves the per-year counters in app_stats along with it", async () => {
    await db.insert(students).values({ usn: "1MS23IS051", dob: "19-11-2004", currentYear: 0 });
    portal.mockResolvedValue(result(dashboard("")));

    await sync("1MS23IS051");

    const counters = Object.fromEntries((await db.select().from(appStats)).map((r) => [r.key, r.value]));
    expect(counters).toMatchObject({ students_total: 1, students_year_0: 0, students_year_4: 1 });
  });
});
