/**
 * Which presses beside the large view of the details leave it open.
 *
 * The card is closed by a click outside it, which still does what it was for: nothing is
 * dimmed or covered, so a click on the dump or the toolbar lands there. A press is left to
 * what it was aimed at, with the card still up, when it lands
 *
 * - in a tool panel — a row, a node's triangle, a menu button, the search, the legend;
 * - in another owner of a details pane (`data-detail-owner`, the Agent window's list);
 * - in an open menu;
 * - on a divider (`role="separator"`) — the tool panel's edge, the one between the two
 *   files, the minimap's, a column's — whose press moves the divider: the card follows the
 *   room it leaves, as it follows the window.
 *
 * Upstream also leaves the card up for a press that moves or resizes the window — its title
 * bar, the toolbar's bare ground, the window's buttons and edges — and, since `e7d038e5`, for
 * one on the window's title, a text field it had taken for a control. None of that is in the
 * page: a browser's window and its title are the browser's, and the desktop shell keeps the
 * system's frame, so such a press never reaches the document.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolDetailPane.swift#ToolDetailPane.handleClickWhileShown
 * @upstream-differs asked of the element the press landed on, by what it is in the page,
 * where upstream walks the view hierarchy from the hit; the window's own chrome is not in
 * the page and has no case here
 */
export const LEAVES_LARGE_DETAIL_OPEN =
  ".tool-panel, [data-detail-owner], [role=menu], [role=separator]";

/** Where a press landed, as much of an element as the question needs. */
export interface PressTarget {
  closest(selectors: string): unknown;
}

/** Whether a press on `target`, outside the card, leaves the large view open. */
export const pressLeavesLargeDetailOpen = (target: PressTarget): boolean =>
  (target.closest(LEAVES_LARGE_DETAIL_OPEN) ?? null) !== null;
