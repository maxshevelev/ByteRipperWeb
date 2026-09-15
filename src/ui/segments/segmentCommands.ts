import type { Segment } from "@/core/segments/segmentation";
import { replaceSegment, SegmentLengthMismatch } from "@/core/segments/segmentReplacer";
import {
  type Part,
  partsFor,
  previewWrite,
  writeParts,
  writeTitle,
} from "@/core/segments/segmentWriter";
import { ChunkCache } from "@/core/storage/chunkCache";
import { FileBackedStorage } from "@/core/storage/fileBackedStorage";
import { hexAddress } from "@/core/text/hexText";
import { detectFileCapabilities } from "@/platform/files/capabilities";
import { openFiles } from "@/platform/files/openFile";
import { directorySink, namesIn, pickDirectory, zipSink } from "@/platform/files/partSinks";
import { saveRange } from "@/platform/files/rangeSave";
import { BackgroundOperation, beginOperation } from "@/state/operationStore";
import { applySegments, segmentLabel, segmentsFor } from "@/state/segmentsStore";
import { type PaneId, reportProblem, workspaceStore } from "@/state/workspaceStore";

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
  return workspaceStore.getSnapshot().panes[pane]?.name ?? "Untitled";
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
  const slot = workspaceStore.getSnapshot().panes[pane];
  if (slot === undefined) return;
  const name = `${baseName(pane)}_${segmentLabel(piece.index)}.bin`;
  try {
    const outcome = await saveRange(slot.document.storage, piece.start, piece.end, name);
    if (outcome === "downloaded") {
      reportProblem(`Downloaded ${name}. This browser cannot write to a folder you choose.`);
    }
  } catch (error) {
    reportProblem(error instanceof Error ? error.message : "That segment could not be saved.");
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
  const slot = workspaceStore.getSnapshot().panes[pane];
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
      reportProblem(`Wrote ${parts.length} segment${parts.length === 1 ? "" : "s"}.`);
    } else {
      const preview = previewWrite(parts);
      const archive = `${baseName(pane)}_segments.zip`;
      if (
        !(await confirm(writeTitle(parts.length), `${messageFor(preview)}\n\nInto ${archive}.`))
      ) {
        return;
      }
      await write(zipSink(archive));
      reportProblem(`Downloaded ${archive}. This browser cannot write into a folder you choose.`);
    }
  } catch (error) {
    reportProblem(error instanceof Error ? error.message : "Those segments could not be written.");
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
 * Replace Segment from File… (§21.6).
 *
 * The donor must be exactly as long as the piece. A mismatch is refused with
 * both sizes named, because making it an insert-and-shift would move every
 * offset after the piece — a decision, not a default.
 *
 * @upstream ByteRipperApp/Segments/SegmentsForm.swift#SegmentsFormController.replacePiece
 * @upstream ByteRipperApp/Segments/SegmentsForm.swift#SegmentsFormController.replaceSegmentFromFile
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.replacePiece
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.minimapMenuReplaceSegment
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.replaceSegment
 */
export async function replacePieceFromFile(pane: PaneId, piece: Segment): Promise<void> {
  const slot = workspaceStore.getSnapshot().panes[pane];
  if (slot === undefined) return;
  try {
    const [donor] = await openFiles({ multiple: false, capabilities: detectFileCapabilities() });
    if (donor === undefined) return;
    await replaceSegment({
      document: slot.document,
      start: piece.start,
      end: piece.end,
      donor: new FileBackedStorage(donor.source, new ChunkCache()),
      label: `Replace ${segmentLabel(piece.index)}`,
    });
  } catch (error) {
    if (error instanceof SegmentLengthMismatch) {
      reportProblem(
        `${segmentLabel(piece.index)} is ${error.pieceLength.toLocaleString()} bytes and that ` +
          `file is ${error.donorLength.toLocaleString()}. The file must be exactly the same ` +
          "length to replace the piece."
      );
      return;
    }
    reportProblem(error instanceof Error ? error.message : "That segment could not be replaced.");
  }
}

export type { Part };
/** The address a command names in its own title. */
export { hexAddress };
