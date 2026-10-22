import { type Segment, type Segmentation, segmentLabel } from "@/core/segments/segmentation";
import type { SessionView } from "@/core/session/sessionView";
import { createStore } from "@/state/store";
import type { PaneId } from "@/state/workspaceStore";

/**
 * Each pane's segment partition, as this window sees it.
 *
 * Per pane, not per workspace, and that is the opposite of a bookmark on purpose: segments
 * describe one file's make-up, and a cut **travels with the content** — an insert before it moves
 * it — while a bookmark is a place the person chose and must stay where it was put.
 *
 * The partition and its history are the session's (`Design/FILE_SESSIONS.md`): the host keeps
 * them, moves the cuts with every edit, and takes a cut back with Undo in the order it happened
 * among the edits (`src/core/session/sessionCuts.ts`, `sessionActs.ts`). What is here is the
 * partition of the session each pane shows, kept current from its view, for what draws and asks.
 */

/** @upstream ByteRipperApp/Segments/SegmentStore.swift#SegmentStore.Snapshot */
export interface PaneSegments {
  /**
   * @upstream ByteRipperApp/Segments/SegmentStore.swift#SegmentStore.current
   */
  readonly partition: Segmentation;
}

export interface SegmentsState {
  readonly panes: Readonly<Record<PaneId, PaneSegments | undefined>>;
}

/**
 * @upstream ByteRipperApp/Segments/SegmentStore.swift#SegmentStore
 * @upstream-differs the partitions of the sessions the panes show, mirrored from their views
 */
export const segmentsStore = createStore<SegmentsState>({
  panes: { a: undefined, b: undefined },
});

/** The session each pane shows, and how to stop hearing of its cuts. */
const shown = new Map<PaneId, { readonly view: SessionView; readonly stop: () => void }>();

/**
 * Says which session `pane` shows, or that it shows none; its partition is kept current from
 * then on. The workspace calls it whenever its panes change.
 */
export function showSegmentsOf(pane: PaneId, view: SessionView | undefined): void {
  const held = shown.get(pane);
  if (held?.view === view) return;
  held?.stop();
  shown.delete(pane);
  const put = (partition: Segmentation | undefined) =>
    segmentsStore.update((state) =>
      state.panes[pane]?.partition === partition
        ? state
        : {
            panes: {
              ...state.panes,
              [pane]: partition === undefined ? undefined : { partition },
            },
          }
    );
  if (view === undefined) {
    put(undefined);
    return;
  }
  shown.set(pane, { view, stop: view.onCutsChanged(put) });
  put(view.partition);
}

/** @upstream ByteRipperApp/Segments/SegmentStore.swift#SegmentStore.segment */
export function segmentsFor(pane: PaneId): Segmentation | undefined {
  return segmentsStore.getSnapshot().panes[pane]?.partition;
}

export function segmentsIn(pane: PaneId): Segment[] {
  return segmentsFor(pane)?.segments ?? [];
}

/**
 * The pane's content was replaced wholesale: it starts again as one piece covering it, and
 * nothing that came before is undoable any more.
 *
 * @upstream ByteRipperApp/Segments/SegmentStore.swift#SegmentStore.reset
 */
export function resetSegments(pane: PaneId, contentSize: number): void {
  void shown.get(pane)?.view.resetCuts(contentSize);
}

/**
 * Replaces a pane's partition, an undoable step of its own. Returns whether anything changed: the
 * commands are offered whether or not they can act, and a refused cut must not push a step nothing
 * would undo.
 *
 * @upstream ByteRipperApp/Segments/SegmentStore.swift#SegmentStore.snapshot
 */
export function applySegments(
  pane: PaneId,
  change: (partition: Segmentation) => Segmentation | undefined
): boolean {
  const view = shown.get(pane)?.view;
  if (view === undefined) return false;
  return view.applyCuts(change(view.partition));
}

/**
 * Both panes, for the shell's "does anything have segments" questions.
 *
 * The pane ids spelled out rather than imported: the workspace store imports this one to reset a
 * pane's partition when a file opens, and a value import back the other way would close the
 * circle.
 */
export function anyCuts(): boolean {
  return (["a", "b"] as const).some((pane) => (segmentsFor(pane)?.cuts.length ?? 0) > 0);
}

export { segmentLabel };
