import { describe, expect, it } from "vitest";

import { getAttendanceBuffer } from "./attendanceBuffer";

describe("getAttendanceBuffer", () => {
  it("counts the absences that still leave the target met", () => {
    // 80% of 70 classes is 56, and 60 are attended if none of the 20 remaining is missed, so 4 can be missed.
    const result = getAttendanceBuffer({ present: 40, absent: 10, remaining: 20 }, 80);
    expect(result).toMatchObject({ total: 70, buffer: 4, coversAllRemaining: false, isReachable: true });
  });

  it("never offers more absences than there are classes remaining", () => {
    const result = getAttendanceBuffer({ present: 60, absent: 0, remaining: 3 }, 50);
    expect(result.buffer).toBe(3);
    expect(result.coversAllRemaining).toBe(true);
  });

  it("allows no absences when the target is met exactly", () => {
    const result = getAttendanceBuffer({ present: 17, absent: 3, remaining: 5 }, 88);
    expect(result.buffer).toBe(0);
    expect(result.coversAllRemaining).toBe(false);
  });

  it("reports an unreachable target even when every remaining class is attended", () => {
    const result = getAttendanceBuffer({ present: 10, absent: 20, remaining: 5 }, 90);
    expect(result.isReachable).toBe(false);
    expect(result.buffer).toBeLessThan(0);
    expect(Math.round(result.maxPossiblePct)).toBe(43);
  });

  it("has no buffer once no classes remain, even if the target is met", () => {
    const result = getAttendanceBuffer({ present: 90, absent: 10, remaining: 0 }, 75);
    expect(result.buffer).toBe(0);
    expect(result.coversAllRemaining).toBe(true);
  });

  it("handles a subject with no classes", () => {
    expect(getAttendanceBuffer({ present: 0, absent: 0, remaining: 0 }, 75)).toMatchObject({ total: 0, buffer: 0 });
  });
});
