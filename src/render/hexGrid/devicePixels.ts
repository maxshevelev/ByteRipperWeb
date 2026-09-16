/**
 * A CSS length moved onto the nearest whole device pixel.
 *
 * The grid scrolls by copying what it painted and repainting only the band the
 * copy exposed. The copy can only move by whole device pixels, so a scroll
 * offset that falls between two of them — which a scaled track, a wheel on a
 * high-density screen and the other pane's linked position all produce — let
 * the copied rows land half a pixel away from the rows painted beside them.
 * The error was carried into the next frame's copy and grew with every one,
 * which is what drew lines between the rows. Snapping the offset first makes
 * the copy and the paint agree to the pixel.
 */
export function snapToDevicePixels(css: number, devicePixelRatio: number): number {
  const scale = devicePixelRatio > 0 ? devicePixelRatio : 1;
  return Math.round(css * scale) / scale;
}

/**
 * The band two edges bound, with both of them on the device grid.
 *
 * A row is a whole number of CSS pixels tall, but a device pixel is not a whole
 * number of CSS pixels: a 2× screen at 90% browser zoom draws 1.8 of them per
 * CSS pixel, and a sixteen-pixel row covers 28.8 of them. Two rows then meet in
 * the middle of a device pixel, and each of the two fills covers that pixel only
 * partly — so whatever is beneath it, the canvas's own black or the colour the
 * row above painted, shows through the remainder. That is the line drawn between
 * the rows, and it is why the grid read correctly at 100% zoom and at no other.
 *
 * Rounding the band's top and its bottom, and taking the height as the distance
 * between them, is what makes two neighbours agree. A row's bottom and the next
 * row's top are the *same expression on the same numbers* — the caller passes
 * the top of the row below as this band's `bottom` — so they are the same
 * number, and the two bands meet exactly: every device pixel gets one row's
 * colour and no pixel is left over. That is what a gap-free grid needs; drawing
 * a row outward onto the grid instead (`floor`/`ceil`) covers the pixels but
 * blends the two rows' colours in the shared one, which is the same line in a
 * fainter ink.
 *
 * The edges must be on the grid *in the canvas's own coordinates*, so the
 * transform's vertical offset has to be on it too — a fraction there puts every
 * band back between two pixels however carefully they are rounded here. See
 * `HexGridRenderer.draw`.
 *
 * @web-only AppKit fills a rect on the backing store's grid itself, so a row
 * that is not a whole number of device pixels cannot arise upstream; a canvas
 * fills where it is told, and a row has to be put on the grid here
 */
export function bandOnDeviceGrid(
  top: number,
  bottom: number,
  devicePixelRatio: number
): { readonly top: number; readonly height: number } {
  const snappedTop = snapToDevicePixels(top, devicePixelRatio);
  const snappedBottom = snapToDevicePixels(bottom, devicePixelRatio);
  return { top: snappedTop, height: snappedBottom - snappedTop };
}
