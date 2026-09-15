/**
 * The two signs of taking something out of a panel — as text, and as a
 * picture — drawn once.
 *
 * Each is worn twice: on the button that does the copy, and on the plate over
 * the window that confirms it. One drawing for both is what keeps the plate
 * recognisably about the control that was clicked; two copies of the paths
 * would come to differ.
 *
 * Shapes only, in a 16-unit box: the `<svg>` around them sets the size, the
 * stroke and the colour, which differ between a button and a plate.
 *
 * @upstream Modules/MEATool/Sources/MEAToolUI/MEAToolViewController.swift#MEAToolViewController.copySummaryGlyph
 * @upstream Modules/MEATool/Sources/MEAToolUI/MEAToolViewController.swift#MEAToolViewController.copyScreenshotGlyph
 * @upstream-differs drawn shapes, where upstream names the SF Symbols `doc.on.doc` and `camera`
 */

/** `doc.on.doc`: a page over a page. */
export function CopyDocumentShapes() {
  return (
    <>
      <rect x="5.5" y="5.5" width="8" height="9" rx="1.5" />
      <path d="M3.5 10.5h-.5a1.5 1.5 0 0 1-1.5-1.5V3a1.5 1.5 0 0 1 1.5-1.5h5A1.5 1.5 0 0 1 9.5 3v.5" />
    </>
  );
}

/** `camera`. */
export function CameraShapes() {
  return (
    <>
      <path d="M1.5 5.5A1.5 1.5 0 0 1 3 4h1.8l1.2-1.8h4l1.2 1.8H13a1.5 1.5 0 0 1 1.5 1.5v6.5A1.5 1.5 0 0 1 13 13.5H3A1.5 1.5 0 0 1 1.5 12z" />
      <circle cx="8" cy="8.5" r="2.6" />
    </>
  );
}
