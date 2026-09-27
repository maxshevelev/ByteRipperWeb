import { L } from "@/core/localization/localization";
import { mergeTitle, type Segment, segmentLabel } from "@/core/segments/segmentation";
import { segmentSource } from "@/state/segmentSources";
import { type PaneId, paneState } from "@/state/workspaceStore";
import {
  mergePiece,
  replacePieceFromFile,
  revertPiece,
  savePiece,
} from "@/ui/segments/segmentCommands";
import type { MenuEntry } from "@/ui/shell/menuModel";

/**
 * The menu that acts on one piece (§21.3, §21.4).
 *
 * One function, because the strip beside the minimap and the row in the
 * segments form offer the same commands — the reader asking from either place
 * is asking about the same piece, and two menus that drifted apart would be the
 * bug. Every title names the piece, so the menu says what it will act on:
 * "Save Segment S1…", not a bare "Save Segment".
 *
 * @upstream ByteRipperApp/Segments/SegmentsForm.swift#SegmentsFormController.makeRowMenu
 * @upstream-differs the titles are named for the piece when the menu is built, rather than
 * bare placeholders that `validateMenuItem` renames on show — a web menu has no validation pass
 */
export function pieceMenu(options: {
  readonly pane: PaneId;
  readonly piece: Segment;
  readonly pieceCount: number;
  /** Shows the piece in the dump. Absent where there is nothing to scroll. */
  readonly onReveal?: ((piece: Segment) => void) | undefined;
  /** Renames in place, where the caller has somewhere to do that. */
  readonly onEdit?: ((piece: Segment) => void) | undefined;
}): (MenuEntry | undefined)[] {
  const { pane, piece, pieceCount } = options;
  const label = segmentLabel(piece.index);
  // The one piece that came from a file can go back to it (§21.7). The source
  // is asked synchronously: a web menu is synchronous, and a source that has
  // gone unreadable is the case `revertPiece` answers with its own alert.
  // @upstream-differs upstream greys the item via `canRevertSegment` (an async
  // reader check); the web decides presence from the link, which is what a
  // synchronous menu can read.
  const source = segmentSource(pane, piece);
  return [
    { label: L("Save Segment %1$@…", label), onSelect: () => void savePiece(pane, piece) },
    {
      label: L("Replace Segment %1$@ from File…", label),
      onSelect: () => void replacePieceFromFile(pane, piece),
    },
    source === undefined
      ? undefined
      : {
          label: L("Revert Segment %1$@ to “%2$@”", label, source.name),
          onSelect: () => void revertPiece(pane, piece),
        },
    { kind: "separator" },
    options.onReveal === undefined
      ? undefined
      : { label: L("Select Segment %1$@", label), onSelect: () => options.onReveal?.(piece) },
    options.onEdit === undefined
      ? undefined
      : { label: L("Edit Segment %1$@", label), onSelect: () => options.onEdit?.(piece) },
    {
      label: mergeTitle(piece.index),
      disabled: pieceCount < 2,
      onSelect: () => mergePiece(pane, piece.index),
    },
  ];
}

/**
 * Selecting a piece selects its whole range, not a caret at its start (§21.3).
 *
 * Shared, so the strip and the form put the same thing on screen.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.segmentMenuSelectSegment
 */
export function selectPiece(pane: PaneId, piece: Segment): void {
  const slot = paneState(pane);
  if (slot === undefined) return;
  void slot.typing.setSelection(piece.start, piece.end);
}
