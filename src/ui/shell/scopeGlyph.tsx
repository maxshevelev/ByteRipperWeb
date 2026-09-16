/**
 * The scope worn twice: the toolbar's **Go To** and the UEFI panel's control
 * that shows the node under the caret in the tree. One drawing for both is what
 * keeps the two buttons recognisably the same control — two copies of the paths
 * would come to differ, which is how they differed already: the toolbar's had
 * lost the ticks.
 *
 * Upstream does not draw it at all: both buttons name SF Symbols' `dot.scope`
 * and the system supplies the picture. There is no such catalogue here, so the
 * shape is written out once, and the `<svg>` around it sets the size, the
 * stroke and the colour — which differ between a toolbar button and a panel
 * header.
 *
 * @upstream ByteRipperApp/App/MainWindowController.swift#MainWindowController.goToItem
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolViewController.swift#UEFIToolViewController.loadView
 * @upstream-differs drawn shapes, where upstream names the symbol on both buttons
 */

/** `dot.scope`: the ring, the dot at its centre, and the four ticks out of it. */
export function ScopeShapes() {
  return (
    <>
      <circle cx="8" cy="8" r="5" />
      {/* The dot alone is solid: the ring and the ticks are the stroke, and the
          dot says so itself so it reads the same at either size. */}
      <circle cx="8" cy="8" r="1.2" fill="currentColor" stroke="none" />
      <path d="M8 1v2.2M8 12.8V15M1 8h2.2M12.8 8H15" />
    </>
  );
}
