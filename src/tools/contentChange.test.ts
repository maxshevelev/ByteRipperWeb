import { describe, expect, it } from "vitest";
import type { UndoOperation } from "@/core/edit/undoHistory";
import {
  changeOfEdit,
  changeOfOperations,
  earliestAffectedOffset,
  mergedWith,
  type ToolContentChange,
} from "@/tools/contentChange";

/** Ported from `ToolModuleKitTests/ContentChangeTests.swift`. */

const edited = (start: number, end: number, sizeDelta: number): ToolContentChange => ({
  kind: "edited",
  start,
  end,
  sizeDelta,
});
const reloaded: ToolContentChange = { kind: "reloaded" };

/** One change as a line a test can state whole — `0x10..<0x41 +4`. */
const shape = (change: ToolContentChange): string =>
  change.kind === "reloaded"
    ? "reloaded"
    : `0x${change.start.toString(16)}..<0x${change.end.toString(16)} ${change.sizeDelta >= 0 ? "+" : ""}${change.sizeDelta}`;

describe("coalescing what a session is told", () => {
  // Once the content has been replaced there is nothing left to be precise
  // about — from either side, since the reload may arrive first.
  // @upstream Packages/ToolModuleKit/Tests/ToolModuleKitTests/ContentChangeTests.swift#ContentChangeTests.testAReloadSwallowsAnEdit
  it("has a reload swallow an edit", () => {
    const edit = edited(0x10, 0x20, 0);

    expect(mergedWith(edit, reloaded)).toEqual(reloaded);
    expect(mergedWith(reloaded, edit)).toEqual(reloaded);
    expect(mergedWith(reloaded, reloaded)).toEqual(reloaded);
  });

  // A run of typing: the stretch from the earliest start to the latest end,
  // which is what a session has to re-read.
  // @upstream Packages/ToolModuleKit/Tests/ToolModuleKitTests/ContentChangeTests.swift#ContentChangeTests.testTwoEditsBecomeTheStretchTheyBothTouched
  it("makes two edits the stretch they both touched", () => {
    const first = edited(0x40, 0x41, 0);
    const second = edited(0x10, 0x11, 0);

    expect(shape(mergedWith(first, second))).toBe("0x10..<0x41 +0");
  });

  // Length changes add up: two insertions have moved the tail by both.
  // @upstream Packages/ToolModuleKit/Tests/ToolModuleKitTests/ContentChangeTests.swift#ContentChangeTests.testLengthChangesAddUp
  it("adds length changes up", () => {
    const first = edited(0x10, 0x14, 4);
    const second = edited(0x20, 0x20, -2);

    expect(shape(mergedWith(first, second))).toBe("0x10..<0x20 +2");
  });

  // What a session acts on: where the content stopped being what it read.
  // @upstream Packages/ToolModuleKit/Tests/ToolModuleKitTests/ContentChangeTests.swift#ContentChangeTests.testTheEarliestAffectedOffset
  it("answers the earliest affected offset", () => {
    expect(earliestAffectedOffset(edited(0x30, 0x40, 0))).toBe(0x30);
    expect(earliestAffectedOffset(reloaded)).toBeUndefined();
  });
});

// @upstream ByteRipperApp/Tools/ToolController.swift#ToolController.paneEdited
describe("an edit as the change a session hears", () => {
  it("leaves the offsets alone for an overwrite", () => {
    expect(shape(changeOfEdit({ kind: "overwrite", start: 0x10, end: 0x14 }))).toBe(
      "0x10..<0x14 +0"
    );
  });

  it("counts an insert's bytes onto the tail", () => {
    expect(shape(changeOfEdit({ kind: "insert", at: 0x10, length: 4 }))).toBe("0x10..<0x14 +4");
  });

  // A deletion's damage is the shift, not the bytes that are nowhere any more.
  it("covers nothing where the bytes of a deletion left from", () => {
    expect(shape(changeOfEdit({ kind: "delete", start: 0x10, end: 0x12 }))).toBe("0x10..<0x10 -2");
  });
});

describe("a transaction's operations as one change", () => {
  const bytes = (count: number) => new Uint8Array(count);

  it("says nothing about a transaction that changed nothing", () => {
    expect(changeOfOperations([])).toBeUndefined();
  });

  // A checksum repair writes six places in one gesture; the session hears it
  // once, as the stretch between the outermost of them.
  it("folds a scattered transaction into the stretch it touched", () => {
    const operations: UndoOperation[] = [
      { kind: "overwrite", at: 0x40, before: bytes(2), after: bytes(2) },
      { kind: "overwrite", at: 0x10, before: bytes(4), after: bytes(4) },
    ];

    expect(shape(changeOfOperations(operations) as ToolContentChange)).toBe("0x10..<0x42 +0");
  });

  // An operation that moves the tail moves it for every operation before it,
  // which is why the deltas are added rather than the widths compared.
  it("adds up the operations that move the tail", () => {
    const operations: UndoOperation[] = [
      { kind: "insert", at: 0x10, bytes: bytes(4) },
      { kind: "delete", at: 0x20, bytes: bytes(2) },
    ];

    expect(shape(changeOfOperations(operations) as ToolContentChange)).toBe("0x10..<0x20 +2");
  });
});
