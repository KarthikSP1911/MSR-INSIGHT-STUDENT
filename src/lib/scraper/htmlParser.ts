import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";

import type { ExamHistoryEntry, StudentDetails } from "@/lib/studentDetails";
import { normalizeStudentRecord, type RawScrapedRecord } from "./dataNormalizer";
import type { ScrapedData } from "./portalScraper";

/**
 * Ported near-verbatim from MSR-Insight's
 * backend/express/src/services/scraper/htmlParser.js. Parses the raw HTML
 * blobs returned by the portal scrape into the intermediate shape
 * dataNormalizer.ts consumes.
 */

const COURSE_CODE_RE = /^[0-9A-Z]{5,14}$/;

export interface CourseRow {
  code: string;
  name: string;
  attLink: string;
  cieLink: string;
}

export function extractCourseRowsFromDashboard($dash: CheerioAPI): CourseRow[] {
  const courses: CourseRow[] = [];
  const pushRow = ($row: ReturnType<CheerioAPI>) => {
    const cols = $row.find("td");
    if (cols.length < 2) return;
    const rawCode = $dash(cols[0]).text().trim().split(/\s+/)[0];
    const code = rawCode.replace(/[()]/g, "").toUpperCase();
    if (!COURSE_CODE_RE.test(code)) return;
    const name = $dash(cols[1]).text().trim();
    const attLink =
      $row.find('a[href*="task=attendencelist"], a[href*="attendencelist"]').first().attr("href") || "";
    const cieLink =
      $row.find('a[href*="task=ciedetails"], a[href*="ciedetails"]').first().attr("href") || "";
    if (!attLink && !cieLink) return;
    courses.push({ code, name, attLink, cieLink });
  };

  $dash('table[class*="dash_od_row"] tbody tr').each((_, row) => {
    pushRow($dash(row));
  });

  if (courses.length === 0) {
    $dash("table tbody tr").each((_, row) => {
      const $row = $dash(row);
      if (!$row.find('a[href*="attendencelist"], a[href*="ciedetails"]').length) return;
      pushRow($row);
    });
  }

  if (courses.length === 0) {
    $dash("tr").each((_, row) => {
      const $row = $dash(row);
      const cols = $row.find("td");
      if (cols.length < 2) return;
      const rawCode = $dash(cols[0]).text().trim().split(/\s+/)[0];
      const code = rawCode.replace(/[()]/g, "").toUpperCase();
      if (!COURSE_CODE_RE.test(code)) return;
      const name = $dash(cols[1]).text().trim();
      const attLink =
        $row.find('a[href*="task=attendencelist"], a[href*="attendencelist"]').first().attr("href") || "";
      const cieLink =
        $row.find('a[href*="task=ciedetails"], a[href*="ciedetails"]').first().attr("href") || "";
      courses.push({ code, name, attLink, cieLink });
    });
  }

  const seen = new Set<string>();
  return courses.filter((c) => {
    if (seen.has(c.code)) return false;
    seen.add(c.code);
    return true;
  });
}

/** Balanced-bracket extraction for `var chartData = [ ... ];` (CIE marks chart). */
function extractChartDataJsonArray(html: string | undefined): string | null {
  if (!html) return null;
  const markers = ["var chartData", "chartData"];
  for (const m of markers) {
    const startIdx = html.indexOf(m);
    if (startIdx === -1) continue;
    const from = html.indexOf("[", startIdx);
    if (from === -1) continue;
    let depth = 0;
    for (let i = from; i < html.length; i++) {
      const c = html[i];
      if (c === "[") depth++;
      else if (c === "]") {
        depth--;
        if (depth === 0) {
          return html.slice(from, i + 1);
        }
      }
    }
  }
  return null;
}

/** Parses the dashboard + per-course attendance/CIE pages into the current-semester `details` record. */
export function parseCurrentSemester(scrapedData: ScrapedData): StudentDetails {
  const $dash = cheerio.load(scrapedData.dashboard);
  const name = $dash("h3").first().text().trim() || "Unknown";
  const usn = $dash("h2").first().text().trim() || "Unknown";
  const classInfo = $dash("p").first().text().trim() || "";

  const courseRows = extractCourseRowsFromDashboard($dash);

  const parseAttendanceHtml = (code: string) => {
    const details = {
      present_classes: 0,
      absent_classes: 0,
      still_to_go: 0,
      classes: { present_dates: [] as string[], absent_dates: [] as string[] },
    };
    const html = scrapedData.attendance?.[code];
    if (html) {
      const $ = cheerio.load(html);
      const mapping: [keyof typeof details, string][] = [
        ["present_classes", "cn-attend"],
        ["absent_classes", "cn-absent"],
        ["still_to_go", "cn-still"],
      ];
      mapping.forEach(([key, cls]) => {
        if (key === "classes") return;
        const spanMatch = $(`span[class*="${cls}"]`)
          .text()
          .match(/\[(\d+)\]/);
        if (spanMatch) details[key] = parseInt(spanMatch[1], 10);
      });

      const bodyText = $.root().text();
      if (details.present_classes === 0) {
        const pm = bodyText.match(/present[^[]*\[(\d+)\]/i);
        if (pm) details.present_classes = parseInt(pm[1], 10);
      }
      if (details.absent_classes === 0) {
        const am = bodyText.match(/absent[^[]*\[(\d+)\]/i);
        if (am) details.absent_classes = parseInt(am[1], 10);
      }
      if (details.still_to_go === 0) {
        const rm = bodyText.match(/(?:still\s*to\s*go|remaining)[^[]*\[(\d+)\]/i);
        if (rm) details.still_to_go = parseInt(rm[1], 10);
      }

      $('table[class*="cn-attend-list1"] tbody tr, table[class*="attend-list1"] tbody tr').each((_, r) => {
        const cols = $(r).find("td");
        if (cols.length >= 2) details.classes.present_dates.push($(cols[1]).text().trim());
      });

      $('table[class*="cn-attend-list2"] tbody tr, table[class*="attend-list2"] tbody tr').each((_, r) => {
        const cols = $(r).find("td");
        if (cols.length >= 2) details.classes.absent_dates.push($(cols[1]).text().trim());
      });
    }
    return details;
  };

  const parseCieHtml = (code: string) => {
    let tests: { test_name: string; class_average: number; max_marks: number; marks_obtained: number }[] = [];
    let eligibility = "Unknown";
    const html = scrapedData.cie?.[code];

    if (html) {
      const $ = cheerio.load(html);
      const cieTable = $('table[class*="cn-cie-table"]');
      if (cieTable.length) {
        const headers = cieTable
          .find("thead th")
          .map((_, el) => $(el).text().trim())
          .get();
        const idx = headers.indexOf("Eligibility");
        if (idx !== -1) {
          const row = cieTable.find("tbody tr").first();
          if (row.length && row.find("td").length > idx) {
            eligibility = $(row.find("td")[idx]).text().trim();
          }
        }
      }

      const chartJson = extractChartDataJsonArray(html);
      if (chartJson) {
        try {
          const cleanedJson = chartJson.replace(/,\s*([}\]])/g, "$1");
          const parsed = JSON.parse(cleanedJson) as {
            xaxis?: string;
            col1?: number;
            col2?: number;
            linevalue?: number;
          }[];
          tests = parsed.map((i) => ({
            test_name: i.xaxis || "",
            class_average: i.col1 || 0,
            max_marks: i.col2 || 0,
            marks_obtained: i.linevalue || 0,
          }));
        } catch {
          // Ignore JSON parsing errors — matches source behavior
        }
      }
    }
    return { tests, eligibility };
  };

  const currentSemesterData = courseRows.map((row) => ({
    code: row.code,
    name: row.name,
    attendance_details: parseAttendanceHtml(row.code),
    cie_details: { tests: parseCieHtml(row.code).tests },
  }));

  const studentRecord: RawScrapedRecord = {
    name,
    usn,
    class_details: classInfo,
    last_updated: new Date().toISOString(),
    current_semester: currentSemesterData,
  };

  return normalizeStudentRecord(studentRecord);
}

export interface ParsedExamHistory {
  examHistory: ExamHistoryEntry[];
  cgpa: string;
}

/** Parses the portal's exam-results page into per-semester results plus the overall CGPA. */
export function parseExamHistory(examsHtml: string | undefined): ParsedExamHistory {
  const $exam = cheerio.load(examsHtml || "");
  // A perfect score prints as a whole number ("10"), so a decimal point can't be required. Keep the
  // original rule (first paragraph with a decimal), then fall back to one that names the CGPA, then a lone "10".
  const paragraphs = $exam("p");
  const paragraphsMatching = (test: (text: string) => boolean) =>
    paragraphs.filter((_, el) => test($exam(el).text())).first();
  const decimal = paragraphsMatching((t) => /\d+\.\d+/.test(t));
  const named = paragraphsMatching((t) => /CGPA/i.test(t) && /\d/.test(t));
  const wholeTen = paragraphsMatching((t) => /^\s*10\s*$/.test(t));
  const cgpaP = [decimal, named, wholeTen].find((p) => p.length > 0);
  const cgpa = cgpaP ? cgpaP.text().trim() : "N/A";

  const examHistory: ExamHistoryEntry[] = $exam("table.res-table")
    .map((_, table) => {
      const cap = $exam(table).find("caption").text().replace(/\s+/g, " ").trim();
      const semName = cap.split("Credits")[0].trim();
      const sgpaMatch = cap.match(/SGPA\s*:?\s*(\d+(?:\.\d+)?)/);
      const creditsMatch = cap.match(/Credits Earned\s*:\s*(\d+)/);

      const courses = $exam(table)
        .find("tbody tr")
        .map((_, r) => {
          const cols = $exam(r).find("td");
          if (cols.length >= 6) {
            return {
              code: $exam(cols[0]).text().trim(),
              name: $exam(cols[1]).text().trim(),
              gpa: $exam(cols[4]).text().trim(),
              grade: $exam(cols[5]).text().trim(),
            };
          }
          return null;
        })
        .get()
        .filter((c): c is NonNullable<typeof c> => c !== null);

      return {
        semester: semName,
        sgpa: sgpaMatch ? sgpaMatch[1] : "N/A",
        credits_earned: creditsMatch ? creditsMatch[1] : "N/A",
        courses,
      };
    })
    .get();

  return { examHistory, cgpa };
}
