import { describe, expect, it } from "vitest";

import { isDoubleTap } from "./useDoubleTap";

const tap = (time: number, x = 100, y = 100) => ({ time, x, y });

describe("isDoubleTap", () => {
  it("is false for the first tap", () => {
    expect(isDoubleTap(null, tap(0))).toBe(false);
  });

  it("is true for a second tap soon after, in the same place", () => {
    expect(isDoubleTap(tap(0), tap(200, 105, 98))).toBe(true);
  });

  it("is false when the second tap comes too late", () => {
    expect(isDoubleTap(tap(0), tap(600))).toBe(false);
  });

  it("is false when the second tap lands somewhere else", () => {
    expect(isDoubleTap(tap(0), tap(200, 200, 100))).toBe(false);
  });
});
