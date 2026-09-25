import type { DiffEdit } from "@/core/diff/diffEngine";
import { type Segment, SegmentLink } from "@/core/segments/segmentation";
import {
  type SegmentReplaceOutcome,
  replaceSegment,
  SegmentLengthMismatch,
} from "@/core/segments/segmentReplacer";
import {
  type Part,
  partsFor,
  previewWrite,
  writeParts,
  writeTitle,
} from "@/core/segments/segmentWriter";
import { ChunkCache } from "@/core/storage/chunkCache";
import { FileBackedStorage } from "@/core/storage/fileBackedStorage";
import { friendlySize } from "@/core/text/byteSize";
import { hexAddress } from "@/core/text/hexText";
import { detectFileCapabilities } from "@/platform/files/capabilities";
import { openFiles } from "@/platform/files/openFile";
import { directorySink, namesIn, pickDirectory, zipSink } from "@/platform/files/partSinks";
import { saveRange } from "@/platform/files/rangeSave";
import { noteEdit } from "@/state/diffStore";
import { BackgroundOperation, beginOperation } from "@/state/operationStore";
import { noteMinimapEdit } from "@/state/minimapStore";
import { applySegments, segmentLabel, segmentsFor } from "@/state/segmentsStore";
import { segmentRevertDonor, segmentSource, sourceIDForFile } from "@/state/segmentSources";
import { noteSearchEdit } from "@/state/searchStore";
import { showTransientMessage } from "@/state/transientMessageStore";
import { groupActs } from "@/state/undoRouter";
import { type PaneId, paneState, reportAlert } from "@/state/workspaceStore";

/**
 * What the segment commands actually do.
 *
 * One module for them because each is reachable from three places — the dump's
 * right-click menu, the segments dialog's row menu, and the toolbar's menu —
 * and a command that behaved differently depending on which one opened it would
 * be three commands wearing one name.
 */

/**
 * Adds a cut at `offset`, naming the piece that starts there. Says whether it took.
 *
 * @upstream ByteRipperApp/Segments/SegmentStore.swift#SegmentStore.addCut
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.addCut
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.splitHere
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.presentCutEditPopover
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.cutEditPresenter
 */
export function addCut(pane: PaneId, offset: number, name = ""): boolean {
  return applySegments(pane, (partition) => {
    const cut = partition.addCut(offset);
    if (cut === undefined) return undefined;
    // The cut splits the piece at `offset`; the new piece is the one that
    // *starts* there, so it is the one the name belongs to.
    const piece = cut.indexContaining(offset);
    return name.length > 0 && piece !== undefined ? cut.rename(piece, name) : cut;
  });
}

/**
 * Merges the piece at `index` into its neighbour, which keeps its name.
 *
 * @upstream ByteRipperApp/Segments/SegmentStore.swift#SegmentStore.removePiece
 * @upstream ByteRipperApp/Segments/SegmentStore.swift#SegmentStore.removeCut
 * @upstream ByteRipperApp/Segments/SegmentsForm.swift#SegmentsFormController.removeCutPressed
 * @upstream ByteRipperApp/Segments/SegmentsForm.swift#SegmentsFormController.removeSelectedSegment
 * @upstream ByteRipperApp/Segments/SegmentsForm.swift#SegmentsFormController.removeClickedSegment
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.removeSegment
 */
export function mergePiece(pane: PaneId, index: number): boolean {
  return applySegments(pane, (partition) => partition.removePiece(index));
}

/**
 * Back to one piece covering the file, keeping the first piece's name.
 *
 * @upstream ByteRipperApp/Segments/SegmentsForm.swift#SegmentsFormController.removeAllPressed
 * @upstream ByteRipperApp/Segments/SegmentsForm.swift#SegmentsFormController.confirmRemoveAll
 */
export function mergeAll(pane: PaneId): boolean {
  return applySegments(pane, (partition) => {
    if (partition.cuts.length === 0) return undefined;
    // Removed from the end, so each removal's index still means what it meant:
    // removing a piece renumbers everything after it.
    let current = partition;
    for (let index = current.segments.length - 1; index >= 1; index--) {
      current = current.removePiece(index) ?? current;
    }
    return current;
  });
}

/** @upstream ByteRipperApp/Segments/SegmentStore.swift#SegmentStore.rename */
export function renamePiece(pane: PaneId, index: number, name: string): boolean {
  return applySegments(pane, (partition) => partition.rename(index, name));
}

/**
 * Moves the cut that opens a piece to another offset.
 *
 * @upstream ByteRipperApp/Segments/SegmentStore.swift#SegmentStore.moveCut
 */
export function moveCut(pane: PaneId, from: number, to: number): boolean {
  return applySegments(pane, (partition) => partition.moveCut(from, to));
}

/**
 * The piece under an offset, or nothing when the pane has no partition.
 *
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.segmentStore
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.onSegmentsChanged
 */
export function pieceAt(pane: PaneId, offset: number): Segment | undefined {
  return segmentsFor(pane)?.containing(offset);
}

/** What the saved files are named after: the name the pane's header shows. */
function baseName(pane: PaneId): string {
  return paneState(pane)?.name ?? "Untitled";
}

/**
 * Save Segment…: one piece to a file the user chooses (§21.5).
 *
 * @upstream ByteRipperApp/Segments/SegmentsForm.swift#SegmentsFormController.savePiece
 * @upstream ByteRipperApp/Segments/SegmentsForm.swift#SegmentsFormController.saveSegment
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.savePiece
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.minimapMenuSaveSegment
 */
export async function savePiece(pane: PaneId, piece: Segment): Promise<void> {
  const slot = paneState(pane);
  if (slot === undefined) return;
  const name = `${baseName(pane)}_${segmentLabel(piece.index)}.bin`;
  try {
    const outcome = await saveRange(slot.document.storage, piece.start, piece.end, name);
    // Upstream saves into the folder the user chose and says nothing: the file
    // is there. A download is the case that needs words — the copy went
    // somewhere the user did not point at, and no folder holds it.
    // @web-only a page cannot write into a chosen folder where the browser has
    // no picker, so the copy is downloaded and the pane's line says so
    if (outcome === "downloaded") {
      showTransientMessage(
        pane,
        `Downloaded ${name}. This browser cannot write to a folder you choose.`
      );
    }
  } catch (error) {
    reportAlert(
      `Could not save “${name}”.`,
      error instanceof Error ? error.message : "That segment could not be saved."
    );
  }
}

/**
 * Save All as Separate Files (§21.5).
 *
 * A folder where the browser offers one and a ZIP where it does not, and the
 * one confirmation names every part and every file it would replace — before
 * anything is written, which is the whole point of asking.
 */
export async function saveAllPieces(
  pane: PaneId,
  confirm: (title: string, message: string) => Promise<boolean>
): Promise<void> {
  const slot = paneState(pane);
  const pieces = segmentsFor(pane)?.segments ?? [];
  if (slot === undefined || pieces.length === 0) return;

  const parts = partsFor(pieces, baseName(pane));
  let cancelled = false;
  const operation = new BackgroundOperation(
    `Writing ${parts.length} segment${parts.length === 1 ? "" : "s"}…`,
    () => {
      cancelled = true;
    }
  );
  // The strip goes up once the writing starts, not while a dialog is asking.
  const write = (sink: Parameters<typeof writeParts>[2]) => {
    beginOperation(pane, operation);
    return writeParts(parts, slot.document.storage, sink, {
      shouldCancel: () => cancelled,
      onProgress: (fraction) => operation.report(fraction),
    });
  };
  try {
    if (detectFileCapabilities().canPickDirectory) {
      const directory = await pickDirectory();
      if (directory === undefined) return;
      const preview = previewWrite(parts, await namesIn(directory));
      if (!(await confirm(writeTitle(parts.length), messageFor(preview)))) return;
      await write(directorySink(directory));
      // Upstream writes the files and stops there: the folder holds them, and a
      // confirmation would have to interrupt to say what the user can see.
    } else {
      const preview = previewWrite(parts);
      const archive = `${baseName(pane)}_segments.zip`;
      if (
        !(await confirm(writeTitle(parts.length), `${messageFor(preview)}\n\nInto ${archive}.`))
      ) {
        return;
      }
      await write(zipSink(archive));
      // The same words as a single saved piece, for the same reason (§D7).
      showTransientMessage(
        pane,
        `Downloaded ${archive}. This browser cannot write into a folder you choose.`
      );
    }
  } catch (error) {
    // @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.runSegmentWrite
    reportAlert(
      "Saving segments failed.",
      error instanceof Error ? error.message : "Those segments could not be written."
    );
  } finally {
    operation.finish();
  }
}

function messageFor(preview: { lines: readonly string[]; replacing: readonly string[] }): string {
  const lines = preview.lines.join("\n");
  if (preview.replacing.length === 0) return lines;
  return `${lines}\n\nThese files will be replaced:\n${preview.replacing.join("\n")}`;
}

/**
 * What the segment commands ask the app.
 *
 * The one question they ask — a swap that would change the document's length
 * moves every offset after the piece, which is a decision the user makes, not
 * the command's — needs the app to draw a dialog, and a command module cannot
 * import React. So the app installs the question, the way it installs
 * `editingHooks.confirmShift`, and a command reached before one is installed
 * (a test that answers nothing) is refused, which is the safe direction:
 * nothing moves.
 */
export const segmentAsks: {
  lengthChange?:
    | ((question: {
        readonly title: string;
        readonly message: string;
        readonly confirmLabel: string;
      }) => Promise<boolean>)
    | undefined;
} = {};

/**
 * The one question a swap asks when the piece and the file are not the same
 * length (§21.6, §21.7): both lengths named, and what agreeing to it moves.
 * A same-length swap never asks. Refused where no one is installed to answer.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.confirmSegmentLengthChange
 */
function askLengthChange(question: {
  readonly title: string;
  readonly label: string;
  readonly pieceLength: number;
  readonly sourceName: string;
  readonly sourceLength: number;
  readonly confirmLabel: string;
}): Promise<boolean> {
  const grows = question.sourceLength > question.pieceLength;
  const shift = grows
    ? question.sourceLength - question.pieceLength
    : question.pieceLength - question.sourceLength;
  const message =
    `${question.label} is ${friendlySize(question.pieceLength)}, and ` +
    `“${question.sourceName}” is ${friendlySize(question.sourceLength)}. ` +
    `Taking the file’s length ${grows ? "adds" : "removes"} ` +
    `${friendlySize(shift)} at the end of the segment, so every segment ` +
    "after it moves by that much.";
  const ask = segmentAsks.lengthChange;
  if (ask === undefined) return Promise.resolve(false);
  return ask({ title: question.title, message, confirmLabel: question.confirmLabel });
}

/**
 * What a swap tells the stores that read the document, and how it moves the
 * partition's boundaries.
 *
 * The byte change itself went through the document, which tells the dirty flag
 * and the tool's tree — but the comparison, the search, the minimap and the
 * cuts read their own stores, which the document does not touch. So the command
 * says them what happened, and moves the cuts to match. A same-length swap
 * moves no cut; one that changed the length adds or removes the difference at
 * the piece's tail and moves the cuts after it.
 *
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.replaceSegment
 */
function notifySwap(pane: PaneId, piece: Segment, outcome: SegmentReplaceOutcome): void {
  const size = paneState(pane)?.document.size ?? 0;
  const content = (edit: DiffEdit) => {
    noteEdit(edit);
    noteSearchEdit(pane, edit);
    noteMinimapEdit(pane);
  };
  switch (outcome.kind) {
    case "none":
      // An overwrite moves no cut, so there is no partition edit — only the
      // content-change repaint.
      content({ kind: "overwrite", start: piece.start, end: piece.end });
      return;
    case "inserted":
      content({ kind: "overwrite", start: piece.start, end: outcome.at });
      // The added bytes are this piece's, not the next piece's: they replaced
      // it, so the boundary that closed it moves out past them and every piece
      // after it moves whole — links and all (§21.7). The ordinary `.insert`
      // rule would hand them to the piece that starts at the boundary (§21.2),
      // which is right for an edit made there and wrong for a swap.
      applySegments(
        pane,
        (partition) => partition.applyGrowth(piece.index, outcome.length, size)
      );
      content({ kind: "insert", at: outcome.at, length: outcome.length });
      return;
    case "deleted":
      content({ kind: "overwrite", start: piece.start, end: outcome.start });
      applySegments(
        pane,
        (partition) =>
          partition.applyEdit(
            { kind: "delete", start: outcome.start, end: outcome.end },
            size
          ).partition
      );
      content({ kind: "delete", start: outcome.start, end: outcome.end });
      return;
  }
}

/**
 * Revert Segment to «file»: puts the piece's bytes back to the file they
 * came from — the inverse of the join that brought them in, one piece at a
 * time. One undo step, and the link stays: the bytes are still that file's.
 *
 * The length is the one thing that can have come apart — an insert or a delete
 * inside the piece, or the source rewritten a different size — and then the
 * user is asked before the pieces after it are moved.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.revertPiece
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.revertSegment
 */
export async function revertPiece(pane: PaneId, piece: Segment): Promise<void> {
  const slot = paneState(pane);
  if (slot === undefined) return;
  const source = segmentSource(pane, piece);
  const link = piece.link;
  if (source === undefined || link === undefined) return;
  const donor = segmentRevertDonor(pane, piece);
  if (donor === undefined) {
    reportAlert(
      `“${source.name}” cannot be read`,
      `${segmentLabel(piece.index)} came from it, but it is no longer there to go back to. ` +
        "Nothing in the dump was changed."
    );
    return;
  }
  const label = segmentLabel(piece.index);
  let allowingLengthChange = false;
  if (donor.size !== piece.end - piece.start) {
    const agreed = await askLengthChange({
      title: `Restore ${label} at the source’s length?`,
      label,
      pieceLength: piece.end - piece.start,
      sourceName: source.name,
      sourceLength: donor.size,
      confirmLabel: "Restore Length",
    });
    if (!agreed) return;
    allowingLengthChange = true;
  }
  try {
    await groupActs(pane, async () => {
      const outcome = await replaceSegment({
        document: slot.document,
        start: piece.start,
        end: piece.end,
        donor,
        label: `Revert ${label}`,
        allowingLengthChange,
      });
      notifySwap(pane, piece, outcome);
      // The bytes are still that file's — but the file may now be a different
      // length than the piece was, so the link re-records what it now spans.
      applySegments(
        pane,
        (partition) =>
          partition.setLink(
            new SegmentLink(link.source, link.start, link.start + donor.size),
            Math.min(piece.index, partition.segments.length - 1)
          )
      );
    });
  } catch (error) {
    reportAlert(
      "Reverting the segment failed.",
      error instanceof Error ? error.message : "That segment could not be reverted."
    );
  }
}

/**
 * Replace Segment from File… (§21.6).
 *
 * The donor may be a different length than the piece: the same-length case
 * writes it in place and moves no cut, and a different length is a question —
 * the file can take the piece's place at its own length, and the pieces after
 * it move by the difference. Only the user can say whether that is what they
 * meant, so a plain same-length swap never asks, and a refusal changes nothing.
 *
 * @upstream ByteRipperApp/Segments/SegmentsForm.swift#SegmentsFormController.replacePiece
 * @upstream ByteRipperApp/Segments/SegmentsForm.swift#SegmentsFormController.replaceSegmentFromFile
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.replacePiece
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.minimapMenuReplaceSegment
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.replaceSegment
 */
export async function replacePieceFromFile(pane: PaneId, piece: Segment): Promise<void> {
  const slot = paneState(pane);
  if (slot === undefined) return;
  const [donor] = await openFiles({ multiple: false, capabilities: detectFileCapabilities() });
  if (donor === undefined) return;
  const label = segmentLabel(piece.index);
  const storage = new FileBackedStorage(donor.source, new ChunkCache());
  const run = async (allowingLengthChange: boolean): Promise<void> => {
    await groupActs(pane, async () => {
      const outcome = await replaceSegment({
        document: slot.document,
        start: piece.start,
        end: piece.end,
        donor: storage,
        label: `Replace ${label}`,
        allowingLengthChange,
      });
      notifySwap(pane, piece, outcome);
      // The bytes now come from the file the user pointed at, at its own length.
      applySegments(
        pane,
        (partition) =>
          partition.setLink(
            new SegmentLink(sourceIDForFile(pane, donor), 0, storage.size),
            Math.min(piece.index, partition.segments.length - 1)
          )
      );
    });
  };
  try {
    await run(false);
  } catch (error) {
    if (error instanceof SegmentLengthMismatch) {
      // A mismatch is a question, not a refusal (§21.6): the file can take the
      // piece's place at its own length, and the pieces after it move by the
      // difference. The first attempt rolled back, so nothing has changed.
      const agreed = await askLengthChange({
        title: `Replace ${label} at the file’s length?`,
        label,
        pieceLength: error.pieceLength,
        sourceName: donor.name,
        sourceLength: error.donorLength,
        confirmLabel: "Replace and Resize",
      });
      if (!agreed) return;
      try {
        await run(true);
      } catch (inner) {
        reportAlert(
          "Replacing the segment failed.",
          inner instanceof Error ? inner.message : "That segment could not be replaced."
        );
      }
      return;
    }
    reportAlert(
      "Replacing the segment failed.",
      error instanceof Error ? error.message : "That segment could not be replaced."
    );
  }
}

export type { Part };
/** The address a command names in its own title. */
export { hexAddress };
