import { describe, expect, it } from "vitest";
import {
  type PaneState,
  paneRestore,
  relativePathOf,
  type SegmentationState,
  segmentationApplies,
  stampIsUnchanged,
  WORKSPACE_VERSION,
  type Workspace,
  workspaceIsEmpty,
} from "@/core/workspace/workspace";

/**
 * The workspace as it is written down, and what of it a restore applies.
 *
 * @upstream Packages/Workspace/Tests/WorkspaceTests/WorkspaceTests.swift#WorkspaceTests
 */
describe("the workspace", () => {
  /** A pane on 0x10..<0x20 of a file, typing into the text column in insert mode. */
  const pane = (start: number, end: number, top: number): PaneState => ({
    document: { kind: "file", file: { name: "a.bin", size: 0x1000, modified: 0 } },
    selectionStart: start,
    selectionEnd: end,
    inputRegion: "text",
    insertMode: true,
    topOffset: top,
  });

  // @upstream Packages/Workspace/Tests/WorkspaceTests/WorkspaceTests.swift#WorkspaceTests.testAWorkspaceWithOnlyEmptyTabsIsEmpty
  it("is empty with nothing open", () => {
    const empty: Workspace = {
      version: WORKSPACE_VERSION,
      tab: {
        panes: [undefined, undefined],
        activePane: 0,
        surface: { minimapVisible: false },
        fragments: [],
      },
    };
    expect(workspaceIsEmpty(empty)).toBe(true);
    expect(workspaceIsEmpty({ ...empty, notes: { isUp: true, selected: [] } })).toBe(false);
  });

  // @upstream Packages/Workspace/Tests/WorkspaceTests/WorkspaceTests.swift#WorkspaceTests.testAStampSaysWhetherTheFileChanged
  it("tells by a stamp whether the file changed", () => {
    const stamp = { size: 16, modified: 1_000_000 };
    expect(stampIsUnchanged(stamp, { size: 16, modified: 1_000_000 })).toBe(true);
    expect(stampIsUnchanged(stamp, { size: 17, modified: 1_000_000 })).toBe(false);
    expect(stampIsUnchanged(stamp, { size: 16, modified: 1_060_000 })).toBe(false);
  });

  // @upstream Packages/Workspace/Tests/WorkspaceTests/WorkspaceTests.swift#WorkspaceTests.testAnUnchangedFileGetsEverythingBack
  it("gives an unchanged file everything back", () => {
    const restore = paneRestore(pane(0x10, 0x20, 0x100), 0x1000, true);
    expect(restore.selection).toEqual({ start: 0x10, end: 0x20 });
    expect(restore.topOffset).toBe(0x100);
    expect(restore.inputRegion).toBe("text");
    expect(restore.insertMode).toBe(true);
    expect(restore.keepsMeasuredState).toBe(true);
  });

  // @upstream Packages/Workspace/Tests/WorkspaceTests/WorkspaceTests.swift#WorkspaceTests.testAShorterFileMovesThePositionToItsLastAddress
  it("moves the position of a shorter file to its last address", () => {
    const restore = paneRestore(pane(0xf00, 0xf10, 0xe00), 0x800, false);
    expect(restore.selection).toEqual({ start: 0x7ff, end: 0x800 });
    expect(restore.topOffset).toBe(0x7ff);
    expect(restore.keepsMeasuredState, "segments and tools were measured on other bytes").toBe(
      false
    );
  });

  // @upstream Packages/Workspace/Tests/WorkspaceTests/WorkspaceTests.swift#WorkspaceTests.testAChangedFileKeepsAPositionThatStillFits
  it("keeps a position that still fits a changed file", () => {
    const restore = paneRestore(pane(0x10, 0x20, 0), 0x2000, false);
    expect(restore.selection).toEqual({ start: 0x10, end: 0x20 });
    expect(restore.keepsMeasuredState).toBe(false);
  });

  // @upstream Packages/Workspace/Tests/WorkspaceTests/WorkspaceTests.swift#WorkspaceTests.testAnEmptyFileTakesTheCaretToZero
  it("takes the caret of an empty file to zero", () => {
    const restore = paneRestore(pane(0x10, 0x20, 0x10), 0, false);
    expect(restore.selection).toEqual({ start: 0, end: 0 });
    expect(restore.topOffset).toBe(0);
  });

  // @upstream Packages/Workspace/Tests/WorkspaceTests/WorkspaceTests.swift#WorkspaceTests.testSegmentsApplyOnlyToTheBytesTheyWereCutOn
  it("applies segments only to the bytes they were cut on", () => {
    const cut: SegmentationState = {
      contentSize: 0x1000,
      pieces: [
        { start: 0, name: "a" },
        { start: 0x800, name: "b" },
      ],
    };
    expect(segmentationApplies(cut, 0x1000, true)).toBe(true);
    expect(segmentationApplies(cut, 0x1000, false)).toBe(false);
    expect(segmentationApplies(cut, 0x2000, true)).toBe(false);
    const unsorted: SegmentationState = {
      contentSize: 0x1000,
      pieces: [
        { start: 0, name: "a" },
        { start: 0, name: "b" },
      ],
    };
    expect(segmentationApplies(unsorted, 0x1000, true)).toBe(false);
  });

  // @upstream Packages/Workspace/Tests/WorkspaceTests/WorkspaceTests.swift#WorkspaceTests.testARelativePathClimbsOutOfTheProjectsFolder
  it("climbs out of a project's folder for a relative path", () => {
    const folder = "/Users/me/Jobs/1234";
    expect(relativePathOf("/Users/me/Jobs/1234/dumps/a.bin", folder)).toBe("dumps/a.bin");
    expect(relativePathOf("/Users/me/Jobs/shared/b.bin", folder)).toBe("../shared/b.bin");
    expect(relativePathOf("/Volumes/USB/c.bin", folder)).toBeUndefined();
    expect(relativePathOf("C:\\Jobs\\1234\\a.bin", "C:\\Jobs\\1234")).toBe("a.bin");
  });
});
