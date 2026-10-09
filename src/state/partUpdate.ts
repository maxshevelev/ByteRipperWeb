import { L } from "@/core/localization/localization";
import {
  type PartCodec,
  type PartParent,
  type PartReader,
  PartRefusal,
  type PartUpdate,
} from "@/core/parts/partCodec";
import type { DocumentOrigin } from "@/state/documentOrigin";
import { documentPartReader } from "@/state/documentPartReader";
import { BackgroundOperation, presentBlocking } from "@/state/operationStore";
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
 * parent may have closed, the source may have changed under it — and the link
 * says which (`DocumentOrigin.planUpdate`). What goes back is the codec's
 * (`PartCodec.encode`): the same bytes, the bytes encoded again, a body
 * compressed again and the image laid out around it. What is left here is the
 * asking and the writing.
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
// @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.updateConfirm
// @upstream-differs a test seam upstream (the alert is handed to a closure); here the browser's confirmation is called directly
function confirmOverwritingChangedSource(origin: DocumentOrigin): boolean {
  return window.confirm(
    `${L("“%1$@” has changed in %2$@", origin.partName, origin.parentName)}. ${L(
      "Its bytes there are no longer the ones this part was opened from. Updating overwrites those changes with this part's bytes."
    )}`
  );
}

/**
 * Puts `pane`'s bytes back into the document they came out of.
 *
 * A quick codec — a copy, an XOR — is written on the spot; a slow one works in
 * the parent's worker behind a modal that says what is being done and how far
 * it has got, with a Cancel that abandons the result: the work cannot be
 * stopped halfway, but nothing is written until it is done, so abandoning costs
 * nothing. It is modal for upstream's own reason — the update is worked out
 * over the parent's bytes as they were when it was asked for, and a change
 * landing under it would only be thrown away with it.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.performUpdateInParent
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.beginUpdateOperation
 * @upstream-differs one window: upstream's sheet hangs on the parent's window
 * and brings that window to the front first, where this modal is the one
 * window's own
 */
export async function updateInParent(pane: PartId): Promise<UpdateOutcome> {
  const slot = paneState(pane);
  const origin = slot?.origin;
  if (slot === undefined || origin === undefined) return { kind: "nothing" };
  if (!(await origin.hasChanges(slot.document))) return { kind: "nothing" };

  const plan = await origin.planUpdate(slot.document);
  if (plan.kind === "refused") {
    reportAlert(plan.title, plan.message, "problem");
    return { kind: "refused" };
  }
  const parent = paneState(origin.parent);
  if (parent === undefined) return { kind: "refused" };
  if (plan.confirm && !confirmOverwritingChangedSource(origin)) return { kind: "cancelled" };
  const stepName = L("Update from %1$@", slot.name);
  const content = documentPartReader(parent.document);
  const partParent: PartParent = {
    content,
    source: origin.sourceRange,
    name: origin.parentName,
    partName: origin.partName,
  };

  if (plan.codec.isImmediate) {
    let update: PartUpdate;
    try {
      update = await plan.codec.encode(plan.bytes, partParent);
    } catch (error) {
      presentRefusal(error, origin);
      return { kind: "refused" };
    }
    return finishUpdate(update, origin, content, plan.bytes, stepName);
  }
  return encodeBehindModal(plan.codec, plan.bytes, origin, partParent, stepName);
}

/**
 * The slow half: the codec's work behind a modal, and what it worked out
 * written only if the parent is still what it was when the work began.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.performUpdateInParent
 */
async function encodeBehindModal(
  codec: PartCodec,
  bytes: Uint8Array,
  origin: DocumentOrigin,
  partParent: PartParent,
  stepName: string
): Promise<UpdateOutcome> {
  const parent = paneState(origin.parent);
  if (parent === undefined) return { kind: "refused" };
  const document = parent.document;
  const generation = document.contentGeneration;

  // What upstream's `UpdateHandle` carries — the task and the operation the (×) reaches it
  // through — is this closure and the flag it sets: one thread, nothing to cancel but the wait.
  // @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.UpdateHandle
  // @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.UpdateHandle.task
  // @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.UpdateHandle.operation
  let abandoned = false;
  const operation = new BackgroundOperation(L("Getting ready"), () => {
    abandoned = true;
    operation.finish();
  });
  presentBlocking(L("Updating “%1$@” from “%2$@”", origin.parentName, origin.partName), operation);
  let result: { readonly update: PartUpdate } | { readonly error: unknown };
  try {
    result = {
      update: await codec.encode(bytes, {
        ...partParent,
        progress: (phase, fraction) => {
          if (phase !== undefined) operation.rename(phase);
          if (fraction !== undefined) operation.report(fraction);
        },
      }),
    };
  } catch (error) {
    result = { error };
  }
  operation.finish();
  // Abandoned from the modal: nothing was written, and nothing is said.
  if (abandoned) return { kind: "cancelled" };
  if ("error" in result) {
    presentRefusal(result.error, origin);
    return { kind: "refused" };
  }
  // Worked out over the bytes as they were when asked.
  const now = paneState(origin.parent);
  if (now === undefined || now.document !== document || document.contentGeneration !== generation) {
    reportAlert(
      L("“%1$@” changed", origin.parentName),
      L("It changed while the update was being worked out. Nothing was written."),
      "problem"
    );
    return { kind: "refused" };
  }
  return finishUpdate(result.update, origin, partParent.content, bytes, stepName);
}

/**
 * Writes an update the codec worked out and says so — with what the codec had
 * to say about it, and how to take it back.
 *
 * The link takes the new bytes as the truth *before* the write, so the change
 * the write announces already finds it intact with nothing left to put back —
 * and is put back as it was if the write does not land.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.finishUpdate
 * @upstream-differs showing where the update landed is the caller's
 * (`putBack` in the shell), which holds the panels
 */
async function finishUpdate(
  update: PartUpdate,
  origin: DocumentOrigin,
  content: PartReader,
  partBytes: Uint8Array,
  stepName: string
): Promise<UpdateOutcome> {
  // What the source will be once the run is written: the parent as it is, with
  // the run laid over it. The file never changes length.
  let source: Uint8Array;
  try {
    source = await content.read(update.source[0], update.source[1] - update.source[0]);
  } catch {
    reportAlert(
      L("Could not update “%1$@”.", origin.parentName),
      L("Those bytes could not be read."),
      "problem"
    );
    return { kind: "refused" };
  }
  const runEnd = update.offset + update.bytes.length;
  const from = Math.max(update.offset, update.source[0]);
  const to = Math.min(runEnd, update.source[1]);
  if (from < to) {
    source.set(
      update.bytes.subarray(from - update.offset, to - update.offset),
      from - update.source[0]
    );
  }

  const snapshot = origin.adopt(partBytes, source, update.source);
  if (update.bytes.length > 0) {
    const problem = await applyTransaction(origin.parent, {
      name: stepName,
      writes: [{ offset: update.offset, bytes: update.bytes }],
    });
    if (problem !== undefined) {
      origin.restore(snapshot);
      reportAlert(L("Could not update “%1$@”.", origin.parentName), problem, "problem");
      return { kind: "refused" };
    }
  }
  // It says last where it can be taken back: in the parent, not in the part.
  reportAlert(
    L("Updated “%1$@”", origin.parentName),
    [...update.notes, undoLine(origin)].join("\n\n"),
    "success"
  );
  return { kind: "updated", parent: origin.parent };
}

/**
 * Why a part did not go back, in the codec's words.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.presentRefusal
 */
function presentRefusal(error: unknown, origin: DocumentOrigin): void {
  if (error instanceof PartRefusal) {
    reportAlert(error.title, error.message, "problem");
    return;
  }
  reportAlert(
    L("“%1$@” cannot be put back", origin.partName),
    error instanceof Error ? error.message : String(error),
    "problem"
  );
}

/**
 * What an update says last: where it can be taken back. The update is one undo
 * step in the parent, not in the part it was made in.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.undoLine
 * @upstream-differs Undo rather than ⌘Z: the key is the platform's
 */
function undoLine(origin: DocumentOrigin): string {
  return L("Undo in “%1$@” takes it back.", origin.parentName);
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
    return { title: L("Update in Parent"), enabled: false };
  }
  const title = L("Update in “%1$@”", origin.parentName);
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
    ? L(
        "One panel was opened out of it and will lose its way back. Its bytes stay as they are; only the way back goes."
      )
    : L(
        "%1$@ panels were opened out of it and will lose their way back. Their bytes stay as they are; only the way back goes.",
        count
      );

/** @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.strandingCloseButton */
export const strandingCloseButton = (count: number): string =>
  count === 1 ? L("Close and Break Link") : L("Close and Break Links");
