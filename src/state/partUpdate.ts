import type { DocumentOrigin } from "@/state/documentOrigin";
import { applyTransaction } from "@/state/toolEdits";
import {
  type PaneId,
  type PartId,
  paneState,
  reportAlert,
  workspaceStore,
} from "@/state/workspaceStore";

/**
 * Update in Parent: the part's bytes put back where they came from, as one undo
 * step in the parent (`Design/UEFI/UPDATE_IN_PARENT.md` §3).
 *
 * Everything that can be wrong with it is decided before a byte moves — the
 * parent may have closed, the source may have changed under it, the part may
 * have grown — and the link says which (`DocumentOrigin.planUpdate`). What is
 * left here is the asking and the writing.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.performUpdateInParent
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.writeUpdate
 */

/** What an update did, for the caller that has to decide what happens next. */
export type UpdateOutcome =
  /** Written into the parent. */
  | { readonly kind: "updated"; readonly parent: PaneId }
  /** The parent already has these bytes. */
  | { readonly kind: "nothing" }
  /** Refused before anything moved; the reason has been shown. */
  | { readonly kind: "refused" }
  /** The reader backed out of overwriting a source that had changed. */
  | { readonly kind: "cancelled" };

/**
 * The question asked when the source has changed in the parent since the part
 * was taken out of it: overwriting those changes is the reader's call.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.confirmOverwritingChangedSource
 * @upstream-differs the browser's own confirmation, which carries one message
 * rather than a title and a body
 */
function confirmOverwritingChangedSource(origin: DocumentOrigin): boolean {
  return window.confirm(
    `“${origin.partName}” has changed in ${origin.parentName}. ` +
      "Its bytes there are no longer the ones this part was opened from. " +
      "Updating overwrites those changes with this part's bytes."
  );
}

/**
 * Puts `pane`'s bytes back into the document they came out of.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.performUpdateInParent
 */
export async function updateInParent(pane: PartId): Promise<UpdateOutcome> {
  const slot = paneState(pane);
  const origin = slot?.origin;
  if (slot === undefined || origin === undefined) return { kind: "nothing" };
  if (!(await origin.hasChanges(slot.document))) return { kind: "nothing" };

  const plan = await origin.planUpdate(slot.document);
  if (plan.kind === "refused") {
    reportAlert(plan.title, plan.message);
    return { kind: "refused" };
  }
  if (plan.confirm && !confirmOverwritingChangedSource(origin)) return { kind: "cancelled" };

  // The link takes the new bytes as the truth *before* the write, so the change
  // the write announces already finds it intact with nothing left to put back —
  // and is put back as it was if the write does not land.
  const snapshot = origin.adopt(plan.bytes, plan.bytes, [
    plan.offset,
    plan.offset + plan.bytes.length,
  ]);
  const problem = await applyTransaction(origin.parent, {
    name: `Update from ${slot.name}`,
    writes: [{ offset: plan.offset, bytes: plan.bytes }],
  });
  if (problem !== undefined) {
    origin.restore(snapshot);
    reportAlert(`Could not update “${origin.parentName}”.`, problem);
    return { kind: "refused" };
  }
  return { kind: "updated", parent: origin.parent };
}

/**
 * What the Update in Parent item is called, and whether it can do anything:
 * named after the parent, enabled while there is something to put back into a
 * parent that is still open.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.validateUpdateInParent
 */
export async function updateInParentItem(pane: PaneId): Promise<{
  readonly title: string;
  readonly enabled: boolean;
}> {
  const slot = paneState(pane);
  const origin = slot?.origin;
  if (slot === undefined || origin === undefined) {
    return { title: "Update in Parent", enabled: false };
  }
  const title = `Update in “${origin.parentName}”`;
  const state = await origin.state();
  if (state === "parentClosed") return { title, enabled: false };
  return { title, enabled: await origin.hasChanges(slot.document) };
}

/**
 * The parts that came out of `pane` — the ones whose way home closing it would
 * take away.
 *
 * @upstream ByteRipperApp/Fragments/FragmentPanels.swift#FragmentPanels.panelsLinked
 */
export function partsLinkedTo(pane: PaneId): PartId[] {
  const state = workspaceStore.getSnapshot();
  return Object.entries(state.parts)
    .filter(([, part]) => part.origin?.parent === pane)
    .map(([id]) => id as PartId);
}

/**
 * What the reader is told about the parts that were taken out of what they are
 * closing. Their link does not follow it anywhere: it stops leading somewhere,
 * and Update in Parent stops being on offer for them.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.strandingSentence
 */
export const strandingSentence = (count: number): string =>
  count === 1
    ? "One panel was opened out of it and will lose its way back. " +
      "Its bytes stay as they are; only the way back goes."
    : `${count} panels were opened out of it and will lose their way back. ` +
      "Their bytes stay as they are; only the way back goes.";

/** @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.strandingCloseButton */
export const strandingCloseButton = (count: number): string =>
  count === 1 ? "Close and Break Link" : "Close and Break Links";
