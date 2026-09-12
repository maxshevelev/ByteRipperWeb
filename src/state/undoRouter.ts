import {
  canRedoSegments,
  canUndoSegments,
  redoSegments,
  undoSegments,
} from "@/state/segmentsStore";
import { type PaneId, workspaceStore } from "@/state/workspaceStore";

/**
 * Which of a pane's two histories `Cmd/Ctrl+Z` should take back.
 *
 * A pane has two kinds of undoable act: edits to its bytes, kept by the
 * document's own history, and changes to its partition — a cut, a merge, a
 * rename — kept by the segments store. They cannot be one history: the
 * document's dirty state is a function of its history, and a cut changes no
 * byte and must not make a file look unsaved.
 *
 * So there are two, and this decides between them. It keeps only the *order*
 * the acts happened in, and asks each history to do its own work.
 *
 * **The order can drift, and it is made to correct itself.** A fast repeat of
 * undo takes back a whole typing series as one batch, which is one press for
 * several recorded transactions — after that this stack holds document entries
 * the document no longer has. So an entry whose history has nothing left to
 * undo is dropped and the next one tried, which brings the two back into step
 * rather than leaving a press that does nothing.
 */

type Act = { readonly kind: "document" | "segments"; readonly pane: PaneId };

const past: Act[] = [];
const future: Act[] = [];

/** How far back this remembers. Beyond it the two histories answer for themselves. */
const LIMIT = 256;

function push(act: Act): void {
  past.push(act);
  if (past.length > LIMIT) past.shift();
  // A new act is a new future: what was undone is no longer reachable.
  future.length = 0;
}

export function noteDocumentAct(pane: PaneId): void {
  push({ kind: "document", pane });
}

export function noteSegmentAct(pane: PaneId): void {
  push({ kind: "segments", pane });
}

/** Forgets a pane's acts — it closed, or its content was replaced wholesale. */
export function forgetActs(pane: PaneId): void {
  for (const stack of [past, future]) {
    for (let index = stack.length - 1; index >= 0; index--) {
      if (stack[index]?.pane === pane) stack.splice(index, 1);
    }
  }
}

/**
 * Takes back the last act on `pane`, whichever history it belongs to.
 *
 * Returns false when neither history has anything left, so the caller can leave
 * the key to whatever else wants it.
 */
export async function undoLast(pane: PaneId, batch: boolean): Promise<boolean> {
  for (let index = past.length - 1; index >= 0; index--) {
    const act = past[index];
    if (act === undefined || act.pane !== pane) continue;
    if (act.kind === "segments") {
      if (!canUndoSegments(pane)) {
        past.splice(index, 1);
        continue;
      }
      past.splice(index, 1);
      future.push(act);
      undoSegments(pane);
      return true;
    }
    const slot = workspaceStore.getSnapshot().panes[pane];
    if (slot === undefined || !slot.document.canUndo) {
      past.splice(index, 1);
      continue;
    }
    past.splice(index, 1);
    future.push(act);
    await slot.typing.undo(batch);
    return true;
  }
  // Nothing recorded for this pane, which is the state after a reload of the
  // page or past the limit above. The document still knows its own history.
  const slot = workspaceStore.getSnapshot().panes[pane];
  if (slot?.document.canUndo === true) {
    await slot.typing.undo(batch);
    return true;
  }
  return false;
}

export async function redoLast(pane: PaneId): Promise<boolean> {
  for (let index = future.length - 1; index >= 0; index--) {
    const act = future[index];
    if (act === undefined || act.pane !== pane) continue;
    if (act.kind === "segments") {
      if (!canRedoSegments(pane)) {
        future.splice(index, 1);
        continue;
      }
      future.splice(index, 1);
      past.push(act);
      redoSegments(pane);
      return true;
    }
    const slot = workspaceStore.getSnapshot().panes[pane];
    if (slot === undefined || !slot.document.canRedo) {
      future.splice(index, 1);
      continue;
    }
    future.splice(index, 1);
    past.push(act);
    await slot.typing.redo();
    return true;
  }
  const slot = workspaceStore.getSnapshot().panes[pane];
  if (slot?.document.canRedo === true) {
    await slot.typing.redo();
    return true;
  }
  return false;
}
