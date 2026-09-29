import { BYTES_PER_ROW } from "@/core/document/rowWidth";
import { L } from "@/core/localization/localization";
import { applyTransaction } from "@/state/toolEdits";
import {
  isSlot,
  type PaneId,
  paneState,
  reportAlert,
  type SlotId,
  type WorkspaceState,
  windowPanesAreReachable,
  workspaceStore,
} from "@/state/workspaceStore";
import { scrollLink } from "@/ui/pane/scrollLink";

/**
 * Copy to Other Pane: a selection written over the same addresses in the other
 * pane, in one step and without the clipboard.
 *
 * The four steps it replaces — select, copy, select the same range again,
 * paste — spend two of them re-entering an address that is identical on both
 * sides by the premise of the app, and pass the bytes through a clipboard any
 * stray copy in between would silently replace.
 */

const otherSlot = (slot: SlotId): SlotId => (slot === "a" ? "b" : "a");

/**
 * Whether Copy to Other Pane can run from `source`: two files, neither behind a
 * fragment panel, `source` one of them — a fragment panel's pane has no pane
 * beside it — and a selection in it. The refusal that needs a sentence, a range
 * past the other file's end, is left to the command, which can say which file
 * and which address.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.canCopyToOtherPane
 */
export function canCopyToOtherPane(state: WorkspaceState, source: PaneId): boolean {
  if (!isSlot(source) || !windowPanesAreReachable(state)) return false;
  const from = state.panes[source];
  if (from === undefined || state.panes[otherSlot(source)] === undefined) return false;
  const { start, end } = from.document.selection;
  return end > start;
}

/**
 * Writes `source`'s selection over the same addresses in the other pane.
 *
 * Overwrite only, the rule paste follows: no byte moves, and a range that runs
 * past the end of the other file is refused rather than growing it — an
 * image's length is its chip's. One undo step in the receiving file, and the
 * copy is shown where it landed, selected, so the reader sees that it happened
 * and what it covered.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.copyToOtherPane
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.copyPaneSelectionToOtherPane
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.copySelectionToOtherPane
 * @upstream-differs no read-only refusal: a page edits every document it holds in
 * memory, so there is no destination that cannot be written into
 */
export async function copySelectionToOtherPane(source: PaneId): Promise<void> {
  const state = workspaceStore.getSnapshot();
  if (!isSlot(source) || !canCopyToOtherPane(state, source)) return;
  const name = L("Copy to Other Pane");
  const target = otherSlot(source);
  const from = state.panes[source];
  const into = state.panes[target];
  if (from === undefined || into === undefined) return;
  const { start, end } = from.document.selection;
  if (end > into.document.size) {
    reportAlert(
      name,
      L(
        "The selection ends at %1$@, past the end of “%2$@”, which ends at %3$@. Nothing was copied.",
        hex(end),
        into.name,
        hex(into.document.size)
      )
    );
    return;
  }
  let problem: string | undefined;
  try {
    const bytes = await from.document.read(start, end - start);
    problem = await applyTransaction(target, { name, writes: [{ offset: start, bytes }] });
  } catch (error) {
    problem = error instanceof Error ? error.message : String(error);
  }
  if (problem !== undefined) {
    reportAlert(name, problem);
    return;
  }
  // The receiving pane may well be scrolled somewhere else.
  const landed = paneState(target);
  if (landed === undefined) return;
  await landed.typing.setSelection(start, end);
  scrollLink.scrollToOffset(target, start, BYTES_PER_ROW, { centre: true });
}

const hex = (value: number) => `0x${value.toString(16).toUpperCase()}`;
