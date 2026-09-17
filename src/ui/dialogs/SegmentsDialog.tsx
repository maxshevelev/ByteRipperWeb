import { useEffect, useState } from "react";
import type { Segment } from "@/core/segments/segmentation";
import { segmentLabel } from "@/core/segments/segmentation";
import { friendlySize } from "@/core/text/byteSize";
import { hexAddress } from "@/core/text/hexText";
import { segmentsStore } from "@/state/segmentsStore";
import { useStore } from "@/state/useStore";
import type { PaneId } from "@/state/workspaceStore";
import { Dialog } from "@/ui/dialogs/Dialog";
import { mergeAll, mergePiece, renamePiece } from "@/ui/segments/segmentCommands";
import { pieceMenu } from "@/ui/segments/segmentMenu";
import { openContextMenu } from "@/ui/shell/ContextMenu";
import { observeHexColors, readSegmentTints } from "@/ui/theme/hexColors";

/**
 * The segments form (§21.4): the partition as a table, and what acts on it.
 *
 * A row per piece — its label, where it opens, how big it is, and whatever it
 * has been called. The whole-partition commands sit in the footer; the ones
 * that act on *one* piece are in the row's own right-click menu, which is the
 * same menu the strip beside the minimap offers, because the reader asking from
 * either place is asking about the same piece.
 */
export interface SegmentsDialogProps {
  readonly open: boolean;
  readonly pane: PaneId;
  /** @upstream ByteRipperApp/Segments/SegmentsForm.swift#SegmentsFormController.addCutPressed */
  readonly onAddCut: () => void;
  /**
   * @upstream ByteRipperApp/Segments/SegmentsForm.swift#SegmentsFormController.saveAll
   * @upstream ByteRipperApp/Segments/SegmentsForm.swift#SegmentsFormController.saveAllPressed
   */
  readonly onSaveAll: () => void;
  /**
   * @upstream ByteRipperApp/Segments/SegmentsForm.swift#SegmentsFormController.selectedSegmentIndex
   * @upstream ByteRipperApp/Segments/SegmentsForm.swift#SegmentsFormController.selectedSegment
   * @upstream ByteRipperApp/Segments/SegmentsForm.swift#SegmentsFormController.selectSegment
   * @upstream ByteRipperApp/Segments/SegmentsForm.swift#SegmentsFormController.tableViewSelectionDidChange
   * @upstream ByteRipperApp/Segments/SegmentsForm.swift#SegmentsFormController.goToSelectedSegment
   */
  readonly onSelectPiece: (piece: Segment) => void;
  /** @upstream ByteRipperApp/Segments/SegmentsForm.swift#SegmentsFormController.dismissForm */
  readonly onClose: () => void;
}

/**
 * @upstream ByteRipperApp/Segments/SegmentsForm.swift#SegmentsFormController
 * @upstream ByteRipperApp/Segments/SegmentsForm.swift#SegmentsFormController.segmentTable
 * @upstream ByteRipperApp/Segments/SegmentsForm.swift#SegmentsFormController.addButton
 * @upstream ByteRipperApp/Segments/SegmentsForm.swift#SegmentsFormController.removeButton
 * @upstream ByteRipperApp/Segments/SegmentsForm.swift#SegmentsFormController.removeAllButton
 * @upstream ByteRipperApp/Segments/SegmentsForm.swift#SegmentsFormController.saveAllButton
 * @upstream ByteRipperApp/Segments/SegmentsForm.swift#SegmentsFormController.closeButton
 * @upstream ByteRipperApp/Segments/SegmentsForm.swift#SegmentsFormController.editPopoverPresenter
 * @upstream ByteRipperApp/Segments/SegmentsForm.swift#SegmentsFormController.isEditingSegment
 * @upstream ByteRipperApp/Segments/SegmentsForm.swift#SegmentsFormController.editClickedSegment
 * @upstream ByteRipperApp/Segments/SegmentsForm.swift#SegmentsFormController.cancelEdit
 * @upstream ByteRipperApp/Segments/SegmentsForm.swift#SegmentsFormController.handleDoubleClick
 * @upstream-differs a dialog; a piece is renamed in place with a double-click rather than in a popover
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.showSegments
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.openSegmentsForm
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.presentSegmentsForm
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.segmentsFormPresenter
 */
export function SegmentsDialog({
  open,
  pane,
  onAddCut,
  onSaveAll,
  onSelectPiece,
  onClose,
}: SegmentsDialogProps) {
  const partition = useStore(segmentsStore).panes[pane]?.partition;
  /** @upstream ByteRipperApp/Segments/SegmentsForm.swift#SegmentsFormController.segments */
  const pieces = partition?.segments ?? [];
  const [selected, setSelected] = useState(0);
  const [renaming, setRenaming] = useState<number | undefined>(undefined);
  /**
   * The swatches, read out of the theme and read again when it moves.
   *
   * A tint here is the same tint the pane's bands wear (§21.3), so a form left
   * open across an appearance change has to follow it: the row would otherwise
   * keep the colour the piece was not cut in.
   */
  const [tints, setTints] = useState(() => readSegmentTints());
  useEffect(() => observeHexColors(() => setTints(readSegmentTints())), []);

  useEffect(() => {
    if (open) setRenaming(undefined);
  }, [open]);

  /** @upstream ByteRipperApp/Segments/SegmentsForm.swift#SegmentsFormController.validateMenuItem */
  const rowMenu = (piece: Segment) =>
    pieceMenu({
      pane,
      piece,
      pieceCount: pieces.length,
      onReveal: (chosen) => {
        onSelectPiece(chosen);
        onClose();
      },
      onEdit: (chosen) => setRenaming(chosen.index),
    });

  return (
    <Dialog open={open} title="Segments" onClose={onClose}>
      <div className="dialog-body">
        <div className="segments-scroll">
          <table className="panel-table segments-table">
            <caption className="visually-hidden">Segments</caption>
            <thead>
              <tr>
                <th scope="col">Piece</th>
                <th scope="col">Start</th>
                <th scope="col">Size</th>
                <th scope="col">Name</th>
              </tr>
            </thead>
            <tbody>
              {pieces.map((piece) => (
                <tr
                  key={piece.start}
                  data-selected={selected === piece.index ? "" : undefined}
                  onPointerDown={() => setSelected(piece.index)}
                  onDoubleClick={() => setRenaming(piece.index)}
                  onContextMenu={(event) => {
                    setSelected(piece.index);
                    openContextMenu(event, rowMenu(piece));
                  }}
                >
                  <th scope="row" className="segments-label">
                    <i
                      className="segments-swatch"
                      style={{ background: tints[piece.index % tints.length] }}
                      aria-hidden="true"
                    />
                    {segmentLabel(piece.index)}
                  </th>
                  <td className="segments-start">{hexAddress(piece.start)}</td>
                  <td className="segments-size">{friendlySize(piece.end - piece.start)}</td>
                  <td className="segments-name">
                    {renaming === piece.index ? (
                      <input
                        className="bookmark-name-field"
                        ref={(element) => element?.select()}
                        defaultValue={piece.name}
                        aria-label={`Name for ${segmentLabel(piece.index)}`}
                        onBlur={(event) => {
                          renamePiece(pane, piece.index, event.target.value);
                          setRenaming(undefined);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            renamePiece(pane, piece.index, event.currentTarget.value);
                            setRenaming(undefined);
                          }
                          if (event.key === "Escape") {
                            event.preventDefault();
                            setRenaming(undefined);
                          }
                        }}
                      />
                    ) : (
                      piece.name
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="dialog-help">
          Right-click a piece to save it, replace it from a file, select it, rename it, or merge it.
        </p>

        <div className="dialog-actions">
          <button type="button" className="toolbar-button" onClick={onAddCut} title="Add a cut">
            Add Cut…
          </button>
          <button
            type="button"
            className="toolbar-button"
            disabled={pieces.length < 2}
            onClick={() => mergePiece(pane, selected)}
            title="Merge the selected piece into its neighbour"
          >
            Merge
          </button>
          <button
            type="button"
            className="toolbar-button"
            disabled={pieces.length < 2}
            onClick={() => mergeAll(pane)}
          >
            Merge All
          </button>
          <span className="toolbar-spacer" />
          <button type="button" className="toolbar-button" onClick={onSaveAll}>
            Save All as Separate Files…
          </button>
          <button type="button" className="toolbar-button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </Dialog>
  );
}
