/**
 * Ported from `SegmentCommandsTests.swift`'s status-bar readout, with its own
 * sizes and offsets.
 *
 * The substance is the spelling: bare hex padded to the file's largest address,
 * the piece as one block, and the lengths abbreviated. Upstream asserts the
 * assembled `statusLabel.stringValue` of a laid-out view; here the line is a
 * function of the status, so the same strings are asserted without a view.
 */

import { describe, expect, it } from "vitest";
import { comparisonInfo } from "@/core/diff/comparisonSummary";
import { DiffBlockIndex } from "@/core/diff/diffBlock";
import { type Segmentation, segmentReadout, wholeFile } from "@/core/segments/segmentation";
import {
  exactSizeText,
  hexSizeText,
  type PaneStatus,
  sizeCopyText,
  statusLine,
  statusParts,
} from "@/core/text/statusLine";

/** A 16-byte file with a cut at 8, which is upstream's usual fixture. */
const cutAt8 = (): Segmentation => {
  const split = wholeFile(16).addCut(8);
  if (split === undefined) throw new Error("the fixture's cut was refused");
  return split;
};

/** The line for a caret at `caret` in `partition`, with nothing dirty. */
const line = (partition: Segmentation | undefined, caret: number): string =>
  statusLine({
    fileSize: partition?.contentSize ?? 0,
    cursorOffset: caret,
    selectionLength: 0,
    isDirty: false,
    segment: segmentReadout(partition, caret),
    comparison: "",
  });

describe("the status line", () => {
  // @upstream ByteRipperTests/SegmentCommandsTests.swift#SegmentCommandsTests.testTheStatusBarNamesTheCaretsPiece
  it("names the piece the caret is in", () => {
    const split = cutAt8();
    // The caret in the first piece reads S0, in the second S1.
    expect(segmentReadout(split, 4)).toEqual({ label: "S0", start: 0, end: 8 });
    expect(segmentReadout(split, 12)).toEqual({ label: "S1", start: 8, end: 16 });
  });

  // @upstream ByteRipperTests/SegmentCommandsTests.swift#SegmentCommandsTests.testTheStatusBarIsSilentWithOnePiece
  it("is silent with one piece", () => {
    const one = wholeFile(16);
    expect(segmentReadout(one, 4)).toBeUndefined();

    // A cut makes the readout appear; removing it brings the silence back.
    const split = cutAt8();
    expect(segmentReadout(split, 4)).toBeDefined();
    expect(segmentReadout(split.removeCut(8) ?? one, 4)).toBeUndefined();
  });

  // @upstream ByteRipperTests/SegmentCommandsTests.swift#SegmentCommandsTests.testTheStatusBarRendersBareHexAndOneSegmentBlock
  it("renders bare hex and one piece block", () => {
    // The file's largest address is 0x10 (its size), two hex digits, so every
    // address is padded to two: caret 0xC → "0C", S1 = [8, 16) → "08-0F" (first
    // byte 0x8, last byte 0xF).
    expect(line(cutAt8(), 12)).toBe("Offset 0C  ·  S1: 08-0F (8 B)  ·  16 B");
  });

  // @upstream ByteRipperTests/SegmentCommandsTests.swift#SegmentCommandsTests.testTheStatusBarPadsToTheFilesLargestAddressAndRoundsTheLength
  it("pads to the file's largest address and rounds the length", () => {
    // 4 MB, six hex digits.
    const size = 0x400000;
    const partition = wholeFile(size).addCut(0x2e6);
    if (partition === undefined) throw new Error("the fixture's cut was refused");

    // 0x400000 - 0x2E6 = 4193562 B = 3.999 MB → "4 MB"; the file is "4 MB".
    // The range is first-to-last byte: 0002E6-3FFFFF.
    expect(line(partition, 0x2e6)).toBe("Offset 0002E6  ·  S1: 0002E6-3FFFFF (4 MB)  ·  4 MB");
  });

  // @upstream ByteRipperTests/SegmentCommandsTests.swift#SegmentCommandsTests.testTheStatusBarAbbreviatesTheSelectionLength
  it("abbreviates the selection length", () => {
    const selected = (length: number): string =>
      statusLine({
        fileSize: 2048,
        cursorOffset: 0,
        selectionLength: length,
        isDirty: false,
        segment: undefined,
        comparison: "",
      });

    // 2000 B = 1.953 KB → rounds to "2 KB", not "2000 selected".
    expect(selected(2000)).toContain("2 KB selected");
    // A small selection stays in bytes: 16 bytes → "16 B selected".
    expect(selected(16)).toContain("16 B selected");
    // A caret is not a selection, and says nothing (0x800 is three digits).
    expect(selected(0)).toBe("Offset 000  ·  2 KB");
  });

  // The web's own: upstream's line carries "Modified" and the port keeps it.
  it("says Modified when the document has unsaved changes", () => {
    const status: PaneStatus = {
      fileSize: 16,
      cursorOffset: 4,
      selectionLength: 0,
      isDirty: true,
      segment: undefined,
      comparison: "",
    };
    expect(statusLine(status)).toBe("Offset 04  ·  16 B  ·  Modified");
  });

  // @upstream ByteRipperTests/DiffNavigationTests.swift#DiffNavigationTests.waitForIndex
  it("carries the comparison's share as its last part", () => {
    // 12 bytes out of 2048 is 0.585…%, which rounds up to the tenth above it.
    const index = DiffBlockIndex.of(2048, 2048, [
      { kind: "different", start: 0, end: 12 },
      { kind: "same", start: 12, end: 2048 },
    ]);
    const status: PaneStatus = {
      fileSize: 2048,
      cursorOffset: 4,
      selectionLength: 0,
      isDirty: false,
      segment: undefined,
      comparison: comparisonInfo(index),
    };
    expect(statusLine(status)).toBe("Offset 004  ·  2 KB  ·  differing 0.6%");
  });

  it("does not leave a separator standing for a comparison with nothing to say", () => {
    // While the index is building the part is empty, and an empty part would
    // read as a dangling separator at the end of the line.
    const status: PaneStatus = {
      fileSize: 2048,
      cursorOffset: 4,
      selectionLength: 0,
      isDirty: false,
      segment: undefined,
      comparison: "",
    };
    expect(statusLine(status)).toBe("Offset 004  ·  2 KB");
  });

  // An empty file has no address to take a width from, so the least it can be
  // is one digit — and the line says so rather than printing nothing.
  it("spells an empty file", () => {
    expect(line(wholeFile(0), 0)).toBe("Offset 0  ·  0 B");
  });
});

describe("the parts of the line the pointer acts on", () => {
  /** @upstream ByteRipperTests/StatusBarSizeTests.swift#StatusBarSizeTests.testTheExactSizeIsHexAndDecimal */
  it("writes the exact size as hex and decimal", () => {
    // The 64-bit case is the point of upstream's format string: a 32-bit one
    // would print the low half of a file over 2 GB.
    expect(exactSizeText(0)).toBe("0x0 (0 bytes)");
    expect(exactSizeText(2 * 1024 * 1024)).toBe("0x200000 (2097152 bytes)");
    expect(exactSizeText(0x100000001)).toBe("0x100000001 (4294967297 bytes)");
    expect(hexSizeText(0x100000001)).toBe("0x100000001");
  });

  /** @upstream ByteRipperTests/StatusBarSizeTests.swift#StatusBarSizeTests.testEachHalfOfTheExactFormIsCopiedInItsOwnFormat */
  it("copies each half of the exact form in its own format", () => {
    // What each half puts on the clipboard: that half on its own — the hex
    // address without the `0x` prefix the readout beside it wears, the decimal
    // count without the word that follows it in the bar. The prefix belongs to
    // the field the value is pasted into, which adds it.
    const size = 2 * 1024 * 1024;
    expect(sizeCopyText(size, "hex")).toBe("200000");
    expect(sizeCopyText(size, "decimal")).toBe("2097152");
    expect(sizeCopyText(0x100000001, "hex")).toBe("100000001");
    expect(sizeCopyText(0x100000001, "decimal")).toBe("4294967297");
  });

  /** @upstream ByteRipperTests/StatusBarSizeTests.swift#StatusBarSizeTests.testTheRegionCoversTheSizeAndNothingElse */
  it("marks the size's part and no other", () => {
    // 800 points of room, where the bar draws "Offset 0000  ·  2 MB  ·  Modified":
    // the size is the part between the separators and nothing either side of it.
    const parts = statusParts({
      fileSize: 2 * 1024 * 1024,
      cursorOffset: 0,
      selectionLength: 0,
      isDirty: true,
      segment: undefined,
      comparison: "",
    });
    expect(parts.parts).toEqual(["Offset 000000", "2 MB", "Modified"]);
    expect(parts.parts[parts.sizeIndex]).toBe("2 MB");
  });

  /** @upstream ByteRipperTests/StatusBarOffsetTests.swift#StatusBarOffsetTests.testTheRegionCoversTheAddressAndNothingElse */
  it("marks the address as the tail of its part", () => {
    // The line draws "Offset 0002E6" with the digits last, so the word in front
    // of them is not part of what a right-click on the address copies.
    const parts = statusParts({
      fileSize: 0x400000,
      cursorOffset: 0x2e6,
      selectionLength: 0,
      isDirty: false,
      segment: undefined,
      comparison: "",
    });
    expect(parts.offset.index).toBe(0);
    expect(parts.offset.digits).toBe("0002E6");
    expect(parts.parts[parts.offset.index]?.endsWith(parts.offset.digits)).toBe(true);
  });

  /** @upstream ByteRipperTests/StatusBarOffsetTests.swift#StatusBarOffsetTests.testTheRegionCoversTheAddressAndNothingElse */
  it("pads the address to the file's largest address", () => {
    // Three hundred bytes is three hex digits, so the caret at zero is drawn
    // "000" — and those digits, not a second formatting of the offset, are what
    // the line hands over.
    const parts = statusParts({
      fileSize: 300,
      cursorOffset: 0,
      selectionLength: 0,
      isDirty: false,
      segment: undefined,
      comparison: "",
    });
    expect(parts.offset.digits).toBe("000");
    expect(parts.parts[0]).toBe("Offset 000");
  });

  it("says where the size is when the line has the other parts before it", () => {
    // A selection and a piece move the size to the right, and the index is what
    // the readout unfolds: the pointer has to be on the part that is drawn.
    const split = cutAt8();
    const parts = statusParts({
      fileSize: 16,
      cursorOffset: 12,
      selectionLength: 8,
      isDirty: false,
      segment: segmentReadout(split, 12),
      comparison: "",
    });
    expect(parts.parts).toEqual(["Offset 0C", "8 B selected", "S1: 08-0F (8 B)", "16 B"]);
    expect(parts.parts[parts.sizeIndex]).toBe("16 B");
  });
});
