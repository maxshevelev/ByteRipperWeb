import type { DiffEdit } from "@/core/diff/diffEngine";
import { type Piece, Segmentation, SegmentLink, wholeFile } from "@/core/segments/segmentation";

/**
 * A session's segment partition and the partitions its cuts can step back and forth through
 * (`Design/FILE_SESSIONS.md`): the file's make-up, so the session's, whatever window shows it.
 *
 * The partition is immutable, so what is kept is a stack of whole partitions rather than a log of
 * changes to one. A cut, a merge and a rename are each one entry, and taking one back is picking
 * up the partition from before it — which cannot go wrong halfway.
 *
 * @upstream ByteRipperApp/Segments/SegmentStore.swift#SegmentStore
 * @upstream-differs the store is the session's, one per document, with its own undo
 */
export class CutHistory {
  /**
   * @upstream ByteRipperApp/Segments/SegmentStore.swift#SegmentStore.current
   * @upstream ByteRipperApp/Segments/SegmentStore.swift#SegmentStore.contentSize
   * @upstream ByteRipperApp/Segments/SegmentStore.swift#SegmentStore.cuts
   * @upstream ByteRipperApp/Segments/SegmentStore.swift#SegmentStore.segments
   */
  partition: Segmentation;
  /** Partitions before the current one, oldest first. */
  past: readonly Segmentation[] = [];
  /** Partitions undone out of the way, newest first. */
  future: readonly Segmentation[] = [];
  /** Counts every change, so a window rebuilds its copy only when there is a new one. */
  version = 0;

  /**
   * @upstream ByteRipperApp/Segments/SegmentStore.swift#SegmentStore.init
   */
  constructor(contentSize: number) {
    this.partition = wholeFile(contentSize);
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /**
   * The content was replaced: one piece covering it, and nothing to step back to.
   *
   * @upstream ByteRipperApp/Segments/SegmentStore.swift#SegmentStore.reset
   */
  reset(contentSize: number): void {
    this.partition = wholeFile(contentSize);
    this.past = [];
    this.future = [];
    this.version++;
  }

  /**
   * Replaces the partition, remembering the one it replaced. Answers whether anything changed: a
   * refused cut must not push an entry nothing would undo.
   *
   * @upstream ByteRipperApp/Segments/SegmentStore.swift#SegmentStore.snapshot
   */
  apply(next: Segmentation): boolean {
    if (samePartition(next, this.partition)) return false;
    this.past = [...this.past, this.partition].slice(-HISTORY_LIMIT);
    // A new change is a new future: what was undone is no longer reachable.
    this.future = [];
    this.partition = next;
    this.version++;
    return true;
  }

  /** @upstream ByteRipperApp/Segments/SegmentStore.swift#SegmentStore.restore */
  undo(): boolean {
    const previous = this.past.at(-1);
    if (previous === undefined) return false;
    this.future = [this.partition, ...this.future];
    this.past = this.past.slice(0, -1);
    this.partition = previous;
    this.version++;
    return true;
  }

  redo(): boolean {
    const next = this.future[0];
    if (next === undefined) return false;
    this.past = [...this.past, this.partition].slice(-HISTORY_LIMIT);
    this.future = this.future.slice(1);
    this.partition = next;
    this.version++;
    return true;
  }

  /**
   * Puts a partition back exactly as it was, history untouched: for undo and redo of an edit,
   * which moving the cuts through the edit's inverse would get wrong — a delete that swallowed a
   * cut cannot give it back.
   *
   * @upstream ByteRipperApp/Segments/SegmentStore.swift#SegmentStore.restore
   * @upstream-differs the snapshot is the partition alone; the store's own history stays where it is
   */
  restore(partition: Segmentation): void {
    if (partition === this.partition) return;
    this.partition = partition;
    this.version++;
  }

  /** Puts back the partitions the cuts can step through, the partition itself untouched. */
  restoreHistory(past: readonly Segmentation[], future: readonly Segmentation[]): void {
    this.past = past;
    this.future = future;
    this.version++;
  }

  /**
   * An edit landed: the cuts move with the bytes. Not an undoable step of its own — the edit is —
   * so the partition is replaced in place, and the past and future entries are moved too so an
   * undo of an older cut still lands on offsets that mean something.
   *
   * @upstream ByteRipperApp/Segments/SegmentStore.swift#SegmentStore.apply
   * @upstream ByteRipperApp/Segments/SegmentStore.swift#SegmentStore.rebase
   */
  noteEdit(edit: DiffEdit, newSize: number): void {
    if (edit.kind === "overwrite" && newSize === this.partition.contentSize) return;
    this.partition = this.partition.applyEdit(edit, newSize).partition;
    this.past = this.past.map((one) => one.applyEdit(edit, newSize).partition);
    this.future = this.future.map((one) => one.applyEdit(edit, newSize).partition);
    this.version++;
  }
}

/** How deep the partition's own undo goes. Cuts are few; this is generous. */
const HISTORY_LIMIT = 64;

function samePartition(left: Segmentation, right: Segmentation): boolean {
  if (left === right) return true;
  if (left.contentSize !== right.contentSize || left.pieces.length !== right.pieces.length) {
    return false;
  }
  return left.pieces.every((piece, index) => {
    const other = right.pieces[index];
    return (
      other !== undefined &&
      piece.start === other.start &&
      piece.name === other.name &&
      (piece.link === undefined ? other.link === undefined : piece.link.equals(other.link))
    );
  });
}

/**
 * A partition as it crosses between the host and a window: plain data.
 *
 * @web-only a partition is an object in the page; a port carries data
 */
export interface PartitionData {
  readonly contentSize: number;
  readonly pieces: readonly {
    readonly start: number;
    readonly name: string;
    readonly link?: { readonly source: number; readonly start: number; readonly end: number };
  }[];
}

/** @web-only see {@link PartitionData} */
export function partitionData(partition: Segmentation): PartitionData {
  return {
    contentSize: partition.contentSize,
    pieces: partition.pieces.map((piece) => ({
      start: piece.start,
      name: piece.name,
      ...(piece.link === undefined
        ? {}
        : {
            link: { source: piece.link.source.raw, start: piece.link.start, end: piece.link.end },
          }),
    })),
  };
}

/** @web-only see {@link PartitionData} */
export function partitionFrom(data: PartitionData): Segmentation {
  const pieces: Piece[] = data.pieces.map((piece) => ({
    start: piece.start,
    name: piece.name,
    ...(piece.link === undefined
      ? {}
      : {
          link: new SegmentLink({ raw: piece.link.source }, piece.link.start, piece.link.end),
        }),
  }));
  return new Segmentation(data.contentSize, pieces);
}
