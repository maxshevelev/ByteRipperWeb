/**
 * The outline of a byte span.
 *
 * Ported from the cases `HexView.contour` was written against. The shapes are
 * the point: a span is one region, and the contour has to be its perimeter —
 * anything that draws an edge where the span has no boundary makes a run of
 * rows read as a pile of boxes.
 */

import { describe, expect, it } from "vitest";
import { BYTES_PER_ROW, HexLayout } from "@/render/hexGrid/hexLayout";
import {
  contourRowSpan,
  hexColumns,
  outlinesFolded,
  spanContours,
  textColumns,
} from "@/render/hexGrid/spanContour";

const layout = new HexLayout({ charWidth: 8, rowHeight: 17 });
const columns = hexColumns(layout);
const contour = (start: number, end: number, padding = 2) =>
  spanContours({ start, end, layout, columns, padding });

/** Every distinct y a contour touches, in order. */
const rows = (points: readonly { y: number }[]) =>
  [...new Set(points.map((p) => p.y))].sort((a, b) => a - b);

describe("a span inside one row", () => {
  it("is a single rectangle", () => {
    const [loop, ...rest] = contour(4, 8);
    expect(rest).toEqual([]);
    expect(loop).toHaveLength(4);
    expect(rows(loop ?? [])).toEqual([0, layout.rowHeight]);
  });
});

describe("a span of whole rows", () => {
  it("is one rectangle, not one per row", () => {
    // Three full rows. Outlined row by row this was three boxes with two
    // interior lines through the middle of a single unbroken region.
    const [loop, ...rest] = contour(0, 3 * BYTES_PER_ROW);
    expect(rest).toEqual([]);
    expect(loop).toHaveLength(4);
    expect(rows(loop ?? [])).toEqual([0, 3 * layout.rowHeight]);
  });
});

describe("a span with a partial first and last row", () => {
  it("is one staircase with eight corners", () => {
    // Starts at column 4 of row 0, ends at column 7 of row 2: the left edge
    // steps in at the top, the right edge steps in at the bottom.
    const [loop, ...rest] = contour(4, 2 * BYTES_PER_ROW + 8);
    expect(rest).toEqual([]);
    expect(loop).toHaveLength(8);
    expect(rows(loop ?? [])).toEqual([
      0,
      layout.rowHeight,
      2 * layout.rowHeight,
      3 * layout.rowHeight,
    ]);
  });

  it("has no vertex in the middle of a straight run", () => {
    // When the first row's start column happens to line up with the left edge
    // of the row below, the step has zero width and its two vertices collapse.
    const [loop] = contour(0, 2 * BYTES_PER_ROW + 8);
    // Starting at column 0 makes the left edge straight: a plain six-corner L.
    expect(loop?.length).toBeLessThan(8);
  });
});

// @upstream ByteRipperTests/ActivePaneTests.swift#ActivePaneTests.testMirrorSplitsASpanWhoseRowsShareNoColumn
describe("two rows whose parts share no column", () => {
  it("is two rectangles rather than a loop that crosses back", () => {
    // Row 0 columns 12–15, row 1 columns 0–3. There is no staircase here, and
    // joining them ran a line back across the row boundary, outlining nothing.
    const loops = contour(12, BYTES_PER_ROW + 4);
    expect(loops).toHaveLength(2);
    for (const loop of loops) expect(loop).toHaveLength(4);
    expect(rows(loops[0] ?? [])).toEqual([0, layout.rowHeight]);
    expect(rows(loops[1] ?? [])).toEqual([layout.rowHeight, 2 * layout.rowHeight]);
  });
});

describe("padding", () => {
  it("pads a hex edge only where a spacer already exists", () => {
    const padding = 2;
    const wordSize = layout.wordSize;
    // Column 0 always begins a word, so its left edge may lean outward.
    const [atWordStart] = spanContours({ start: 0, end: 1, layout, columns, padding });
    expect(atWordStart?.[0]?.x).toBe(layout.hexByteX(0) - padding);

    // A column that does not begin a word stays flush, or the stroke would
    // land on the glyph beside it.
    const inside = wordSize > 1 ? 1 : 0;
    if (wordSize > 1) {
      const [mid] = spanContours({ start: inside, end: inside + 1, layout, columns, padding });
      expect(mid?.[0]?.x).toBe(layout.hexByteX(inside));
    }
  });

  it("pads the text column only at its outer edges", () => {
    const padding = 2;
    const text = textColumns(layout);
    const [edge] = spanContours({ start: 0, end: 1, layout, columns: text, padding });
    expect(edge?.[0]?.x).toBe(layout.textX(0) - padding);

    const [middle] = spanContours({ start: 3, end: 4, layout, columns: text, padding });
    expect(middle?.[0]?.x).toBe(layout.textX(3));
  });
});

describe("an empty span", () => {
  it("outlines nothing", () => {
    expect(contour(10, 10)).toEqual([]);
    expect(contour(10, 4)).toEqual([]);
  });
});

describe("the rows a contour touches", () => {
  it("reaches a row past each end of the span", () => {
    // The stroke is centred on the row boundaries the horizontal edges sit on,
    // so half of it lands in the row beyond. Repainting only the span's own
    // rows left that half behind as a line under rows that no longer had one.
    const span = contourRowSpan(2 * BYTES_PER_ROW + 4, 5 * BYTES_PER_ROW + 4);
    expect(span).toEqual({ first: 1, end: 7 });
  });

  it("does not reach above the first row", () => {
    expect(contourRowSpan(0, 4)).toEqual({ first: 0, end: 2 });
  });

  it("touches nothing for an empty span", () => {
    expect(contourRowSpan(10, 10)).toEqual({ first: 0, end: 0 });
    expect(contourRowSpan(10, 2)).toEqual({ first: 0, end: 0 });
  });

  it("covers every row the contour actually draws into", () => {
    // The guard in the renderer and the invalidation both come from here, so
    // the property that matters is that the range contains the span's own rows
    // with a margin on each side.
    for (const [start, end] of [
      [0, 1],
      [15, 17],
      [BYTES_PER_ROW, 3 * BYTES_PER_ROW],
      [100, 1000],
    ] as const) {
      const span = contourRowSpan(start, end);
      expect(span.first).toBeLessThanOrEqual(Math.floor(start / BYTES_PER_ROW));
      expect(span.end).toBeGreaterThan(Math.floor((end - 1) / BYTES_PER_ROW) + 1);
    }
  });
});

/**
 * A note's dashed outline over a large stretch of the dump: drawn from the part near the rows being
 * painted, so a scroll over a note of megabytes costs what a scroll over a small one does — and the
 * dashes still stand still while it scrolls.
 *
 * @upstream ByteRipperTests/NoteOutlineTests.swift#NoteOutlineTests
 */
describe("folding a note's outline", () => {
  const band = { top: 1000, bottom: 1200 };

  // A tall rectangle is brought in to just outside the band, by whole dash periods, and what
  // lies in the band is left where it was.
  // @upstream ByteRipperTests/NoteOutlineTests.swift#NoteOutlineTests.testATallOutlineIsBroughtInByWholePeriods
  it("brings a tall outline in by whole periods", () => {
    const loop = [
      { x: 10, y: -10_000 },
      { x: 90, y: -10_000 },
      { x: 90, y: 50_000 },
      { x: 10, y: 50_000 },
    ];
    const folded = outlinesFolded([loop], band, 7)[0] ?? [];
    loop.forEach((before, index) => {
      const after = folded[index] ?? { x: Number.NaN, y: Number.NaN };
      expect(after.x, "only heights move").toBe(before.x);
      expect(Math.abs(after.y - before.y) % 7, "by whole periods").toBe(0);
      expect(after.y >= band.top && after.y <= band.bottom, "the corners stay outside").toBe(false);
    });
    expect(folded[0]?.y ?? 0, "no more than a period above it").toBeGreaterThan(band.top - 7);
    expect(folded[2]?.y ?? 0, "and no more than a period below").toBeLessThan(band.bottom + 7);
  });

  // An outline whose corners already lie within a period of the band is not touched.
  // @upstream ByteRipperTests/NoteOutlineTests.swift#NoteOutlineTests.testANearbyOutlineIsLeftAlone
  it("leaves a nearby outline alone", () => {
    const loop = [
      { x: 10, y: 995 },
      { x: 90, y: 995 },
      { x: 90, y: 1205 },
      { x: 10, y: 1205 },
    ];
    expect(outlinesFolded([loop], band, 7)[0]).toEqual(loop);
  });

  // A staircase — a note starting and ending mid-row — keeps its steps: the corners above the band
  // move together, so their row's height between them is kept.
  // @upstream ByteRipperTests/NoteOutlineTests.swift#NoteOutlineTests.testAStaircaseKeepsItsSteps
  it("keeps a staircase's steps", () => {
    const loop = [
      { x: 40, y: -5000 },
      { x: 90, y: -5000 },
      { x: 90, y: 40_000 },
      { x: 60, y: 40_000 },
      { x: 60, y: 40_016 },
      { x: 10, y: 40_016 },
      { x: 10, y: -4984 },
      { x: 40, y: -4984 },
    ];
    const folded = outlinesFolded([loop], band, 7)[0] ?? [];
    expect((folded[7]?.y ?? 0) - (folded[0]?.y ?? 0), "the first row's step").toBe(16);
    expect((folded[4]?.y ?? 0) - (folded[3]?.y ?? 0), "and the last row's").toBe(16);
  });
});
