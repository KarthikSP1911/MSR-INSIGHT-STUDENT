import { describe, expect, it } from "vitest";

import { parseCurrentSemester, parseExamHistory } from "./htmlParser";
import { planFetchTargets } from "./portalScraper";
import type { ScrapedData } from "./portalScraper";

const DASHBOARD = `
<h2>1MS23IS051</h2><h3>Test Student</h3><p>B.E. INFORMATION SCIENCE SEM 06</p>
<table class="dash_od_row"><tbody>
  <tr><td>23IS62</td><td>Software Engineering</td>
    <td><a href="index.php?option=com_attendance&task=attendencelist&c=1">att</a>
        <a href="index.php?option=com_cie&task=ciedetails&c=1">cie</a></td></tr>
  <tr><td>23AL61</td><td>Machine Learning</td>
    <td><a href="index.php?option=com_attendance&task=attendencelist&c=2">att</a></td></tr>
</tbody></table>`;

const ATTENDANCE = `
<span class="cn-attend">Present [10]</span><span class="cn-absent">Absent [2]</span><span class="cn-still">Remaining [5]</span>
<table class="cn-attend-list1"><tbody><tr><td>1</td><td>01-09-2026</td></tr></tbody></table>
<table class="cn-attend-list2"><tbody><tr><td>1</td><td>02-09-2026</td></tr></tbody></table>`;

const CIE = `<script>var chartData = [
  {"xaxis":"T1","col1":20,"col2":50,"linevalue":35},
  {"xaxis":"A/Q 1","col1":8,"col2":10,"linevalue":9},
];</script>`;

const EXAMS = `
<p>Overall CGPA 8.45</p>
<table class="res-table"><caption>Semester 1 Credits Earned : 20 SGPA: 8.10</caption><tbody>
  <tr><td>23MA11</td><td>Maths</td><td></td><td></td><td>9</td><td>A+</td></tr>
  <tr><td>short row</td></tr>
</tbody></table>
<table class="res-table"><caption>Semester 2 Credits Earned : 22 SGPA: 8.80</caption><tbody>
  <tr><td>23PH21</td><td>Physics</td><td></td><td></td><td>10</td><td>O</td></tr>
</tbody></table>`;

const scraped = (overrides: Partial<ScrapedData> = {}): ScrapedData => ({
  dashboard: DASHBOARD,
  attendance: { "23IS62": ATTENDANCE },
  cie: { "23IS62": CIE },
  ...overrides,
});

describe("parseCurrentSemester", () => {
  it("builds subjects from the dashboard, attendance and CIE pages", () => {
    const details = parseCurrentSemester(scraped());

    expect(details).toMatchObject({ name: "Test Student", usn: "1MS23IS051", current_year: 3 });
    expect(details.subjects).toHaveLength(2);

    const se = details.subjects![0];
    expect(se).toMatchObject({ code: "23IS62", attendance: 83 });
    expect(se.attendance_details).toMatchObject({ present: 10, absent: 2, remaining: 5, present_dates: ["01-09-2026"], absent_dates: ["02-09-2026"] });
    expect(se.assessments).toEqual([
      { type: "T1", obtained_marks: 35, class_average: 20 },
      { type: "AQ1", obtained_marks: 9, class_average: 8 },
    ]);
    // Best test mark + both assignment/quiz marks.
    expect(se.marks).toBe(44);
  });

  describe("finding the class line when the dashboard puts other text first", () => {
    // What the portal started sending on 2026-10-07: an "Attendance" heading and a notice come before the details.
    const withNoticeFirst = (classLine: string) => `
<h2>Attendance</h2>
<p>More than 85% of Attendance is must in each subject to write final exam.</p>
<h3>Test Student</h3>${classLine}
<table class="dash_od_row"><tbody>
  <tr><td>23IS62</td><td>Software Engineering</td><td><a href="index.php?task=attendencelist&c=1">att</a></td></tr>
</tbody></table>`;

    it("skips a leading notice paragraph and reads the line that mentions the semester", () => {
      const details = parseCurrentSemester(scraped({ dashboard: withNoticeFirst("<div><span>B.E-IS,  SEM 07,  SEC A</span></div>") }));

      expect(details.class_details).toBe("B.E-IS,  SEM 07,  SEC A");
      expect(details.current_year).toBe(4);
    });

    it("finds it in a later paragraph too", () => {
      const details = parseCurrentSemester(scraped({ dashboard: withNoticeFirst("<p>B.E-IS, SEM 05, SEC C</p>") }));

      expect(details.class_details).toBe("B.E-IS, SEM 05, SEC C");
      expect(details.current_year).toBe(3);
    });

    it("does not mistake a container that merely holds the line for the line itself", () => {
      const details = parseCurrentSemester(
        scraped({ dashboard: withNoticeFirst("<section><h4>Class</h4><p>B.E-CI, SEM 07, SEC A</p></section>") }),
      );

      expect(details.class_details).toBe("B.E-CI, SEM 07, SEC A");
    });

    it("still reads the first paragraph when no line mentions a semester (the year then comes from the USN)", () => {
      const details = parseCurrentSemester(scraped({ dashboard: withNoticeFirst("") }));

      expect(details.class_details).toMatch(/85% of Attendance/);
      expect(details.current_year).toBe(0);
    });

    it("keeps working on the original layout", () => {
      expect(parseCurrentSemester(scraped()).class_details).toBe("B.E. INFORMATION SCIENCE SEM 06");
    });
  });

  it("does not carry exam history or CGPA, which now live in their own columns", () => {
    const details = parseCurrentSemester(scraped({ exams: EXAMS }));
    expect(details).not.toHaveProperty("exam_history");
    expect(details).not.toHaveProperty("cgpa");
  });
});

describe("parseExamHistory", () => {
  it("parses semesters, SGPA, credits, courses and the overall CGPA", () => {
    const { examHistory, cgpa } = parseExamHistory(EXAMS);

    expect(cgpa).toBe("Overall CGPA 8.45");
    expect(examHistory).toHaveLength(2);
    expect(examHistory[0]).toMatchObject({ semester: "Semester 1", sgpa: "8.10", credits_earned: "20" });
    expect(examHistory[0].courses).toEqual([{ code: "23MA11", name: "Maths", gpa: "9", grade: "A+" }]);
    expect(examHistory[1].courses[0].grade).toBe("O");
  });

  it.each([
    ["a whole-number perfect score", "<p>Overall CGPA 10</p>", "SGPA: 10", "Overall CGPA 10", "10"],
    ["a two-decimal perfect score", "<p>Overall CGPA 10.00</p>", "SGPA: 10.00", "Overall CGPA 10.00", "10.00"],
    ["a bare number with no label", "<p>10</p>", "SGPA : 10", "10", "10"],
  ])("keeps %s instead of falling back to N/A", (_label, cgpaHtml, sgpaText, expectedCgpa, expectedSgpa) => {
    const html = `${cgpaHtml}<table class="res-table"><caption>Semester 1 Credits Earned : 20 ${sgpaText}</caption><tbody></tbody></table>`;
    const { examHistory, cgpa } = parseExamHistory(html);

    expect(cgpa).toBe(expectedCgpa);
    expect(examHistory[0].sgpa).toBe(expectedSgpa);
  });

  it("does not mistake an unrelated paragraph containing a number for the CGPA", () => {
    expect(parseExamHistory("<p>Results published 10 days ago</p>").cgpa).toBe("N/A");
  });

  it("returns an empty result for a missing or empty page", () => {
    expect(parseExamHistory(undefined)).toEqual({ examHistory: [], cgpa: "N/A" });
    expect(parseExamHistory("")).toEqual({ examHistory: [], cgpa: "N/A" });
  });
});

describe("planFetchTargets", () => {
  const rows = [
    { code: "A", name: "A", attLink: "index.php?option=att&c=1", cieLink: "index.php?option=cie&c=1" },
    { code: "B", name: "B", attLink: "index.php?option=att&c=1", cieLink: "" },
  ];
  const urls = (scope: Parameters<typeof planFetchTargets>[1]) => [...planFetchTargets(rows, scope).keys()];

  it("current: attendance and CIE pages only, resolved against the portal base", () => {
    expect(urls("current")).toEqual([
      "https://parents.msrit.edu/newparents/index.php?option=att&c=1",
      "https://parents.msrit.edu/newparents/index.php?option=cie&c=1",
    ]);
  });

  it("shares one fetch between courses that link to the same page", () => {
    const targets = planFetchTargets(rows, "current").get("https://parents.msrit.edu/newparents/index.php?option=att&c=1");
    expect(targets).toEqual([
      { courseCode: "A", type: "attendance" },
      { courseCode: "B", type: "attendance" },
    ]);
  });

  it("exam_history: only the results page", () => {
    expect(urls("exam_history")).toEqual([expect.stringContaining("com_history&task=getResult")]);
  });

  it("full: everything", () => {
    expect(urls("full")).toHaveLength(3);
    expect(urls("full")).toContainEqual(expect.stringContaining("com_history"));
  });
});
