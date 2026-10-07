import { describe, expect, it } from "vitest";

import { CURRENT_STALE_MS, EXAM_STALE_MS, MANUAL_COOLDOWN_MS, nextManualRefreshAt, scopeForStaleness } from "./scrapePolicy";
import type { StudentDetails } from "./studentDetails";

const NOW = Date.parse("2026-10-06T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms);

const subject = { code: "23IS62", name: "SE", marks: 0, attendance: 0, attendance_details: {} as never, assessments: [] };
const details = (lastUpdated: Date | string | undefined): StudentDetails => ({
  subjects: [subject],
  last_updated: lastUpdated instanceof Date ? lastUpdated.toISOString() : lastUpdated,
});

describe("scopeForStaleness", () => {
  it("returns null when both parts are fresh", () => {
    expect(scopeForStaleness({ details: details(ago(60_000)), examHistoryUpdatedAt: ago(60_000) }, NOW)).toBeNull();
  });

  it("refreshes only the current semester once it is 24h old", () => {
    const student = { details: details(ago(CURRENT_STALE_MS)), examHistoryUpdatedAt: ago(1000) };
    expect(scopeForStaleness(student, NOW)).toBe("current");
    expect(scopeForStaleness({ ...student, details: details(ago(CURRENT_STALE_MS - 1)) }, NOW)).toBeNull();
  });

  it("refreshes only exam history once it is 7 days old", () => {
    const student = { details: details(ago(1000)), examHistoryUpdatedAt: ago(EXAM_STALE_MS) };
    expect(scopeForStaleness(student, NOW)).toBe("exam_history");
    expect(scopeForStaleness({ ...student, examHistoryUpdatedAt: ago(EXAM_STALE_MS - 1) }, NOW)).toBeNull();
  });

  it("uses one full job when both parts are stale", () => {
    expect(scopeForStaleness({ details: details(ago(CURRENT_STALE_MS)), examHistoryUpdatedAt: ago(EXAM_STALE_MS) }, NOW)).toBe("full");
  });

  it("treats a student who was never scraped as needing everything", () => {
    expect(scopeForStaleness({ details: {}, examHistoryUpdatedAt: null }, NOW)).toBe("full");
  });

  it("fetches exam history for an old account that has current data but never had results stored", () => {
    expect(scopeForStaleness({ details: details(ago(1000)), examHistoryUpdatedAt: null }, NOW)).toBe("exam_history");
  });

  it("treats a missing or unparseable last_updated as stale", () => {
    expect(scopeForStaleness({ details: details(undefined), examHistoryUpdatedAt: ago(1000) }, NOW)).toBe("current");
    expect(scopeForStaleness({ details: details("not a date"), examHistoryUpdatedAt: ago(1000) }, NOW)).toBe("current");
  });

  it("accepts the ISO strings that JSON delivers for timestamps", () => {
    const iso = ago(1000).toISOString() as unknown as Date;
    expect(scopeForStaleness({ details: details(ago(1000)), examHistoryUpdatedAt: iso }, NOW)).toBeNull();
  });
});

describe("nextManualRefreshAt", () => {
  it("is null when nothing was refreshed yet or the cooldown has passed", () => {
    expect(nextManualRefreshAt(null, NOW)).toBeNull();
    expect(nextManualRefreshAt(undefined, NOW)).toBeNull();
    expect(nextManualRefreshAt(ago(MANUAL_COOLDOWN_MS), NOW)).toBeNull();
  });

  it("returns when the cooldown ends", () => {
    const refreshed = ago(10_000);
    expect(nextManualRefreshAt(refreshed, NOW)?.getTime()).toBe(refreshed.getTime() + MANUAL_COOLDOWN_MS);
  });

  it("ignores unparseable timestamps", () => {
    expect(nextManualRefreshAt("garbage", NOW)).toBeNull();
  });
});
