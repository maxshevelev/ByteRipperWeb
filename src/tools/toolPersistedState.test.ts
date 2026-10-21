import { describe, expect, it } from "vitest";
import { fitTool } from "@/tools/fit/fitTool";
import { meTool } from "@/tools/me/meTool";
import { uefiStructureTool } from "@/tools/uefi/uefiStructureTool";

/**
 * What the workspace keeps of a tool-module's parked state, and reads back.
 *
 * @upstream ByteRipperTests/WorkspaceRestoreTests.swift#WorkspaceRestoreTests
 */
describe("a tool's choice in the workspace", () => {
  // @upstream ByteRipperTests/WorkspaceRestoreTests.swift#WorkspaceRestoreTests.testTheToolPanelComesBackOnItsPaneWithoutMovingTheWindow
  // @upstream-differs the persistable half: the panel's return to its pane is checked in the browser
  it("survives being written down, for every tool that keeps one", () => {
    const uefi = { focus: "0.2.1", meFocus: undefined, open: new Set(["0", "0.2"]) };
    const uefiText = uefiStructureTool.encodedState?.(uefi);
    expect(uefiText).toBeDefined();
    expect(uefiStructureTool.restoredState?.(uefiText ?? "")).toEqual(uefi);

    const me = { tab: "tree", open: new Set(["1", "1.4"]), focus: "1.4.2" };
    const meText = meTool.encodedState?.(me);
    expect(meTool.restoredState?.(meText ?? "")).toEqual(me);

    const fit = { focus: 3, focusZone: "target" };
    const fitText = fitTool.encodedState?.(fit);
    expect(fitTool.restoredState?.(fitText ?? "")).toEqual(fit);
  });

  it("reads nothing back from a text that is not its own", () => {
    for (const tool of [uefiStructureTool, meTool, fitTool]) {
      expect(tool.restoredState?.("not json")).toBeUndefined();
      expect(tool.restoredState?.('{"open":7,"focus":{}}')).toBeUndefined();
    }
  });
});
