/**
 * The overview's byte↔cell mapping: which row, and which of that row's 16
 * cells, a byte offset falls in when `rowCount` pixel rows cover `extent`
 * bytes.
 *
 * Pure arithmetic, shared rather than repeated: the density picture, the
 * modified and difference bits, and the search's match bits must land on the
 * same cells, or the map would contradict itself.
 *
 * Ported from `ByteRipperApp/Minimap/OverviewBinning.swift`. Two changes at the
 * boundary. Upstream's row ranges are `ClosedRange<Int>`; here they are
 * half-open like every other range in this codebase, so an inclusive
 * `rows.upperBound` upstream reads as `rows.to - 1` below. And upstream's
 * arithmetic is `UInt64` throughout, where this has doubles — see
 * {@link mulDiv}.
 */

/** The dump's row width, and the map's. */
export const MINIMAP_COLUMNS = 16;

/** A half-open span of the picture's pixel rows. */
export interface RowRange {
  readonly from: number;
  /** One past the last row. */
  readonly to: number;
}

/** The row and the cells one offset occupies there. */
export interface Cells {
  readonly row: number;
  readonly firstColumn: number;
  /** Inclusive: a byte thinner than a row's cells spans several of them. */
  readonly lastColumn: number;
}

/**
 * `floor(a * b / c)`, exactly, for non-negative integers.
 *
 * Upstream does this in `UInt64` and never has to think about it. A double
 * holds every integer below 2^53, which covers any offset this application
 * admits (D3) — but not always their *product*: a 1 TB extent times a few
 * thousand rows is past it, and the rounding would put a byte in the wrong row.
 * That case takes the slow path rather than being ruled out by a comment.
 */
function mulDiv(a: number, b: number, c: number): number {
  if (c === 0) return 0;
  const product = a * b;
  if (product <= Number.MAX_SAFE_INTEGER) return Math.floor(product / c);
  return Number((BigInt(a) * BigInt(b)) / BigInt(c));
}

export class OverviewBinning {
  /** The extent the rows are binned over — the longest open file. */
  readonly extent: number;
  readonly rowCount: number;

  constructor(extent: number, rowCount: number) {
    this.extent = extent;
    this.rowCount = rowCount;
  }

  /**
   * The first byte of a row's slice of the file. `row === rowCount` gives the
   * extent, so a row's slice is `startOfRow(row)` up to `startOfRow(row + 1)`.
   */
  startOfRow(row: number): number {
    if (this.rowCount <= 0) return 0;
    return mulDiv(this.extent, row, this.rowCount);
  }

  /**
   * The cells one byte of a row's slice occupies, when the slice is thinner
   * than the row's 16 cells: the byte is stretched over the cells it covers, so
   * index 0 of a one-byte slice fills the row.
   *
   * A row covers fewer bytes than it has cells whenever the file is smaller
   * than 16 bytes per pixel row — under ~25 KB on a full-height panel — and
   * covers a *fraction* of a byte once the file is smaller than the panel has
   * rows. Slicing per cell there gave every cell but the last an empty byte
   * range: the picture came out a pale field with the whole file collapsed into
   * a stripe down its right edge.
   */
  stretchedColumns(index: number, span: number): readonly [number, number] {
    const effective = Math.max(span, 1);
    const clamped = Math.min(index, effective - 1);
    const first = mulDiv(clamped, MINIMAP_COLUMNS, effective);
    const last = mulDiv(clamped + 1, MINIMAP_COLUMNS, effective) - 1;
    return [first, Math.max(first, Math.min(MINIMAP_COLUMNS - 1, last))];
  }

  /**
   * The row a byte offset falls in and the cells it occupies there, or
   * `undefined` when the offset is past the extent or its row is outside
   * `rows`.
   */
  cells(offset: number, rows: RowRange): Cells | undefined {
    if (this.rowCount <= 0 || this.extent <= 0 || offset >= this.extent) return undefined;
    const row = mulDiv(offset, this.rowCount, this.extent);
    if (row < rows.from || row >= rows.to) return undefined;

    const rowStart = this.startOfRow(row);
    const span = this.startOfRow(row + 1) - rowStart;
    if (span < MINIMAP_COLUMNS) {
      const index = offset > rowStart ? offset - rowStart : 0;
      const [firstColumn, lastColumn] = this.stretchedColumns(index, span);
      return { row, firstColumn, lastColumn };
    }
    const column = Math.min(MINIMAP_COLUMNS - 1, mulDiv(offset - rowStart, MINIMAP_COLUMNS, span));
    return { row, firstColumn: column, lastColumn: column };
  }

  /**
   * Sets the bit of every cell a byte range touches, for the rows in `rows`.
   * `bits` holds one 16-bit word per row of `rows`, indexed from its start —
   * the shape the modified, difference and match masks all use.
   *
   * A range spanning whole rows fills them, so a difference or a run of matches
   * reads as a band rather than as two end marks.
   */
  mark(start: number, end: number, rows: RowRange, bits: Uint16Array): void {
    const lower = Math.max(start, this.startOfRow(rows.from));
    const upper = Math.min(end, Math.min(this.startOfRow(rows.to), this.extent));
    if (lower >= upper) return;

    const first = this.cells(lower, rows);
    const last = this.cells(upper - 1, rows);
    if (first === undefined || last === undefined) return;

    const set = (row: number, from: number, to: number) => {
      const index = row - rows.from;
      if (index < 0 || index >= bits.length) return;
      let word = bits[index] ?? 0;
      for (let column = from; column <= to; column++) word |= 1 << column;
      bits[index] = word;
    };

    if (first.row === last.row) {
      set(
        first.row,
        Math.min(first.firstColumn, last.firstColumn),
        Math.max(first.lastColumn, last.lastColumn)
      );
      return;
    }
    set(first.row, first.firstColumn, MINIMAP_COLUMNS - 1);
    for (let row = first.row + 1; row < last.row; row++) {
      const index = row - rows.from;
      if (index >= 0 && index < bits.length) bits[index] = 0xffff;
    }
    set(last.row, 0, last.lastColumn);
  }

  /**
   * Sets the bit of the **hex dump's** column for every byte of a range, for
   * the rows in `rows`: `offset % 16`, the column the byte is drawn in.
   *
   * Deliberately not this row's own bins, which is what {@link mark} uses. A
   * row of the overview is kilobytes, so its 16 cells are slices of that span —
   * right for a density picture, and meaningless for a mark the eye is meant to
   * line up with the dump. A match on the first byte of its dump row must sit
   * at the left of the map's row, wherever in the row's kilobytes that byte
   * happens to fall; otherwise the map and the dump disagree about where the
   * user is, which is the one thing a find indicator exists to say.
   *
   * A stretch covering a whole dump row's worth of bytes fills the row's cells,
   * since every column holds one of its bytes.
   */
  markHexColumns(start: number, end: number, rows: RowRange, bits: Uint16Array): void {
    if (this.rowCount <= 0 || this.extent <= 0) return;
    const lower = Math.min(start, this.extent);
    const upper = Math.min(end, this.extent);
    if (lower >= upper) return;

    let offset = lower;
    while (offset < upper) {
      const row = mulDiv(offset, this.rowCount, this.extent);
      // A range can cross the map's rows; each of them takes the columns of its
      // own bytes.
      const limit = Math.min(upper, Math.max(this.startOfRow(row + 1), offset + 1));
      const index = row - rows.from;
      if (row >= rows.from && row < rows.to && index < bits.length) {
        if (limit - offset >= MINIMAP_COLUMNS) {
          bits[index] = 0xffff;
        } else {
          let word = bits[index] ?? 0;
          for (let byte = offset; byte < limit; byte++) word |= 1 << (byte % MINIMAP_COLUMNS);
          bits[index] = word;
        }
      }
      offset = limit;
    }
  }
}
