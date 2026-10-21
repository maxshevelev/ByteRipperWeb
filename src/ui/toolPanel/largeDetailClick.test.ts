import { describe, expect, it } from "vitest";
import { type PressTarget, pressLeavesLargeDetailOpen } from "@/ui/toolPanel/largeDetailClick";

/**
 * An element in a chain of ancestors, each named by the simple selectors it matches —
 * enough of `Element.closest` for a selector list of simple selectors.
 */
function landing(...chain: readonly (readonly string[])[]): PressTarget {
  return {
    closest: (selectors: string) => {
      const wanted = selectors.split(",").map((one) => one.trim());
      return chain.find((element) => element.some((one) => wanted.includes(one))) ?? null;
    },
  };
}

describe("a press beside the large view of the details", () => {
  // @upstream Packages/ToolModuleKit/Tests/ToolModuleKitTests/ToolDetailPaneTests.swift#ToolDetailPaneTests.testAPressOnASplittersDividerLeavesTheCardOpen
  it("leaves it open on a divider, which the press moves", () => {
    // The divider between the two files, outside any tool panel.
    expect(pressLeavesLargeDetailOpen(landing(["[role=separator]"], ["main"]))).toBe(true);
    // The tool panel's own edge, and the minimap's.
    expect(pressLeavesLargeDetailOpen(landing(["[role=separator]"], [".tool-panel"]))).toBe(true);
  });

  it("leaves it open in the tool panel, a details pane's owner and a menu", () => {
    expect(pressLeavesLargeDetailOpen(landing(["button"], [".tool-panel"]))).toBe(true);
    expect(pressLeavesLargeDetailOpen(landing(["td"], ["[data-detail-owner]"]))).toBe(true);
    expect(pressLeavesLargeDetailOpen(landing(["li"], ["[role=menu]"]))).toBe(true);
  });

  // What upstream's flow test checks last (`UEFIToolFlowTests`, its press moved past the
  // divider's grab in `7302cf1f`): beside the panel and the card, the press still closes it.
  it("closes it anywhere else — in the dump beside the divider", () => {
    expect(pressLeavesLargeDetailOpen(landing(["canvas"], [".hex-pane"], ["main"]))).toBe(false);
  });
});
