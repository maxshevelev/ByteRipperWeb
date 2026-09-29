import { useEffect, useRef, useState } from "react";
import { TOPIC, topicLink } from "@/core/help/helpIds";
import { L } from "@/core/localization/localization";
import type { Segment } from "@/core/segments/segmentation";
import { mergeTitle, segmentLabel } from "@/core/segments/segmentation";
import { friendlySize } from "@/core/text/byteSize";
import { hexAddress } from "@/core/text/hexText";
import { type SegmentLinkState, segmentLinkState, segmentSource } from "@/state/segmentSources";
import { segmentsStore } from "@/state/segmentsStore";
import { useStore } from "@/state/useStore";
import type { PaneId } from "@/state/workspaceStore";
import { Dialog } from "@/ui/dialogs/Dialog";
import { HelpButton } from "@/ui/help/HelpButton";
import { BrokenLinkShapes, LinkShapes } from "@/ui/pane/linkGlyphs";
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
  /**
   * The piece to open in rename, when the caller asks for one (§21.4) — "Edit
   * Segment" from the offset menu lands here. Absent for a plain open.
   *
   * @upstream-differs a form field; upstream's offset "Edit" opens an anchored
   * popover, which a browser has no room for.
   */
  readonly initiallyEditing?: number | undefined;
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
  initiallyEditing,
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
    if (!open) return;
    // A plain open clears the in-progress rename; one asked for from the offset
    // menu's "Edit Segment" opens straight into that piece's name field (§21.4).
    setRenaming(initiallyEditing);
    if (initiallyEditing !== undefined) setSelected(initiallyEditing);
  }, [open, initiallyEditing]);

  /**
   * How each linked piece stands to the file it came from — the red mark and
   * the bracketed reason the Name column wears (§21.7). Fetched per piece when
   * the form opens or the partition moves; a piece with no source has no entry,
   * and a verdict still on its way is read as intact — the name is known now,
   * the colour catches up a beat later.
   *
   * @upstream ByteRipperApp/Segments/SegmentsForm.swift#SegmentsFormController.linkedName
   * @upstream-differs the verdict is a promise the form awaits, where upstream's
   * reads a property its pane view model already holds
   */
  const [linkStates, setLinkStates] = useState<Map<number, SegmentLinkState | undefined>>(
    new Map()
  );
  const linkFetch = useRef(0);
  useEffect(() => {
    if (!open) return;
    const gen = ++linkFetch.current;
    // Derived from `partition` (a dep), not the render's `pieces`: `pieces` is
    // `partition.segments`, a getter that hands out a fresh array on every
    // render, so keying on it re-ran this effect on every repaint and each
    // `setLinkStates` below fed the next one — the form spun itself
    // unresponsive. `partition` is a stable object that changes only when the
    // partition actually does.
    const linked = (partition?.segments ?? []).filter((piece) => piece.link !== undefined);
    if (linked.length === 0) {
      setLinkStates(new Map());
      return;
    }
    let cancelled = false;
    void (async () => {
      const entries = await Promise.all(
        linked.map(async (piece) => [piece.index, await segmentLinkState(pane, piece)] as const)
      );
      if (cancelled || gen !== linkFetch.current) return;
      setLinkStates(new Map(entries));
    })();
    return () => {
      cancelled = true;
    };
  }, [open, partition, pane]);

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

  /**
   * The `−`'s act: the piece goes, the neighbour takes over the partition's
   * room — and the selection, the row that slid up into its place, or the new
   * last row.
   *
   * @upstream ByteRipperApp/Segments/SegmentsForm.swift#SegmentsFormController.removeSegment
   */
  const removePiece = (index: number) => {
    if (pieces.length < 2) return;
    mergePiece(pane, index);
    setSelected(Math.min(index, pieces.length - 2));
  };

  /**
   * The list's own keys (§21.4): Return goes to the selected piece's start —
   * the form closes first, the row it lands on has to be visible — and ⌫
   * removes the piece. A key from inside the rename field is the field's: a
   * Return there commits the name, it does not jump to the piece.
   *
   * @upstream ByteRipperApp/Segments/SegmentsForm.swift#SegmentTableView.keyDown
   * @upstream ByteRipperApp/Segments/SegmentsForm.swift#SegmentsFormController.goToSelectedSegment
   * @upstream ByteRipperApp/Segments/SegmentsForm.swift#SegmentsFormController.removeSelectedSegment
   */
  const onRowKey = (event: React.KeyboardEvent<HTMLTableRowElement>, piece: Segment) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter") {
      event.preventDefault();
      onSelectPiece(piece);
      onClose();
      return;
    }
    if (event.key === "Backspace" || event.key === "Delete") {
      event.preventDefault();
      removePiece(piece.index);
    }
  };

  /**
   * The `−`'s tooltip and accessible name: the selected piece and the neighbour
   * it merges into — "Merge S1 into S0" — so the icon-only button says what it
   * will do. With nothing selected there is no piece to name, so it falls back
   * to "Merge".
   *
   * @upstream ByteRipperApp/Segments/SegmentsForm.swift#SegmentsFormController.updateRemoveButton
   */
  const minusTitle = pieces[selected] === undefined ? L("Merge") : mergeTitle(selected);

  /**
   * The Name column for one piece (§21.7): its own name when it has one that
   * is not the file's, then the link glyph and the file it came from. While it
   * still is that file's bytes the run is quiet; once it is not, it goes red
   * with the app's broken-link mark and the reason in brackets — the same two
   * marks and the same red the pane header's link to a parent wears.
   *
   * @upstream ByteRipperApp/Segments/SegmentsForm.swift#SegmentsFormController.linkedName
   * @upstream-differs a plain run of spans and the app's own drawn glyphs, where
   * upstream composes an attributed string from the platform's symbols
   */
  const nameCell = (piece: Segment) => {
    const source = piece.link === undefined ? undefined : segmentSource(pane, piece);
    if (source === undefined) return <>{piece.name}</>;
    const state = linkStates.get(piece.index);
    const intact = state === undefined || state.kind === "matching";
    const reason = linkReason(state);
    const explanation = linkExplanation(state, source.name, piece);
    return (
      // A generic span carries no accessible name, so the explanation rides on
      // the title and the cell's own text — the source name, which is always
      // there.
      <span className="segment-link" data-state={intact ? "intact" : "broken"} title={explanation}>
        {piece.name !== "" && piece.name !== source.name && (
          <span className="segment-link-own">{piece.name}</span>
        )}
        <svg
          className="segment-link-glyph"
          viewBox="0 0 12 12"
          width="12"
          height="12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          {intact ? <LinkShapes /> : <BrokenLinkShapes />}
        </svg>
        <span className="segment-link-source">
          {source.name}
          {reason !== undefined ? ` (${reason})` : ""}
        </span>
      </span>
    );
  };

  return (
    <Dialog open={open} title={L("Segments")} onClose={onClose}>
      <div className="dialog-body">
        <div className="segments-scroll">
          <table className="panel-table segments-table">
            <caption className="visually-hidden">{L("Segments")}</caption>
            {/* No head row: the columns are self-evident (a label, an address,
                a size, a name), and a head of one word each would spend more
                room than it says.
                @upstream ByteRipperApp/Segments/SegmentsForm.swift#SegmentsFormController.makeTable */}
            <tbody>
              {pieces.map((piece) => (
                <tr
                  key={piece.start}
                  tabIndex={0}
                  data-selected={selected === piece.index ? "" : undefined}
                  onPointerDown={() => setSelected(piece.index)}
                  onFocus={() => setSelected(piece.index)}
                  onDoubleClick={() => setRenaming(piece.index)}
                  onKeyDown={(event) => onRowKey(event, piece)}
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
                        aria-label={L("Name for %1$@", segmentLabel(piece.index))}
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
                      nameCell(piece)
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* The +/− under the list: a hairline, then two icon-only buttons at
            the left — + opens the cut, − removes the selected piece. Neither
            has words of its own; the tooltip says what the icon will do.
            @upstream ByteRipperApp/Segments/SegmentsForm.swift#SegmentsFormController.makeFooter */}
        <div className="segments-footer">
          <button
            type="button"
            className="table-addremove"
            aria-label={L("Add Cut")}
            title={L("Add Cut…")}
            onClick={onAddCut}
          >
            +
          </button>
          <button
            type="button"
            className="table-addremove"
            aria-label={minusTitle}
            title={minusTitle}
            disabled={pieces.length < 2 || pieces[selected] === undefined}
            onClick={() => removePiece(selected)}
          >
            −
          </button>
        </div>
        {/* The form's own line — upstream's form has none, its `?` button is
            its only help — so its words, like the cut dialog's, are its own
            and carry their own translations.
            @web-only the form's help line; upstream's form has none */}
        <p className="dialog-help">
          {L(
            "Right-click a piece to save it, replace it from a file, select it, rename it, or merge it."
          )}
        </p>

        <div className="dialog-actions">
          {/* The `?` a form carries sits at the start of its actions, which is
              where the platform's own round help button goes.
              @upstream Packages/HelpUI/Sources/HelpUI/HelpButton.swift#HelpButton.standard */}
          <HelpButton link={topicLink(TOPIC.segments)} />
          <button
            type="button"
            className="toolbar-button"
            disabled={pieces.length < 2}
            onClick={() => mergeAll(pane)}
          >
            {L("Merge All")}
          </button>
          <span className="toolbar-spacer" />
          {/* With one piece there is nothing to separate, so the write stays
              disabled — the button row acts on the whole partition.
              @upstream ByteRipperApp/Segments/SegmentsForm.swift#SegmentsFormController.updateRemoveButton */}
          <button
            type="button"
            className="toolbar-button"
            disabled={pieces.length < 2}
            onClick={onSaveAll}
          >
            {L("Save All as Separate Files…")}
          </button>
          <button type="button" className="toolbar-button" onClick={onClose}>
            {L("Close")}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

/**
 * The bracketed word beside a linked file's name: why the piece is no longer
 * what that file holds. Nil while it still is, and for a verdict still on its
 * way (read as intact).
 *
 * @upstream ByteRipperApp/Segments/SegmentsForm.swift#SegmentsFormController.linkReason
 */
function linkReason(state: SegmentLinkState | undefined): string | undefined {
  switch (state?.kind) {
    case "edited":
      return "edited";
    case "lengthChanged":
      return L("length changed");
    case "missing":
      return L("file missing");
    default:
      return undefined;
  }
}

/**
 * What the row says under the pointer — the same shape the pane header's link
 * explains itself with: where the piece came from, and how it stands to that
 * file now.
 *
 * @upstream ByteRipperApp/Segments/SegmentsForm.swift#SegmentsFormController.linkExplanation
 * @upstream-differs names the file by its name, where upstream's names the URL's
 * path — a page has no path
 */
function linkExplanation(
  state: SegmentLinkState | undefined,
  sourceName: string,
  piece: Segment
): string {
  const segment = segmentLabel(piece.index);
  switch (state?.kind) {
    case "edited":
      return L("%1$@ came from “%2$@”, and has been changed since.", segment, sourceName);
    case "lengthChanged":
      return L(
        "%1$@ came from “%2$@”, which is %3$@ there against %4$@ here.",
        segment,
        sourceName,
        friendlySize(state.sourceLength),
        friendlySize(state.pieceLength)
      );
    case "missing":
      return L("%1$@ came from “%2$@”, which can no longer be read.", segment, sourceName);
    default:
      return L("%1$@ came from “%2$@”, and still holds its bytes.", segment, sourceName);
  }
}
