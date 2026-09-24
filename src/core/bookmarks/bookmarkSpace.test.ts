import { describe, expect, it } from "vitest";
import { BookmarkSpace } from "@/core/bookmarks/bookmarkSpace";
import { BookmarkStore } from "@/core/bookmarks/bookmarkStore";
import { BYTES_PER_ROW } from "@/core/document/rowWidth";

/**
 * §20.7 — one bookmark list for the workspace's dump and the fragment panels
 * opened out of it, read in each place at that place's own offsets.
 *
 * A mark is a row of a file, so a panel showing the part of that file at
 * `0x1F000` shows the mark on `0x1F400` at `0x400`, and a mark made there on
 * `0x400` is a mark on `0x1F400` in the dump. A decompressed body is the
 * exception: its bytes are not the file's bytes, so it reads no list, adds to
 * none, and says so where a list would be offered.
 *
 * Ported from upstream's `BookmarkSpaceTests`; the cases that drive a panel in
 * the running app live beside the state they drive.
 */

describe("the arithmetic", () => {
  // A pane showing a file whole reads the list as it is.
  // @upstream ByteRipperTests/BookmarkSpaceTests.swift#BookmarkSpaceTests.testASpaceAtZeroIsTheListItself
  it("is the list itself at origin zero", () => {
    const store = new BookmarkStore();
    const space = new BookmarkSpace(store);
    store.add(0x120, "ME");

    expect(space.isShifted).toBe(false);
    expect(space.bookmarks).toEqual([{ row: 0x120, name: "ME" }]);
    expect(space.storeRowOf(0x125)).toBe(0x120);
    expect(space.localRowOf(0x120)).toBe(0x120);
  });

  // A shifted space is the same list at the part's addresses, both ways round —
  // and the marks it carries are the marks the list carries.
  // @upstream ByteRipperTests/BookmarkSpaceTests.swift#BookmarkSpaceTests.testAShiftedSpaceTranslatesBothWays
  it("translates both ways when shifted", () => {
    const store = new BookmarkStore();
    const space = new BookmarkSpace(store, 0x1_f000);

    space.add(0x400, "header");

    expect(space.isShifted).toBe(true);
    // The list has it at the file's address, and the panel at the part's.
    expect(store.bookmarks).toEqual([{ row: 0x1_f400, name: "header" }]);
    expect(space.bookmarks).toEqual([{ row: 0x400, name: "header" }]);
    expect(space.at(0x40b)?.row).toBe(0x400);
  });

  // A mark on a row the part does not cover is not a mark in the part. It stays
  // in the list either way — the panel is a window onto it, not a copy of it.
  // @upstream ByteRipperTests/BookmarkSpaceTests.swift#BookmarkSpaceTests.testMarksBeforeThePartAreNotInIt
  it("leaves out the marks that fall before the part", () => {
    const store = new BookmarkStore();
    const space = new BookmarkSpace(store, 0x1_f000);
    store.add(0x10, "above");
    store.add(0x1_f010, "inside");

    expect(space.bookmarks).toEqual([{ row: 0x10, name: "inside" }]);
    expect(space.localRowOf(0x10)).toBeUndefined();
  });

  // A part need not begin on a row boundary, and a mark made in one that does
  // not must read back on the row it was made on. That is what the round *up*
  // into the list's grid is for: rounding both ways down sent the mark one row
  // up the moment it was looked at.
  // @upstream ByteRipperTests/BookmarkSpaceTests.swift#BookmarkSpaceTests.testAnUnalignedPartKeepsAMarkOnTheRowItWasMadeOn
  it("keeps a mark on the row it was made on in an unaligned part", () => {
    const space = new BookmarkSpace(new BookmarkStore(), 0x108);

    for (const local of [0, 0x20, 0x30, 0x400]) {
      const stored = space.storeRowOf(local);
      expect(stored % BYTES_PER_ROW).toBe(0);
      expect(space.localRowOf(stored)).toBe(local);
    }
  });

  // Two of the panel's rows never land on one row of the list, however the part
  // is aligned — a mark made on one row can never swallow another.
  // @upstream ByteRipperTests/BookmarkSpaceTests.swift#BookmarkSpaceTests.testEachPanelRowHasAListRowOfItsOwn
  it("gives each panel row a list row of its own", () => {
    const space = new BookmarkSpace(new BookmarkStore(), 0x108);
    const rows = [0, 1, 2, 3, 4, 5, 6, 7].map((index) => space.storeRowOf(index * 16));

    expect(new Set(rows).size).toBe(rows.length);
  });

  // The per-range question the dump's drawing asks, answered in the panel's
  // offsets — including for the file's last, part-full row.
  // @upstream ByteRipperTests/BookmarkSpaceTests.swift#BookmarkSpaceTests.testRowsInRangeAnswerInThePanesOffsets
  it("answers a range in the pane's offsets", () => {
    const store = new BookmarkStore();
    const space = new BookmarkSpace(store, 0x1_f000);
    store.add(0x1_f000);
    store.add(0x1_f020);
    store.add(0x1_f100);

    expect(space.rowsIn(0, 0x30)).toEqual(new Set([0, 0x20]));
    // The last drawn row brings its mark even where the file stops mid-row.
    expect(space.rowsIn(0, 0x2a)).toEqual(new Set([0, 0x20]));
    expect(space.rowsIn(0x30, 0x110)).toEqual(new Set([0x100]));
  });

  // Dragging a mark is the store's decision, taken in the list's offsets and
  // answered in the panel's (§20.6).
  // @upstream ByteRipperTests/BookmarkSpaceTests.swift#BookmarkSpaceTests.testADragLandsInThePanesOffsets
  it("lands a drag in the pane's offsets", () => {
    const store = new BookmarkStore();
    const space = new BookmarkSpace(store, 0x1_f000);
    space.add(0x20, "moved");

    expect(space.move(0x20, 0x50, 0x90)).toBe(0x50);
    expect(store.bookmarks).toEqual([{ row: 0x1_f050, name: "moved" }]);
  });
});
