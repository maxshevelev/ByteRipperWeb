import { afterEach, describe, expect, it, vi } from "vitest";
import { IDLE_SESSION, toolController } from "@/state/toolController";
import { dumpActionsAt, setDumpActions } from "@/state/toolDumpActions";

/**
 * What the running tool-module offers in the dump's context menu: under its own name, only for
 * the pane its session reads, and nothing when it offers nothing.
 */

const running = (boundPane: "a" | "b") =>
  toolController.update(() => ({
    sessions: {
      panes: { ...IDLE_SESSION, activeIdentifier: "dev.maxik.tool.uefi-structure", boundPane },
    },
  }));

afterEach(() => {
  setDumpActions("a", undefined);
  setDumpActions("b", undefined);
  toolController.update(() => ({ sessions: {} }));
});

describe("the tool commands in the dump's context menu", () => {
  // @upstream ByteRipperTests/UEFIToolFlowTests.swift#UEFIToolFlowTests.testTheDumpsMenuShowsTheClickedBytesNodeInTheTree
  it("lists the commands the tool offers for the clicked byte, under its name", () => {
    const perform = vi.fn();
    running("a");
    setDumpActions("a", (offset) => [
      { title: "Show in Tree", isEnabled: offset === 0x4a, perform: () => perform(offset) },
    ]);
    const offered = dumpActionsAt("a", 0x4a);
    expect(offered?.title).toBe("UEFI Structure");
    expect(offered?.actions.map((action) => [action.title, action.isEnabled])).toEqual([
      ["Show in Tree", true],
    ]);
    offered?.actions[0]?.perform();
    expect(perform).toHaveBeenCalledWith(0x4a);
    expect(dumpActionsAt("a", 0x10)?.actions[0]?.isEnabled).toBe(false);
  });

  // @upstream ByteRipperTests/UEFIToolFlowTests.swift#UEFIToolFlowTests.testWithoutAToolTheDumpsMenuOffersNoToolItem
  it("offers nothing without a tool, in another pane, or an empty list", () => {
    setDumpActions("a", () => [{ title: "Show in Tree", isEnabled: true, perform: () => {} }]);
    expect(dumpActionsAt("a", 0)).toBeUndefined();
    running("b");
    expect(dumpActionsAt("a", 0)).toBeUndefined();
    running("a");
    setDumpActions("a", () => []);
    expect(dumpActionsAt("a", 0)).toBeUndefined();
    setDumpActions("a", undefined);
    expect(dumpActionsAt("a", 0)).toBeUndefined();
  });
});
