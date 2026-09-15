import type { PaneId } from "@/state/workspaceStore";
import { workspaceStore } from "@/state/workspaceStore";
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

  const slot = workspaceStore.getSnapshot().panes[pane];
  if (slot === undefined) return "That pane has no file open.";

  // Bounds are the document's to know, and they are checked before anything is
  // written: a transaction the file cannot hold is refused whole rather than
  // applied as far as it reaches.
  for (const write of checked.transaction.writes) {
    if (write.offset + write.bytes.length > slot.document.size) {
      return "That change would write past the end of this file.";
    }
  }

  slot.document.beginEditGroup(checked.transaction.name);
  for (const write of checked.transaction.writes) {
    await slot.document.overwrite(write.offset, write.bytes);
  }
  slot.document.endEditGroup();
  return undefined;
}
