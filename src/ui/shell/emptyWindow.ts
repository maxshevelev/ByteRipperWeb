import type { Bookmark } from "@/core/bookmarks/bookmarkStore";
import { L } from "@/core/localization/localization";
import { hexAddress } from "@/core/text/hexText";

/**
 * What an empty window says for itself. Bookmarks belong to the workspace, not
 * to a file, so closing the last dump leaves a window still holding them — and
 * the list and the title are how it says so.
 */

/**
 * The bookmark section's heading, which names the list and counts it.
 *
 * @upstream ByteRipperApp/Window/EmptyStateView.swift#EmptyStateView.setBookmarks
 */
export function bookmarkHeading(count: number): string {
  return count === 1 ? L("1 Bookmark Here:") : L("%1$@ Bookmarks Here:", String(count));
}

export interface BookmarkListRow {
  /** The dump's address shape: bare digits, no `0x`. */
  readonly address: string;
  /**
   * A named mark's name. An unnamed one shows nothing further: what it would
   * otherwise be described by is the row's bytes, and with no file open there
   * are none to read.
   */
  readonly name: string;
}

/**
 * The rows the list shows, one a mark, read-only: with no file open there is
 * nowhere to go, so a row that could be clicked would promise what it cannot do.
 *
 * @upstream ByteRipperApp/Window/EmptyStateView.swift#EmptyStateView.setBookmarks
 */
export function bookmarkRows(bookmarks: readonly Bookmark[]): BookmarkListRow[] {
  return bookmarks.map((bookmark) => ({ address: hexAddress(bookmark.row), name: bookmark.name }));
}

/**
 * What the workspace is called: the files it holds, or — holding none — how
 * many marks it is keeping. Not the app's name, which says nothing about this
 * workspace, and not "Untitled", which already means a new file.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.windowTitle
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.updateWindowTitle
 * @upstream-differs the browser tab's title, set as document.title
 */
export function windowTitle(
  names: { readonly a?: string | undefined; readonly b?: string | undefined },
  bookmarkCount: number
): string {
  const open = [names.a, names.b].filter((name): name is string => name !== undefined);
  const [first, second] = open;
  if (first === undefined) {
    if (bookmarkCount === 0) return L("Empty");
    return bookmarkCount === 1
      ? L("Empty (1 Bookmark)")
      : L("Empty (%1$@ Bookmarks)", String(bookmarkCount));
  }
  return second === undefined ? first : `${first} ↔ ${second}`;
}
