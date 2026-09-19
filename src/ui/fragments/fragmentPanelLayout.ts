/**
 * Where a fragment panel sits in the area it covers (`Design/GAPS.md` G48, and
 * upstream's `Design/FRAGMENT_PANELS_PLAN.md`).
 *
 * Pure, so the one rule the geometry has — how much of the file underneath
 * stays showing — is pinned without a window.
 *
 * @upstream ByteRipperApp/Fragments/FragmentPanelView.swift#FragmentPanelLayout
 */

/**
 * How much of the pane header behind the panel the panel covers.
 *
 * A fifth. The overlap is what says the panel is laid *over* the file rather
 * than docked beside it — a panel that cleared the header entirely would read
 * as a second pane — and a fifth is enough to say so while leaving the header
 * itself readable.
 *
 * @upstream ByteRipperApp/Fragments/FragmentPanelView.swift#FragmentPanelLayout.headerCoveredShare
 */
export const HEADER_COVERED_SHARE = 0.2;

/**
 * The pane header's height, which the peek is a share of.
 *
 * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.headerHeight
 * @upstream-differs upstream pins the header at this height with a constraint;
 * here it sizes itself to its glyph, its name and its padding, which at the
 * app's own font measures 28.5 — near enough that taking upstream's number is
 * truer than inventing a second one, and the half point is invisible in a peek
 */
const PANE_HEADER_HEIGHT = 28;

/**
 * How much of the panes behind is left showing above the panel: the rest of
 * that header.
 *
 * @upstream ByteRipperApp/Fragments/FragmentPanelView.swift#FragmentPanelLayout.parentPeek
 */
export const PARENT_PEEK = PANE_HEADER_HEIGHT * (1 - HEADER_COVERED_SHARE);

/**
 * The panel never folds itself smaller than this by being in a short window:
 * below it there is no room for a header, a row of bytes and a status bar, and
 * showing the parent matters less than showing the part.
 *
 * @upstream ByteRipperApp/Fragments/FragmentPanelView.swift#FragmentPanelLayout.minimumPanelHeight
 */
export const MINIMUM_PANEL_HEIGHT = 160;

/**
 * The panel's height in an area `hostHeight` tall.
 *
 * The peek is what gives way when the window is short: full peek while the
 * panel can still be useful, then as much peek as is left over, then none at
 * all in an area smaller than the minimum — where the panel takes what there is
 * rather than hanging off the bottom.
 *
 * @upstream ByteRipperApp/Fragments/FragmentPanelView.swift#FragmentPanelLayout.panelHeight
 */
export function panelHeight(hostHeight: number): number {
  if (hostHeight <= 0) return 0;
  const wanted = hostHeight - PARENT_PEEK;
  if (wanted >= MINIMUM_PANEL_HEIGHT) return wanted;
  return Math.min(hostHeight, MINIMUM_PANEL_HEIGHT);
}
