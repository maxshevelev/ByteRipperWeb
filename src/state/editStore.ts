import { createStore } from "@/state/store";

/**
 * A tick for "something about a document changed".
 *
 * The workspace store holds which files are open; it does not change when one
 * of them is edited, so anything reading `document.isDirty` through it never
 * re-renders — the Save button stayed disabled while you typed. This is the
 * missing signal, kept apart from the workspace store on purpose: the
 * comparison watches that one, and a version bump per keystroke there would
 * have it re-examining its inputs on every byte.
 *
 * Consumers subscribe for the nudge and read the document for the truth.
 */
export const editStore = createStore<{ readonly version: number }>({ version: 0 });

export function noteDocumentChanged(): void {
  editStore.update((state) => ({ version: state.version + 1 }));
}
