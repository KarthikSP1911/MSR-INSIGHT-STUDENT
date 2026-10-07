import { describe, expect, it } from "vitest";

import { computeMenuPlacement } from "./menuPlacement";

const base = { viewportHeight: 800, optionCount: 8, triggerTop: 100, triggerBottom: 140 };

describe("computeMenuPlacement", () => {
  it("opens downward when there is room", () => {
    expect(computeMenuPlacement(base)).toEqual({ placement: "below", maxHeight: 220 });
  });

  it("flips upward when the list does not fit below, even with plenty of room above", () => {
    const { placement, maxHeight } = computeMenuPlacement({ ...base, triggerBottom: 700, triggerTop: 660 });
    // Less room below than above, and the list doesn't fit below, so it flips.
    expect(placement).toBe("above");
    expect(maxHeight).toBe(220);
  });

  it("flips upward near the bottom of the screen when there is more room above", () => {
    const result = computeMenuPlacement({ ...base, triggerTop: 720, triggerBottom: 760 });
    expect(result.placement).toBe("above");
    expect(result.maxHeight).toBeGreaterThan(0);
  });

  it("never lets the menu be taller than the space it is given", () => {
    const below = computeMenuPlacement({ ...base, viewportHeight: 300, triggerTop: 20, triggerBottom: 60 });
    expect(below.placement).toBe("below");
    expect(below.maxHeight).toBeLessThanOrEqual(300 - 60 - 6 - 12);
  });

  it("keeps a usable minimum height on a very short screen", () => {
    expect(computeMenuPlacement({ ...base, viewportHeight: 120, triggerTop: 40, triggerBottom: 80 }).maxHeight).toBe(96);
  });

  it("respects a taller custom maximum, e.g. the mobile semester list", () => {
    expect(computeMenuPlacement({ ...base, optionCount: 12, maxMenuHeight: 320 }).maxHeight).toBe(320);
  });

  it("treats the cap as a maximum: a short list simply ends at its own content", () => {
    expect(computeMenuPlacement({ ...base, optionCount: 3 })).toEqual({ placement: "below", maxHeight: 220 });
  });
});
