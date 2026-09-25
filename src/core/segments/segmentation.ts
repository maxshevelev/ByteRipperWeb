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

/**
 * Which file a piece's bytes came from (§21.7).
 *
 * An id rather than the file itself: the partition is a value that undo copies
 * and compares, and a reader — let alone a URL — has no place in one. What the
 * id stands for lives in the pane's source registry
 * (`src/state/segmentSources.ts`), which outlives every snapshot, so an undo
 * that brings a piece back brings its link back with it.
 *
 * @upstream ByteRipperApp/Segments/SegmentStore.swift#SegmentSourceID
 */
export interface SegmentSourceID {
  /** @upstream ByteRipperApp/Segments/SegmentStore.swift#SegmentSourceID.raw */
  readonly raw: number;
}

/**
 * A piece's link to the file its bytes came from (§21.7): which file, and the
 * stretch of that file the piece stands for.
 *
 * The extent is the piece's *extent in the source*, which is not always the
 * piece's own length: an insert inside the piece leaves the piece longer than
 * the stretch it came from, and a delete leaves it shorter. That difference is
 * exactly what Revert Segment asks about before it restores the source's
 * length, so it is kept rather than derived.
 *
 * @upstream ByteRipperApp/Segments/SegmentStore.swift#SegmentLink
 */
export class SegmentLink {
  /** @upstream ByteRipperApp/Segments/SegmentStore.swift#SegmentLink.source */
  readonly source: SegmentSourceID;
  /**
   * The stretch of the source the piece stands for, half-open `[start, end)`.
   *
   * @upstream ByteRipperApp/Segments/SegmentStore.swift#SegmentLink.sourceRange
   * @upstream-differs the half-open range as two offsets, per D13, rather than
   * a `Range` value
   */
  readonly start: number;
  readonly end: number;

  /**
   * Upstream's struct carries the implicit memberwise initializer here; there
   * is no declaration to anchor, so the constructor is plain.
   */
  constructor(source: SegmentSourceID, start: number, end: number) {
    this.source = source;
    this.start = start;
    this.end = end;
  }

  /**
   * The source offset the piece's byte at `offset` stands for, given the piece
   * opens at `pieceStart`. Past the link's extent the answer is undefined —
   * those bytes came from nowhere the link knows about.
   *
   * @upstream ByteRipperApp/Segments/SegmentStore.swift#SegmentLink.sourceOffset
   */
  sourceOffset(offset: number, pieceStart: number): number | undefined {
    if (offset < pieceStart) return undefined;
    const within = offset - pieceStart;
    if (within >= this.end - this.start) return undefined;
    return this.start + within;
  }

  /**
   * The same link shifted by `delta` in the source — what a boundary move does
   * to a piece that gains or loses bytes at its front. Undefined when the shift
   * would take the extent before the source's start or past its own end: the
   * piece's bytes then stand in no fixed relation to the file, and a link that
   * lies is worse than none.
   *
   * @upstream ByteRipperApp/Segments/SegmentStore.swift#SegmentLink.shiftedStart
   */
  shiftedStart(delta: number): SegmentLink | undefined {
    const lower = this.start + delta;
    if (lower < 0 || lower > this.end) return undefined;
    return new SegmentLink(this.source, lower, this.end);
  }

  /**
   * The same link with its extent grown or shrunk at the far end — what a
   * boundary move does to the piece *before* the cut, which gains or loses
   * bytes at its tail. Never shrinks past its own start.
   *
   * @upstream ByteRipperApp/Segments/SegmentStore.swift#SegmentLink.resizedEnd
   */
  resizedEnd(delta: number): SegmentLink {
    const upper = this.end + delta;
    return new SegmentLink(this.source, this.start, Math.max(upper, this.start));
  }

  /**
   * Whether `other` is the same link: same source, same extent.
   *
   * @upstream-differs upstream's synthesized `Equatable` conformance
   */
  equals(other: SegmentLink | undefined): boolean {
    return (
      other !== undefined &&
      this.source.raw === other.source.raw &&
      this.start === other.start &&
      this.end === other.end
    );
  }
}

/**
 * One piece as the partition stores it: where it opens and what it is called.
 *
 * @upstream ByteRipperApp/Segments/SegmentStore.swift#Piece
 */
export interface Piece {
  /**
   * The opening offset. The first piece opens at 0; the rest are the cuts.
   *
   * @upstream ByteRipperApp/Segments/SegmentStore.swift#Piece.start
   */
  readonly start: number;
  /**
   * The user's name; empty means "no name".
   *
   * @upstream ByteRipperApp/Segments/SegmentStore.swift#Piece.name
   */
  readonly name: string;
  /**
   * The file the piece's bytes came from, when they came from one (§21.7).
   *
   * @upstream ByteRipperApp/Segments/SegmentStore.swift#Piece.link
   */
  readonly link?: SegmentLink | undefined;
}

/**
 * One piece of the content, with its derived position and extent.
 *
 * @upstream ByteRipperApp/Segments/SegmentStore.swift#Segment
 */
export interface Segment {
  /**
   * Positional label index: S0, S1, … in file order. Derived, never stored.
   *
   * @upstream ByteRipperApp/Segments/SegmentStore.swift#Segment.index
   */
  readonly index: number;
  /**
   * Half-open `[start, end)`.
   *
   * @upstream ByteRipperApp/Segments/SegmentStore.swift#Segment.range
   */
  readonly start: number;
  readonly end: number;
  /**
   * Survives renumbering; empty means "no name" (still shown as S<i>).
   *
   * @upstream ByteRipperApp/Segments/SegmentStore.swift#Segment.name
   */
  readonly name: string;
  /**
   * The file the piece's bytes came from, when they came from one (§21.7).
   *
   * @upstream ByteRipperApp/Segments/SegmentStore.swift#Segment.link
   */
  readonly link?: SegmentLink | undefined;
}

/**
 * The positional label for the piece at `index`.
 *
 * The one place the "S" prefix is built, so every site that names a piece — the
 * form's label column, the panes' status line, the merge commands, the saved
 * file names — reads the same shape.
 *
 * @upstream ByteRipperApp/Segments/SegmentStore.swift#Segment.label
 */
export function segmentLabel(index: number): string {
  return `S${index}`;
}

/**
 * One piece as the status line reads it (§21.3): the label the line shows and
 * the range it renders.
 *
 * A snapshot rather than a {@link Segment} because the line holds it while the
 * partition may move under it — there is no index to re-resolve and no name the
 * line does not show.
 *
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#SegmentReadout
 */
export interface SegmentReadout {
  /**
   * Positional label: "S0", "S1", …
   *
   * @upstream ByteRipperApp/Pane/PaneViewModel.swift#SegmentReadout.label
   */
  readonly label: string;
  /**
   * The piece's half-open byte range.
   *
   * @upstream ByteRipperApp/Pane/PaneViewModel.swift#SegmentReadout.range
   */
  readonly start: number;
  readonly end: number;
}

/**
 * The status line's readout of the piece the caret is in — nothing when the pane
 * is a single piece, where the readout's absence is the signal that the dump is
 * not partitioned.
 *
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.segmentReadout
 */
export function segmentReadout(
  partition: Segmentation | undefined,
  caret: number
): SegmentReadout | undefined {
  if (partition === undefined || partition.pieces.length <= 1) return undefined;
  const piece = partition.containing(caret);
  if (piece === undefined) return undefined;
  return { label: segmentLabel(piece.index), start: piece.start, end: piece.end };
}

/**
 * The title for merging a piece into its neighbour.
 *
 * The one place the "into which" rule is written: the piece above absorbs it,
 * or the one below for S0.
 *
 * @upstream ByteRipperApp/Segments/SegmentStore.swift#Segment.mergeTitle
 */
export function mergeTitle(index: number): string {
  return `Merge ${segmentLabel(index)} into ${segmentLabel(index === 0 ? 1 : index - 1)}`;
}

/**
 * The whole-file partition a freshly opened document starts with.
 *
 * @upstream ByteRipperApp/Segments/SegmentStore.swift#Segmentation.reset
 */
export function wholeFile(contentSize: number): Segmentation {
  return new Segmentation(contentSize, [{ start: 0, name: "" }]);
}

/** @upstream ByteRipperApp/Segments/SegmentStore.swift#Segmentation */
export class Segmentation {
  /** @upstream ByteRipperApp/Segments/SegmentStore.swift#Segmentation.contentSize */
  readonly contentSize: number;
  /**
   * In file order, never empty, the first opening at 0.
   *
   * @upstream ByteRipperApp/Segments/SegmentStore.swift#Segmentation.pieces
   */
  readonly pieces: readonly Piece[];

  /** @upstream ByteRipperApp/Segments/SegmentStore.swift#Segmentation.init */
  constructor(contentSize: number, pieces: readonly Piece[]) {
    this.contentSize = contentSize;
    this.pieces = pieces;
  }

  /**
   * Every piece start except the first: the partition's cuts.
   *
   * @upstream ByteRipperApp/Segments/SegmentStore.swift#Segmentation.cuts
   */
  get cuts(): number[] {
    return this.pieces.slice(1).map((piece) => piece.start);
  }

  /**
   * The pieces in file order, with derived indices and extents.
   *
   * @upstream ByteRipperApp/Segments/SegmentStore.swift#Segmentation.segments
   */
  get segments(): Segment[] {
    return this.pieces.map((piece, index) => ({
      index,
      start: piece.start,
      end: this.pieces[index + 1]?.start ?? this.contentSize,
      name: piece.name,
      link: piece.link,
    }));
  }

  /**
   * The index of the piece containing `offset` — the last one that opens at or
   * before it — or `undefined` past the end of the file. A cut belongs to the
   * piece that *starts* there.
   *
   * @upstream ByteRipperApp/Segments/SegmentStore.swift#Segmentation.pieceIndex
   */
  indexContaining(offset: number): number | undefined {
    if (offset >= this.contentSize || offset < 0) return undefined;
    for (let index = this.pieces.length - 1; index >= 0; index--) {
      if ((this.pieces[index]?.start ?? 0) <= offset) return index;
    }
    return undefined;
  }

  /**
   * The piece containing `offset`, or `undefined` past the end of the file.
   *
   * @upstream ByteRipperApp/Segments/SegmentStore.swift#Segmentation.segment
   */
  containing(offset: number): Segment | undefined {
    const index = this.indexContaining(offset);
    return index === undefined ? undefined : this.segments[index];
  }

  // Links (§21.7)

  /**
   * A link over `[start, end)`, or `undefined` when the range is empty: a link
   * that stands for no bytes of the source says nothing, and Revert Segment
   * would have nothing to restore from it.
   *
   * @upstream ByteRipperApp/Segments/SegmentStore.swift#Segmentation.nonEmptyLink
   * @upstream-differs the half-open range as two offsets, per D13, rather than
   * a `Range` value
   */
  static nonEmptyLink(
    source: SegmentSourceID,
    start: number,
    end: number
  ): SegmentLink | undefined {
    if (start >= end) return undefined;
    return new SegmentLink(source, start, end);
  }

  /**
   * Links the piece at `index` to `link` (undefined unlinks it). The one way a
   * link is set: a join, a replace-from-file, or the detach that turns the
   * pane's own file into a source (§21.7).
   *
   * @upstream ByteRipperApp/Segments/SegmentStore.swift#Segmentation.setLink
   */
  setLink(link: SegmentLink | undefined, index: number): Segmentation {
    const piece = this.pieces[index];
    if (piece === undefined) return this;
    const pieces = [...this.pieces];
    pieces[index] = { start: piece.start, name: piece.name, link };
    return new Segmentation(this.contentSize, pieces);
  }

  /**
   * Links every piece that has no link yet to `source`, each at its own
   * offsets — what a join does to the content the pane already held when that
   * content was a file the join is about to detach from (§21.7, §22.2). Pieces
   * that already carry a link (an earlier join's) keep it.
   *
   * `undefined` when nothing changed: a partition already fully linked to the
   * source, or with a piece too empty to link, stays a no-op the caller can
   * skip.
   *
   * @upstream ByteRipperApp/Segments/SegmentStore.swift#Segmentation.linkUnlinkedPieces
   */
  linkUnlinkedPieces(source: SegmentSourceID): Segmentation | undefined {
    const ends = this.pieces.slice(1).map((piece) => piece.start);
    ends.push(this.contentSize);
    let changed = false;
    const pieces = this.pieces.map((piece, index) => {
      if (piece.link !== undefined) return piece;
      const link = Segmentation.nonEmptyLink(source, piece.start, ends[index] ?? 0);
      if (link === undefined) return piece;
      changed = true;
      return { start: piece.start, name: piece.name, link };
    });
    return changed ? new Segmentation(this.contentSize, pieces) : undefined;
  }

  /**
   * Adds a cut at `offset`, splitting the piece that contains it. The earlier
   * piece keeps its name; the new one starts unnamed.
   *
   * Refused at 0, at EOF, or where a cut already is — every piece must stay
   * non-empty.
   *
   * A link splits with the piece (§21.7): both halves came from the same file,
   * at the offsets they sit at in it — which is why a cut inside a joined half
   * leaves two pieces that each still know where they came from.
   *
   * @upstream ByteRipperApp/Segments/SegmentStore.swift#Segmentation.addCut
   */
  addCut(offset: number): Segmentation | undefined {
    if (offset <= 0 || offset >= this.contentSize) return undefined;
    if (this.pieces.some((piece) => piece.start === offset)) return undefined;
    const index = this.indexContaining(offset);
    if (index === undefined) return undefined;
    const cut = this.pieces[index];
    if (cut === undefined) return undefined;

    let newLink: SegmentLink | undefined;
    let kept = cut;
    if (cut.link !== undefined) {
      // Where the cut falls in the source: the document bytes the earlier half
      // keeps, clamped to the extent the link actually covers (an insert can
      // leave the piece longer than its source).
      const taken = Math.min(offset - cut.start, cut.link.end - cut.link.start);
      const split = cut.link.start + taken;
      kept = {
        start: cut.start,
        name: cut.name,
        link: Segmentation.nonEmptyLink(cut.link.source, cut.link.start, split),
      };
      newLink = Segmentation.nonEmptyLink(cut.link.source, split, cut.link.end);
    }
    const pieces = [...this.pieces];
    pieces.splice(index, 1, kept, { start: offset, name: "", link: newLink });
    return new Segmentation(this.contentSize, pieces);
  }

  /**
   * Removes the cut at `offset`, merging the two pieces it separated into the
   * earlier one, which keeps its name.
   *
   * The bytes are untouched: removing a cut changes how the file is read, not
   * the file.
   *
   * @upstream ByteRipperApp/Segments/SegmentStore.swift#Segmentation.removeCut
   */
  removeCut(offset: number): Segmentation | undefined {
    const index = this.pieces.findIndex((piece) => piece.start === offset);
    if (index < 1) return undefined;
    const before = this.pieces[index - 1];
    if (before === undefined) return undefined;
    // The earlier piece absorbs the later one's bytes, so its extent in its
    // own source grows by as many (§21.7): the absorbed piece's link goes with
    // it, the way its name does.
    const end = this.pieces[index + 1]?.start ?? this.contentSize;
    const pieces = [...this.pieces];
    pieces[index - 1] = { start: before.start, name: before.name, link: before.link?.resizedEnd(end - offset) };
    pieces.splice(index, 1);
    return new Segmentation(this.contentSize, pieces);
  }

  /**
   * Removes the piece at `index`, merging its bytes into a neighbour and
   * keeping that neighbour's name: the piece above absorbs it, or — for S0 —
   * the piece below, which reopens at the file start, so what was S1 becomes
   * S0. Refused when there is only one piece: no neighbour to merge into.
   *
   * @upstream ByteRipperApp/Segments/SegmentStore.swift#Segmentation.removePiece
   */
  removePiece(index: number): Segmentation | undefined {
    if (this.pieces.length <= 1 || index < 0 || index >= this.pieces.length) return undefined;
    const removedStart = this.pieces[index]?.start ?? 0;
    const removedEnd = this.pieces[index + 1]?.start ?? this.contentSize;
    const pieces = [...this.pieces];
    if (index === 0) {
      const below = pieces[1];
      if (below === undefined) return undefined;
      // The piece below absorbs S0 and takes its place: it reopens at 0 and
      // keeps its own name, so what was S1 is now S0. It gains S0's bytes at
      // its front, so its extent in its source opens that much earlier — and
      // where the source has no room for them, the link is dropped rather than
      // left claiming bytes that are not its (§21.7).
      pieces[1] = {
        start: 0,
        name: below.name,
        link: below.link?.shiftedStart(-(removedEnd - removedStart)),
      };
      pieces.shift();
    } else {
      const above = pieces[index - 1];
      if (above !== undefined) {
        // The piece above absorbs it and keeps its name; the removed piece is
        // simply dropped from the partition. Its bytes join the piece above,
        // whose extent in its own source grows to match (§21.7).
        pieces[index - 1] = {
          start: above.start,
          name: above.name,
          link: above.link?.resizedEnd(removedEnd - removedStart),
        };
      }
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
   *
   * @upstream ByteRipperApp/Segments/SegmentStore.swift#Segmentation.moveCut
   */
  moveCut(from: number, offset: number): Segmentation | undefined {
    if (from === offset) return undefined;
    const index = this.pieces.findIndex((piece) => piece.start === from);
    if (index < 1) return undefined;

    const lower = this.pieces[index - 1]?.start ?? 0;
    const upper = this.pieces[index + 1]?.start ?? this.contentSize;
    if (offset <= lower || offset >= upper) return undefined;

    const moved = this.pieces[index];
    const before = this.pieces[index - 1];
    if (moved === undefined || before === undefined) return undefined;
    // The boundary slides without the bytes moving, so both pieces' extents in
    // their sources slide with it (§21.7): the piece that opens here gains or
    // loses bytes at its front, the one before it at its tail. A slide that
    // would take a front past its source's start drops the link.
    const delta = offset - from;
    const pieces = [...this.pieces];
    pieces[index] = { start: offset, name: moved.name, link: moved.link?.shiftedStart(delta) };
    pieces[index - 1] = { start: before.start, name: before.name, link: before.link?.resizedEnd(delta) };
    return new Segmentation(this.contentSize, pieces);
  }

  /**
   * Renames the piece at `index`. An empty name unnames it — it goes back to
   * showing its label. A name never changes the tint, which is by position.
   *
   * @upstream ByteRipperApp/Segments/SegmentStore.swift#Segmentation.rename
   */
  rename(index: number, name: string): Segmentation {
    const piece = this.pieces[index];
    if (piece === undefined) return this;
    const pieces = [...this.pieces];
    pieces[index] = { start: piece.start, name: name.trim(), link: piece.link };
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
   *
   * @upstream ByteRipperApp/Segments/SegmentStore.swift#Segmentation.apply
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
        // The link is untouched: the piece's bytes stand for the same stretch
        // of their source, only at a later offset (§21.7).
        return { start: piece.start + length, name: piece.name, link: piece.link };
      });
      return { partition: new Segmentation(newSize, pieces), moved };
    }

    return this.applyDelete(edit.start, edit.end, newSize);
  }

  /**
   * Applies an insert whose bytes belong to the piece at `index` although they
   * landed on its closing boundary — what a swap that made a piece longer does
   * (§21.6, §21.7).
   *
   * The ordinary insert rule gives bytes added at a cut to the piece that
   * *starts* there, which is right for an edit made at that offset and wrong
   * for this one: the bytes replaced a piece, so they are that piece's. Every
   * piece after it moves by `length`, and its own extent in its source grows
   * with it.
   *
   * @upstream ByteRipperApp/Segments/SegmentStore.swift#Segmentation.applyGrowth
   */
  applyGrowth(index: number, length: number, newSize: number): Segmentation {
    if (this.pieces[index] === undefined || length <= 0) {
      return new Segmentation(newSize, this.pieces);
    }
    const pieces = this.pieces.map((piece, i) => {
      if (i <= index) return piece;
      return { start: piece.start + length, name: piece.name, link: piece.link };
    });
    const grown = pieces[index];
    if (grown !== undefined) {
      pieces[index] = {
        start: grown.start,
        name: grown.name,
        link: grown.link?.resizedEnd(length),
      };
    }
    return new Segmentation(newSize, pieces);
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
      // The name it keeps: the first piece *of this run* that opens before the
      // deletion — a run beginning inside it keeps the name of the piece that
      // opens at its shifted start. Searched from `i`, not from 0: the pieces
      // before the run are not in it, and piece 0 opens before every deletion,
      // so starting at 0 gave every later run piece 0's name.
      let nameIndex = j;
      for (let k = i; k <= j; k++) {
        if ((bounds[k] ?? 0) < lo) {
          nameIndex = k;
          break;
        }
      }
      // The link follows the name (§21.7), and moves only when the piece it
      // names lost its head to the deletion: a run that keeps its head still
      // opens on the byte it always did, and one that starts past the deletion
      // moved whole — in both cases its extent in its source is unchanged.
      const anchor = bounds[nameIndex] ?? 0;
      const named = this.pieces[nameIndex];
      const link =
        anchor >= lo && anchor < hi ? named?.link?.shiftedStart(hi - anchor) : named?.link;
      survivors.push({ start: newStart, name: named?.name ?? "", link });
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
   *
   * @upstream ByteRipperApp/Segments/SegmentStore.swift#Segmentation.rebase
   */
  resized(contentSize: number): Segmentation {
    const kept = this.pieces.filter((piece) => piece.start === 0 || piece.start < contentSize);
    return new Segmentation(
      contentSize,
      kept.length > 0 ? kept : [{ start: 0, name: this.pieces[0]?.name ?? "" }]
    );
  }
}
