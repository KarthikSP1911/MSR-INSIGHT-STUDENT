import { beforeEach, describe, expect, it, vi } from "vitest";

import { currentYearFromUsn } from "@/lib/academicYear";
import { describeDegradedLoginFailure, loginWithoutDatabase } from "./degradedLogin";
import { getCompleteStudentData, type CompleteStudentData } from "./portalScraper";
import { PortalAuthError, PortalLoginUnsupportedError, PortalUnavailableError } from "./portalHttpClient";

vi.mock("./portalScraper", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./portalScraper")>()),
  getCompleteStudentData: vi.fn(),
}));
const portal = vi.mocked(getCompleteStudentData);

const DASHBOARD = `
  <h3>Asha Rao</h3><h2>1MS23IS051</h2><p>B.E. - SEM 06</p>
  <table class="dash_od_row"><tbody>
    <tr><td>23IS62</td><td>Software Engineering</td><td><a href="index.php?task=attendencelist&c=1">att</a></td></tr>
  </tbody></table>`;

const scraped = (): CompleteStudentData => ({
  data: { dashboard: DASHBOARD, attendance: {}, cie: {}, exams: "<p>8.52</p>" },
  timings: { method: "http", loginMs: 1, pinMs: 1, fetchMs: { p50: 1, max: 1, total: 1 }, requestCount: 2, bytesDownloaded: 10 },
});

beforeEach(() => {
  portal.mockReset();
});

describe("loginWithoutDatabase", () => {
  it("logs in to the portal once and returns the full record without a PIN", async () => {
    portal.mockResolvedValue(scraped());

    const student = await loginWithoutDatabase({ usn: "1MS23IS051", dob: "19-11-2004", authType: "mother", pin: "1234" });

    expect(portal).toHaveBeenCalledTimes(1);
    expect(portal).toHaveBeenCalledWith("1MS23IS051", "19", "11", "2004", "Mother's Mobile", "1234", "full", undefined);
    // The year comes from the USN's batch (not the page's "SEM 06"), so it follows the academic year.
    expect(student).toMatchObject({ usn: "1MS23IS051", name: "Asha Rao", dob: "19-11-2004", authType: "Mother's Mobile", cgpa: "8.52", currentYear: currentYearFromUsn("1MS23IS051") });
    expect(student.details.subjects).toHaveLength(1);
    expect(student.examHistoryUpdatedAt).toBeInstanceOf(Date);
    expect(student).not.toHaveProperty("encryptedPin");
    expect(JSON.stringify(student)).not.toContain("1234");
  });

  it("still gets the right USN and year when the portal's page puts 'Attendance' and a notice first", async () => {
    const newLayout = `<h2>Attendance</h2><p>More than 85% of Attendance is must in each subject to write final exam.</p>
      <h3>Asha Rao</h3>${DASHBOARD.slice(DASHBOARD.indexOf("<table"))}`;
    portal.mockResolvedValue({ ...scraped(), data: { ...scraped().data, dashboard: newLayout } });

    const student = await loginWithoutDatabase({ usn: "1MS23IS051", dob: "19-11-2004", authType: "mother", pin: "1234" });

    expect(student.details.usn).toBe("1MS23IS051");
    expect(student.currentYear).toBe(currentYearFromUsn("1MS23IS051"));
    expect(student.currentYear).toBeGreaterThanOrEqual(1);
  });

  it("propagates a portal rejection so the route can report it", async () => {
    portal.mockRejectedValue(new PortalAuthError());

    await expect(loginWithoutDatabase({ usn: "1MS23IS051", dob: "19-11-2004", authType: "ABC ID", pin: "0000" })).rejects.toBeInstanceOf(
      PortalAuthError,
    );
  });
});

describe("describeDegradedLoginFailure", () => {
  it.each([
    ["wrong credentials", new PortalAuthError(), 400],
    ["a changed login page", new PortalLoginUnsupportedError(), 503],
    ["a portal outage", new PortalUnavailableError(), 502],
    ["anything unexpected", new Error("boom"), 502],
  ])("maps %s to %i", (_label, err, status) => {
    expect(describeDegradedLoginFailure(err).status).toBe(status);
  });

  it("never blames the student's details for an unexpected error", () => {
    expect(describeDegradedLoginFailure(new Error("boom")).message).toMatch(/Could not reach the college portal/);
  });
});
