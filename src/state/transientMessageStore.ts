import { createStore } from "@/state/store";
import { PANE_IDS, type PaneId } from "@/state/workspaceStore";

/**
 * The pane's transient message: one line, in the place the pane's status line
 * stands, for a couple of seconds — then the line comes back.
 *
 * It is how upstream reports what an operation *did* rather than what it found
 * in the bytes: "Appended boot.bin after bios.bin. Total: 8 MB.", "Duplicated
 * bios.bin as Untitled. Size: 4 MB.", and the Find bar's "No match found."
 * Those reports replaced the window's status bar in the web for a while, which
 * was wrong twice over: upstream has no window status bar, and a report about
 * one pane's file belongs on that pane.
 *
 * The message is not a problem: a problem is an alert, and stays until it is
 * read. This yields back on its own, which is only honest for something that
 * has already happened and needs no answer.
 *
 * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.showTransientMessage
 * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.restoreStatus
 * @upstream-differs a store the readout draws from, rather than a label the view
 * sets and a perform-request it cancels
 */

/**
 * How long the message holds. Upstream's `afterDelay: 2.0`.
 *
 * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.showTransientMessage
 */
export const TRANSIENT_MESSAGE_MS = 2000;

export type TransientMessages = { readonly [pane in PaneId]: string | undefined };

export const transientMessageStore = createStore<TransientMessages>({ a: undefined, b: undefined });

/**
 * The pending restore, one per pane: a second message on the same pane replaces
 * the first and takes over its clock, so the newer report is the one that gets
 * its two seconds.
 *
 * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.restoreStatus
 */
const restores = new Map<PaneId, ReturnType<typeof setTimeout>>();

/**
 * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.showTransientMessage
 */
export function showTransientMessage(pane: PaneId, message: string): void {
  const pending = restores.get(pane);
  if (pending !== undefined) clearTimeout(pending);
  transientMessageStore.update((state) => ({ ...state, [pane]: message }));
  restores.set(
    pane,
    setTimeout(() => {
      restores.delete(pane);
      transientMessageStore.update((state) => ({ ...state, [pane]: undefined }));
    }, TRANSIENT_MESSAGE_MS)
  );
}

/**
 * Drops the message and its clock at once. For a pane that is being handed a
 * different file, or closed: "Downloaded bios.bin." under the name of the file
 * the user has just opened in its place would be a report about a document that
 * is no longer there.
 */
export function forgetTransientMessage(pane: PaneId): void {
  const pending = restores.get(pane);
  if (pending !== undefined) clearTimeout(pending);
  restores.delete(pane);
  transientMessageStore.update((state) => ({ ...state, [pane]: undefined }));
}

/** Every pane at once — what closing the workspace needs. */
export function forgetAllTransientMessages(): void {
  for (const pane of PANE_IDS) forgetTransientMessage(pane);
}
