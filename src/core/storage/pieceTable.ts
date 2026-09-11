/**
 * The logical content of an edited file as a list of pieces, each naming a
 * range of one of two immutable sources.
 *
 * Ported from `PieceTable.swift`; the design it implements is written up in
 * `../ByteRipper/Design/PIECE_TABLE_PLAN.md`. This is the arithmetic only — no
 * bytes, no I/O. {@link EditOverlayStorage} owns the two sources (the file the
 * document was opened from, and an append-only buffer of the bytes editing has
 * added) and asks the table which source segments cover a window.
 *
 * Editing a piece list is O(pieces), never O(bytes): an insert splits one piece
 * and adds another, a delete drops or trims a few. That is the whole point. The
 * design this replaced upstream rewrote the entire file into a temporary file
 * per edit, which cost the same 25 ms per typed byte whether the byte landed at
 * the start of an 8 MB dump or at its end.
 */

/** Which immutable source a piece reads from. */
export type PieceSource =
  /** The storage the document was opened from. */
  | "base"
  /** The append-only buffer of bytes editing added. */
  | "added";

export interface Piece {
  readonly source: PieceSource;
  /** Offset within the source. */
  readonly start: number;
  readonly length: number;
}

/** A slice of one source, in that source's own coordinates. Half-open (D13). */
export interface PieceSegment {
  readonly source: PieceSource;
  readonly start: number;
  readonly end: number;
}

/** A half-open logical range `[start, end)`. */
export interface OffsetRange {
  readonly start: number;
  readonly end: number;
}

export class PieceTable {
  private pieces: Piece[] = [];
  /**
   * Prefix sums: `starts[i]` is the logical offset piece `i` begins at, and the
   * last element is the total size. Rebuilt on every mutation, which is what
   * keeps {@link segments} a binary search rather than a walk.
   */
  private starts: number[] = [0];

  /** A table holding one piece: the whole base, unedited. */
  constructor(baseSize = 0) {
    if (baseSize > 0) this.pieces = [{ source: "base", start: 0, length: baseSize }];
    this.rebuildStarts();
  }

  get size(): number {
    return this.starts[this.starts.length - 1] ?? 0;
  }

  /** How many pieces describe the content — the cost of a read. */
  get pieceCount(): number {
    return this.pieces.length;
  }

  /**
   * A copy that shares nothing mutable with this one.
   *
   * Swift gets this free: `PieceTable` is a struct, so handing one to a
   * snapshot hands over a value. In TypeScript the arrays are references, and a
   * snapshot that aliased them would change every time the document it was
   * taken from was edited.
   */
  clone(): PieceTable {
    const copy = new PieceTable(0);
    copy.pieces = this.pieces.slice();
    copy.starts = this.starts.slice();
    return copy;
  }

  // MARK: - Reading

  /**
   * The source segments covering `[start, end)`, in logical order. Clamped to
   * the table's size; an empty or out-of-range window yields nothing.
   */
  segments(start: number, end: number): PieceSegment[] {
    const lower = Math.min(Math.max(start, 0), this.size);
    const upper = Math.min(Math.max(end, 0), this.size);
    if (lower >= upper) return [];

    const result: PieceSegment[] = [];
    let index = this.pieceIndexContaining(lower);
    let position = lower;

    while (position < upper && index < this.pieces.length) {
      const piece = this.pieces[index];
      const pieceStart = this.starts[index];
      if (piece === undefined || pieceStart === undefined) break;

      const offsetInPiece = position - pieceStart;
      const take = Math.min(piece.length - offsetInPiece, upper - position);
      if (take > 0) {
        const from = piece.start + offsetInPiece;
        result.push({ source: piece.source, start: from, end: from + take });
        position += take;
      }
      index++;
    }
    return result;
  }

  /**
   * The logical ranges backed by the added buffer, merged where adjacent.
   *
   * While no length-changing edit has happened, a logical offset is still the
   * original file's offset — so these are exactly the ranges an in-place save
   * has to patch. After a shift they are no longer file offsets, which is why
   * the storage stops offering the in-place path at all.
   */
  get addedRanges(): OffsetRange[] {
    const result: OffsetRange[] = [];
    for (let index = 0; index < this.pieces.length; index++) {
      const piece = this.pieces[index];
      const start = this.starts[index];
      if (piece === undefined || start === undefined || piece.source !== "added") continue;

      const end = start + piece.length;
      const last = result[result.length - 1];
      if (last !== undefined && last.end === start) {
        result[result.length - 1] = { start: last.start, end };
      } else {
        result.push({ start, end });
      }
    }
    return result;
  }

  // MARK: - Editing

  /**
   * Inserts a slice of the added buffer at `at`, shifting what follows.
   *
   * A run of typing lands as one piece, not one per keystroke: when the new
   * bytes continue the added piece that ends exactly at `at`, that piece simply
   * grows.
   */
  insert(at: number, addedStart: number, addedEnd: number): void {
    const length = addedEnd - addedStart;
    if (length <= 0) return;
    const offset = Math.min(Math.max(at, 0), this.size);

    const growable = this.pieceEndingAt(offset);
    if (growable !== undefined) {
      const piece = this.pieces[growable];
      if (
        piece !== undefined &&
        piece.source === "added" &&
        piece.start + piece.length === addedStart
      ) {
        this.pieces[growable] = { ...piece, length: piece.length + length };
        this.rebuildStarts();
        return;
      }
    }

    this.splitPieceAt(offset);
    this.pieces.splice(this.insertionIndexFor(offset), 0, {
      source: "added",
      start: addedStart,
      length,
    });
    this.rebuildStarts();
  }

  /** Removes `[start, end)`, shifting what follows left. */
  delete(start: number, end: number): void {
    const lower = Math.min(Math.max(start, 0), this.size);
    const upper = Math.min(Math.max(end, 0), this.size);
    if (lower >= upper) return;

    this.splitPieceAt(lower);
    this.splitPieceAt(upper);
    const first = this.insertionIndexFor(lower);
    const last = this.insertionIndexFor(upper);
    this.pieces.splice(first, last - first);
    this.rebuildStarts();
  }

  /**
   * Replaces `[start, end)` with a slice of the added buffer — an overwrite.
   * The lengths need not match: a longer replacement grows the file, which is
   * how a write past EOF extends it.
   */
  replace(start: number, end: number, addedStart: number, addedEnd: number): void {
    this.delete(start, end);
    this.insert(start, addedStart, addedEnd);
  }

  // MARK: - Internals

  private rebuildStarts(): void {
    const starts = new Array<number>(this.pieces.length + 1);
    starts[0] = 0;
    let total = 0;
    for (let i = 0; i < this.pieces.length; i++) {
      total += this.pieces[i]?.length ?? 0;
      starts[i + 1] = total;
    }
    this.starts = starts;
  }

  /**
   * The index of the piece containing `offset` — the last piece for an offset
   * at the very end — by binary search over the prefix sums.
   */
  private pieceIndexContaining(offset: number): number {
    if (this.pieces.length === 0) return 0;
    let low = 0;
    let high = this.pieces.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if ((this.starts[mid] ?? 0) <= offset) low = mid;
      else high = mid - 1;
    }
    return low;
  }

  /**
   * The index a piece starting at `offset` would take — `pieces.length` at the
   * end. Valid only on a boundary, so callers split first.
   */
  private insertionIndexFor(offset: number): number {
    if (offset >= this.size) return this.pieces.length;
    let low = 0;
    let high = this.pieces.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if ((this.starts[mid] ?? 0) < offset) low = mid + 1;
      else high = mid;
    }
    return low;
  }

  /** The index of the piece that ends exactly at `offset`, if any. */
  private pieceEndingAt(offset: number): number | undefined {
    if (offset <= 0 || offset > this.size) return undefined;
    const index = this.insertionIndexFor(offset) - 1;
    if (index < 0 || index >= this.pieces.length) return undefined;
    return this.starts[index + 1] === offset ? index : undefined;
  }

  /**
   * Splits the piece straddling `offset` in two, so `offset` becomes a piece
   * boundary. A no-op when it already is one.
   */
  private splitPieceAt(offset: number): void {
    if (offset <= 0 || offset >= this.size) return;
    const index = this.pieceIndexContaining(offset);
    const pieceStart = this.starts[index];
    const piece = this.pieces[index];
    if (piece === undefined || pieceStart === undefined || offset <= pieceStart) return;

    const head = offset - pieceStart;
    this.pieces[index] = { source: piece.source, start: piece.start, length: head };
    this.pieces.splice(index + 1, 0, {
      source: piece.source,
      start: piece.start + head,
      length: piece.length - head,
    });
    this.rebuildStarts();
  }
}
