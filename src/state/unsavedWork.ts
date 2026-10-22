import { inDesktopShell } from "@/platform/desktop/desktopFiles";
import { hostDocument } from "@/state/sessions/pageSessions";
import { workspaceHolds } from "@/state/workspace/workspaceRecorder";
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

/**
 * The panes holding edits nothing else has — the workspace's own, and the parts
 * opened over them.
 *
 * A part counts. Its bytes are a copy that has never been anywhere else: the
 * parent has not got them back, and a tab that closed without asking would take
 * the work with it exactly as it would a file's.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.unsavedDocumentCount
 */
export function unsavedPanes(): UnsavedPane[] {
  const { panes, parts } = workspaceStore.getSnapshot();
  const result: UnsavedPane[] = [];
  for (const pane of ["a", "b"] as const) {
    const slot = panes[pane];
    if (slot?.document.isDirty) result.push({ pane, name: slot.name });
  }
  for (const [pane, part] of Object.entries(parts)) {
    if (part.document.isDirty) result.push({ pane: pane as PaneId, name: part.name });
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
    if (leaving) return;
    // A window of the desktop shell that closes on its own leaves the workspace, and what it held
    // goes with it, so everything unsaved is asked about; a quit keeps it and asks in
    // `unsavedPanesLostToLeaving` before any window goes (`Design/DESKTOP_WINDOWS.md`, D2).
    const lost = inDesktopShell() ? unsavedPanes() : unsavedPanesLostToLeaving();
    if (lost.length === 0) return;
    event.preventDefault();
    // Assigning returnValue is the older spelling, still required by some
    // browsers for the prompt to appear at all.
    event.returnValue = "";
  };

  window.addEventListener("beforeunload", onBeforeUnload);
  return () => window.removeEventListener("beforeunload", onBeforeUnload);
}

/**
 * The unsaved panes leaving would lose. With the workspace kept, what it holds as it is now comes
 * back unsaved, so leaving does not ask about it (`Design/WORKSPACE.md`); only what it could not
 * write down yet is asked about.
 *
 * @upstream ByteRipperApp/Workspace/ContentKeeper.swift#ContentKeeper.holdsCurrentBytes
 */
export function unsavedPanesLostToLeaving(): UnsavedPane[] {
  const { panes, parts } = workspaceStore.getSnapshot();
  return unsavedPanes().filter((one) => {
    const document = (
      one.pane in panes ? panes[one.pane as "a" | "b"] : parts[one.pane as keyof typeof parts]
    )?.document;
    return document === undefined || !workspaceHolds(hostDocument(document));
  });
}

/** Set once the page has asked about everything itself and is going. */
let leaving = false;

/**
 * The page is going — to another project — having asked about what would be lost itself: the
 * browser's question would be a second one.
 *
 * @web-only a switch between projects is a reload
 */
export function leaveWithoutAsking(): void {
  leaving = true;
}
