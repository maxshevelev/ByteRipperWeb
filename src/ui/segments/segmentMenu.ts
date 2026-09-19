import { mergeTitle, type Segment, segmentLabel } from "@/core/segments/segmentation";
import { type PaneId, paneState } from "@/state/workspaceStore";
import { mergePiece, replacePieceFromFile, savePiece } from "@/ui/segments/segmentCommands";
import type { MenuEntry } from "@/ui/shell/menuModel";

/**
 * The menu that acts on one piece (§21.3, §21.4).
 *
 * One function, because the strip beside the minimap and the row in the
 * segments form offer the same commands — the reader asking from either place
 * is asking about the same piece, and two menus that drifted apart would be the
 * bug. Every title names the piece, so the menu says what it will act on:
 * "Save Segment S1…", not a bare "Save Segment".
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
  return [
    { label: `Save Segment ${label}…`, onSelect: () => void savePiece(pane, piece) },
    {
      label: `Replace Segment ${label} from File…`,
      onSelect: () => void replacePieceFromFile(pane, piece),
    },
    { kind: "separator" },
    options.onReveal === undefined
      ? undefined
      : { label: `Select Segment ${label}`, onSelect: () => options.onReveal?.(piece) },
    options.onEdit === undefined
      ? undefined
      : { label: `Edit Segment ${label}`, onSelect: () => options.onEdit?.(piece) },
    {
      label: mergeTitle(piece.index),
      destructive: true,
      disabled: pieceCount < 2,
      onSelect: () => mergePiece(pane, piece.index),
    },
  ];
}

/**
 * Selecting a piece selects its whole range, not a caret at its start (§21.3).
 *
 * Shared, so the strip and the form put the same thing on screen.
 */
export function selectPiece(pane: PaneId, piece: Segment): void {
  const slot = paneState(pane);
  if (slot === undefined) return;
  void slot.typing.setSelection(piece.start, piece.end);
}
