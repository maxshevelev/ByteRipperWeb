import {
  type AnnotationRemoval,
  agentAnnotationStore,
  annotationRemoval,
  restoreAnnotations,
  takeFreshAnnotations,
} from "@/state/agent/agentAnnotationStore";
import { createStore } from "@/state/store";
import { notesPanelIsUp, workspaceStore } from "@/state/workspaceStore";

/**
 * What the Annotations panel keeps that is not an annotation: the removals made there, which ⌘Z
 * puts back and ⇧⌘Z makes again, and the cards something outside the panel asks it to select — a
 * removal undone, the offset menu's Open Annotation.
 *
 * The removals are kept while the page runs, not from one launch to the next, and one removal is
 * one step.
 *
 * @upstream ByteRipperApp/Notes/NotesWindowController.swift#NotesWindowController.removals
 * @upstream-differs a store of the page's, where upstream gives the window an UndoManager of its own
 */
export interface NotesPanelState {
  readonly undo: readonly AnnotationRemoval[];
  /** The removals undone, to be made again, the last undone last. */
  readonly redo: readonly (readonly string[])[];
  /**
   * The cards to select the next time the panel looks, and a serial so the same ids asked twice
   * are two asks.
   */
  readonly select: { readonly ids: readonly string[]; readonly serial: number } | undefined;
  /**
   * The cards that wear the New tag: the notes made since the panel was last up, marked when it
   * comes up, and every note made while it is up; the marks go when it is folded or another panel
   * rises over it.
   *
   * @upstream ByteRipperApp/Agent/AgentAnnotationCards.swift#AgentAnnotationCards.newIDs
   */
  readonly newIds: ReadonlySet<string>;
}

export const notesPanelStore = createStore<NotesPanelState>({
  undo: [],
  redo: [],
  select: undefined,
  newIds: new Set(),
});

/**
 * Whether the panel was up when last looked at: coming up marks the notes made meanwhile new,
 * going out of view takes the marks off.
 *
 * @upstream ByteRipperApp/Notes/NotesWindowController.swift#NotesWindowController.wasInView
 */
let wasInView = false;

/**
 * The panel has perhaps come into view, or gone out of it, or a note was made while it is in view:
 * the New marks follow.
 *
 * @upstream ByteRipperApp/Notes/NotesWindowController.swift#NotesWindowController.noteLookedAt
 * @upstream ByteRipperApp/Notes/NotesWindowController.swift#NotesWindowController.leftView
 * @upstream ByteRipperApp/Notes/NotesWindowController.swift#NotesWindowController.refresh
 */
function noteLookedAt(): void {
  const inView = notesPanelIsUp(workspaceStore.getSnapshot());
  const was = wasInView;
  wasInView = inView;
  if (!inView) {
    if (was && notesPanelStore.getSnapshot().newIds.size > 0) {
      notesPanelStore.update((state) => ({ ...state, newIds: new Set() }));
    }
    return;
  }
  if (agentAnnotationStore.getSnapshot().fresh.size === 0) return;
  const fresh = takeFreshAnnotations();
  notesPanelStore.update((state) => ({
    ...state,
    newIds: was ? new Set([...state.newIds, ...fresh]) : new Set(fresh),
  }));
}
workspaceStore.subscribe(noteLookedAt);
agentAnnotationStore.subscribe(noteLookedAt);

/**
 * A removal made in the panel — the ✕, Delete — becomes one undo step, and what was undone before
 * is no longer to be redone.
 *
 * @upstream ByteRipperApp/Notes/NotesWindowController.swift#NotesWindowController.recordRemoval
 */
export function removeFromPanel(ids: ReadonlySet<string>): void {
  const removal = annotationRemoval((one) => ids.has(one.id));
  if (removal === undefined) return;
  notesPanelStore.update((state) => ({ ...state, undo: [...state.undo, removal], redo: [] }));
}

/**
 * Edit ▸ Undo (⌘Z) with the panel up: the last removal undone — the cards back where they stood,
 * selected. False when there is none.
 *
 * @upstream ByteRipperApp/Notes/NotesWindowController.swift#NotesWindowController.putBack
 */
export function undoPanelRemoval(): boolean {
  const removal = notesPanelStore.getSnapshot().undo.at(-1);
  if (removal === undefined) return false;
  restoreAnnotations(removal);
  const ids = removal.removed.map((one) => one.annotation.id);
  notesPanelStore.update((state) => ({
    ...state,
    undo: state.undo.slice(0, -1),
    redo: [...state.redo, ids],
    select: { ids, serial: (state.select?.serial ?? 0) + 1 },
  }));
  return true;
}

/**
 * Edit ▸ Redo (⇧⌘Z) with the panel up: the removal undone made again. False when there is none.
 *
 * @upstream ByteRipperApp/Notes/NotesWindowController.swift#NotesWindowController.removeAgain
 */
export function redoPanelRemoval(): boolean {
  const ids = notesPanelStore.getSnapshot().redo.at(-1);
  if (ids === undefined) return false;
  const wanted = new Set(ids);
  const removal = annotationRemoval((one) => wanted.has(one.id));
  notesPanelStore.update((state) => ({
    ...state,
    redo: state.redo.slice(0, -1),
    undo: removal === undefined ? state.undo : [...state.undo, removal],
  }));
  return true;
}

/** Whether ⌘Z or ⇧⌘Z has a removal to take back or make again. */
export const canUndoPanelRemoval = (): boolean => notesPanelStore.getSnapshot().undo.length > 0;
export const canRedoPanelRemoval = (): boolean => notesPanelStore.getSnapshot().redo.length > 0;

/**
 * Asks the panel to select the cards of `ids`, and nothing else, and scroll to the first.
 *
 * @upstream ByteRipperApp/Agent/AgentAnnotationCards.swift#AgentAnnotationCards.select
 */
export function selectInPanel(ids: readonly string[]): void {
  notesPanelStore.update((state) => ({
    ...state,
    select: { ids, serial: (state.select?.serial ?? 0) + 1 },
  }));
}

/** Forgets the removals and the asks, for a test that leaves none behind. */
export function forgetPanelRemovalsForTesting(): void {
  wasInView = false;
  notesPanelStore.update(() => ({ undo: [], redo: [], select: undefined, newIds: new Set() }));
}
