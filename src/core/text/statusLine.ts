/**
 * The pane's status line (§21.3, §3.4, §15).
 *
 * Ported from `FilePaneView.updateStatus`, which spells one string out of the
 * pane's status and hands it to a label. It lives here rather than in the pane
 * because the spelling is the substance — the address width, the piece block,
 * the abbreviations — and a spelling that can only be read off a rendered view
 * is a spelling nothing can check.
 *
 * Two things about the line are worth knowing before reading it:
 *
 * - **Every address takes the same width**, the hex digits of the file's
 *   largest address — its size, since the last piece ends there. That is what
 *   makes the offset and the piece's bounds read as aligned columns.
 * - **Sizes are abbreviated to a whole unit** ("4 MB", "16 B"), never the exact
 *   count. The exact figure is the file summary's business, in the window's own
 *   bar; a status line naming a selection or a piece is naming a size in
 *   passing.
 */

import type { SegmentReadout } from "@/core/segments/segmentation";
import { friendlySize } from "@/core/text/byteSize";
import { addressString } from "@/core/text/offsetParser";

/**
 * Read-only snapshot of the pane's status-bar fields (§15) — what the line
 * below is spelled from.
 *
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneStatus
 * @upstream-differs the fields the line does not read are the web's elsewhere: the
 * file's name is the pane header's, `canUndo`/`canRedo` are the undo store's, and a
 * read-only document is not a state this edition has — an edit goes to an overlay and
 * a save asks the platform for permission at the save, so there is never a file the
 * pane may not write.
 */
export interface PaneStatus {
  /**
   * The file's size — what the line's address width is taken from, and the last
   * part it names.
   *
   * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneStatus.fileSize
   */
  readonly fileSize: number;
  /**
   * The caret's offset, raw — the line renders it as bare hex.
   *
   * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneStatus.cursorOffset
   */
  readonly cursorOffset: number;
  /**
   * How many bytes the selection covers, zero when it is a caret.
   *
   * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneStatus.selectionLength
   */
  readonly selectionLength: number;
  /**
   * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneStatus.isDirty
   */
  readonly isDirty: boolean;
  /**
   * The piece the caret is in, for the line's readout (§21.3). Nothing when the
   * pane is a single piece: the readout appearing at all is the signal that the
   * dump is partitioned.
   *
   * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneStatus.segment
   */
  readonly segment: SegmentReadout | undefined;
}

/**
 * The line as it reads: the parts joined by the app's separator.
 *
 * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.updateStatus
 * @upstream-differs no read-only part (see {@link PaneStatus}), and the comparison
 * summary — upstream's last part — is the window bar's here, where the web keeps the
 * answer to "are these the same?" for the pair rather than for one pane.
 */
export function statusLine(status: PaneStatus): string {
  // The file's largest address: 0x400000 is six digits, so every address in the
  // bar is. An empty file has no address to measure, so one digit.
  const width = status.fileSize > 0 ? status.fileSize.toString(16).length : 1;
  const address = (value: number) => addressString(value, width);

  const parts = [`Offset ${address(status.cursorOffset)}`];
  if (status.selectionLength > 0) {
    parts.push(`${friendlySize(status.selectionLength)} selected`);
  }
  const segment = status.segment;
  if (segment !== undefined) {
    // One block: the label, the range first-to-last byte, and the piece's
    // length. The count is the range's, not the last byte's — a piece of eight
    // bytes ending at 0x0F is "8 B", not "0F".
    parts.push(
      `${segment.label}: ${address(segment.start)}-${address(segment.end - 1)} ` +
        `(${friendlySize(segment.end - segment.start)})`
    );
  }
  parts.push(friendlySize(status.fileSize));
  if (status.isDirty) parts.push("Modified");
  return parts.join("  ·  ");
}
