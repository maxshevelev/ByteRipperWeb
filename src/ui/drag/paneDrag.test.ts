import { describe, expect, it } from "vitest";
import {
  middleTruncated,
  PANE_DRAG_ICON_GAP,
  PANE_DRAG_MAX_WIDTH,
  PANE_DRAG_MIN_HEIGHT,
  PANE_DRAG_MIN_WIDTH,
  PANE_DRAG_TEXT_INSET,
  paneDragNameBudget,
  paneDragPillHeight,
  paneDragPillSize,
} from "@/ui/drag/paneDrag";

/**
 * Ported from the pill half of `PaneDragTests.swift`, plus the two rules the
 * platform did not need written down: the browser has no middle truncation to
 * reach for and no header to measure, so both are arithmetic here.
 */

/** A uniform font: every character is 8 wide, which makes the budgets exact. */
const measure = (charWidth = 8) => {
  const width = (text: string) => [...text].length * charWidth;
  return width;
};

// @upstream ByteRipperTests/PaneDragTests.swift#PaneDragTests.testThePillFitsWideContent
describe("the pill's size", () => {
  it("fits wide content, plus a padding at each end", () => {
    const size = paneDragPillSize(220, 28);

    expect(size.width).toBe(Math.min(PANE_DRAG_MAX_WIDTH, 220 + PANE_DRAG_TEXT_INSET * 2));
    expect(size.height).toBe(28); // the height is the header's
  });

  // @upstream ByteRipperTests/PaneDragTests.swift#PaneDragTests.testAWideNameIsCappedRatherThanStretchingThePill
  it("caps a wide name rather than stretching across the screen", () => {
    expect(paneDragPillSize(4000, 28).width).toBe(PANE_DRAG_MAX_WIDTH);
  });

  // @upstream ByteRipperTests/PaneDragTests.swift#PaneDragTests.testAShortNameStillGetsAFullPlate
  it("gives a short name a full plate rather than a lozenge", () => {
    const size = paneDragPillSize(12, 28);
    expect(size.width).toBe(PANE_DRAG_MIN_WIDTH);
    expect(size.width).toBe(200);
  });

  // @upstream ByteRipperTests/PaneDragTests.swift#PaneDragTests.testThePillIsNotScaled
  it("is not scaled", () => {
    const size = paneDragPillSize(120, 28);
    expect(size.height).toBe(28); // no shrink between drawing and carrying
    expect(size.width).toBeGreaterThanOrEqual(PANE_DRAG_MIN_WIDTH);
  });

  it("keeps a squeezed header's plate from becoming a line", () => {
    expect(paneDragPillHeight(9)).toBe(PANE_DRAG_MIN_HEIGHT);
    expect(paneDragPillHeight(34)).toBe(34);
  });

  it("leaves the name the room the glyph and the paddings do not take", () => {
    // No glyph: the gap after one is not charged for.
    expect(paneDragNameBudget(260, 0)).toBe(260 - PANE_DRAG_TEXT_INSET * 2);
    expect(paneDragNameBudget(260, 14)).toBe(
      260 - PANE_DRAG_TEXT_INSET * 2 - 14 - PANE_DRAG_ICON_GAP
    );
    // A plate too narrow for what it must carry leaves nothing, not a negative.
    expect(paneDragNameBudget(10, 20)).toBe(0);
  });
});

// @web-only the platform has no middle truncation to reach for
describe("middle truncation", () => {
  const charWidth = 8;

  it("leaves a name that fits exactly as it is", () => {
    expect(middleTruncated("board.bin", 200, measure(charWidth))).toBe("board.bin");
    // Exactly at the budget is still a fit.
    expect(middleTruncated("board", 40, measure(charWidth))).toBe("board");
  });

  it("keeps the head and the tail, and removes the middle", () => {
    // 184 wide, cut to 152: half the room for each end, and the tail is exactly
    // long enough for the extension whole.
    const cut = middleTruncated("firmware_dump_donor.bin", 152, measure(charWidth));
    expect(cut).toBe("firmware_…donor.bin");
    expect(cut).not.toContain("dump");
  });

  it("keeps the tail, which is what tells two dumps apart", () => {
    // Two dumps of one chip differ in their tails and nowhere else, so the cut
    // names still have to differ — and still say they are dumps.
    const donor = middleTruncated("firmware_dump_donor.bin", 152, measure(charWidth));
    const board = middleTruncated("firmware_dump_board.bin", 152, measure(charWidth));
    expect(donor).not.toBe(board);
    expect(donor.endsWith("donor.bin")).toBe(true);
    expect(board.endsWith("board.bin")).toBe(true);
  });

  it("always fits the width it was given", () => {
    const name = "a_very_long_firmware_dump_name_2024_donor.bin";
    for (const maxWidth of [28, 40, 64, 88, 120, 200]) {
      const cut = middleTruncated(name, maxWidth, measure(charWidth));
      expect(measure(charWidth)(cut)).toBeLessThanOrEqual(maxWidth);
    }
  });

  it("gives up the ellipsis itself when even that does not fit", () => {
    expect(middleTruncated("board.bin", 4, measure(charWidth))).toBe("…");
  });

  it("cuts at code points, never through a character", () => {
    const cut = middleTruncated("😀😀😀😀😀😀😀😀😀😀😀😀.bin", 96, measure(charWidth));
    // Rejoining the code points is the string itself only when no half of a
    // surrogate pair was left behind.
    expect([...cut].join("")).toBe(cut);
    expect(cut.endsWith(".bin")).toBe(true);
    expect(cut).toContain("…");
  });
});
