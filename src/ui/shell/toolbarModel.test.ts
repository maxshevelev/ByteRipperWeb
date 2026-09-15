import { describe, expect, it } from "vitest";
import {
  identicalBadgeAfter,
  paneLayoutOffer,
  TOOLBAR_DEFAULT_ITEMS,
  type ToolbarContext,
  toolbarItemEnabled,
  toolbarItems,
} from "@/ui/shell/toolbarModel";

/** The toolbar — upstream's `ToolbarItemsTests`, `ToolbarValidationTests` and `ToolsToolbarTests` where they are about the model. */

const context = (overrides: Partial<ToolbarContext> = {}): ToolbarContext => ({
  activeOpen: false,
  comparison: false,
  navigation: { previousDifference: false, nextDifference: false },
  ...overrides,
});

describe("the toolbar's items", () => {
  // @upstream ByteRipperTests/ToolbarItemsTests.swift#ToolbarItemsTests.testTheToolbarIsTwoGroupsSplitByTheFlexibleSpace
  // @upstream ByteRipperTests/MinimapTests.swift#MinimapTests.testToolbarPinsMinimapToggleAtFarRight
  it("are two groups split by the flexible space", () => {
    expect(TOOLBAR_DEFAULT_ITEMS).toEqual([
      "tools",
      "space",
      "goTo",
      "find",
      "segments",
      "space",
      "insertMode",
      "wordSize",
      "flexibleSpace",
      "diffNavigation",
      "space",
      "paneLayout",
      "space",
      "toggleMinimap",
    ]);
    expect(toolbarItems(false, false)).toEqual([
      "tools",
      "space",
      "goTo",
      "find",
      "segments",
      "space",
      "insertMode",
      "wordSize",
      "flexibleSpace",
      "space",
      "paneLayout",
      "space",
      "toggleMinimap",
    ]);
  });

  // @upstream ByteRipperTests/ToolsToolbarTests.swift#ToolsToolbarTests.testToolsIsTheLeftmostItem
  it("start with Tools, and a space after it", () => {
    expect(toolbarItems(false, false).slice(0, 2)).toEqual(["tools", "space"]);
  });

  // @upstream ByteRipperTests/ToolbarValidationTests.swift#ToolbarValidationTests.testTheDifferenceBlockIsOnlyInTheToolbarInComparisonMode
  // @upstream ByteRipperTests/ToolbarValidationTests.swift#ToolbarValidationTests.testDifferentFilesKeepTheArrowsNotTheBadge
  it("carry the difference block only in a comparison, in the plaque's slot", () => {
    expect(toolbarItems(false, false)).not.toContain("diffNavigation");
    expect(toolbarItems(true, false)).toEqual(TOOLBAR_DEFAULT_ITEMS);
    expect(toolbarItems(true, false)).not.toContain("filesIdentical");
  });

  // @upstream ByteRipperTests/ToolbarValidationTests.swift#ToolbarValidationTests.testIdenticalFilesShowTheBadgeInsteadOfTheArrows
  it("put the badge in the block's place for identical files", () => {
    const items = toolbarItems(true, true);
    expect(items).not.toContain("diffNavigation");
    expect(items.indexOf("filesIdentical")).toBe(TOOLBAR_DEFAULT_ITEMS.indexOf("diffNavigation"));
  });
});

describe("the difference plaque", () => {
  // The last determined answer holds while a rebuild runs.
  // @upstream ByteRipperTests/ToolbarValidationTests.swift#ToolbarValidationTests.testRebuildInFlightKeepsTheLastDeterminedPlaque
  it("keeps its last determined state while a comparison is running", () => {
    let identical = identicalBadgeAfter(false, { status: "ready", differingBytes: 0 });
    expect(identical).toBe(true);

    identical = identicalBadgeAfter(identical, { status: "scanning", differingBytes: 0 });
    expect(identical).toBe(true);

    identical = identicalBadgeAfter(identical, { status: "ready", differingBytes: 12 });
    expect(identical).toBe(false);
  });
});

describe("what each item can do", () => {
  // @upstream ByteRipperTests/ToolbarItemsTests.swift#ToolbarItemsTests.testTheDocumentCommandsFollowTheActivePane
  // @upstream ByteRipperTests/ToolsToolbarTests.swift#ToolsToolbarTests.testTheItemIsDisabledWithNoFileOpen
  it("gives the document commands and Tools a dump to act on", () => {
    for (const id of ["goTo", "find", "segments", "tools"] as const) {
      expect(toolbarItemEnabled(id, context())).toBe(false);
      expect(toolbarItemEnabled(id, context({ activeOpen: true }))).toBe(true);
    }
  });

  // @upstream ByteRipperTests/ToolbarItemsTests.swift#ToolbarItemsTests.testTheWordSizeButtonIsAlwaysEnabled
  it("leaves the view settings live on an empty window", () => {
    expect(toolbarItemEnabled("wordSize", context())).toBe(true);
    expect(toolbarItemEnabled("toggleMinimap", context())).toBe(true);
  });

  // @upstream ByteRipperTests/ToolbarValidationTests.swift#ToolbarValidationTests.testTheArrowsFollowTheCaretsPositionInTheComparison
  it("lights each arrow only where it has somewhere to go", () => {
    const ahead = context({
      comparison: true,
      navigation: { previousDifference: false, nextDifference: true },
    });
    expect(toolbarItemEnabled("nextDifference", ahead)).toBe(true);
    expect(toolbarItemEnabled("previousDifference", ahead)).toBe(false);
  });

  // The icon and the tooltip name the arrangement the click produces, and there
  // is nothing to arrange with one pane.
  // @upstream ByteRipperTests/ToolbarItemsTests.swift#ToolbarItemsTests.testThePaneLayoutIconNamesTheArrangementItWillProduce
  it("offers the other arrangement, and only with two panes", () => {
    expect(toolbarItemEnabled("paneLayout", context({ activeOpen: true }))).toBe(false);
    expect(toolbarItemEnabled("paneLayout", context({ comparison: true }))).toBe(true);
    expect(paneLayoutOffer("sideBySide")).toEqual({
      next: "stacked",
      label: "Stack Panes",
      toolTip: "Stack the panes",
    });
    expect(paneLayoutOffer("stacked")).toEqual({
      next: "sideBySide",
      label: "Side-by-Side Panes",
      toolTip: "Place the panes side by side",
    });
  });
});
