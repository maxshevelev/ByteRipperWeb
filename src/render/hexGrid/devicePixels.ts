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
