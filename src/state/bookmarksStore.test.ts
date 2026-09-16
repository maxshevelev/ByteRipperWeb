import { beforeEach, describe, expect, it } from "vitest";
import { rowContaining } from "@/core/bookmarks/bookmarkStore";
import { BYTES_PER_ROW } from "@/core/document/rowWidth";
import {
  addBookmark,
  BOOKMARK_DRAG_HYSTERESIS,
  bookmarks,
  moveBookmark,
  pointerRow,
  removeBookmark,
} from "@/state/bookmarksStore";

/**
 * §20.6 — moving a mark with the pointer, as far as the store decides it.
 *
 * The view owns the gesture: the press, the capture, the release. What it asks
 * the store is a single question per move — "the pointer is here, it came from
 * there; which row is the mark on now" — and that question is `pointerRow`. The
 * two rules it holds are the ones the gesture gets wrong without it: a step
 * happens when the pointer *crosses* into another row rather than while it
 * merely rests over one, and a crossing counts only once the pointer is a
 * couple of points inside the row it crossed into.
 */

const ROW_HEIGHT = 17;
/** A y coordinate a given distance inside the top of a row. */
const insideRow = (row: number, offset: number) => row * ROW_HEIGHT + offset;
/**
 * The mark's row as the store names it: a byte offset, always a multiple of the
 * row width. `pointerRow` answers in row *indexes* — how many row heights down
 * the pointer is — and the view is what turns one into the other.
 */
const storeRow = (offset: number) => rowContaining(offset);
/** A y coordinate's row index, for the gesture tests below. */
const indexOf = (offset: number) => rowContaining(offset) / BYTES_PER_ROW;
/** The row a 0x200-byte file ends on, as the pane would report it. */
const LAST_ROW = storeRow(0x1ff);

beforeEach(() => {
  for (const mark of [...bookmarks.bookmarks]) removeBookmark(mark.row);
});

describe("the row a dragged mark is counted on", () => {
  // @upstream ByteRipperTests/BookmarkDragTests.swift#BookmarkDragTests.testThePointerMustCrossARowEdgeByAFewPointsToStep
  it("holds the row it came from until the pointer is a few points inside the next", () => {
    // Absolute distances rather than the constant itself: a test measured in
    // the value it is checking would pass with no hysteresis at all.
    expect(BOOKMARK_DRAG_HYSTERESIS).toBeGreaterThan(1);

    // A point past the edge into the next row is inside the band, and is not
    // yet a crossing.
    expect(pointerRow(insideRow(1, 1), 0, ROW_HEIGHT)).toBe(0);
    // Four points in: past the band, really on the next row.
    expect(pointerRow(insideRow(1, 4), 0, ROW_HEIGHT)).toBe(1);
  });

  it("is symmetric — a step back needs the same few points", () => {
    // One point above row 1's top edge is still inside row 1.
    expect(pointerRow(insideRow(1, -1), 1, ROW_HEIGHT)).toBe(1);
    // Four points above it, and the row below is what the pointer is on.
    expect(pointerRow(insideRow(1, -4), 1, ROW_HEIGHT)).toBe(0);
  });

  it("counts a row the pointer is well inside immediately", () => {
    expect(pointerRow(insideRow(1, ROW_HEIGHT / 2), 0, ROW_HEIGHT)).toBe(1);
    expect(pointerRow(insideRow(4, ROW_HEIGHT / 2), 1, ROW_HEIGHT)).toBe(4);
  });

  it("crosses more than one row at a time, however far the pointer jumped", () => {
    // The pointer can leave a row in one event and arrive several rows away.
    expect(pointerRow(insideRow(5, 6), 0, ROW_HEIGHT)).toBe(5);
    expect(pointerRow(insideRow(0, 6), 5, ROW_HEIGHT)).toBe(0);
  });

  it("has no row above the first one", () => {
    // A pointer dragged past the top of the grid: the mark lands on row 0
    // rather than on a negative offset.
    expect(pointerRow(-200, 5, ROW_HEIGHT)).toBe(0);
    expect(pointerRow(insideRow(0, 0), 5, ROW_HEIGHT)).toBe(0);
  });

  it("stays where it was when there is no row height to divide by", () => {
    // The layout is not measured yet — during the first frame, or after the
    // grid was hidden. Nothing can be said about a pointer, so nothing changes.
    expect(pointerRow(100, 3, 0)).toBe(3);
  });
});

describe("a mark dragged across a row boundary", () => {
  it("moves with the crossing, and stops where the crossing stopped it", () => {
    addBookmark(0x20, "travelling");
    const row = indexOf(0x20);

    // The gesture starts on the mark's own row: the first step comes when the
    // pointer leaves it.
    let from = row;
    // Onto the boundary — no step: the pointer has not crossed anything yet.
    from = pointerRow(insideRow(row + 1, 1), from, ROW_HEIGHT);
    expect(from).toBe(row);

    // Past the band: a step, and the mark takes the new row.
    from = pointerRow(insideRow(row + 1, 4), from, ROW_HEIGHT);
    expect(from).toBe(row + 1);
    expect(moveBookmark(0x20, from * BYTES_PER_ROW, LAST_ROW)).toBe(0x30);
    expect(bookmarks.bookmarks.map((mark) => mark.row)).toEqual([0x30]);
  });

  // @upstream ByteRipperTests/BookmarkDragTests.swift#BookmarkDragTests.testJitterAfterAJumpLeavesTheMarkWhereItLanded
  it("does not shuffle back when a hand rests on the row it jumped over", () => {
    // Two marks, one row apart. Dragging the first down onto the second's row
    // jumps it past — one mark per row — so the pointer is left resting on the
    // row the mark just jumped over. Re-reading that row would compute the jump
    // again, in the other direction, and the mark flickered to and fro.
    addBookmark(0x00, "moving");
    addBookmark(0x10, "in the way");

    let from = indexOf(0x00);
    from = pointerRow(insideRow(1, 4), from, ROW_HEIGHT);
    expect(moveBookmark(0x00, from * BYTES_PER_ROW, LAST_ROW)).toBe(0x20);
    expect(bookmarks.bookmarks.map((mark) => mark.row)).toEqual([0x10, 0x20]);

    // The hand jitters within the row the mark is now past.
    for (const offset of [0, 2, 6, 10, 15]) {
      from = pointerRow(insideRow(1, offset), from, ROW_HEIGHT);
      expect(from, `offset ${offset}`).toBe(1);
    }
    expect(bookmarks.bookmarks.map((mark) => mark.row)).toEqual([0x10, 0x20]);
  });

  it("starts a fresh gesture from the mark's own row", () => {
    // Per gesture, not per view: a new press re-reads where the pointer is, so
    // the next drag is not measured against the last one's row.
    addBookmark(0x00);
    let from = indexOf(0x00);
    from = pointerRow(insideRow(3, 6), from, ROW_HEIGHT);
    moveBookmark(0x00, from * BYTES_PER_ROW, LAST_ROW);
    expect(bookmarks.bookmarks.map((mark) => mark.row)).toEqual([0x30]);

    // Pressed again, on the mark where it now is.
    from = indexOf(0x30);
    from = pointerRow(insideRow(4, 6), from, ROW_HEIGHT);
    moveBookmark(0x30, from * BYTES_PER_ROW, LAST_ROW);
    expect(bookmarks.bookmarks.map((mark) => mark.row)).toEqual([0x40]);
  });

  it("cannot be carried past the last row of the file", () => {
    // 0x40 bytes is four rows, so 0x30 is the last row a mark may be dragged to.
    const lastRow = storeRow(0x3f);
    addBookmark(0x00);
    const landed = moveBookmark(0x00, 40 * BYTES_PER_ROW, lastRow);
    expect(landed).toBe(0x30);
    expect(bookmarks.bookmarks.map((mark) => mark.row)).toEqual([0x30]);
  });
});
