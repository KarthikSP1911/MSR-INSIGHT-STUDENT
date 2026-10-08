import { describe, expect, it } from "vitest";

import { academicYearStart, currentYearFromUsn } from "./academicYear";

const at = (year: number, month: number, day = 15) => new Date(Date.UTC(year, month - 1, day));

describe("academicYearStart", () => {
  it.each([
    ["August starts a new academic year", at(2026, 8, 1), 2026],
    ["the last moment of July is still the old one", new Date(Date.UTC(2026, 6, 31, 23, 59, 59)), 2025],
    ["October is in the year that began in August", at(2026, 10, 8), 2026],
    ["January is in the year that began the previous August", at(2026, 1, 10), 2025],
  ])("%s", (_label, now, expected) => {
    expect(academicYearStart(now)).toBe(expected);
  });
});

describe("currentYearFromUsn", () => {
  describe("in October 2026 (academic year 2026-27)", () => {
    const now = at(2026, 10, 8);

    it.each([
      ["1MS26IS001", 1],
      ["1MS25IS051", 2],
      ["1MS24CS010", 3],
      ["1MS23IS051", 4],
      ["1MS22ME001", 4], // past the 4 years: held at 4
      ["1MS18IS007", 4],
    ])("%s is in year %i", (usn, year) => {
      expect(currentYearFromUsn(usn, now)).toBe(year);
    });

    it.each([
      ["1MS26IS401", 2], // joined the 2nd year this August
      ["1MS25IS450", 3],
      ["1MS24IS401", 4],
      ["1MS23IS499", 4], // held at 4
    ])("lateral entry %s is in year %i", (usn, year) => {
      expect(currentYearFromUsn(usn, now)).toBe(year);
    });
  });

  describe("before the academic year rolls over", () => {
    it("is one year lower in January than in October for the same batch", () => {
      expect(currentYearFromUsn("1MS23IS051", at(2026, 1))).toBe(3);
      expect(currentYearFromUsn("1MS23IS051", at(2026, 10))).toBe(4);
    });

    it("counts a batch that has not started yet as year 1", () => {
      expect(currentYearFromUsn("1MS26IS001", at(2026, 2))).toBe(1);
    });

    it("moves up on 1 August, not before", () => {
      expect(currentYearFromUsn("1MS24IS001", new Date(Date.UTC(2026, 6, 31, 23, 59, 59)))).toBe(2);
      expect(currentYearFromUsn("1MS24IS001", at(2026, 8, 1))).toBe(3);
    });
  });

  it("ignores a temporary -T suffix, letter case and surrounding spaces", () => {
    const now = at(2026, 10);

    expect(currentYearFromUsn("1MS25IS051-T", now)).toBe(2);
    expect(currentYearFromUsn(" 1ms25is051 ", now)).toBe(2);
  });

  it("accepts both 2- and 3-letter branch codes", () => {
    const now = at(2026, 10);

    expect(currentYearFromUsn("1MS24CS010", now)).toBe(3);
    expect(currentYearFromUsn("1MS24CSE010", now)).toBe(3);
  });

  it.each(["", "HELLO", "Attendance", "1MS23IS05", "1MS23IS0511", "MS23IS051", "1MS2IS051"])("returns null for %j", (usn) => {
    expect(currentYearFromUsn(usn, at(2026, 10))).toBeNull();
  });
});
