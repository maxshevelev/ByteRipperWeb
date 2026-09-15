import { type PaneId, workspaceStore } from "@/state/workspaceStore";

/**
 * What would be lost right now.
 *
 * A browser tab can be closed in a dozen ways this application never hears
 * about, so the one hook it does get — `beforeunload` — has to be armed
 * whenever anything is unsaved and disarmed the moment nothing is. Arming it
 * permanently would make every reload ask, which trains people to click through
 * the dialog that matters.
 */

export interface UnsavedPane {
  readonly pane: PaneId;
  readonly name: string;
}

/** The panes holding edits the file on disk does not have. */
export function unsavedPanes(): UnsavedPane[] {
  const { panes } = workspaceStore.getSnapshot();
  const result: UnsavedPane[] = [];
  for (const pane of ["a", "b"] as const) {
    const slot = panes[pane];
    if (slot?.document.isDirty) result.push({ pane, name: slot.name });
  }
  return result;
}

/**
 * Asks the browser to confirm before the tab goes.
 *
 * The message is the browser's own — every one of them ignores whatever text a
 * page supplies, and has for years — so this only decides *whether* to ask.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.windowShouldClose
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.saveAllThen
 */
export function watchForUnsavedWork(): () => void {
  const onBeforeUnload = (event: BeforeUnloadEvent) => {
    if (unsavedPanes().length === 0) return;
    event.preventDefault();
    // Assigning returnValue is the older spelling, still required by some
    // browsers for the prompt to appear at all.
    event.returnValue = "";
  };

  window.addEventListener("beforeunload", onBeforeUnload);
  return () => window.removeEventListener("beforeunload", onBeforeUnload);
}
