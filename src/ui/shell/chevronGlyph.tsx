/**
 * The chevron a pull-down carries: the mark that says a control opens a list to
 * choose from rather than acting at once. Three controls wear one — the
 * toolbar's Tools picker, the panel header's file selector and the word-size
 * field — and one drawing for all three is what keeps them reading as the same
 * gesture; three copies of the path would come to differ, which is what
 * happened to the scope before it was drawn once (see `scopeGlyph.tsx`).
 *
 * Upstream draws none of them: AppKit's `NSPopUpButton` brings its own arrow,
 * and the arrow alone is what says what the control is. Here the arrow is drawn
 * by this side — the word-size field has to be, since its bezel is the
 * platform's no longer (see `.toolbar-select`) — so it is drawn once.
 *
 * The `<svg>` around it sets the size and the stroke, which is a button's in the
 * toolbar and the panel header's beside a file's name.
 *
 * @upstream ByteRipperApp/App/MainWindowController.swift#MainWindowController.makeToolsItem
 * @upstream ByteRipperApp/Tools/ToolPanelView.swift#ToolPanelView.setPanes
 * @upstream-differs drawn shape, where upstream's button carries the platform's own arrow
 */

/** Down from the middle, on the `<svg>`'s 8×5 box: the two strokes of the arrow. */
export function ChevronShapes() {
  return <path d="M1 1l3 3 3-3" />;
}
