import { afterEach, describe, expect, it } from "vitest";
import {
  closeLargeDetail,
  largeDetailStore,
  showLargeDetail,
  toggleLargeDetail,
} from "@/state/largeDetailStore";

/**
 * Ported from `ToolDetailPaneTests`: the large view a row's detail opens into — the
 * state of it, which Space, the corner button, Esc and a click outside move. The
 * card and the pane it folds are components, which the web has no level for here.
 */

const isOpen = () => largeDetailStore.getSnapshot().open;

describe("the large view of a panel's details", () => {
  afterEach(closeLargeDetail);

  // @upstream Packages/ToolModuleKit/Tests/ToolModuleKitTests/ToolDetailPaneTests.swift#ToolDetailPaneTests.testNothingToShowIsNotTaken
  it("is not opened with nothing to show, and the key is not taken", () => {
    expect(toggleLargeDetail(false)).toBe(false);
    expect(showLargeDetail(false)).toBe(false);
    expect(isOpen()).toBe(false);
  });

  // @upstream Packages/ToolModuleKit/Tests/ToolModuleKitTests/ToolDetailPaneTests.swift#ToolDetailPaneTests.testTheCornerButtonOpensAndCloses
  // @upstream Packages/ToolModuleKit/Tests/ToolModuleKitTests/ToolDetailPaneTests.swift#ToolDetailPaneTests.testSpaceOnTheTableOpens
  it("is opened and closed by the same key", () => {
    expect(toggleLargeDetail(true)).toBe(true);
    expect(isOpen()).toBe(true);
    // Shut again, whether or not there is anything left to show.
    expect(toggleLargeDetail(false)).toBe(true);
    expect(isOpen()).toBe(false);
  });

  // @upstream Packages/ToolModuleKit/Tests/ToolModuleKitTests/ToolDetailPaneTests.swift#ToolDetailPaneTests.testSpaceAndEscClose
  it("is closed by closing, and closing a shut one does nothing", () => {
    showLargeDetail(true);
    closeLargeDetail();
    expect(isOpen()).toBe(false);
    const before = largeDetailStore.getSnapshot();
    closeLargeDetail();
    expect(largeDetailStore.getSnapshot()).toBe(before);
  });
});
