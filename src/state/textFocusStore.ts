import { createStore } from "@/state/store";

/**
 * The text field being typed in, when there is one: what Edit ▸ Undo and Redo act on instead of
 * the dump (`d368a3e8`). The keys already reach the field first — the shell answers its own
 * chords only outside one — but a menu item is chosen with the pointer: the shell's menu bar takes
 * no focus, and the page's own menu takes it to its button. So the field is remembered while the
 * focus is in it or has gone only into a menu, and forgotten when it goes anywhere else.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.editedText
 * @upstream-differs remembered across a menu's own focus, where AppKit's menus take none
 */
export const textFocusStore = createStore<{ readonly field: HTMLElement | undefined }>({
  field: undefined,
});

/** Whether typing here edits text of its own, which keeps its own undo. */
export const isTextEntry = (element: Element): boolean =>
  (element instanceof HTMLElement && element.isContentEditable) ||
  element.closest("input, textarea, select") !== null;

/** Whether the focus went into a menu, which leaves the field it came from the one being edited. */
const isMenu = (element: Element): boolean =>
  element.closest('[role="menu"], [aria-haspopup="menu"]') !== null;

/** The field being typed in, if it is still on the page. */
export function editedTextField(): HTMLElement | undefined {
  const field = textFocusStore.getSnapshot().field;
  if (field === undefined || !field.isConnected) return undefined;
  return field;
}

/**
 * Edit ▸ Undo or Redo on the field being typed in, through the field's own history. True when
 * there was one to act on, so the dump's is left alone.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.undo
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.redo
 */
export function undoInTextField(redo: boolean): boolean {
  const field = editedTextField();
  if (field === undefined) return false;
  field.focus();
  // The field's own undo: the browser keeps it, and offers no other way in.
  document.execCommand(redo ? "redo" : "undo");
  return true;
}

/**
 * Edit ▸ Select All while a text field is being typed in: the field's own text, not every byte.
 * False when no field is, and the command is the dump's or the panel's.
 *
 * @upstream ByteRipperApp/App/MainMenu.swift#MainMenu.makeEditMenu
 * @upstream-differs the field is selected by the page, where upstream's menu sends the standard
 * selectAll: to the first responder
 */
export function selectAllInTextField(): boolean {
  const field = editedTextField();
  if (field === undefined) return false;
  field.focus();
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) field.select();
  else document.execCommand("selectAll");
  return true;
}

if (typeof document !== "undefined") {
  document.addEventListener(
    "focusin",
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (isTextEntry(target) && target instanceof HTMLElement) {
        if (textFocusStore.getSnapshot().field !== target)
          textFocusStore.update(() => ({ field: target }));
        return;
      }
      if (isMenu(target)) return;
      if (textFocusStore.getSnapshot().field !== undefined) {
        textFocusStore.update(() => ({ field: undefined }));
      }
    },
    true
  );
}
