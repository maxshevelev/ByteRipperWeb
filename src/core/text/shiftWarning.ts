/**
 * The warning before an edit that shifts every offset after it (§7.2).
 *
 * Upstream asks this three separate times, and each asking has its own words:
 * the first insert-mode keystroke in a file ("Inserting at offset …"), Paste
 * Insert ("Insert N byte(s) at offset …"), and Delete Bytes ("Bytes from offset
 * … will be removed"). The port asks from one place — the editing queue, which
 * is the only thing that knows an edit is about to shift anything — so the
 * words are chosen here by *which edit asked*, and the three sentences are
 * upstream's own rather than one sentence made to fit all three.
 *
 * What they have in common is the one thing the warning is for: every offset
 * past the edit is about to change, and the file structure may be affected. The
 * exact form the count takes is upstream's: a plainer "5 bytes" would be an
 * improvement on a sentence this edition is copying rather than writing.
 *
 * This is a spelling, so it lives with the other spellings and is asserted
 * without a view — the dialog that shows it is `ConfirmDialog`.
 */

/**
 * The edit that is about to shift every offset after it, as the warning needs
 * it: which command asked, where the shift starts, and how many bytes move.
 *
 * `count` is what the two range commands name — a paste's bytes, a delete's
 * bytes. The insert-mode keystroke is one byte and upstream's sentence for it
 * names only the offset, so nothing reads the count there.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.flipInsertMode
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.pasteInsert
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.deleteSelectionOrCaret
 */
export interface ShiftingEdit {
  /**
   * Which command asked: a keystroke in insert mode, a paste that inserts, or a
   * delete.
   */
  readonly kind: "insert" | "paste" | "delete";
  /** The offset the shift starts at — the caret's, as upstream reads it. */
  readonly at: number;
  /** How many bytes move, for the two commands whose words name a count. */
  readonly count: number;
}

/** The three strings a confirmation dialog is shown with. */
export interface ShiftWarning {
  readonly title: string;
  readonly message: string;
  /**
   * What the confirming button says — the command's own verb, as upstream
   * titles the first button of each of the three alerts.
   */
  readonly confirmLabel: string;
}

/**
 * The warning for one shifting edit, in upstream's words.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.flipInsertMode
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.pasteInsert
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.deleteSelectionOrCaret
 */
export function shiftWarning(edit: ShiftingEdit): ShiftWarning {
  const at = hexOffset(edit.at);
  switch (edit.kind) {
    // The alert `flipInsertMode` injects into the pane, shown on the first
    // insert-mode keystroke in a file and asked no more after it is answered.
    case "insert":
      return {
        title: "Insert?",
        message: `Inserting at offset ${at} shifts every byte from here on — the file structure may be affected.`,
        confirmLabel: "Insert",
      };
    // Edit ▸ Paste Insert, which is what a paste into an insert-mode pane is.
    // A paste while a selection stands removes those bytes first — the offsets
    // after it shift either way, which is what the sentence is about.
    case "paste":
      return {
        title: "Paste Insert?",
        message: `Insert ${edit.count} byte(s) at offset ${at}. Existing bytes from this offset on will shift.`,
        confirmLabel: "Insert",
      };
    // Delete Bytes, and the deletes insert mode carries out: removing bytes
    // moves everything after them left.
    case "delete":
      return {
        title: `Delete ${edit.count} byte(s)?`,
        message: `Bytes from offset ${at} will be removed. Subsequent offsets will shift — the file structure may be affected.`,
        confirmLabel: "Delete",
      };
  }
}

/**
 * An offset as these sentences name one: `0x` and the upper-case digits, with
 * no padding — upstream's `String(format: "0x%X", offset)`.
 *
 * Not the dump's {@link hexAddress}, which pads to eight digits, nor the status
 * line's spelling, which pads to the file's widest address: both pad because
 * they are read as columns, and a sentence has no column to line up with.
 */
function hexOffset(offset: number): string {
  return `0x${offset.toString(16).toUpperCase()}`;
}
