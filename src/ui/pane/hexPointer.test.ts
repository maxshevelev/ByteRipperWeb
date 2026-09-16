import { describe, expect, it } from "vitest";
import { HexLayout } from "@/render/hexGrid/hexLayout";
import {
  contextMenuAnchor,
  dragHasLeftDeadZone,
  hexClickPlacement,
  pointerTarget,
} from "@/ui/pane/hexPointer";

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

/**
 * The dead zone a drag waits to leave (§3.3), tested where the pointer's own x
 * and y go straight to the rule — the same standing-in for the event the tests
 * above do. `MouseSelectionTests` drives the real view for these; what is
 * checked here is the decision, which is all the pane asks for.
 *
 * A press mid-byte sits on the boundary `dragEndOffset` measures from, so the
 * zone is what keeps a 1 px tremor from selecting the byte.
 */
describe("the drag dead zone", () => {
  /** A point on row `row` of a 32-byte file, `x` px into the content. */
  const at = (x: number, row = 0) => ({ x, y: row * layout.rowHeight + layout.rowHeight / 2 });
  const size = 32;
  const rows = layout.rowCount(size);
  const left = (origin: { x: number; y: number }, point: { x: number; y: number }) =>
    dragHasLeftDeadZone(layout, origin, point, rows);

  // @upstream ByteRipperTests/MouseSelectionTests.swift#MouseSelectionTests.testJitterInDeadZoneDoesNotSelect
  it("holds the selection back while the pointer stays inside it", () => {
    // Byte 0's nibble boundary: the place a click between the two digits puts
    // the caret. A quarter of a character either way is hand tremor.
    const boundary = inByte(0, 1);
    const jitter = layout.charWidth * 0.25;
    expect(left(at(boundary), at(boundary + jitter))).toBe(false);
    expect(left(at(boundary), at(boundary - jitter))).toBe(false);
    // And the zone's own edges belong to it, as upstream's inclusive test says.
    expect(left(at(boundary), at(layout.highNibbleMidX(0)))).toBe(false);
    expect(left(at(boundary), at(layout.lowNibbleMidX(0)))).toBe(false);
  });

  // @upstream ByteRipperTests/MouseSelectionTests.swift#MouseSelectionTests.testDragOutOfDeadZoneSelectsFromClick
  it("lets the drag through the moment the pointer leaves", () => {
    const boundary = inByte(0, 1);
    expect(left(at(boundary), at(layout.lowNibbleMidX(0) + 1))).toBe(true);
    expect(left(at(boundary), at(layout.highNibbleMidX(0) - 1))).toBe(true);
    // A character to the right, which is byte 0's own outer quarter.
    expect(left(at(boundary), at(layout.lowNibbleMidX(0) + layout.charWidth))).toBe(true);
  });

  // @upstream ByteRipperApp/Hex/HexView.swift#HexView.dragHasLeftDeadZone
  it("spans the pressed row, so vertical movement engages it", () => {
    const boundary = inByte(0, 1);
    // The same x, one row down: outside the zone's frame.
    expect(left(at(boundary), at(boundary, 1))).toBe(true);
    // The row above is outside it too, and so is a y below the pressed row.
    expect(left(at(boundary, 1), at(boundary))).toBe(true);
  });

  it("engages at once for a press that is not in the hex column", () => {
    // A byte's outer quarter, the offset column and the text column are all
    // clear positions: nothing there sits on the drag boundary.
    expect(left(at(inByte(0, 0.25)), at(inByte(0, 0.5)))).toBe(true);
    expect(left(at(layout.leftPadding + 4), at(layout.leftPadding + 6))).toBe(true);
    expect(left(at(layout.textX(3)), at(layout.textX(3) + 2))).toBe(true);
    // A click in the gap before byte 0's cell — the region's left edge.
    expect(left(at(layout.hexByteX(0) - 2), at(layout.hexByteX(0) + 4))).toBe(true);
  });

  // @upstream ByteRipperApp/Hex/HexView.swift#HexView.dragHasLeftDeadZone
  it("engages for a press the layout cannot place in a row", () => {
    // 32 bytes is two data rows and the trailing caret row; the press lands
    // past even that, and above the first row, where there is no zone to sit in
    // — the rule answers `true` rather than trapping the drag forever.
    const boundary = inByte(0, 1);
    expect(left(at(boundary, 3), at(boundary, 3))).toBe(true);
    expect(left(at(boundary, -1), at(boundary, -1))).toBe(true);
  });
});
