/**
 * Ported from `BookmarkTests.swift` and the model half of
 * `BookmarkDragTests.swift`.
 *
 * The move rule is the part worth pinning down: one row holds one bookmark, so
 * dragging a mark onto an occupied row has to do *something*, and which
 * something is the difference between marks sliding past each other and marks
 * swallowing each other.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  type Bookmark,
  BookmarkStore,
  bookmarkDisplayName,
  normalizeBookmarkName,
  rowContaining,
} from "@/core/bookmarks/bookmarkStore";
import { BYTES_PER_ROW } from "@/core/document/rowWidth";

const ROW = BYTES_PER_ROW;
let store: BookmarkStore;

beforeEach(() => {
  store = new BookmarkStore();
});

/** The rows carrying a mark, in order. */
const rows = (of: BookmarkStore = store) => of.bookmarks.map((mark) => mark.row);

describe("a bookmark marks a row, not a byte", () => {
  it("snaps an offset to its row's start", () => {
    expect(rowContaining(0)).toBe(0);
    expect(rowContaining(ROW - 1)).toBe(0);
    expect(rowContaining(ROW)).toBe(ROW);
    expect(rowContaining(ROW * 3 + 7)).toBe(ROW * 3);
  });

  it("makes two offsets in one row one bookmark", () => {
    store.add(4);
    store.add(9);
    expect(rows()).toEqual([0]);
  });
});

describe("adding, naming and removing", () => {
  it("toggles a mark on and off", () => {
    expect(store.toggle(ROW * 2)).toEqual({ row: ROW * 2, name: "" });
    expect(rows()).toEqual([ROW * 2]);
    expect(store.toggle(ROW * 2 + 3)).toBeUndefined();
    expect(rows()).toEqual([]);
  });

  it("names an unmarked row and renames a marked one", () => {
    expect(store.add(ROW, "first").name).toBe("first");
    expect(store.add(ROW, "second").name).toBe("second");
    expect(rows()).toEqual([ROW]);
  });

  it("stores a name trimmed, and treats whitespace as unnamed", () => {
    expect(normalizeBookmarkName("  header  ")).toBe("header");
    expect(store.add(0, "  header  ").name).toBe("header");
    expect(store.add(ROW, "   ").name).toBe("");
  });

  it("renames only a row that carries a mark", () => {
    expect(store.rename(0, "nope")).toBeUndefined();
    store.add(0);
    expect(store.rename(0, "yes")?.name).toBe("yes");
  });

  it("reports whether there was a mark to remove", () => {
    expect(store.remove(0)).toBe(false);
    store.add(0);
    expect(store.remove(7)).toBe(true);
  });

  it("calls an unnamed bookmark by where it is", () => {
    expect(bookmarkDisplayName({ row: 0x1234, name: "" })).toBe("00001234");
    expect(bookmarkDisplayName({ row: 0x1234, name: "vector table" })).toBe("vector table");
  });

  it("keeps the list sorted by row", () => {
    for (const row of [ROW * 5, 0, ROW * 2, ROW * 9]) store.add(row);
    expect(rows()).toEqual([0, ROW * 2, ROW * 5, ROW * 9]);
  });

  it("reports the row that changed, not a bare signal", () => {
    const changed: number[] = [];
    store.onChange = (row) => changed.push(row);
    store.add(ROW * 3 + 2);
    store.rename(ROW * 3, "x");
    store.remove(ROW * 3);
    expect(changed).toEqual([ROW * 3, ROW * 3, ROW * 3]);
  });

  it("seeds without reporting anything", () => {
    let reported = 0;
    store.onChange = () => reported++;
    store.seed([
      { row: ROW * 4, name: "b" },
      { row: 0, name: "a" },
    ]);
    expect(rows()).toEqual([0, ROW * 4]);
    expect(reported).toBe(0);
  });

  it("lists the marked rows in a range", () => {
    for (const row of [0, ROW * 2, ROW * 6]) store.add(row);
    expect([...store.rowsIn(ROW, ROW * 6)].sort((a, b) => a - b)).toEqual([ROW * 2]);
  });
});

describe("dragging a mark", () => {
  /** Upstream's own fixtures, offsets and all. */
  const marked = (rows: readonly number[]) => {
    const made = new BookmarkStore();
    for (const row of rows) made.add(row);
    return made;
  };

  it("carries the name and reports where it landed", () => {
    store.add(0x10, "EC table");
    const changed: number[] = [];
    store.onChange = (row) => changed.push(row);

    expect(store.move(0x10, 0x40, 0x100)).toBe(0x40);
    expect(store.bookmarks).toEqual<Bookmark[]>([{ row: 0x40, name: "EC table" }]);
    // Both rows repaint: the one it left and the one it landed on.
    expect(changed).toEqual([0x10, 0x40]);
  });

  it("snaps to the target row", () => {
    // The drag reports whatever offset the pointer is over.
    expect(marked([0]).move(0x8, 0x4b, 0x100)).toBe(0x40);
  });

  it("jumps past a marked row, and past a whole run of them", () => {
    const one = marked([0x00, 0x20]);
    expect(one.move(0x00, 0x20, 0x100)).toBe(0x30);
    expect(one.bookmarks.map((mark) => mark.row)).toEqual([0x20, 0x30]);

    const run = marked([0x00, 0x20, 0x30, 0x40]);
    expect(run.move(0x00, 0x20, 0x100)).toBe(0x50);
    expect(run.bookmarks.map((mark) => mark.row)).toEqual([0x20, 0x30, 0x40, 0x50]);
  });

  it("jumps a marked row going up", () => {
    const up = marked([0x10, 0x40]);
    expect(up.move(0x40, 0x10, 0x100)).toBe(0x00);
    expect(up.bookmarks.map((mark) => mark.row)).toEqual([0x00, 0x10]);
  });

  it("stops before an obstacle with nowhere to jump to", () => {
    // Occupied to the end of the file: the mark travels as far as the pointer
    // took it rather than leaving the file or swallowing what is in its way.
    const blocked = marked([0x00, 0x20, 0x30]);
    expect(blocked.move(0x00, 0x20, 0x30)).toBe(0x10);
    expect(blocked.bookmarks.map((mark) => mark.row)).toEqual([0x10, 0x20, 0x30]);
  });

  it("stops before the obstacle going up", () => {
    const blocked = marked([0x00, 0x10, 0x30]);
    expect(blocked.move(0x30, 0x10, 0x100)).toBe(0x20);
    expect(blocked.bookmarks.map((mark) => mark.row)).toEqual([0x00, 0x10, 0x20]);
  });

  it("stays put when the obstacle leaves no room at all", () => {
    // 0x10 is taken, 0x00 above it is taken, and there is no row between 0x10
    // and the mark's own 0x20 to stop on.
    const boxed = marked([0x00, 0x10, 0x20]);
    expect(boxed.move(0x20, 0x10, 0x100)).toBeUndefined();
    expect(boxed.bookmarks.map((mark) => mark.row)).toEqual([0x00, 0x10, 0x20]);
  });

  it("clamps a target past the last row the pane draws", () => {
    expect(marked([0x00]).move(0x00, 0x9000, 0x70)).toBe(0x70);
  });

  it("reports nothing for moving nothing, or moving nowhere", () => {
    const one = marked([0x20]);
    expect(one.move(0x00, 0x40, 0x100)).toBeUndefined();
    // 0x2F is the same row the mark is already on.
    expect(one.move(0x20, 0x2f, 0x100)).toBeUndefined();
  });
});

describe("the edit dialog's change", () => {
  it("moves and renames in one step, never losing the name in between", () => {
    store.add(ROW, "old");
    const seen: Bookmark[][] = [];
    store.onChange = () => seen.push(store.bookmarks.map((mark) => ({ ...mark })));
    expect(store.edit(ROW, ROW * 5, "new")).toEqual({ row: ROW * 5, name: "new" });
    // It is never in the list unnamed: the only states seen are "gone" and
    // "there, named".
    for (const snapshot of seen) {
      for (const mark of snapshot) expect(mark.name).toBe("new");
    }
  });

  it("renames in place when the row does not change", () => {
    store.add(ROW, "old");
    expect(store.edit(ROW + 3, ROW, "new")).toEqual({ row: ROW, name: "new" });
    expect(rows()).toEqual([ROW]);
  });

  it("does nothing for a row that carries no mark", () => {
    expect(store.edit(0, ROW, "x")).toBeUndefined();
  });
});
