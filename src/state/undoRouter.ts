import type { Segmentation } from "@/core/segments/segmentation";
import {
  canRedoSegments,
  canUndoSegments,
  redoSegments,
  restorePartition,
  segmentsFor,
  undoSegments,
} from "@/state/segmentsStore";
import { type PaneId, syncJoinAttachment, workspaceStore } from "@/state/workspaceStore";

/**
 * Which of a pane's histories `Cmd/Ctrl+Z` should take back.
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
 * **Some acts are both.** A join inserts bytes *and* cuts the seam, and it is
 * one thing the user did, so it is one press to take back: {@link groupActs}
 * folds everything recorded inside it into a single entry.
 *
 * **The order can drift, and it is made to correct itself.** A fast repeat of
 * undo takes back a whole typing series as one batch, which is one press for
 * several recorded transactions — after that this stack holds document entries
 * the document no longer has. So an entry whose history has nothing left to
 * undo is dropped and the next one tried, which brings the two back into step
 * rather than leaving a press that does nothing.
 *
 * **The partition comes back by snapshot, not by inverse edit.** An edit moves
 * the cuts, and so does its undo — but a delete that swallowed a cut cannot give
 * it back, and the partitions waiting in the segments' own redo history went
 * through that delete too. So each act remembers the partition it left, taken
 * the moment it is undone, and a redo ends on exactly that; a group remembers
 * the one it started from, and an undo of it ends there. Upstream keeps a
 * snapshot per transaction beside the document's history for the same reason.
 */

/** @upstream-differs upstream's segmentUndoStack and segmentRedoStack become a partition on each act */
interface SimpleAct {
  readonly kind: "document" | "segments";
  readonly pane: PaneId;
  /** The partition this act left, taken when it was undone. */
  after?: Segmentation | undefined;
}

interface GroupAct {
  readonly kind: "group";
  readonly pane: PaneId;
  readonly parts: readonly Act[];
  /** The partition from before the group's first part. */
  readonly before: Segmentation | undefined;
  after?: Segmentation | undefined;
}

type Act = SimpleAct | GroupAct;

const past: Act[] = [];
const future: Act[] = [];

/** How far back this remembers. Beyond it the two histories answer for themselves. */
const LIMIT = 256;

/** The acts recorded inside an open group, or nothing when none is open. */
let grouping: { pane: PaneId; parts: Act[] } | undefined;

function push(act: Act): void {
  if (grouping !== undefined && grouping.pane === act.pane) {
    grouping.parts.push(act);
    return;
  }
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

/**
 * Runs `act` with everything it records folded into one undo entry.
 *
 * For a join, which is one gesture that touches both of a pane's histories: the
 * bytes go in and the seam becomes a cut, and a press that took back only half
 * of that would leave an image cut where nothing joins any more.
 */
export async function groupActs(pane: PaneId, act: () => Promise<void>): Promise<void> {
  // Not re-entrant on purpose: a nested group would be a second meaning for
  // one press, and nothing here needs one.
  if (grouping !== undefined) {
    await act();
    return;
  }
  grouping = { pane, parts: [] };
  const before = segmentsFor(pane);
  try {
    await act();
  } finally {
    const parts = grouping.parts;
    grouping = undefined;
    if (parts.length === 1 && parts[0] !== undefined) push(parts[0]);
    else if (parts.length > 1) push({ kind: "group", pane, parts, before });
  }
}

/** Forgets a pane's acts — it closed, or its content was replaced wholesale. */
export function forgetActs(pane: PaneId): void {
  for (const stack of [past, future]) {
    for (let index = stack.length - 1; index >= 0; index--) {
      if (stack[index]?.pane === pane) stack.splice(index, 1);
    }
  }
}

/** Whether this act still has anything left to take back. */
function canUndoAct(act: Act): boolean {
  if (act.kind === "group") return act.parts.some(canUndoAct);
  if (act.kind === "segments") return canUndoSegments(act.pane);
  return workspaceStore.getSnapshot().panes[act.pane]?.document.canUndo === true;
}

function canRedoAct(act: Act): boolean {
  if (act.kind === "group") return act.parts.some(canRedoAct);
  if (act.kind === "segments") return canRedoSegments(act.pane);
  return workspaceStore.getSnapshot().panes[act.pane]?.document.canRedo === true;
}

async function undoAct(act: Act, batch: boolean): Promise<void> {
  if (act.kind === "group") {
    // In reverse: the seam cut was made after the bytes went in, so it comes
    // out first — and the cut's offsets only mean anything while they are in.
    for (const part of [...act.parts].reverse()) await undoAct(part, false);
    return;
  }
  if (act.kind === "segments") {
    undoSegments(act.pane);
    return;
  }
  const slot = workspaceStore.getSnapshot().panes[act.pane];
  await slot?.typing.undo(batch);
  // A join is one of those steps, and taking it back gives the pane its file
  // and its name back with it (§22.2).
  syncJoinAttachment(act.pane);
}

async function redoAct(act: Act): Promise<void> {
  if (act.kind === "group") {
    for (const part of act.parts) await redoAct(part);
    return;
  }
  if (act.kind === "segments") {
    redoSegments(act.pane);
    return;
  }
  const slot = workspaceStore.getSnapshot().panes[act.pane];
  await slot?.typing.redo();
  // Redoing a join detaches the pane from its file again (§22.2).
  syncJoinAttachment(act.pane);
}

/**
 * The act a press would take back, and what to call it.
 *
 * The menu asks, because an item that says only "Undo" leaves the user to
 * guess which of the two histories the press is about — and a greyed one that
 * would in fact work is worse than either. The name comes from the document
 * where the step carries one: a tool's transaction names itself, so the menu
 * reads `Undo Fix FIT Checksum` rather than `Undo`.
 */
export function nextUndo(pane: PaneId): { readonly label: string | undefined } | undefined {
  return nextAct(past, pane, canUndoAct, (slot) => slot.document.canUndo, documentUndoLabel);
}

/** The same for the next redo. */
export function nextRedo(pane: PaneId): { readonly label: string | undefined } | undefined {
  return nextAct(future, pane, canRedoAct, (slot) => slot.document.canRedo, documentRedoLabel);
}

type Slot = NonNullable<ReturnType<typeof workspaceStore.getSnapshot>["panes"][PaneId]>;

/**
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.undoLabel
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.redoLabel
 */
const documentUndoLabel = (slot: Slot) => slot.document.undoHistory.undoLabel;
const documentRedoLabel = (slot: Slot) => slot.document.undoHistory.redoLabel;

/**
 * The newest act on `pane` that still has something left in it, or — where this
 * remembers none — the document's own answer, which is the state after a reload
 * of the page or past the limit above.
 *
 * It reads the stacks without changing them: asking what a press would do must
 * not be the press. The drift the press corrects is left for the press.
 */
function nextAct(
  stack: readonly Act[],
  pane: PaneId,
  usable: (act: Act) => boolean,
  documentCan: (slot: Slot) => boolean,
  documentLabel: (slot: Slot) => string | undefined
): { readonly label: string | undefined } | undefined {
  const slot = workspaceStore.getSnapshot().panes[pane];
  for (let index = stack.length - 1; index >= 0; index--) {
    const act = stack[index];
    if (act === undefined || act.pane !== pane) continue;
    if (!usable(act)) continue;
    // A segments act is a cut, which carries no name of its own: the label is
    // the document's, and a cut changes no byte, so there is none to give.
    return { label: act.kind === "segments" ? undefined : slot && documentLabel(slot) };
  }
  if (slot !== undefined && documentCan(slot)) return { label: documentLabel(slot) };
  return undefined;
}

/**
 * What the shell does about the caret an undo or a redo put back.
 *
 * A step restores the caret to where the edit it takes back began — the history
 * remembers it — and that can be anywhere in the file: undoing a join returns it
 * to the top, and redoing one puts it back at the seam. A viewport that stays
 * where it was leaves the reader looking at rows the step did not touch, with
 * the caret, the place the step was *about*, off screen.
 *
 * Upstream's `PaneViewModel.undo` and `.redo` both end with `notify(reveal:
 * .center)`, and that mode is narrower than "scroll to the caret": **centre it
 * only if it landed outside the viewport**, because moving the rows under
 * someone who can already see the caret is worse than not scrolling at all — and
 * wider than "the caret moved", because a step is a navigation command wherever
 * the caret ends up.
 *
 * The shell registers this rather than the router scrolling: where the dump goes
 * is the shell's (the pane's reveal requests), and which history a press took
 * back is the router's. Registered once, so every press that reaches these
 * functions — the keyboard, the pane's own handler, the Edit menu — is revealed
 * the same way.
 *
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.undo
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.redo
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.SelectionReveal
 */
export const undoHooks: {
  onCaretRestored?: ((pane: PaneId) => void) | undefined;
} = {};

/**
 * Takes back the last act on `pane`, whichever history it belongs to.
 *
 * Returns false when neither history has anything left, so the caller can leave
 * the key to whatever else wants it.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.undoEdit
 */
export async function undoLast(pane: PaneId, batch: boolean): Promise<boolean> {
  const taken = await undoStep(pane, batch);
  // The one funnel every undo goes through, so the reveal cannot be left out at
  // one of the three doors — and so a press that took nothing back reveals
  // nothing either.
  if (taken) undoHooks.onCaretRestored?.(pane);
  return taken;
}

/** The step itself, without the reveal that follows a press. */
async function undoStep(pane: PaneId, batch: boolean): Promise<boolean> {
  for (let index = past.length - 1; index >= 0; index--) {
    const act = past[index];
    if (act === undefined || act.pane !== pane) continue;
    if (!canUndoAct(act)) {
      past.splice(index, 1);
      continue;
    }
    past.splice(index, 1);
    future.push(act);
    // Every later act is already undone, so this is exactly what the act left.
    act.after = segmentsFor(pane);
    await undoAct(act, batch);
    if (act.kind === "group" && act.before !== undefined) restorePartition(pane, act.before);
    return true;
  }
  // Nothing recorded for this pane, which is the state after a reload of the
  // page or past the limit above. The document still knows its own history.
  const slot = workspaceStore.getSnapshot().panes[pane];
  if (slot?.document.canUndo === true) {
    await slot.typing.undo(batch);
    syncJoinAttachment(pane);
    return true;
  }
  return false;
}

/**
 * Puts back the last act an undo took out of `pane`, and centres the caret it
 * restores when that landed outside the viewport — see {@link undoHooks}.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.redoEdit
 */
export async function redoLast(pane: PaneId): Promise<boolean> {
  const taken = await redoStep(pane);
  if (taken) undoHooks.onCaretRestored?.(pane);
  return taken;
}

/** The step itself, without the reveal that follows a press. */
async function redoStep(pane: PaneId): Promise<boolean> {
  for (let index = future.length - 1; index >= 0; index--) {
    const act = future[index];
    if (act === undefined || act.pane !== pane) continue;
    if (!canRedoAct(act)) {
      future.splice(index, 1);
      continue;
    }
    future.splice(index, 1);
    past.push(act);
    await redoAct(act);
    if (act.after !== undefined) restorePartition(pane, act.after);
    return true;
  }
  const slot = workspaceStore.getSnapshot().panes[pane];
  if (slot?.document.canRedo === true) {
    await slot.typing.redo();
    syncJoinAttachment(pane);
    return true;
  }
  return false;
}
