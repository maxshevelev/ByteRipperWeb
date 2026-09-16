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
import { type Segmentation, segmentReadout, wholeFile } from "@/core/segments/segmentation";
import { type PaneStatus, statusLine } from "@/core/text/statusLine";

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
    };
    expect(statusLine(status)).toBe("Offset 04  ·  16 B  ·  Modified");
  });

  // An empty file has no address to take a width from, so the least it can be
  // is one digit — and the line says so rather than printing nothing.
  it("spells an empty file", () => {
    expect(line(wholeFile(0), 0)).toBe("Offset 0  ·  0 B");
  });
});
