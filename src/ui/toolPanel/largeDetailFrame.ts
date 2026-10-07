/**
 * Where the large view of the details stands: a margin from the window's top, bottom and
 * outer edge, up to two thirds of its width, and clear of the tool panel it belongs to —
 * on the far side of it from the window's middle, a gap from its edge — so the width is
 * what the panel leaves when it is wider than a third of the window.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolDetailPane.swift#ToolDetailPane.restingFrame
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolDetailPane.swift#ToolDetailPane.gap
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolDetailPane.swift#ToolDetailPane.minimumWidth
 */
export const CARD_MARGIN = 30;
/**
 * The card's margin to the window's right and bottom edges, tighter — the card has nothing
 * there to keep apart from but the window's frame — where the top and the left want the
 * air of the toolbar.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolDetailPane.swift#ToolDetailPane.edgeMargin
 */
export const CARD_EDGE_MARGIN = 12;
export const CARD_GAP = 12;
export const CARD_MINIMUM_WIDTH = 200;
const WIDTH_SHARE = 2 / 3;

/** The panel's edges in the window, where the card belongs to one. */
export interface PanelEdges {
  readonly left: number;
  readonly right: number;
}

export function largeDetailFrame(
  viewportWidth: number,
  panel: PanelEdges | undefined
): { readonly left: number; readonly width: number } {
  let left = CARD_MARGIN;
  let right = viewportWidth - CARD_EDGE_MARGIN;
  let anchoredRight = true;
  if (panel !== undefined) {
    if ((panel.left + panel.right) / 2 <= viewportWidth / 2) {
      left = Math.max(left, panel.right + CARD_GAP);
    } else {
      right = Math.min(right, panel.left - CARD_GAP);
      anchoredRight = false;
    }
  }
  const width = Math.max(
    CARD_MINIMUM_WIDTH,
    Math.min(Math.round(viewportWidth * WIDTH_SHARE), right - left)
  );
  return { left: anchoredRight ? right - width : left, width };
}
