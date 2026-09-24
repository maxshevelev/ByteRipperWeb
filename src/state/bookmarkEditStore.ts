import { rowContaining } from "@/core/bookmarks/bookmarkStore";
import { parseOffset } from "@/core/text/offsetParser";
import {
  addBookmark,
  bookmarkAt,
  bookmarksStore,
  editBookmark,
  removeBookmark,
} from "@/state/bookmarksStore";
import { createStore } from "@/state/store";
import { type PaneId, paneInFront } from "@/state/workspaceStore";

/**
 * The bookmark being named or edited, and the commands that open it (§20.3).
 *
 * ⌘D on an unmarked row marks it and opens the naming popover on the new mark:
 * Return saves it (unnamed if nothing was typed), Esc removes it again — so
 * **⌘D, Return** is the whole gesture for "mark this row", and ⌘D, a name,
 * Return the one for "mark it and call it this". ⌘D on a marked row unmarks it
 * on the spot. A double click on an address never unmarks: it marks and names a
 * bare row, and edits the mark that is already there.
 *
 * One session at a time. Opening another replaces the one on screen without
 * running either of its outcomes, and a session closes by itself when its mark
 * goes — ⌘D reaches the workspace through an open popover, and a panel editing
 * a bookmark that no longer exists is nonsense.
 */

/**
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.BookmarkEditRequest
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.openEditing
 */
export interface BookmarkEditSession {
  /**
   * The pane whose dump the popover hangs off, or `undefined` when it hangs off
   * a row of the Go To form's bookmark list.
   *
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.BookmarkEditRequest.pane
   */
  readonly pane: PaneId | undefined;
  /**
   * The row the popover opened on — where the bookmark is now.
   *
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.BookmarkEditRequest.row
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.editingRow
   * @upstream ByteRipperApp/Bookmarks/BookmarkEditPopover.swift#BookmarkEditPopoverController.row
   */
  readonly row: number;
  /**
   * The name to edit, or `undefined` when the mark was just made — which is
   * also what makes Esc mean "remove it again", and what leaves Delete out.
   *
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.BookmarkEditRequest.existingName
   * @upstream ByteRipperApp/Bookmarks/BookmarkEditPopover.swift#BookmarkEditPopoverController.initialName
   */
  readonly existingName: string | undefined;
  /** Tells one session from the next on the same row. */
  readonly token: number;
}

export const bookmarkEditStore = createStore<{ readonly session: BookmarkEditSession | undefined }>(
  { session: undefined }
);

let nextToken = 1;

const current = () => bookmarkEditStore.getSnapshot().session;

function close(): void {
  if (current() !== undefined) bookmarkEditStore.update(() => ({ session: undefined }));
}

/**
 * Opens the popover on `pane`'s mark, replacing any session already on screen
 * — ⌘D on another row while one is open would otherwise leave two panels up.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.presentBookmarkEditPopover
 */
function present(pane: PaneId | undefined, row: number, existingName: string | undefined): void {
  bookmarkEditStore.update(() => ({
    session: { pane, row, existingName, token: nextToken++ },
  }));
}

/**
 * ⌘D, and the dump menu's Toggle Bookmark: unmarks a marked row on the spot,
 * and marks and names an unmarked one.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.toggleBookmarkInPane
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.toggleBookmark
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.toggleBookmarkAtOffset
 */
export function toggleBookmarkInPane(pane: PaneId, offset: number): void {
  if (removeBookmark(pane, offset)) return;
  markAndNameBookmark(pane, offset);
}

/**
 * Marks the row first, so the mark is visible while its name is typed, then
 * opens the naming popover on it.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.markAndNameBookmark
 */
export function markAndNameBookmark(pane: PaneId, offset: number): void {
  const row = rowContaining(offset);
  addBookmark(pane, row);
  present(pane, row, undefined);
}

/**
 * ⇧⌘D, and the dump menu's Edit Bookmark…: the popover on the row's existing
 * mark. Nothing for a row that carries none — ⌘D is how a mark is made.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.editBookmarkInPane
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.editBookmark
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.editBookmarkAtOffset
 */
export function editBookmarkInPane(pane: PaneId, offset: number): void {
  const existing = bookmarkAt(pane, offset);
  if (existing === undefined) return;
  present(pane, existing.row, existing.name);
}

/**
 * The Go To form's list: a double click on a row, or its menu's Edit
 * Bookmark…. The same popover the dump's ⇧⌘D opens, on the list's row — one
 * editor for a bookmark wherever it is edited from, and one that can move and
 * delete it, which an in-place name field could not.
 *
 * @upstream ByteRipperApp/Bookmarks/GoToBookmarksForm.swift#GoToBookmarksController.editBookmark
 */
export function editBookmarkInList(offset: number): void {
  const existing = bookmarkAt(paneInFront(), offset);
  if (existing === undefined) return;
  present(undefined, existing.row, existing.name);
}

/**
 * Closes the popover without running either outcome — for the window it hangs
 * in going away under it.
 */
export function abandonBookmarkEdit(): void {
  close();
}

/**
 * A double click on an address: edits the mark that is there, and marks and
 * names the row otherwise. It never unmarks — the pointer covers the mark it is
 * aimed at, so a toggle here would take a bookmark away on a click a row off.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.handleOffsetDoubleClick
 */
export function handleOffsetDoubleClick(pane: PaneId, offset: number): void {
  if (bookmarkAt(pane, offset) !== undefined) editBookmarkInPane(pane, offset);
  else markAndNameBookmark(pane, offset);
}

/**
 * The row the Offset field names, or `undefined` when it names none: the text
 * is not an offset, or it lands on a row another bookmark already holds — one
 * row holds one bookmark, so that is as invalid as a typo. The mark's own row
 * is always its to keep.
 *
 * @upstream ByteRipperApp/Bookmarks/BookmarkEditPopover.swift#BookmarkEditPopoverController.editedRow
 * @upstream ByteRipperApp/Bookmarks/BookmarkEditPopover.swift#BookmarkEditPopoverController.rowIsFree
 */
export function editedBookmarkRow(text: string, row: number): number | undefined {
  const parsed = parseOffset(text);
  if (!parsed.ok) return undefined;
  const candidate = rowContaining(parsed.value);
  return candidate === row || bookmarkAt(editedPane(), candidate) === undefined
    ? candidate
    : undefined;
}

/**
 * Saves the row and the name, and closes. A moved bookmark is the same
 * bookmark: it leaves the old row and arrives on the new one named. Returns
 * the session it closed, so the pane can land the caret on a mark just made.
 *
 * @upstream ByteRipperApp/Bookmarks/BookmarkEditPopover.swift#BookmarkEditPopoverController.onCommit
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.BookmarkEditRequest.commit
 * @upstream ByteRipperApp/Bookmarks/BookmarkSpace.swift#BookmarkSpace.edit
 */
export function commitBookmarkEdit(target: number, name: string): BookmarkEditSession | undefined {
  const session = current();
  if (session === undefined) return undefined;
  close();
  editBookmark(session.pane ?? paneInFront(), session.row, target, name);
  return session;
}

/**
 * Backs out: removes a mark made for this popover, or leaves an existing one
 * exactly as it was.
 *
 * @upstream ByteRipperApp/Bookmarks/BookmarkEditPopover.swift#BookmarkEditPopoverController.onCancel
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.BookmarkEditRequest.cancel
 */
export function cancelBookmarkEdit(): void {
  const session = current();
  if (session === undefined) return;
  close();
  if (session.existingName === undefined)
    removeBookmark(session.pane ?? paneInFront(), session.row);
}

/**
 * Removes the bookmark and closes — offered only for one that already existed.
 *
 * @upstream ByteRipperApp/Bookmarks/BookmarkEditPopover.swift#BookmarkEditPopoverController.onDelete
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.BookmarkEditRequest.delete
 */
export function deleteEditedBookmark(): void {
  const session = current();
  if (session === undefined || session.existingName === undefined) return;
  close();
  removeBookmark(session.pane ?? paneInFront(), session.row);
}

/**
 * Closes the popover when the mark it is editing disappears, whichever path
 * removed it.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.dismissEditPopoverIfItsMarkIsGone
 * @upstream ByteRipperApp/Bookmarks/BookmarkEditPopover.swift#BookmarkEditPopoverController.abandon
 */
bookmarksStore.subscribe(() => {
  const session = current();
  if (
    session !== undefined &&
    bookmarkAt(session.pane ?? paneInFront(), session.row) === undefined
  ) {
    close();
  }
});

/**
 * The marks the open session is about: its own pane's, or the pane in front for
 * a row picked out of the Go To form's list, which is the window's one list of
 * whatever is in front of it.
 */
function editedPane(): PaneId {
  return current()?.pane ?? paneInFront();
}
