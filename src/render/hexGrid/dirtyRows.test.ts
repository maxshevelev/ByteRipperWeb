import { describe, expect, it } from "vitest";
import { DirtyRows } from "@/render/hexGrid/dirtyRows";

const asPairs = (ranges: readonly { start: number; end: number }[]) =>
  ranges.map((range) => [range.start, range.end]);

describe("marking rows dirty", () => {
  it("merges overlapping and touching runs", () => {
    const dirty = new DirtyRows();
    dirty.invalidate(10, 20);
    dirty.invalidate(15, 25); // overlaps
    expect(asPairs(dirty.all)).toEqual([[10, 25]]);

    dirty.invalidate(25, 30); // touches, so it is the same band
    expect(asPairs(dirty.all)).toEqual([[10, 30]]);

    dirty.invalidate(40, 50); // apart, so it stays apart
    expect(asPairs(dirty.all)).toEqual([
      [10, 30],
      [40, 50],
    ]);
  });

  it("ignores an empty or backwards run", () => {
    const dirty = new DirtyRows();
    dirty.invalidate(10, 10);
    dirty.invalidate(20, 5);
    expect(dirty.isEmpty).toBe(true);
  });

  it("clamps a negative start rather than inventing rows before the file", () => {
    const dirty = new DirtyRows();
    dirty.invalidate(-5, 3);
    expect(asPairs(dirty.all)).toEqual([[0, 3]]);
  });
});

describe("what a draw paints", () => {
  it("is the dirty runs clipped to the viewport", () => {
    const dirty = new DirtyRows();
    dirty.invalidate(0, 5);
    dirty.invalidate(20, 40);

    expect(asPairs(dirty.within(3, 25))).toEqual([
      [3, 5],
      [20, 25],
    ]);
  });

  it("leaves rows outside the viewport dirty", () => {
    // They were never painted. Forgetting them would leave them stale the
    // moment they scroll back in — which is exactly the bug a dirty-region
    // renderer exists to avoid.
    const dirty = new DirtyRows();
    dirty.invalidate(0, 100);

    dirty.clearWithin(10, 20); // the viewport that was just painted
    expect(asPairs(dirty.all)).toEqual([
      [0, 10],
      [20, 100],
    ]);
  });

  it("is empty once everything visible has been painted", () => {
    const dirty = new DirtyRows();
    dirty.invalidate(5, 9);
    dirty.clearWithin(0, 20);
    expect(dirty.isEmpty).toBe(true);
    expect(dirty.within(0, 20)).toEqual([]);
  });

  it("marks one row at a time for a caret moving down a column", () => {
    const dirty = new DirtyRows();
    dirty.invalidateRow(7);
    dirty.invalidateRow(8);
    expect(asPairs(dirty.all)).toEqual([[7, 9]]);
  });
});
