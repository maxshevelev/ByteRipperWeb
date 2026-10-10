import type { BinaryDocument } from "@/core/document/binaryDocument";
import { appLanguage, L, LIn, LocalizedText } from "@/core/localization/localization";
import {
  type PartCodec,
  type PartParent,
  type PartReader,
  PartRefusal,
  type PartUpdate,
} from "@/core/parts/partCodec";
import { agentShell } from "@/state/agent/agentShell";
import type { DocumentOrigin } from "@/state/documentOrigin";
import { documentPartReader } from "@/state/documentPartReader";
import {
  BackgroundOperation,
  blockingOperationStore,
  presentBlocking,
} from "@/state/operationStore";
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
export function updateInParent(pane: PartId): Promise<UpdateOutcome> {
  return oneUpdateAtATime(pane, () => updateInParentNow(pane));
}

/** @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.performUpdateInParent */
async function updateInParentNow(pane: PartId): Promise<UpdateOutcome> {
  const slot = paneState(pane);
  const origin = slot?.origin;
  if (slot === undefined || origin === undefined) return { kind: "nothing" };
  // The parent as it is before anything here waits: what the update is worked out over.
  const asked = parentAsAsked(origin);
  if (!(await origin.hasChanges(slot.document))) return { kind: "nothing" };

  const plan = await origin.planUpdate(slot.document);
  if (plan.kind === "refused") {
    reportAlert(plan.refusal.title.text, plan.refusal.messageText.text, "problem");
    return { kind: "refused" };
  }
  const parent = paneState(origin.parent);
  if (parent === undefined || asked === undefined) return { kind: "refused" };
  if (plan.confirm && !confirmOverwritingChangedSource(origin)) return { kind: "cancelled" };
  const stepName = updateStepName(slot.name);
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
    return finishUpdate(update, origin, asked, content, plan.bytes, stepName);
  }
  return encodeBehindModal(plan.codec, plan.bytes, origin, asked, partParent, stepName);
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
  asked: ParentAsAsked,
  partParent: PartParent,
  stepName: string
): Promise<UpdateOutcome> {
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
  if (!stillAsAsked(origin, asked)) {
    reportParentChanged(origin);
    return { kind: "refused" };
  }
  return finishUpdate(result.update, origin, asked, partParent.content, bytes, stepName);
}

/**
 * What is said when the parent changed under an update: nothing was written, and why.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.performUpdateInParent
 */
function reportParentChanged(origin: DocumentOrigin): void {
  reportAlert(
    L("“%1$@” changed", origin.parentName),
    L("It changed while the update was being worked out. Nothing was written."),
    "problem"
  );
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
  asked: ParentAsAsked,
  content: PartReader,
  partBytes: Uint8Array,
  stepName: string
): Promise<UpdateOutcome> {
  const landed = await landUpdate(update, origin, asked, content, partBytes, stepName);
  if (landed.kind === "parentChanged") {
    reportParentChanged(origin);
    return { kind: "refused" };
  }
  if (landed.kind === "unreadable") {
    reportAlert(
      L("Could not update “%1$@”.", origin.parentName),
      L("Those bytes could not be read."),
      "problem"
    );
    return { kind: "refused" };
  }
  if (landed.kind === "failed") {
    reportAlert(L("Could not update “%1$@”.", origin.parentName), landed.problem, "problem");
    return { kind: "refused" };
  }
  // It says last where it can be taken back: in the parent, not in the part.
  reportAlert(
    L("Updated “%1$@”", origin.parentName),
    [...update.notes.map((note) => note.text), undoLine(origin)].join("\n\n"),
    "success"
  );
  return { kind: "updated", parent: origin.parent };
}

/**
 * Writes an update the codec worked out into the parent: unreadable when the parent's bytes could
 * not be read to work out what the source becomes, failed when the write itself did not land — the
 * link as it was.
 *
 * The parent is asked once more whether it is still what the update was worked out over, after the
 * last wait and right before the write: the read of the source is a wait, and upstream's landing,
 * which has none, cannot be overtaken where this one could.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.landUpdate
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.writeUpdate
 * @upstream-differs `parentChanged` when the parent moved during the read of the source
 */
async function landUpdate(
  update: PartUpdate,
  origin: DocumentOrigin,
  asked: ParentAsAsked,
  content: PartReader,
  partBytes: Uint8Array,
  stepName: string
): Promise<
  | { readonly kind: "landed" }
  | { readonly kind: "parentChanged" }
  | { readonly kind: "unreadable" }
  | { readonly kind: "failed"; readonly problem: string }
> {
  // What the source will be once the run is written: the parent as it is, with
  // the run laid over it. The file never changes length.
  let source: Uint8Array;
  try {
    source = await content.read(update.source[0], update.source[1] - update.source[0]);
  } catch {
    return { kind: "unreadable" };
  }
  if (!stillAsAsked(origin, asked)) return { kind: "parentChanged" };
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
      return { kind: "failed", problem };
    }
  }
  return { kind: "landed" };
}

/**
 * What the parent's Edit menu offers to undo after an update: in the app's language even when an
 * agent asked for the update in English.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.updateStepName
 */
export const updateStepName = (partName: string): string =>
  LIn("Update from %1$@", appLanguage(), partName);

/**
 * What Update in Parent came to, for a caller that asks no questions and shows no dialogs — the
 * agent: every case the command answers with an alert is a value here.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.QuietUpdateOutcome
 */
export type QuietUpdateOutcome =
  /** The part holds nothing the parent has not got back. */
  | { readonly kind: "unchanged" }
  /**
   * It cannot go back: the parent is closed, or the codec refused — in the codec's words, put
   * into words by the caller.
   */
  | { readonly kind: "refused"; readonly refusal: PartRefusal }
  /**
   * The source changed in the parent since the part was opened; going back would overwrite that,
   * and it was not allowed to.
   */
  | { readonly kind: "sourceChanged" }
  /** The parent changed while the update was worked out; nothing was written. */
  | { readonly kind: "parentChanged" }
  /** The write itself failed; nothing was written. */
  | { readonly kind: "writeFailed"; readonly reason: string }
  | { readonly kind: "updated"; readonly update: PartUpdate };

/**
 * Update in Parent with no questions and no dialogs: what the command does, the answers handed
 * back instead of shown. `overwritingChangedSource` is the answer to the one question the command
 * asks.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.updateInParentQuietly
 * @upstream-differs no read-only parent to refuse: a page edits every document it holds in memory
 */
export function updateInParentQuietly(
  pane: PartId,
  overwritingChangedSource: boolean
): Promise<QuietUpdateOutcome> {
  return oneUpdateAtATime(pane, () => updateInParentQuietlyNow(pane, overwritingChangedSource));
}

/** @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.updateInParentQuietly */
async function updateInParentQuietlyNow(
  pane: PartId,
  overwritingChangedSource: boolean
): Promise<QuietUpdateOutcome> {
  const slot = paneState(pane);
  const origin = slot?.origin;
  if (slot === undefined || origin === undefined) return { kind: "unchanged" };
  // The parent as it is before anything here waits: what the update is worked out over, as
  // upstream's, which reads its generation with nothing between it and the plan.
  const asked = parentAsAsked(origin);
  if (!(await origin.hasChanges(slot.document))) return { kind: "unchanged" };
  const plan = await origin.planUpdate(slot.document);
  if (plan.kind === "refused") return { kind: "refused", refusal: plan.refusal };
  const parent = paneState(origin.parent);
  if (parent === undefined || asked === undefined || parent.document !== asked.document) {
    return {
      kind: "refused",
      refusal: new PartRefusal(
        LocalizedText.of("The parent is closed"),
        LocalizedText.of(
          "“%1$@” is no longer open, so there is nothing to put “%2$@” back into.",
          origin.parentName,
          origin.partName
        )
      ),
    };
  }
  if (plan.confirm && !overwritingChangedSource) return { kind: "sourceChanged" };
  const content = documentPartReader(parent.document);
  const partParent: PartParent = {
    content,
    source: origin.sourceRange,
    name: origin.parentName,
    partName: origin.partName,
  };
  let update: PartUpdate;
  try {
    update = await plan.codec.encode(plan.bytes, partParent);
  } catch (error) {
    return {
      kind: "refused",
      refusal:
        error instanceof PartRefusal
          ? error
          : new PartRefusal(
              LocalizedText.of("“%1$@” cannot be put back", origin.partName),
              LocalizedText.verbatim(error instanceof Error ? error.message : String(error))
            ),
    };
  }
  // Worked out over the bytes as they were when asked.
  if (!stillAsAsked(origin, asked)) return { kind: "parentChanged" };
  const landed = await landUpdate(
    update,
    origin,
    asked,
    content,
    plan.bytes,
    updateStepName(slot.name)
  );
  if (landed.kind === "parentChanged") return { kind: "parentChanged" };
  if (landed.kind === "unreadable") {
    // Upstream's "The tab could not be read": a part here is a panel, never a tab, and the
    // sentence is the one `DocumentOrigin.planUpdate` already says for the same bytes.
    // @upstream-differs "part" for upstream's "tab": the web has no tabs of its own
    return { kind: "writeFailed", reason: LIn("The part could not be read", "en") };
  }
  if (landed.kind === "failed") return { kind: "writeFailed", reason: landed.problem };
  return { kind: "updated", update };
}

/**
 * The parent document an update writes into, and how many times its bytes had changed when the
 * update was asked for: read before the first wait, so that nothing which lands while the part is
 * compared, planned or encoded passes unseen.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.updateInParentQuietly
 * @upstream-differs a value of its own: upstream reads `contentGeneration` into a local with no
 * wait before it
 */
interface ParentAsAsked {
  readonly document: BinaryDocument;
  readonly generation: number;
}

/** The parent of `origin` as it is now; nothing once it is closed. */
function parentAsAsked(origin: DocumentOrigin): ParentAsAsked | undefined {
  const document = paneState(origin.parent)?.document;
  return document === undefined ? undefined : { document, generation: document.contentGeneration };
}

/** Whether the parent is still the document, and its bytes still the ones, `asked` read. */
function stillAsAsked(origin: DocumentOrigin, asked: ParentAsAsked): boolean {
  return (
    paneState(origin.parent)?.document === asked.document &&
    asked.document.contentGeneration === asked.generation
  );
}

/**
 * The update each parent document is in the middle of taking, which the next one waits behind.
 *
 * Upstream's update runs on the main actor: the plan, the check that the parent has not moved and
 * the write are one stretch nothing else runs inside, so a second update of the same part finds the
 * first one written and nothing left to put back. Here every one of those is a wait, and two
 * updates asked at once — an agent's call sent twice, an agent's beside the menu's — would both
 * plan over the same bytes and both write. One at a time per parent, the second is worked out over
 * what the first left: nothing new, usually, or a part that has changed since, as it would be had
 * it been asked a moment later.
 *
 * @web-only upstream's main actor is the queue
 */
const updatesUnderWay = new WeakMap<BinaryDocument, Promise<void>>();

/** `work` once every update already under way into `pane`'s parent has finished. */
function oneUpdateAtATime<T>(pane: PartId, work: () => Promise<T>): Promise<T> {
  const origin = paneState(pane)?.origin;
  const parent = origin === undefined ? undefined : paneState(origin.parent)?.document;
  if (parent === undefined) return work();
  const run = (updatesUnderWay.get(parent) ?? Promise.resolve()).then(work);
  updatesUnderWay.set(
    parent,
    run.then(
      () => undefined,
      () => undefined
    )
  );
  return run;
}

/**
 * Whether something the person is in the middle of holds the window, as an attached sheet holds
 * upstream's: the modal of a slow update, an alert still waiting for its button, or any other modal
 * dialog the shell has up.
 *
 * @upstream ByteRipperApp/Agent/AgentEditTools.swift#AgentEditTools.updateInParent
 * @upstream-differs three places to look where upstream asks the window for its `attachedSheet`
 */
export const aDialogIsOpen = (): boolean =>
  blockingOperationStore.getSnapshot() !== undefined ||
  workspaceStore.getSnapshot().alert !== undefined ||
  agentShell.busy?.() !== undefined;

/**
 * Why a part did not go back, in the codec's words.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.presentRefusal
 */
function presentRefusal(error: unknown, origin: DocumentOrigin): void {
  if (error instanceof PartRefusal) {
    reportAlert(error.title.text, error.messageText.text, "problem");
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
