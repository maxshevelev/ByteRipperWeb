import { createStore } from "@/state/store";

/**
 * What Add Annotation… and Edit Annotation ask for, while they ask: the words of the form, what
 * it holds already, and where the answer goes. One at a time: the form is modal.
 *
 * @upstream ByteRipperApp/Notes/MainViewController+Notes.swift#NoteForm.ask
 * @upstream-differs a store the shell's dialog reads, where upstream runs an alert
 */
export interface NoteFormRequest {
  readonly message: string;
  readonly information: string;
  readonly button: string;
  readonly title: string;
  readonly note: string;
  readonly done: (title: string, note: string) => void;
}

export const noteFormStore = createStore<NoteFormRequest | undefined>(undefined);

/** Asks for a title and a note; `done` hears them unless the person cancels or leaves no title. */
export function askNote(request: NoteFormRequest): void {
  noteFormStore.update(() => request);
}

export function closeNoteForm(): void {
  noteFormStore.update(() => undefined);
}
