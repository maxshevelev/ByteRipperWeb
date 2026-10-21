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
 * How far the panel stands in from the left and right edges of the panes behind it. A margin on
 * three sides, with the panes showing dimmed through it, is what says the panel lies *over* them:
 * a strip at the top alone read to some as the window having changed its layout.
 *
 * @upstream ByteRipperApp/Fragments/FragmentPanelView.swift#FragmentPanelLayout.sideInset
 */
export const SIDE_INSET = 16;

/**
 * How much of the panes behind is left showing above the panel: twice the side margin, so the
 * top reads as the panel's open edge and the file's own header stays visible behind the scrim.
 *
 * @upstream ByteRipperApp/Fragments/FragmentPanelView.swift#FragmentPanelLayout.parentPeek
 */
export const PARENT_PEEK = SIDE_INSET * 2;

/**
 * The panel's place in an area `width` by `height`: in from either side by the margin — a quarter
 * of the width at most, so a narrow window gives up the margins rather than the panel — and on the
 * area's bottom edge, which is the dock's top.
 *
 * @upstream ByteRipperApp/Fragments/FragmentPanelView.swift#FragmentPanelView.restingFrame
 */
export function restingFrame(
  width: number,
  height: number
): { readonly x: number; readonly width: number; readonly height: number } {
  const inset = Math.min(SIDE_INSET, width / 4);
  return { x: inset, width: Math.max(0, width - inset * 2), height: panelHeight(height) };
}

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
