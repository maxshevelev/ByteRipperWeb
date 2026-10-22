import { isSlot, type PaneId, paneState, syncJoinAttachment } from "@/state/workspaceStore";

/**
 * Which of a pane's histories `Cmd/Ctrl+Z` takes back is the session's to decide
 * (`src/core/session/sessionActs.ts`): it keeps the order the edits and the cuts happened in,
 * whichever window made them. What is left here is the window's side of a press — the typing it
 * closes first, the comparison it tells after, the file a join gives back, the caret it reveals.
 */

/**
 * Runs `act` with everything it records folded into one undo step.
 *
 * For a join, which is one gesture that touches both of a pane's histories: the bytes go in and
 * the seam becomes a cut, and a press that took back only half of that would leave an image cut
 * where nothing joins any more.
 */
export async function groupActs(pane: PaneId, act: () => Promise<void>): Promise<void> {
  const view = paneState(pane)?.document;
  if (view === undefined) {
    await act();
    return;
  }
  view.beginActs();
  try {
    await act();
  } finally {
    await view.endActs();
  }
}

/**
 * The step a press would take back, and what to call it.
 *
 * The menu asks, because an item that says only "Undo" leaves the reader to guess which of the
 * two histories the press is about — and a greyed one that would in fact work is worse than
 * either. The name comes from the document where the step carries one: a tool's transaction names
 * itself, so the menu reads `Undo Fix FIT Checksum` rather than `Undo`; a cut carries none.
 *
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.undoLabel
 */
export function nextUndo(pane: PaneId): { readonly label: string | undefined } | undefined {
  const view = paneState(pane)?.document;
  return view?.canUndo === true ? { label: view.undoLabel } : undefined;
}

/**
 * The same for the next redo.
 *
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.redoLabel
 */
export function nextRedo(pane: PaneId): { readonly label: string | undefined } | undefined {
  const view = paneState(pane)?.document;
  return view?.canRedo === true ? { label: view.redoLabel } : undefined;
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
 * @upstream-differs not a type: the modes live in the pane's reveal requests
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
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.undo
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
  const slot = paneState(pane);
  // What this window told the session a moment ago — a cut, a group closed — is in its answer.
  await slot?.document.settled();
  if (slot?.document.canUndo !== true) return false;
  await slot.typing.undo(batch);
  // A join is one of those steps, and taking it back gives the pane its file and its name back
  // with it (§22.2). Only a slot can have been joined: a part is opened over a file, never out of
  // two.
  if (isSlot(pane)) syncJoinAttachment(pane);
  return true;
}

/**
 * Puts back the last act an undo took out of `pane`, and centres the caret it
 * restores when that landed outside the viewport — see {@link undoHooks}.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.redo
 */
export async function redoLast(pane: PaneId): Promise<boolean> {
  const taken = await redoStep(pane);
  if (taken) undoHooks.onCaretRestored?.(pane);
  return taken;
}

/** The step itself, without the reveal that follows a press. */
async function redoStep(pane: PaneId): Promise<boolean> {
  const slot = paneState(pane);
  // What this window told the session a moment ago — a cut, a group closed — is in its answer.
  await slot?.document.settled();
  if (slot?.document.canRedo !== true) return false;
  await slot.typing.redo();
  // Redoing a join detaches the pane from its file again (§22.2).
  if (isSlot(pane)) syncJoinAttachment(pane);
  return true;
}
