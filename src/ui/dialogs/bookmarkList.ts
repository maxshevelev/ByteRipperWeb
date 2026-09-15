/**
 * The arithmetic of the Go To form's bookmark list, kept apart from the dialog
 * so it can be tested without one.
 */

/**
 * How many rows the list shows before it scrolls, and the fewest it keeps: the
 * empty state is two lines of text over the list, and it needs room to be read.
 *
 * @upstream ByteRipperApp/Bookmarks/GoToBookmarksForm.swift#GoToBookmarksController.updateTableHeight
 */
export const MAX_VISIBLE_ROWS = 10;
export const MIN_VISIBLE_ROWS = 3;

/** Rows' worth of height the list takes for `count` bookmarks. */
export function visibleRowCount(count: number): number {
  return Math.min(Math.max(count, MIN_VISIBLE_ROWS), MAX_VISIBLE_ROWS);
}

/**
 * Where the selection goes when the list changes under it.
 *
 * A bookmark still listed stays selected, wherever it now sits. One that is
 * gone hands the selection to its neighbour — the row that slid up into its
 * place, or the new last row — so a run of removals needs no pointer between
 * presses.
 *
 * @upstream ByteRipperApp/Bookmarks/GoToBookmarksForm.swift#GoToBookmarksController.applySelection
 * @upstream ByteRipperApp/Bookmarks/GoToBookmarksForm.swift#GoToBookmarksController.removeBookmark
 */
export function selectionAfterChange(
  previous: readonly number[],
  rows: readonly number[],
  selected: number | undefined
): number | undefined {
  if (selected === undefined || rows.includes(selected)) return selected;
  if (rows.length === 0) return undefined;
  const at = previous.indexOf(selected);
  if (at === -1) return undefined;
  return rows[Math.min(at, rows.length - 1)];
}

/**
 * What stands where an unnamed bookmark's name would be: the row's bytes as the
 * dump shows them, or a plain sentence for a row past the active file's end — a
 * bookmark is an absolute address, and stays listed where the file does not
 * reach.
 *
 * @upstream ByteRipperApp/Bookmarks/GoToBookmarksForm.swift#GoToBookmarksController.rowDescription
 */
export function rowDescription(bytes: Uint8Array | undefined): string {
  if (bytes === undefined) return PAST_END_OF_FILE;
  return [...bytes].map((byte) => byte.toString(16).toUpperCase().padStart(2, "0")).join(" ");
}

/** @upstream ByteRipperApp/Bookmarks/GoToBookmarksForm.swift#GoToBookmarksController.pastEndOfFileText */
export const PAST_END_OF_FILE = "Past the end of the file";
