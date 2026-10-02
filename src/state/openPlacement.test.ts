import { describe, expect, it } from "vitest";
import { planCompare, planFill, planOpen } from "@/state/openPlacement";

/**
 * Ported from upstream's `OpenPlacementTests` and `OpenIntoActivePaneTests`: ⌘O
 * and Open Recent replace the active pane; Compare with… goes to the pane the
 * active one is compared with.
 */

describe("a file handed to the window", () => {
  /**
   * @upstream ByteRipperTests/OpenPlacementTests.swift#OpenPlacementTests.testWithNoPanesOccupiedTheFirstTwoFilesFillBothPanes
   */
  it("fills both slots with the first two files when nothing is open", () => {
    expect(planFill("a", false, false, 3)).toEqual({ slots: ["a", "b"], ignoredCount: 1 });
    expect(planFill("a", false, false, 1)).toEqual({ slots: ["a"], ignoredCount: 0 });
  });

  /**
   * @upstream ByteRipperTests/OpenPlacementTests.swift#OpenPlacementTests.testWithPane1OccupiedTheFileGoesToPane2
   */
  it("goes to the free slot, and ignores the rest", () => {
    expect(planFill("a", true, false, 2)).toEqual({ slots: ["b"], ignoredCount: 1 });
    expect(planFill("b", false, true, 2)).toEqual({ slots: ["a"], ignoredCount: 1 });
  });

  /**
   * @upstream ByteRipperTests/OpenPlacementTests.swift#OpenPlacementTests.testWithBothPanesOccupiedTheFileReplacesTheActiveOne
   */
  it("replaces the active slot when both are occupied", () => {
    expect(planFill("b", true, true, 2)).toEqual({ slots: ["b"], ignoredCount: 1 });
    expect(planFill("a", true, true, 1)).toEqual({ slots: ["a"], ignoredCount: 0 });
  });
});

describe("Open… and Open Recent", () => {
  /**
   * @upstream ByteRipperTests/OpenPlacementTests.swift#OpenIntoActivePaneTests.testOpenReplacesTheActivePaneEvenWhenTheOtherIsFree
   */
  it("replaces the active slot even when the other is free", () => {
    expect(planOpen("a", true, false, 3)).toEqual({ slots: ["a"], ignoredCount: 2 });
    expect(planOpen("b", true, true, 1)).toEqual({ slots: ["b"], ignoredCount: 0 });
  });

  /**
   * @upstream ByteRipperTests/OpenPlacementTests.swift#OpenIntoActivePaneTests.testOpenWithNothingOpenStillFillsBothPanes
   */
  it("still fills both slots when nothing is open", () => {
    expect(planOpen("a", false, false, 2)).toEqual({ slots: ["a", "b"], ignoredCount: 0 });
  });
});

describe("Compare with…", () => {
  /**
   * @upstream ByteRipperTests/OpenPlacementTests.swift#OpenIntoActivePaneTests.testCompareGoesToTheOtherPane
   */
  it("goes to the other slot", () => {
    const slot = (active: "a" | "b", a: boolean, b: boolean) =>
      planCompare(active, a, b, 1).slots[0];
    expect(slot("a", true, false)).toBe("b"); // the free slot
    expect(slot("b", false, true)).toBe("a"); // the free slot
    expect(slot("a", true, true)).toBe("b"); // the one that is not active
    expect(slot("b", true, true)).toBe("a"); // the one that is not active
  });

  it("is a plain open with nothing open", () => {
    expect(planCompare("a", false, false, 2)).toEqual({ slots: ["a", "b"], ignoredCount: 0 });
  });
});
