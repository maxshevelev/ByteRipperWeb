import { describe, expect, it } from "vitest";
import { largeDetailFrame } from "@/ui/toolPanel/largeDetailFrame";

describe("where the large view of the details stands", () => {
  // @upstream Packages/ToolModuleKit/Tests/ToolModuleKitTests/ToolDetailPaneTests.swift#ToolDetailPaneTests.testTheCardKeepsClearOfTheToolPanel
  it("is two thirds of the window with no panel to keep clear of", () => {
    expect(largeDetailFrame(1500, undefined)).toEqual({ left: 1500 - 30 - 1000, width: 1000 });
  });

  it("keeps clear of a panel on the left, a gap from its edge", () => {
    // The panel takes 0..600: the card has 600+12..1470 = 858, less than two thirds.
    expect(largeDetailFrame(1500, { left: 0, right: 600 })).toEqual({
      left: 1470 - 858,
      width: 858,
    });
  });

  it("stands on the far side of a panel on the right", () => {
    expect(largeDetailFrame(1500, { left: 900, right: 1500 })).toEqual({ left: 30, width: 858 });
  });

  it("is never narrower than the least it is drawn at", () => {
    expect(largeDetailFrame(500, { left: 0, right: 450 }).width).toBe(200);
  });
});
