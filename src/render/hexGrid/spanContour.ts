/**
 * The closed outline of a byte span across the grid.
 *
 * A span of bytes is a *shape*, not a stack of rows: it starts partway along
 * one row, runs full width through the middle, and stops partway along another.
 * Outlining it row by row draws interior lines that are not edges of anything —
 * the span reads as a pile of separate boxes instead of one region.
 *
 * Ported from `HexView.contour(of:layout:x:width:padLeft:padRight:)`. Kept
 * apart from the renderer because it is the single source of contour geometry:
 * the companion's mirrored selection uses it now, and segments and zones will
 * want the same outline over their own spans.
 */

import { BYTES_PER_ROW, type HexLayout } from "@/render/hexGrid/hexLayout";

export interface ContourPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * How one column region lays its cells out, and where its edges may be padded.
 *
 * A vertical edge sits `padding` outside the cells only where a spacer already
 * exists — a word boundary in the hex column, the outer edges of the text
 * column. Padding an edge that runs through the middle of a word would push the
 * stroke onto the neighbouring glyph, so those edges stay flush.
 */
export interface ContourColumns {
  /** The x of a column's cell. */
  readonly x: (column: number) => number;
  readonly width: number;
  readonly padLeft: (column: number) => boolean;
  readonly padRight: (column: number) => boolean;
}

/** The hex column: padded at word boundaries, where a spacer already exists. */
export function hexColumns(layout: HexLayout): ContourColumns {
  const wordSize = layout.wordSize;
  return {
    x: (column) => layout.hexByteX(column),
    width: layout.hexByteWidth,
    padLeft: (column) => column % wordSize === 0,
    padRight: (column) => (column + 1) % wordSize === 0,
  };
}

/** The decoded-text column: padded only at its outer edges. */
export function textColumns(layout: HexLayout): ContourColumns {
  return {
    x: (column) => layout.textX(column),
    width: layout.charWidth,
    padLeft: (column) => column === 0,
    padRight: (column) => column === BYTES_PER_ROW - 1,
  };
}

/**
 * The closed contours of `[start, end)` in one column region.
 *
 * Usually one loop. Two only where the span's parts share no column — a span
 * that starts in the right of one row and ends in the left of the next — where
 * there is no staircase to trace and joining them would draw a line back across
 * the row boundary, outlining nothing.
 */
export function spanContours(options: {
  readonly start: number;
  readonly end: number;
  readonly layout: HexLayout;
  readonly columns: ContourColumns;
  /** How far outside the cells a padded edge sits. */
  readonly padding: number;
}): ContourPoint[][] {
  const { start, end, layout, columns, padding } = options;
  if (end <= start) return [];

  const left = (column: number) => columns.x(column) - (columns.padLeft(column) ? padding : 0);
  const right = (column: number) =>
    columns.x(column) + columns.width + (columns.padRight(column) ? padding : 0);

  const firstRow = Math.floor(start / BYTES_PER_ROW);
  const lastRow = Math.floor((end - 1) / BYTES_PER_ROW);
  const firstColumn = start % BYTES_PER_ROW;
  const lastColumn = (end - 1) % BYTES_PER_ROW;
  const topY = layout.rowFrame(firstRow).y;
  const bottomY = layout.rowFrame(lastRow).y + layout.rowHeight;
  const last = BYTES_PER_ROW - 1;

  if (firstRow === lastRow || (firstColumn === 0 && lastColumn === last)) {
    // A single row, or several full-width rows: a plain rectangle.
    return [
      deduplicated([
        { x: left(firstColumn), y: topY },
        { x: right(lastColumn), y: topY },
        { x: right(lastColumn), y: bottomY },
        { x: left(firstColumn), y: bottomY },
      ]),
    ];
  }

  const firstBottomY = layout.rowFrame(firstRow).y + layout.rowHeight;
  const lastTopY = layout.rowFrame(lastRow).y;

  if (firstRow + 1 === lastRow && lastColumn < firstColumn) {
    // Two rows whose parts share no column. There is no staircase to trace:
    // joining them ran a line back across the row boundary between them, which
    // outlined nothing at all.
    return [
      deduplicated([
        { x: left(firstColumn), y: topY },
        { x: right(last), y: topY },
        { x: right(last), y: firstBottomY },
        { x: left(firstColumn), y: firstBottomY },
      ]),
      deduplicated([
        { x: left(0), y: lastTopY },
        { x: right(lastColumn), y: lastTopY },
        { x: right(lastColumn), y: bottomY },
        { x: left(0), y: bottomY },
      ]),
    ];
  }

  // Several rows with a partial first or last row: the right edge steps in at
  // the last row, the left edge steps in at the first.
  return [
    deduplicated([
      { x: left(firstColumn), y: topY },
      { x: right(last), y: topY },
      { x: right(last), y: lastTopY },
      { x: right(lastColumn), y: lastTopY },
      { x: right(lastColumn), y: bottomY },
      { x: left(0), y: bottomY },
      { x: left(0), y: firstBottomY },
      { x: left(firstColumn), y: firstBottomY },
    ]),
  ];
}

/** Both column regions' contours for one span — what a mirrored selection is. */
export function selectionContours(
  start: number,
  end: number,
  layout: HexLayout,
  padding: number
): ContourPoint[][] {
  return [
    ...spanContours({ start, end, layout, columns: hexColumns(layout), padding }),
    ...spanContours({ start, end, layout, columns: textColumns(layout), padding }),
  ];
}

/**
 * The rows a contour over `[start, end)` touches, half-open.
 *
 * One row wider at each end than the span itself. The contour's horizontal
 * edges sit *on* row boundaries and the stroke is centred on them, so half of
 * it lands in the neighbouring row — and a padded vertical edge leans out
 * sideways there too. Invalidating only the span's own rows leaves that half
 * behind when the span moves, as a line under rows that no longer have one.
 *
 * Anything that outlines a span and repaints by row — the companion's mirror
 * now, segments and zones later — has to invalidate through here.
 */
export function contourRowSpan(
  start: number,
  end: number
): { readonly first: number; readonly end: number } {
  if (end <= start) return { first: 0, end: 0 };
  const firstRow = Math.floor(start / BYTES_PER_ROW);
  const lastRow = Math.floor((end - 1) / BYTES_PER_ROW);
  return { first: Math.max(0, firstRow - 1), end: lastRow + 2 };
}

/**
 * Drops vertices that are not corners, so the polygon stays minimal.
 *
 * A step of zero width or height collapses two vertices onto each other, and
 * the survivor then has collinear edges either side — it marks no corner, and
 * left in place it would put a rounded join in the middle of a straight run.
 */
function deduplicated(points: readonly ContourPoint[]): ContourPoint[] {
  const compact: ContourPoint[] = [];
  for (const point of points) {
    const previous = compact[compact.length - 1];
    if (previous !== undefined && previous.x === point.x && previous.y === point.y) continue;
    compact.push(point);
  }
  const count = compact.length;
  if (count <= 2) return compact;

  const result: ContourPoint[] = [];
  for (let i = 0; i < count; i++) {
    const previous = compact[(i - 1 + count) % count];
    const current = compact[i];
    const next = compact[(i + 1) % count];
    if (previous === undefined || current === undefined || next === undefined) continue;
    if (!isStraightThrough(previous, current, next)) result.push(current);
  }
  return result;
}

/** Whether `mid` lies on a straight run between its neighbours. */
function isStraightThrough(previous: ContourPoint, mid: ContourPoint, next: ContourPoint): boolean {
  const inX = mid.x - previous.x;
  const inY = mid.y - previous.y;
  const outX = next.x - mid.x;
  const outY = next.y - mid.y;
  const lengthIn = Math.hypot(inX, inY);
  const lengthOut = Math.hypot(outX, outY);
  if (lengthIn === 0 || lengthOut === 0) return false;
  // The contour's edges are exactly horizontal or vertical, so the dot product
  // is exactly 1 along a straight run; a corner is perpendicular or reversed.
  return (inX * outX + inY * outY) / (lengthIn * lengthOut) > 0.999;
}

/**
 * Traces a closed rectilinear polygon with rounded corners.
 *
 * Each corner is an arc between the midpoints of its two edges, which is what
 * keeps a short edge — the one-cell step of a staircase — from being rounded
 * away entirely: `arcTo` clamps the radius to what the edge can give.
 */
export function traceContour(
  context: CanvasRenderingContext2D,
  points: readonly ContourPoint[],
  radius: number
): void {
  if (points.length < 2) return;
  const midpoint = (a: ContourPoint, b: ContourPoint) => ({
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  });

  const count = points.length;
  const firstPoint = points[0];
  const lastPoint = points[count - 1];
  if (firstPoint === undefined || lastPoint === undefined) return;

  const startAt = midpoint(lastPoint, firstPoint);
  context.moveTo(startAt.x, startAt.y);
  for (let i = 0; i < count; i++) {
    const corner = points[i];
    const following = points[(i + 1) % count];
    if (corner === undefined || following === undefined) continue;
    const to = midpoint(corner, following);
    context.arcTo(corner.x, corner.y, to.x, to.y, radius);
  }
  context.closePath();
}
