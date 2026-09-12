import { BYTES_PER_ROW } from "@/core/document/rowWidth";

export { BYTES_PER_ROW };
/**
 * Pure geometry for the hex grid.
 *
 * Ported from `HexLayout.swift`, which was already free of AppKit — and this is
 * free of the DOM for the same reason: every metric is passed in, so the
 * arithmetic can be tested without a canvas, and the renderer above it is left
 * with nothing to decide about where things go.
 *
 * A row holds 16 bytes in two groups of 8. Within a group the bytes are packed
 * into words of `wordSize` bytes (1, 2, 4 or 8): a word's bytes are drawn
 * adjacent and words are separated by a space, so a word of one byte is the
 * ordinary byte-per-cell dump. Left of the bytes is the offset column, right of
 * them the decoded text column — upstream calls that one the ASCII column, but
 * the decoding tables reach well past ASCII (`src/core/text/byteDecoder.ts`).
 *
 * Y grows downward: row 0 is at y = 0, which is how a canvas is drawn.
 */

export const GROUP_SIZE = 8;

/** The word sizes the view offers. Anything else falls back to one byte. */
export type WordSize = 1 | 2 | 4 | 8;

export const WORD_SIZES: readonly WordSize[] = [1, 2, 4, 8];

/** How a word size is named in the menu: "1 Byte", "2 Bytes". */
export const wordSizeTitle = (size: WordSize): string => `${size} ${size === 1 ? "Byte" : "Bytes"}`;

export interface HexLayoutOptions {
  /** Width of one monospaced character. */
  readonly charWidth: number;
  /** Height of one row. */
  readonly rowHeight: number;
  readonly leftPadding?: number;
  readonly rightPadding?: number;
  /** Hex digits in the offset column; never fewer than 8. */
  readonly offsetColumnChars?: number;
  readonly wordSize?: number;
}

/** Where in a row a point landed. */
export type HexColumn =
  | { readonly kind: "offset" }
  | { readonly kind: "hex"; readonly column: number }
  | { readonly kind: "text"; readonly column: number };

export interface HexHit {
  readonly row: number;
  readonly column: HexColumn;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export class HexLayout {
  readonly charWidth: number;
  readonly rowHeight: number;
  readonly leftPadding: number;
  readonly rightPadding: number;
  readonly wordSize: WordSize;
  readonly offsetColumnChars: number;

  /** Width of one byte's two hex digits. */
  readonly hexByteWidth: number;
  /** Gap between adjacent words within a group — one character. */
  readonly hexByteGap: number;
  /** Width of one word: its bytes are packed with no gap between them. */
  readonly wordWidth: number;
  readonly wordsPerGroup: number;
  /** Width of one 8-byte group, word gaps included. */
  readonly groupWidth: number;
  /** Gap between the two 8-byte groups — two characters. */
  readonly betweenGroupsGap: number;
  readonly offsetColumnWidth: number;
  /** Width of the 16-character decoded text column. */
  readonly textColumnWidth: number;
  readonly gapAfterOffset: number;
  readonly gapBeforeText: number;
  /** Full width of one row. */
  readonly contentWidth: number;

  constructor(options: HexLayoutOptions) {
    this.charWidth = options.charWidth;
    this.rowHeight = options.rowHeight;
    this.leftPadding = options.leftPadding ?? 12;
    this.rightPadding = options.rightPadding ?? 12;
    this.offsetColumnChars = Math.max(8, options.offsetColumnChars ?? 8);

    const requested = options.wordSize ?? 1;
    this.wordSize = requested === 2 || requested === 4 || requested === 8 ? requested : 1;

    this.hexByteWidth = 2 * this.charWidth;
    this.hexByteGap = this.charWidth;
    this.wordsPerGroup = GROUP_SIZE / this.wordSize;
    this.wordWidth = this.wordSize * this.hexByteWidth;
    this.groupWidth =
      this.wordsPerGroup * this.wordWidth + (this.wordsPerGroup - 1) * this.hexByteGap;
    this.betweenGroupsGap = 2 * this.charWidth;
    this.offsetColumnWidth = this.offsetColumnChars * this.charWidth;
    this.textColumnWidth = BYTES_PER_ROW * this.charWidth;
    this.gapAfterOffset = 2 * this.charWidth;
    this.gapBeforeText = 2 * this.charWidth;

    this.contentWidth =
      this.leftPadding +
      this.offsetColumnWidth +
      this.gapAfterOffset +
      (2 * this.groupWidth + this.betweenGroupsGap) +
      this.gapBeforeText +
      this.textColumnWidth +
      this.rightPadding;
  }

  // MARK: - Rows

  /**
   * Rows needed for `fileSize` bytes.
   *
   * An empty file still shows one row of placeholders, and a file whose length
   * is a multiple of 16 gets a trailing placeholder row — otherwise the caret
   * position at EOF would be off the grid entirely.
   */
  rowCount(fileSize: number): number {
    const dataRows = Math.ceil(fileSize / BYTES_PER_ROW);
    const caretRow = fileSize % BYTES_PER_ROW === 0 ? 1 : 0;
    return dataRows + caretRow;
  }

  /** The absolute offset of a row's column. May exceed the file size. */
  byteOffset(row: number, column: number): number {
    return row * BYTES_PER_ROW + column;
  }

  /** Row and column of an absolute offset. */
  rowColumn(offset: number): { row: number; column: number } {
    return { row: Math.floor(offset / BYTES_PER_ROW), column: offset % BYTES_PER_ROW };
  }

  /** Total content height for a file of `fileSize` bytes. */
  totalHeight(fileSize: number): number {
    return this.rowCount(fileSize) * this.rowHeight;
  }

  // MARK: - Frames

  /**
   * The rows intersecting a viewport, bottom-exclusive — what a virtualised
   * draw iterates. Empty when the viewport has no height.
   */
  visibleRowRange(top: number, height: number): { first: number; end: number } {
    if (height <= 0 || this.rowHeight <= 0) return { first: 0, end: 0 };
    return {
      first: Math.max(0, Math.floor(top / this.rowHeight)),
      end: Math.max(0, Math.ceil((top + height) / this.rowHeight)),
    };
  }

  rowFrame(row: number): Rect {
    return { x: 0, y: row * this.rowHeight, width: this.contentWidth, height: this.rowHeight };
  }

  /**
   * The x of a byte's hex cell within the row. Bytes inside a word are packed
   * together; words are separated by a gap, and the two groups by a wider one.
   */
  hexByteX(column: number): number {
    const group = Math.floor(column / GROUP_SIZE);
    const inGroup = column % GROUP_SIZE;
    const word = Math.floor(inGroup / this.wordSize);
    const inWord = inGroup % this.wordSize;
    const hexX =
      group * (this.groupWidth + this.betweenGroupsGap) +
      word * (this.wordWidth + this.hexByteGap) +
      inWord * this.hexByteWidth;
    return this.leftPadding + this.offsetColumnWidth + this.gapAfterOffset + hexX;
  }

  hexByteFrame(row: number, column: number): Rect {
    return {
      x: this.hexByteX(column),
      y: row * this.rowHeight,
      width: this.hexByteWidth,
      height: this.rowHeight,
    };
  }

  offsetColumnFrame(row: number): Rect {
    return {
      x: this.leftPadding,
      y: row * this.rowHeight,
      width: this.offsetColumnWidth,
      height: this.rowHeight,
    };
  }

  /** The x of the decoded character for a byte. */
  textX(column: number): number {
    const hexEnd =
      this.leftPadding +
      this.offsetColumnWidth +
      this.gapAfterOffset +
      2 * this.groupWidth +
      this.betweenGroupsGap +
      this.gapBeforeText;
    return hexEnd + column * this.charWidth;
  }

  textColumnFrame(row: number): Rect {
    return {
      x: this.textX(0),
      y: row * this.rowHeight,
      width: this.textColumnWidth,
      height: this.rowHeight,
    };
  }

  /**
   * The caret's x inside a byte cell. Nibble 0 places it before the high
   * nibble, nibble 1 before the low one.
   */
  caretX(column: number, nibble: number): number {
    return this.hexByteX(column) + nibble * this.charWidth;
  }

  /**
   * The middle of a byte's high-nibble character — the left edge of the dead
   * zone around the mid-byte caret.
   */
  highNibbleMidX(column: number): number {
    return this.hexByteX(column) + this.charWidth / 2;
  }

  /** The middle of its low-nibble character — the dead zone's right edge. */
  lowNibbleMidX(column: number): number {
    return this.hexByteX(column) + (3 * this.charWidth) / 2;
  }

  // MARK: - Hit testing

  /**
   * A point in content coordinates as a row and column, or `undefined` when it
   * is outside any row.
   *
   * Every point in the hex region maps to a byte. A click between two words —
   * or in the gap between the two groups — places the caret on the following
   * word, so a click never falls dead between cells.
   */
  hitTest(x: number, y: number, rowCount: number): HexHit | undefined {
    const row = this.rowAt(x, y, rowCount);
    if (row === undefined) return undefined;

    const hexStart = this.leftPadding + this.offsetColumnWidth + this.gapAfterOffset;
    const hexEnd = this.textX(0);

    if (x >= hexStart && x < hexEnd) {
      for (let group = 0; group < 2; group++) {
        const groupStart = hexStart + group * (this.groupWidth + this.betweenGroupsGap);
        for (let word = 0; word < this.wordsPerGroup; word++) {
          const wordStart = groupStart + word * (this.wordWidth + this.hexByteGap);
          if (x < wordStart + this.wordWidth) {
            // Inside the word, or in the gap just before it — which belongs to
            // the following word.
            const inWord =
              x >= wordStart
                ? Math.min(this.wordSize - 1, Math.floor((x - wordStart) / this.hexByteWidth))
                : 0;
            return {
              row,
              column: { kind: "hex", column: group * GROUP_SIZE + word * this.wordSize + inWord },
            };
          }
        }
      }
      return { row, column: { kind: "hex", column: BYTES_PER_ROW - 1 } };
    }

    const textStart = this.textX(0);
    if (x >= textStart && x < textStart + this.textColumnWidth) {
      const column = Math.min(BYTES_PER_ROW - 1, Math.floor((x - textStart) / this.charWidth));
      return { row, column: { kind: "text", column } };
    }

    if (x >= this.leftPadding && x < hexStart) return { row, column: { kind: "offset" } };
    return undefined;
  }

  /**
   * The exclusive end of a drag selection for a pointer position: the offset
   * just past the byte whose cell centre the pointer has crossed.
   *
   * Dragging extends the selection by the pointer's *centre-crossing* of a
   * byte, not by entering the next byte's cell. Byte N joins the moment the
   * pointer passes the middle of N's low-nibble character, so the boundary
   * between N and N+1 sits at the centre of N+1's cell — and the row's last
   * byte joins while the pointer is still over it. A byte never needs a
   * following byte in order to be reachable.
   */
  dragEndOffset(x: number, y: number, rowCount: number): number | undefined {
    const row = this.rowAt(x, y, rowCount);
    if (row === undefined) return undefined;
    const rowStart = this.byteOffset(row, 0);

    const hexStart = this.leftPadding + this.offsetColumnWidth + this.gapAfterOffset;
    const hexEnd = this.textX(0);

    if (x >= hexStart && x < hexEnd) {
      // The first column whose centre is still ahead of the pointer: every byte
      // before it has had its centre crossed and is in.
      const half = this.hexByteWidth / 2;
      for (let column = 0; column < BYTES_PER_ROW; column++) {
        if (x < this.hexByteX(column) + half) return rowStart + column;
      }
      return rowStart + BYTES_PER_ROW;
    }

    const textStart = this.textX(0);
    if (x >= textStart && x < textStart + this.textColumnWidth) {
      const half = this.charWidth / 2;
      for (let column = 0; column < BYTES_PER_ROW; column++) {
        if (x < this.textX(column) + half) return rowStart + column;
      }
      return rowStart + BYTES_PER_ROW;
    }

    if (x >= this.leftPadding && x < hexStart) return rowStart;
    return undefined;
  }

  private rowAt(x: number, y: number, rowCount: number): number | undefined {
    if (x < 0 || y < 0) return undefined;
    const row = Math.floor(y / this.rowHeight);
    return row >= 0 && row < rowCount ? row : undefined;
  }
}
