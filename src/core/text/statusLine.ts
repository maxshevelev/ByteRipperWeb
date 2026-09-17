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
 * - **Sizes are abbreviated to a whole unit** ("4 MB", "16 B") in the line
 *   itself. The exact count is what the pointer unfolds on the size (§3.4) and
 *   what a dialog asks for; it is not the line's own spelling.
 */

import type { SegmentReadout } from "@/core/segments/segmentation";
import { friendlySize } from "@/core/text/byteSize";
import { addressString } from "@/core/text/offsetParser";

/**
 * What the bar joins its parts with — and what the size's position is measured
 * through.
 *
 * @upstream ByteRipperApp/Pane/StatusBarLabels.swift#StatusLabel.separator
 */
export const SEPARATOR = "  ·  ";

/**
 * Which half of the exact form a pointer is on. The two are what a size can be
 * put on a clipboard as: the hex address, or the decimal count.
 *
 * @upstream ByteRipperApp/Pane/StatusBarLabels.swift#StatusLabel.SizeForm
 */
export type SizeForm = "hex" | "decimal";

/**
 * The hex half of the exact form — the address a size is written as, the way
 * the bar writes every other number.
 *
 * @upstream ByteRipperApp/Pane/StatusBarLabels.swift#StatusLabel.hexSizeText
 */
export function hexSizeText(bytes: number): string {
  return `0x${bytes.toString(16).toUpperCase()}`;
}

/**
 * The exact size, in the form the Details view writes one: the hex address and
 * the decimal count in brackets beside it — "0x200000 (2097152 bytes)".
 *
 * @upstream ByteRipperApp/Pane/StatusBarLabels.swift#StatusLabel.exactSizeText
 * @upstream-differs the decimal count is a JS number rather than a 64-bit integer, so the
 * same string comes out of `${bytes}` where upstream's format string has to be `%llu` to
 * keep a file over 2 GB off its low half
 */
export function exactSizeText(bytes: number): string {
  return `${hexSizeText(bytes)} (${bytes} bytes)`;
}

/**
 * What a right-click on one half of the exact form puts on the clipboard: that
 * half on its own — the hex address **without** its `0x` prefix, or the decimal
 * count without the word beside it.
 *
 * Bare hex on purpose, like the offset's own menu (§3.4) and the dump's "Copy
 * offset" (§10.2), even though the readout it is copied from carries the prefix:
 * the prefix belongs to the field the value is pasted into, and every offset
 * field in the app takes it on the way in — so a copied `0x200000` would be
 * pasted as `0x0x200000` or rejected outright.
 *
 * @upstream ByteRipperApp/Pane/StatusBarLabels.swift#StatusLabel.copyText
 */
export function sizeCopyText(bytes: number, form: SizeForm): string {
  return form === "hex" ? bytes.toString(16).toUpperCase() : `${bytes}`;
}

/**
 * Read-only snapshot of the pane's status-line fields (§15) — what the line
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
  /**
   * What the comparison has to say (§14.4) — `differing 12.3%`, or nothing at
   * all while the index is being built or when the two files do not differ. The
   * pane appends it like any other part, which is what upstream does: the
   * summary is a part of each pane's line, not a band of the window's.
   *
   * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.comparisonInfo
   */
  readonly comparison: string;
}

/**
 * The line as the parts the pointer can act on (§3.4): the parts themselves,
 * which of them holds the file size, and where in its part the caret's address
 * sits.
 *
 * The parts stay one line rather than becoming views of their own because they
 * share one truncation: a narrower pane shortens the line from the tail, and
 * the size goes with it. Upstream recovers a part's rectangle from character
 * positions in the joined string, which it can measure exactly because the bar
 * is monospaced; here the readout draws each part as its own span and the
 * browser answers with the span's box.
 *
 * @upstream ByteRipperApp/Pane/StatusBarLabels.swift#StatusLabel.show
 */
export interface StatusLineParts {
  /**
   * The parts, already formatted, to be joined with {@link SEPARATOR}.
   *
   * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.updateStatus
   */
  readonly parts: readonly string[];
  /**
   * Which part is the file size, whose value the caller passes on to
   * {@link exactSizeText} (§3.4).
   *
   * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.updateStatus
   */
  readonly sizeIndex: number;
  /**
   * The caret's offset as the bar draws it (§3.4): the part of the line holding
   * it, and the address's own text — the digits alone, without the word beside
   * them, which is what a right-click on them copies.
   *
   * The digits are the bar's own, zero-padded to the width of the file's
   * largest address, rather than a second formatting of the same number: the
   * clipboard gets what the user read off the screen.
   *
   * @upstream ByteRipperApp/Pane/StatusBarLabels.swift#StatusLabel.Offset
   */
  readonly offset: {
    /**
     * Which part of the line the address is drawn in — always the first, but
     * read from the parts rather than assumed, so nothing has to agree by hand.
     *
     * @upstream ByteRipperApp/Pane/StatusBarLabels.swift#StatusLabel.Offset.index
     */
    readonly index: number;
    /**
     * The address's own text, as the bar draws it.
     *
     * @upstream ByteRipperApp/Pane/StatusBarLabels.swift#StatusLabel.Offset.digits
     */
    readonly digits: string;
  };
}

/**
 * The line as it reads: the parts joined by the app's separator.
 *
 * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.updateStatus
 * @upstream-differs no read-only part (see {@link PaneStatus}); the comparison
 * summary is a part here as it is upstream, spelled by
 * `src/core/diff/comparisonSummary.ts`
 */
export function statusLine(status: PaneStatus): string {
  return statusParts(status).parts.join(SEPARATOR);
}

/**
 * The line's parts and where the pointer's two are (§3.4) — what the readout
 * needs to draw a line it can act on. {@link statusLine} is this, joined.
 *
 * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.updateStatus
 * @upstream-differs the parts are not handed to a label here: the readout draws
 * them itself, so this is the spelling and the two positions, nothing more
 */
export function statusParts(status: PaneStatus): StatusLineParts {
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
  // The size is one part among the others, but it is the one the pointer can
  // act on, so where it landed is remembered.
  const sizeIndex = parts.length;
  parts.push(friendlySize(status.fileSize));
  if (status.isDirty) parts.push("Modified");
  // Last, as upstream appends it last: an empty one adds nothing at all, not an
  // empty part — the separator is not left standing between two others.
  if (status.comparison !== "") parts.push(status.comparison);
  return {
    parts,
    sizeIndex,
    // The offset is the line's first part, and the bar always leads with it: the
    // digits drawn there are the ones a right-click on them copies, so they are
    // handed on as the address's own text.
    offset: { index: 0, digits: address(status.cursorOffset) },
  };
}
