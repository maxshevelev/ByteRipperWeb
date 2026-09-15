import type { DiffEdit } from "@/core/diff/diffEngine";
import {
  type Segment,
  type Segmentation,
  segmentLabel,
  wholeFile,
} from "@/core/segments/segmentation";
import { createStore } from "@/state/store";
import { forgetActs, noteSegmentAct } from "@/state/undoRouter";
import type { PaneId } from "@/state/workspaceStore";

/**
 * Each pane's segment partition.
 *
 * Per pane, not per workspace, and that is the opposite of a bookmark on
 * purpose: segments describe one file's make-up, and a cut **travels with the
 * content** — an insert before it moves it — while a bookmark is a place the
 * user chose and must stay where it was put.
 *
 * The partition itself is immutable, so what is kept here is a stack of whole
 * partitions rather than a log of changes to one. A cut, a merge and a rename
 * are each one entry, and taking one back is picking up the partition from
 * before it — which cannot go wrong halfway.
 */

/** @upstream ByteRipperApp/Segments/SegmentStore.swift#SegmentStore.Snapshot */
export interface PaneSegments {
  /**
   * @upstream ByteRipperApp/Segments/SegmentStore.swift#SegmentStore.current
   * @upstream ByteRipperApp/Segments/SegmentStore.swift#SegmentStore.contentSize
   * @upstream ByteRipperApp/Segments/SegmentStore.swift#SegmentStore.cuts
   * @upstream ByteRipperApp/Segments/SegmentStore.swift#SegmentStore.segments
   */
  readonly partition: Segmentation;
  /** Partitions before the current one, oldest first. */
  readonly past: readonly Segmentation[];
  /** Partitions undone out of the way, newest first. */
  readonly future: readonly Segmentation[];
}

export interface SegmentsState {
  readonly panes: Readonly<Record<PaneId, PaneSegments | undefined>>;
}

const empty = (contentSize: number): PaneSegments => ({
  partition: wholeFile(contentSize),
  past: [],
  future: [],
});

/**
 * @upstream ByteRipperApp/Segments/SegmentStore.swift#SegmentStore
 * @upstream-differs one store over every pane's partition, with its own undo
 */
export const segmentsStore = createStore<SegmentsState>({
  panes: { a: undefined, b: undefined },
});

/** How deep the partition's own undo goes. Cuts are few; this is generous. */
const HISTORY_LIMIT = 64;

/** @upstream ByteRipperApp/Segments/SegmentStore.swift#SegmentStore.segment */
export function segmentsFor(pane: PaneId): Segmentation | undefined {
  return segmentsStore.getSnapshot().panes[pane]?.partition;
}

export function segmentsIn(pane: PaneId): Segment[] {
  return segmentsFor(pane)?.segments ?? [];
}

/**
 * A pane opened a file: it starts as one piece covering it.
 *
 * @upstream ByteRipperApp/Segments/SegmentStore.swift#SegmentStore.init
 * @upstream ByteRipperApp/Segments/SegmentStore.swift#SegmentStore.reset
 */
export function resetSegments(pane: PaneId, contentSize: number): void {
  // A new file in the slot: nothing that came before it is undoable any more.
  forgetActs(pane);
  segmentsStore.update((state) => ({
    panes: { ...state.panes, [pane]: empty(contentSize) },
  }));
}

export function clearSegments(pane: PaneId): void {
  forgetActs(pane);
  segmentsStore.update((state) => ({ panes: { ...state.panes, [pane]: undefined } }));
}

/** The two panes changed places; so do their partitions. */
export function swapSegments(): void {
  segmentsStore.update((state) => ({ panes: { a: state.panes.b, b: state.panes.a } }));
}

/**
 * Replaces a pane's partition, remembering the one it replaced.
 *
 * Returns whether anything changed: the commands are offered whether or not
 * they can act, and a refused cut must not push an entry nothing would undo.
 *
 * @upstream ByteRipperApp/Segments/SegmentStore.swift#SegmentStore.snapshot
 */
export function applySegments(
  pane: PaneId,
  change: (partition: Segmentation) => Segmentation | undefined
): boolean {
  const current = segmentsStore.getSnapshot().panes[pane];
  if (current === undefined) return false;
  const next = change(current.partition);
  if (next === undefined || next === current.partition) return false;

  segmentsStore.update((state) => ({
    panes: {
      ...state.panes,
      [pane]: {
        partition: next,
        past: [...current.past, current.partition].slice(-HISTORY_LIMIT),
        // A new change is a new future: what was undone is no longer reachable.
        future: [],
      },
    },
  }));
  noteSegmentAct(pane);
  return true;
}

/** @upstream ByteRipperApp/Segments/SegmentStore.swift#SegmentStore.restore */
export function undoSegments(pane: PaneId): boolean {
  const current = segmentsStore.getSnapshot().panes[pane];
  const previous = current?.past[current.past.length - 1];
  if (current === undefined || previous === undefined) return false;
  segmentsStore.update((state) => ({
    panes: {
      ...state.panes,
      [pane]: {
        partition: previous,
        past: current.past.slice(0, -1),
        future: [current.partition, ...current.future],
      },
    },
  }));
  return true;
}

export function redoSegments(pane: PaneId): boolean {
  const current = segmentsStore.getSnapshot().panes[pane];
  const next = current?.future[0];
  if (current === undefined || next === undefined) return false;
  segmentsStore.update((state) => ({
    panes: {
      ...state.panes,
      [pane]: {
        partition: next,
        past: [...current.past, current.partition].slice(-HISTORY_LIMIT),
        future: current.future.slice(1),
      },
    },
  }));
  return true;
}

export function canUndoSegments(pane: PaneId): boolean {
  return (segmentsStore.getSnapshot().panes[pane]?.past.length ?? 0) > 0;
}

export function canRedoSegments(pane: PaneId): boolean {
  return (segmentsStore.getSnapshot().panes[pane]?.future.length ?? 0) > 0;
}

/**
 * An edit landed: the cuts move with the bytes.
 *
 * Not an undoable step of its own — the edit is, and taking the edit back
 * brings the cuts back with it. So the partition is replaced in place, history
 * untouched, and the past entries are shifted too so an undo of an older cut
 * still lands on offsets that mean something.
 *
 * @upstream ByteRipperApp/Segments/SegmentStore.swift#SegmentStore.apply
 * @upstream ByteRipperApp/Segments/SegmentStore.swift#SegmentStore.rebase
 */
export function noteSegmentEdit(pane: PaneId, edit: DiffEdit, newSize: number): void {
  const current = segmentsStore.getSnapshot().panes[pane];
  if (current === undefined) return;
  const shifted = current.partition.applyEdit(edit, newSize);
  segmentsStore.update((state) => ({
    panes: {
      ...state.panes,
      [pane]: {
        partition: shifted.partition,
        past: current.past.map((one) => one.applyEdit(edit, newSize).partition),
        future: current.future.map((one) => one.applyEdit(edit, newSize).partition),
      },
    },
  }));
}

/**
 * Both panes, for the shell's "does anything have segments" questions.
 *
 * The pane ids spelled out rather than imported: the workspace store imports
 * this one to reset a pane's partition when a file opens, and a value import
 * back the other way would close the circle.
 */
export function anyCuts(): boolean {
  return (["a", "b"] as const).some((pane) => (segmentsFor(pane)?.cuts.length ?? 0) > 0);
}

export { segmentLabel };
