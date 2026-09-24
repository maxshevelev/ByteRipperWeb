import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rowContaining } from "@/core/bookmarks/bookmarkStore";
import { BYTES_PER_ROW } from "@/core/document/rowWidth";
import {
  addBookmark,
  BOOKMARK_DRAG_HYSTERESIS,
  bookmarkAt,
  bookmarks,
  bookmarksIn,
  bookmarksStore,
  marksFor,
  moveBookmark,
  pointerRow,
  removeBookmark,
} from "@/state/bookmarksStore";
import { EMPTY_DOCK } from "@/state/fragmentDock";
import { openLinkedPart } from "@/state/openLinkedPart";
import {
  closePart,
  openEmptyInPane,
  type PartId,
  paneState,
  workspaceStore,
} from "@/state/workspaceStore";

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
  for (const mark of [...bookmarks.bookmarks]) removeBookmark("a", mark.row);
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
    addBookmark("a", 0x20, "travelling");
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
    expect(moveBookmark("a", 0x20, from * BYTES_PER_ROW, LAST_ROW)).toBe(0x30);
    expect(bookmarks.bookmarks.map((mark) => mark.row)).toEqual([0x30]);
  });

  // @upstream ByteRipperTests/BookmarkDragTests.swift#BookmarkDragTests.testJitterAfterAJumpLeavesTheMarkWhereItLanded
  it("does not shuffle back when a hand rests on the row it jumped over", () => {
    // Two marks, one row apart. Dragging the first down onto the second's row
    // jumps it past — one mark per row — so the pointer is left resting on the
    // row the mark just jumped over. Re-reading that row would compute the jump
    // again, in the other direction, and the mark flickered to and fro.
    addBookmark("a", 0x00, "moving");
    addBookmark("a", 0x10, "in the way");

    let from = indexOf(0x00);
    from = pointerRow(insideRow(1, 4), from, ROW_HEIGHT);
    expect(moveBookmark("a", 0x00, from * BYTES_PER_ROW, LAST_ROW)).toBe(0x20);
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
    addBookmark("a", 0x00);
    let from = indexOf(0x00);
    from = pointerRow(insideRow(3, 6), from, ROW_HEIGHT);
    moveBookmark("a", 0x00, from * BYTES_PER_ROW, LAST_ROW);
    expect(bookmarks.bookmarks.map((mark) => mark.row)).toEqual([0x30]);

    // Pressed again, on the mark where it now is.
    from = indexOf(0x30);
    from = pointerRow(insideRow(4, 6), from, ROW_HEIGHT);
    moveBookmark("a", 0x30, from * BYTES_PER_ROW, LAST_ROW);
    expect(bookmarks.bookmarks.map((mark) => mark.row)).toEqual([0x40]);
  });

  it("cannot be carried past the last row of the file", () => {
    // 0x40 bytes is four rows, so 0x30 is the last row a mark may be dragged to.
    const lastRow = storeRow(0x3f);
    addBookmark("a", 0x00);
    const landed = moveBookmark("a", 0x00, 40 * BYTES_PER_ROW, lastRow);
    expect(landed).toBe(0x30);
    expect(bookmarks.bookmarks.map((mark) => mark.row)).toEqual([0x30]);
  });
});

/**
 * §20.7 — a fragment panel reads the workspace's list at the part's offsets.
 *
 * A bookmark is a row of a *file*, and a panel is a window onto that file: a
 * row marked in the dump is marked in the part taken out of it, and marking it
 * in either place marks it in the other. A decompressed body is the exception —
 * its bytes are not the file's bytes, so it reads no list and adds to none.
 *
 * Ported from the half of upstream's `BookmarkSpaceTests` that drives a panel;
 * the arithmetic is in `core/bookmarks/bookmarkSpace.test.ts`.
 *
 * @upstream ByteRipperTests/BookmarkSpaceTests.swift#BookmarkSpaceTests
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.bookmarks
 * @upstream ByteRipperApp/Fragments/FragmentPanels.swift#FragmentPanels.bookmarkSpace
 */
describe("a panel's view of the list", () => {
  afterEach(() => {
    for (const panel of workspaceStore.getSnapshot().dock.panels) closePart(`part:${panel}`);
    workspaceStore.update((state) => ({
      ...state,
      panes: { a: undefined, b: undefined },
      parts: {},
      dock: EMPTY_DOCK,
    }));
  });

  /** A file of `length` bytes in pane A. */
  async function fileInA(length = 0x2000): Promise<void> {
    openEmptyInPane("a", "bios.bin");
    const slot = paneState("a");
    if (slot === undefined) throw new Error("pane A should be open");
    await slot.document.insert(
      0,
      Uint8Array.from({ length }, (_, index) => index & 0xff)
    );
  }

  /** Takes `[start, end)` of pane A out as a part. */
  async function partOfA(start: number, end: number, kind?: "decompressed"): Promise<PartId> {
    const slot = paneState("a");
    if (slot === undefined) throw new Error("pane A should be open");
    return openLinkedPart({
      parent: "a",
      bytes: await slot.document.read(start, end - start),
      name: "zone.bin",
      source: [start, end],
      partName: "zone",
      ...(kind === undefined ? {} : { kind }),
    });
  }

  // A mark made in the dump is the same mark in the part taken out of it, at
  // the address the part has it at.
  // @upstream ByteRipperTests/BookmarkSpaceTests.swift#BookmarkSpaceTests.testAMarkInEitherPlaceRepaintsTheOther
  it("shows the dump's marks at the part's offsets", async () => {
    await fileInA();
    const part = await partOfA(0x1000, 0x1100);

    addBookmark("a", 0x1040, "in the file");

    expect(bookmarkAt(part, 0x40)?.name).toBe("in the file");
    expect(bookmarksIn(bookmarksStore.getSnapshot(), part)).toEqual([
      { row: 0x40, name: "in the file" },
    ]);
  });

  // And the other way: a mark made in the panel is a mark on the file's row.
  // @upstream ByteRipperTests/BookmarkSpaceTests.swift#BookmarkSpaceTests.testAMarkInEitherPlaceRepaintsTheOther
  it("puts a mark made in the part on the file's row", async () => {
    await fileInA();
    const part = await partOfA(0x1000, 0x1100);

    addBookmark(part, 0x40, "in the part");

    expect(bookmarkAt("a", 0x1040)?.name).toBe("in the part");
    expect(bookmarkAt("b", 0x1040)?.name).toBe("in the part");
  });

  /** Both of the workspace's panes read one list: a mark is an absolute offset. */
  it("leaves the two file slots sharing theirs", async () => {
    await fileInA();
    addBookmark("a", 0x40, "shared");

    expect(bookmarkAt("b", 0x40)?.name).toBe("shared");
  });

  // A mark on a row above the part is not a mark in the part, and stays in the
  // list either way.
  // @upstream ByteRipperTests/BookmarkSpaceTests.swift#BookmarkSpaceTests.testMarksBeforeThePartAreNotInIt
  it("leaves out the marks that fall before the part", async () => {
    await fileInA();
    const part = await partOfA(0x1000, 0x1100);

    addBookmark("a", 0x10, "above");

    expect(bookmarksIn(bookmarksStore.getSnapshot(), part)).toEqual([]);
    expect(bookmarkAt("a", 0x10)?.name).toBe("above");
  });

  /** A part opened out of a part composes, without anything counting the depth. */
  it("composes the offsets of a part taken out of a part", async () => {
    await fileInA();
    const outer = await partOfA(0x1000, 0x1100);
    const outerSlot = paneState(outer);
    if (outerSlot === undefined) throw new Error("the part should be open");
    const inner = await openLinkedPart({
      parent: outer,
      bytes: await outerSlot.document.read(0x40, 0x20),
      name: "inner.bin",
      source: [0x40, 0x60],
      partName: "inner",
    });

    addBookmark(inner, 0, "deep");

    expect(bookmarkAt("a", 0x1040)?.name).toBe("deep");
    expect(bookmarkAt(outer, 0x40)?.name).toBe("deep");
  });

  /**
   * The marks stay when the panel closes: they were never the part's. Upstream
   * closes a window onto the list, not the list.
   */
  it("keeps the marks when the part closes", async () => {
    await fileInA();
    const part = await partOfA(0x1000, 0x1100);
    addBookmark(part, 0x40, "made in the part");

    closePart(part);

    expect(bookmarkAt("a", 0x1040)?.name).toBe("made in the part");
  });

  /**
   * A decompressed body has no space at all: its bytes are what a section
   * unpacks to, so no offset in them is an offset in the file. Nothing is
   * drawn, and nothing can be made.
   */
  it("gives a decompressed body no list at all", async () => {
    await fileInA();
    const part = await partOfA(0x1000, 0x1100, "decompressed");

    expect(marksFor(part)).toBeUndefined();
    expect(addBookmark(part, 0x40, "nowhere")).toBeUndefined();
    expect(bookmarkAt(part, 0x40)).toBeUndefined();
    expect(bookmarksIn(bookmarksStore.getSnapshot(), part)).toEqual([]);
    // And the file's own list is untouched by the attempt.
    expect(bookmarks.bookmarks).toEqual([]);
  });

  /** And so does anything opened out of one. */
  it("gives a part of a decompressed body none either", async () => {
    await fileInA();
    const body = await partOfA(0x1000, 0x1100, "decompressed");
    const bodySlot = paneState(body);
    if (bodySlot === undefined) throw new Error("the part should be open");
    const inner = await openLinkedPart({
      parent: body,
      bytes: await bodySlot.document.read(0, 0x20),
      name: "inner.bin",
      source: [0, 0x20],
      partName: "inner",
    });

    expect(marksFor(inner)).toBeUndefined();
  });
});
