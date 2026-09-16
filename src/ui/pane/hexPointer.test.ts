import { describe, expect, it } from "vitest";
import { HexLayout } from "@/render/hexGrid/hexLayout";
import { contextMenuAnchor, hexClickPlacement, pointerTarget } from "@/ui/pane/hexPointer";

/**
 * Ported from `CaretPlacementTests` and `OffsetContextMenuTests`, which drive
 * the real view with synthesized mouse events. Here the pointer's x goes
 * straight to the rules, with the layout's own `hitTest` standing in for the
 * event — so what is tested is the decision, not the plumbing.
 *
 * The layout's numbers are upstream's: charWidth 8, rowHeight 17.
 */
const layout = new HexLayout({ charWidth: 8, rowHeight: 17 });

/** A left click at `x` on row 0 of a 32-byte file. */
function click(x: number, insertMode = false, row = 0, size = 32) {
  const y = row * layout.rowHeight + layout.rowHeight / 2;
  const hit = layout.hitTest(x, y, layout.rowCount(size));
  expect(hit).toBeDefined();
  if (hit === undefined) throw new Error("unreachable");
  return pointerTarget(layout, hit, x, insertMode);
}

/** A right click at `x`, as `contextMenuAnchor` reads it. */
function rightClick(x: number, row = 0, size = 32, insertMode = false) {
  const y = row * layout.rowHeight + layout.rowHeight / 2;
  const hit = layout.hitTest(x, y, layout.rowCount(size));
  expect(hit).toBeDefined();
  if (hit === undefined) throw new Error("unreachable");
  return contextMenuAnchor(layout, hit, x, size, insertMode);
}

/** A point `fraction` characters into byte `column`'s cell. */
const inByte = (column: number, fraction: number) =>
  layout.hexByteX(column) + layout.charWidth * fraction;

// @upstream ByteRipperTests/CaretPlacementTests.swift#CaretPlacementTests.testWhereInAByteAClickLandsDecidesTheNibble
describe("where in a byte a click lands", () => {
  it("decides the nibble at the byte's centre in overwrite mode", () => {
    expect(click(inByte(5, 0.25))).toEqual({ offset: 5, region: "hex", nibble: 0 });
    // The high nibble's second half is still its zone — the threshold is the
    // byte's centre, not the middle of each digit's character.
    expect(click(inByte(5, 0.75)).nibble).toBe(0);
    expect(click(inByte(5, 1.25)).nibble).toBe(1);
    expect(click(inByte(5, 1.75)).nibble).toBe(1);
  });

  it("keeps the threshold on the high digit's middle in insert mode", () => {
    expect(click(inByte(5, 0.25), true).nibble).toBe(0);
    expect(click(inByte(5, 0.75), true).nibble).toBe(1);
  });

  // @upstream ByteRipperTests/CaretPlacementTests.swift#CaretPlacementTests.testOverwriteClickInByteGapLandsOnNeighbouringNibble
  it("hands the gap before a byte to the nearer nibble", () => {
    // The one-character gap after byte 5: its first half is byte 5's low
    // nibble's, its second half byte 6's high nibble's.
    const gapAfter5 = layout.hexByteX(5) + layout.hexByteWidth;
    expect(click(gapAfter5 + layout.charWidth * 0.25)).toEqual({
      offset: 5,
      region: "hex",
      nibble: 1,
    });
    expect(click(gapAfter5 + layout.charWidth * 0.75)).toEqual({
      offset: 6,
      region: "hex",
      nibble: 0,
    });
  });

  it("splits the wider gap between the two groups at its middle", () => {
    const groupGap = layout.hexByteX(7) + layout.hexByteWidth;
    expect(click(groupGap + layout.charWidth * 0.5)).toEqual({
      offset: 7,
      region: "hex",
      nibble: 1,
    });
    expect(click(groupGap + layout.charWidth * 1.5)).toEqual({
      offset: 8,
      region: "hex",
      nibble: 0,
    });
  });

  it("takes the row's first byte's left boundary for a click before it", () => {
    // There is no gap before column 0 — the hex region starts there — so the
    // only answer is the byte's own left boundary.
    expect(click(layout.hexByteX(0) - 2)).toEqual({ offset: 0, region: "hex", nibble: 0 });
  });
});

describe("what a click is about besides the caret", () => {
  it("types into the column it landed in", () => {
    expect(click(inByte(5, 0.25)).region).toBe("hex");
    expect(click(layout.textX(5) + layout.charWidth / 2).region).toBe("text");
    expect(click(layout.leftPadding + 4).region).toBe("hex");
  });

  it("lands on the row's first byte when the address was clicked", () => {
    expect(click(layout.leftPadding + 4, false, 2)).toEqual({
      offset: 0x20,
      region: "hex",
      nibble: 0,
    });
  });

  it("lands on the placeholder bytes of the caret row past the file's end", () => {
    // The caret row of a file ending on a row boundary. The offset is past the
    // size on purpose: `moveCaret` clamps it, exactly as it clamps an arrow.
    expect(click(inByte(3, 0.25), false, 2, 32).offset).toBe(0x23);
  });
});

// @upstream ByteRipperTests/OffsetContextMenuTests.swift#OffsetContextMenuTests.testOffsetAnchorFramesRowAddress
describe("what a right click anchors a menu to", () => {
  it("is the row's start offset when the address was clicked", () => {
    for (const [row, expected] of [
      [0, 0],
      [1, 0x10],
      [2, 0x20],
    ] as const) {
      const anchor = rightClick(layout.leftPadding + 4, row, 48);
      expect(anchor?.offset).toBe(expected);
      // The frame spans the row's address rather than a byte.
      expect(anchor?.framesByte).toBe(false);
      expect(anchor?.nibble).toBe(0);
    }
  });

  // @upstream ByteRipperTests/OffsetContextMenuTests.swift#OffsetContextMenuTests.testRightClickOnHexByteMapsToByteOffset
  it("is the clicked byte's own offset, framed as one byte", () => {
    expect(rightClick(inByte(4, 1), 0, 48)?.offset).toBe(0x04);
    expect(rightClick(inByte(3, 1), 2, 48)?.offset).toBe(0x23);
    expect(rightClick(inByte(4, 1), 0, 48)?.framesByte).toBe(true);
  });

  // @upstream ByteRipperTests/OffsetContextMenuTests.swift#OffsetContextMenuTests.testRightClickInAsciiColumnIsIgnored
  it("is nothing at all in the text column", () => {
    expect(rightClick(layout.textX(2) + layout.charWidth / 2)).toBeUndefined();
  });

  // @upstream ByteRipperTests/OffsetContextMenuTests.swift#OffsetContextMenuTests.testRightClickPastEOFIsIgnored
  it("is nothing at all past the file's end", () => {
    // A file ending on a row boundary keeps a trailing caret row, and neither
    // its placeholder byte nor its address is a block to start from.
    expect(rightClick(inByte(0, 1), 2, 32)).toBeUndefined();
    expect(rightClick(layout.leftPadding + 4, 2, 32)).toBeUndefined();
    // An empty file is the same rule with that row first.
    expect(rightClick(layout.leftPadding + 4, 0, 0)).toBeUndefined();
  });

  // @upstream ByteRipperTests/OffsetContextMenuTests.swift#OffsetContextMenuTests.testRightClickNibbleFollowsTheClick
  it("carries the nibble the click fell in, by the same threshold a left click uses", () => {
    expect(rightClick(inByte(5, 0.25))?.nibble).toBe(0);
    expect(rightClick(inByte(5, 0.75))?.nibble).toBe(0);
    expect(rightClick(inByte(5, 1.25))?.nibble).toBe(1);

    expect(rightClick(inByte(5, 0.25), 0, 32, true)?.nibble).toBe(0);
    expect(rightClick(inByte(5, 0.75), 0, 32, true)?.nibble).toBe(1);
  });

  // @upstream ByteRipperTests/OffsetContextMenuTests.swift#OffsetContextMenuTests.testRightClickInGapLandsOnTheFramedByte
  it("stays on the framed byte even for a click in the gap before it", () => {
    // The gap's first half would send a left click to byte 5's low nibble; the
    // menu is about byte 6, which is what `hitTest` reported.
    const gapAfter5 = layout.hexByteX(5) + layout.hexByteWidth;
    const anchor = rightClick(gapAfter5 + layout.charWidth * 0.25);
    expect(anchor?.offset).toBe(6);
    expect(anchor?.nibble).toBe(0);
  });
});

// The nibble placement itself, without a hit in front of it: what the two
// click paths above both read.
describe("the placement rule on its own", () => {
  it("reads the nibble off the pointer's x within the byte", () => {
    expect(hexClickPlacement(layout, inByte(5, 0.75), 5, false)).toEqual({ column: 5, nibble: 0 });
    expect(hexClickPlacement(layout, inByte(5, 0.75), 5, true)).toEqual({ column: 5, nibble: 1 });
  });
});
