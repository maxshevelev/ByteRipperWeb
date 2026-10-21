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
  type ContourPoint,
  contourNear,
  contourRowSpan,
  hexColumns,
  outlinesFolded,
  spanContours,
  startingOnAHorizontalEdge,
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
 * A note's dashed outline over a large stretch of the dump: drawn from the part
 * near the row being painted, so a scroll over a note of megabytes costs what a
 * scroll over a small one does — and the dashes still stand still while it
 * scrolls. Upstream's `NoteOutlineTests`, the folding half.
 */
describe("folding a note's outline", () => {
  const p = (x: number, y: number): ContourPoint => ({ x, y });
  const band = { lower: 1000, upper: 1200 };

  // @upstream ByteRipperTests/NoteOutlineTests.swift#NoteOutlineTests.testATallOutlineIsBroughtInByWholePeriods
  it("brings a tall outline in to just outside the band, by whole periods", () => {
    const loop = [p(10, -10_000), p(90, -10_000), p(90, 50_000), p(10, 50_000)];
    const folded = outlinesFolded([loop], band, 7)[0] ?? [];
    loop.forEach((before, i) => {
      const after = folded[i] ?? p(Number.NaN, Number.NaN);
      expect(after.x).toBe(before.x);
      const moved = Math.abs(after.y - before.y);
      expect(moved % 7).toBeCloseTo(0, 3);
      expect(after.y >= band.lower && after.y <= band.upper).toBe(false);
    });
    expect(folded[0]?.y ?? 0).toBeGreaterThan(band.lower - 7);
    expect(folded[2]?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(band.upper + 7);
  });

  // @upstream ByteRipperTests/NoteOutlineTests.swift#NoteOutlineTests.testANearbyOutlineIsLeftAlone
  it("leaves an outline whose corners are already within a period alone", () => {
    const loop = [p(10, 995), p(90, 995), p(90, 1205), p(10, 1205)];
    expect(outlinesFolded([loop], band, 7)[0]).toEqual(loop);
  });

  // @upstream ByteRipperTests/NoteOutlineTests.swift#NoteOutlineTests.testAStaircaseKeepsItsSteps
  it("keeps a staircase's steps: the corners beyond the band move together", () => {
    const loop = [
      p(40, -5000),
      p(90, -5000),
      p(90, 40_000),
      p(60, 40_000),
      p(60, 40_016),
      p(10, 40_016),
      p(10, -4984),
      p(40, -4984),
    ];
    const folded = outlinesFolded([loop], band, 7)[0] ?? [];
    expect((folded[7]?.y ?? 0) - (folded[0]?.y ?? 0)).toBe(16);
    expect((folded[4]?.y ?? 0) - (folded[3]?.y ?? 0)).toBe(16);
  });

  /**
   * The length of path from where the trace starts — halfway along the edge
   * that closes the loop — to each vertex. The dash phase at a point is this
   * length, modulo the period.
   */
  const lengths = (loop: readonly ContourPoint[]): number[] => {
    const count = loop.length;
    const last = loop[count - 1] ?? p(0, 0);
    const first = loop[0] ?? p(0, 0);
    let run = Math.hypot(first.x - last.x, first.y - last.y) / 2;
    const out = [run];
    for (let i = 1; i < count; i++) {
      const a = loop[i - 1] ?? p(0, 0);
      const b = loop[i] ?? p(0, 0);
      run += Math.hypot(b.x - a.x, b.y - a.y);
      out.push(run);
    }
    return out;
  };

  // @upstream ByteRipperTests/NoteOutlineTests.swift#NoteOutlineTests.testTheDashesStandStillWhateverIsRepainted
  // @upstream-differs checked as path lengths, the quantity the dash phase is, rather than by rendering pixels: the test runner has no canvas
  it("keeps the dash phase at every corner inside the band, once the trace starts on a horizontal edge", () => {
    const span = spanContours({ start: 0x13, end: 0x40_0007, layout, columns, padding: 2 });
    const middle = 0x20_0000 / BYTES_PER_ROW;
    const near = {
      lower: (middle - 2.5) * layout.rowHeight,
      upper: (middle + 3.5) * layout.rowHeight,
    };
    for (const loop of span.map(startingOnAHorizontalEdge)) {
      const folded = outlinesFolded([loop], near, 7)[0] ?? [];
      const before = lengths(loop);
      const after = lengths(folded);
      loop.forEach((point, i) => {
        const shift = (before[i] ?? 0) - (after[i] ?? 0);
        expect(Math.abs(shift % 7) < 1e-6 || Math.abs((shift % 7) - 7) < 1e-6).toBe(true);
        if (point.y >= near.lower && point.y <= near.upper) expect(folded[i]).toEqual(point);
      });
      expect(
        Math.max(...folded.map((one) => one.y)) - Math.min(...folded.map((one) => one.y))
      ).toBeLessThan(
        // A period either side, and the first and last rows' steps kept whole.
        near.upper - near.lower + 2 * (7 + layout.rowHeight)
      );
    }
  });

  // @web-only the turn that makes the fold safe to dash
  it("turns a contour so that the edge closing it is horizontal", () => {
    const [loop] = contour(4, 40);
    const turned = startingOnAHorizontalEdge(loop ?? []);
    expect(turned).toHaveLength(loop?.length ?? 0);
    expect(turned[turned.length - 1]?.y).toBe(turned[0]?.y);
  });
});

describe("the pointer on a contour", () => {
  // @web-only the distance rule HexView.noteContour asks of a stroked path, said over the polygon
  it("answers within the reach either side of the line, and nowhere else", () => {
    const square = [
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 50 },
        { x: 0, y: 50 },
      ],
    ];
    expect(contourNear(square, 50, 3, 4)).toBe(true);
    expect(contourNear(square, 50, -3, 4)).toBe(true);
    expect(contourNear(square, 50, 25, 4)).toBe(false);
    expect(contourNear(square, 104, 25, 4)).toBe(true);
    expect(contourNear(square, 105, 25, 4)).toBe(false);
  });
});
