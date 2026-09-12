/**
 * The pane's segment partition.
 *
 * A segmentation is a *partition* — an ordered list of pieces covering the
 * whole file — so gaps and overlaps are impossible by construction rather than
 * by validation. A piece's end is the next piece's start (or the file's end for
 * the last), so the list *is* the partition and there is no second array to
 * keep in step with it.
 *
 * One per pane, beside the document: segments describe one file's make-up, not
 * the workspace's. That is the opposite of a bookmark, which is the
 * workspace's and never moves under an edit — a **cut travels with the
 * content**, and a bookmark is a mark the user chose and that must stay put.
 *
 * Ported from `ByteRipperApp/Segments/SegmentStore.swift`. Immutable here where
 * Swift makes it a mutating value type: every edit returns a new partition, so
 * a snapshot taken for undo cannot be changed underneath its holder.
 */

import type { DiffEdit } from "@/core/diff/diffEngine";

/** One piece as the partition stores it: where it opens and what it is called. */
export interface Piece {
  /** The opening offset. The first piece opens at 0; the rest are the cuts. */
  readonly start: number;
  /** The user's name; empty means "no name". */
  readonly name: string;
}

/** One piece of the content, with its derived position and extent. */
export interface Segment {
  /** Positional label index: S0, S1, … in file order. Derived, never stored. */
  readonly index: number;
  /** Half-open `[start, end)`. */
  readonly start: number;
  readonly end: number;
  /** Survives renumbering; empty means "no name" (still shown as S<i>). */
  readonly name: string;
}

/**
 * The positional label for the piece at `index`.
 *
 * The one place the "S" prefix is built, so every site that names a piece — the
 * form's label column, the status bar, the merge commands, the saved file
 * names — reads the same shape.
 */
export function segmentLabel(index: number): string {
  return `S${index}`;
}

/**
 * The title for merging a piece into its neighbour.
 *
 * The one place the "into which" rule is written: the piece above absorbs it,
 * or the one below for S0.
 */
export function mergeTitle(index: number): string {
  return `Merge ${segmentLabel(index)} into ${segmentLabel(index === 0 ? 1 : index - 1)}`;
}

/** The whole-file partition a freshly opened document starts with. */
export function wholeFile(contentSize: number): Segmentation {
  return new Segmentation(contentSize, [{ start: 0, name: "" }]);
}

export class Segmentation {
  readonly contentSize: number;
  /** In file order, never empty, the first opening at 0. */
  readonly pieces: readonly Piece[];

  constructor(contentSize: number, pieces: readonly Piece[]) {
    this.contentSize = contentSize;
    this.pieces = pieces;
  }

  /** Every piece start except the first: the partition's cuts. */
  get cuts(): number[] {
    return this.pieces.slice(1).map((piece) => piece.start);
  }

  /** The pieces in file order, with derived indices and extents. */
  get segments(): Segment[] {
    return this.pieces.map((piece, index) => ({
      index,
      start: piece.start,
      end: this.pieces[index + 1]?.start ?? this.contentSize,
      name: piece.name,
    }));
  }

  /**
   * The index of the piece containing `offset` — the last one that opens at or
   * before it — or `undefined` past the end of the file. A cut belongs to the
   * piece that *starts* there.
   */
  indexContaining(offset: number): number | undefined {
    if (offset >= this.contentSize || offset < 0) return undefined;
    for (let index = this.pieces.length - 1; index >= 0; index--) {
      if ((this.pieces[index]?.start ?? 0) <= offset) return index;
    }
    return undefined;
  }

  /** The piece containing `offset`, or `undefined` past the end of the file. */
  containing(offset: number): Segment | undefined {
    const index = this.indexContaining(offset);
    return index === undefined ? undefined : this.segments[index];
  }

  /**
   * Adds a cut at `offset`, splitting the piece that contains it. The earlier
   * piece keeps its name; the new one starts unnamed.
   *
   * Refused at 0, at EOF, or where a cut already is — every piece must stay
   * non-empty.
   */
  addCut(offset: number): Segmentation | undefined {
    if (offset <= 0 || offset >= this.contentSize) return undefined;
    if (this.pieces.some((piece) => piece.start === offset)) return undefined;
    const index = this.indexContaining(offset);
    if (index === undefined) return undefined;

    const pieces = [...this.pieces];
    pieces.splice(index + 1, 0, { start: offset, name: "" });
    return new Segmentation(this.contentSize, pieces);
  }

  /**
   * Removes the cut at `offset`, merging the two pieces it separated into the
   * earlier one, which keeps its name.
   *
   * The bytes are untouched: removing a cut changes how the file is read, not
   * the file.
   */
  removeCut(offset: number): Segmentation | undefined {
    const index = this.pieces.findIndex((piece) => piece.start === offset);
    if (index < 1) return undefined;
    const pieces = [...this.pieces];
    pieces.splice(index, 1);
    return new Segmentation(this.contentSize, pieces);
  }

  /**
   * Removes the piece at `index`, merging its bytes into a neighbour and
   * keeping that neighbour's name: the piece above absorbs it, or — for S0 —
   * the piece below, which reopens at the file start, so what was S1 becomes
   * S0. Refused when there is only one piece: no neighbour to merge into.
   */
  removePiece(index: number): Segmentation | undefined {
    if (this.pieces.length <= 1 || index < 0 || index >= this.pieces.length) return undefined;
    const pieces = [...this.pieces];
    if (index === 0) {
      const below = pieces[1];
      if (below === undefined) return undefined;
      pieces[1] = { start: 0, name: below.name };
      pieces.shift();
    } else {
      pieces.splice(index, 1);
    }
    return new Segmentation(this.contentSize, pieces);
  }

  /**
   * Slides the cut at `from` to `offset`.
   *
   * A cut may only move within the interval it currently bounds — strictly
   * between its neighbours — so it never jumps over another: the partition's
   * structure is preserved, and the piece that opened at `from` keeps its name,
   * which travels with the boundary.
   */
  moveCut(from: number, offset: number): Segmentation | undefined {
    if (from === offset) return undefined;
    const index = this.pieces.findIndex((piece) => piece.start === from);
    if (index < 1) return undefined;

    const lower = this.pieces[index - 1]?.start ?? 0;
    const upper = this.pieces[index + 1]?.start ?? this.contentSize;
    if (offset <= lower || offset >= upper) return undefined;

    const pieces = [...this.pieces];
    const moved = pieces[index];
    if (moved === undefined) return undefined;
    pieces[index] = { start: offset, name: moved.name };
    return new Segmentation(this.contentSize, pieces);
  }

  /**
   * Renames the piece at `index`. An empty name unnames it — it goes back to
   * showing its label. A name never changes the tint, which is by position.
   */
  rename(index: number, name: string): Segmentation {
    const piece = this.pieces[index];
    if (piece === undefined) return this;
    const pieces = [...this.pieces];
    pieces[index] = { start: piece.start, name: name.trim() };
    return new Segmentation(this.contentSize, pieces);
  }

  /**
   * Moves the pieces with the content after an edit.
   *
   * - An **overwrite** changes bytes without shifting offsets: nothing moves,
   *   though the size may have grown (a paste past EOF).
   * - An **insert** shifts the pieces strictly after it; a piece exactly at the
   *   insertion point stays, so the inserted bytes join the piece that *starts*
   *   there.
   * - A **delete** drops the pieces it empties, merges the ones whose seams it
   *   swallows into the piece that starts before it, and shifts the rest left.
   *
   * Returns the partition and whether a boundary actually moved — the content
   * edit repaints the bytes on its own, so the partition only has to repaint
   * when a cut shifted.
   */
  applyEdit(edit: DiffEdit, newSize: number): { partition: Segmentation; moved: boolean } {
    if (edit.kind === "overwrite") {
      // Offsets are preserved; only the size may have grown.
      return { partition: new Segmentation(newSize, this.pieces), moved: false };
    }

    if (edit.kind === "insert") {
      const { at, length } = edit;
      let moved = false;
      const pieces = this.pieces.map((piece) => {
        if (piece.start <= at) return piece;
        moved = true;
        return { start: piece.start + length, name: piece.name };
      });
      return { partition: new Segmentation(newSize, pieces), moved };
    }

    return this.applyDelete(edit.start, edit.end, newSize);
  }

  /**
   * The delete half: recompute the pieces that survive removing `[lo, hi)`.
   *
   * A piece's fate is decided by where it sits relative to the deletion. A seam
   * strictly inside is swallowed — the pieces either side merge into the one
   * that starts before the deletion, which keeps its name. A piece left with no
   * bytes is dropped with its name, and the labels renumber. The survivors are
   * rebuilt in order, each opening where its earliest surviving byte lands.
   */
  private applyDelete(
    lo: number,
    hi: number,
    newSize: number
  ): { partition: Segmentation; moved: boolean } {
    const length = hi - lo;
    if (length <= 0) return { partition: this, moved: false };

    const bounds = [...this.pieces.map((piece) => piece.start), this.contentSize];
    const oldStarts = this.pieces.map((piece) => piece.start);
    const survivors: Piece[] = [];

    let i = 0;
    while (i < this.pieces.length) {
      const start = bounds[i] ?? 0;
      // The run of consecutive pieces whose seams the deletion swallows.
      let j = i;
      while (j + 1 < bounds.length && (bounds[j + 1] ?? 0) < hi && (bounds[j + 1] ?? 0) > lo) {
        j += 1;
      }
      const end = bounds[j + 1] ?? this.contentSize;

      // The run's surviving bytes, in new-file coordinates: the part before
      // `lo` (unchanged) and the part from `hi` on (shifted left).
      const prefixEnd = Math.min(end, lo);
      const suffixStart = Math.max(start, hi);
      const hasPrefix = start < prefixEnd;
      const hasSuffix = suffixStart < end;
      if (!hasPrefix && !hasSuffix) {
        i = j + 1;
        continue;
      }

      const newStart = hasPrefix ? start : suffixStart - length;
      // The name it keeps: the first piece in the run that opens before the
      // deletion — a run beginning inside it keeps the name of the piece that
      // opens at its shifted start.
      let nameIndex = j;
      for (let k = 0; k <= j; k++) {
        if ((bounds[k] ?? 0) < lo) {
          nameIndex = k;
          break;
        }
      }
      survivors.push({ start: newStart, name: this.pieces[nameIndex]?.name ?? "" });
      i = j + 1;
    }

    // A file is always at least the whole-file piece, even when the delete
    // emptied it.
    const pieces =
      survivors.length > 0 ? survivors : [{ start: 0, name: this.pieces[0]?.name ?? "" }];
    const moved =
      pieces.length !== oldStarts.length ||
      pieces.some((piece, index) => piece.start !== oldStarts[index]);
    return { partition: new Segmentation(newSize, pieces), moved };
  }

  /**
   * Re-bases onto a new content size, keeping the offsets and names.
   *
   * A piece opening at or past the new end is dropped — a cut there is not a
   * cut — and the last survivor extends to the new end. What Revert to Saved
   * needs: the file's size changes without throwing away the partition the user
   * set up. The partition stays non-empty.
   */
  resized(contentSize: number): Segmentation {
    const kept = this.pieces.filter((piece) => piece.start === 0 || piece.start < contentSize);
    return new Segmentation(
      contentSize,
      kept.length > 0 ? kept : [{ start: 0, name: this.pieces[0]?.name ?? "" }]
    );
  }
}
