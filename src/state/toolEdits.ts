import { L } from "@/core/localization/localization";
import type { SessionView } from "@/core/session/sessionView";
import { editingHooks, isSlot, type PaneId, paneState } from "@/state/workspaceStore";
import {
  type ToolTransaction,
  transactionProblemMessage,
  validateTransaction,
} from "@/tools/toolTransaction";

/**
 * Applies a tool's transaction to a pane, as one undoable step.
 *
 * The tool computes the writes and the *document* performs them, because that
 * is the only way an edit this application makes can be taken back with the
 * same key the user's own typing is. The whole transaction goes into one edit
 * group, so `Undo Add Microcode` takes back the component, the row, the count
 * and the checksum together — an image carrying three of the four is worse than
 * an image carrying none.
 *
 * Returns the reason nothing was written, or nothing when it all was.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolHost.swift#ToolHost.apply
 * @upstream ByteRipperApp/Tools/PaneToolHost.swift#PaneToolHost.apply
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.applyToolWrites
 */
export async function applyTransaction(
  pane: PaneId,
  transaction: ToolTransaction
): Promise<string | undefined> {
  const checked = validateTransaction(transaction);
  if (!checked.ok) return transactionProblemMessage(checked.problem);

  const slot = paneState(pane);
  if (slot === undefined) return L("That pane has no file open.");
  const problem = await applyDocumentTransaction(slot.document, checked.transaction);
  if (problem !== undefined) return problem;
  // Told as a typed byte is: the comparison, the search, the map and the cuts
  // all hold claims about these bytes. Without it a copy into the other pane
  // left its bytes marked as differing — the two panes repainted what they
  // held, but the comparison had not heard that the bytes now agreed — until
  // something else made it look again. Only a file slot is compared, as the
  // typing path has it.
  if (isSlot(pane)) {
    for (const write of checked.transaction.writes) {
      editingHooks.onEdit?.(pane, {
        kind: "overwrite",
        start: write.offset,
        end: write.offset + write.bytes.length,
      });
    }
  }
  return undefined;
}

/**
 * Applies a transaction to a document no pane of this window shows — a part's parent shown in
 * another window — as one undoable step there. What a pane's edit tells the window around it is
 * the caller's to tell the window that shows it.
 *
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.applyToolWrites
 */
export async function applyDocumentTransaction(
  document: SessionView,
  transaction: ToolTransaction
): Promise<string | undefined> {
  const checked = validateTransaction(transaction);
  if (!checked.ok) return transactionProblemMessage(checked.problem);
  // Bounds are the document's to know, and they are checked before anything is
  // written: a transaction the file cannot hold is refused whole rather than
  // applied as far as it reaches.
  for (const write of checked.transaction.writes) {
    if (write.offset + write.bytes.length > document.size) {
      return L("That change would write past the end of this file.");
    }
  }
  document.beginEditGroup(checked.transaction.name);
  for (const write of checked.transaction.writes) {
    await document.overwrite(write.offset, write.bytes);
  }
  await document.endEditGroup();
  return undefined;
}
