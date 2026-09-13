/**
 * Where a scroller's thumb is, for content taller than a browser can lay out.
 *
 * The dump scrolls through a real scrolling element, so the browser's scrollbar,
 * trackpad momentum and keyboard all keep working. But the spacer inside it can
 * be no taller than the layout engine allows (`elementHeightLimit`), and a
 * 32 MB file at 17 px a row is taller than Chromium's limit — its end simply
 * could not be scrolled to.
 *
 * So there are two heights. The content's, which every offset and every row is
 * measured in; and the track's, the spacer the element really scrolls, which is
 * the content's own height whenever it fits and the limit when it does not.
 * Between them is a straight proportion mapping the top to the top and the last
 * screen to the last screen.
 *
 * Content that fits maps one-to-one and exactly, so scrolling a dump that fits
 * is what it always was.
 */

export interface TrackMetrics {
  readonly contentHeight: number;
  readonly trackHeight: number;
  readonly viewportHeight: number;
}

/** The spacer's height for `contentHeight`: the content's own, up to `limit`. */
export function trackHeightFor(contentHeight: number, limit: number): number {
  return Math.max(0, Math.min(contentHeight, Math.floor(limit)));
}

/** True when the track is shorter than the content, so a pixel of it is more than one of content. */
export function isScaled(metrics: TrackMetrics): boolean {
  return metrics.trackHeight < metrics.contentHeight;
}

/** The element's scroll offset for a content position. */
export function contentToTrack(top: number, metrics: TrackMetrics): number {
  if (!isScaled(metrics)) return top;
  const contentRange = metrics.contentHeight - metrics.viewportHeight;
  const trackRange = metrics.trackHeight - metrics.viewportHeight;
  if (contentRange <= 0 || trackRange <= 0) return 0;
  return (top * trackRange) / contentRange;
}

/** The content position an element scroll offset stands for. */
export function trackToContent(trackTop: number, metrics: TrackMetrics): number {
  if (!isScaled(metrics)) return trackTop;
  const contentRange = metrics.contentHeight - metrics.viewportHeight;
  const trackRange = metrics.trackHeight - metrics.viewportHeight;
  if (contentRange <= 0 || trackRange <= 0) return 0;
  return (trackTop * contentRange) / trackRange;
}

/** `WheelEvent.DOM_DELTA_LINE` and `DOM_DELTA_PAGE`, named without the DOM. */
const DELTA_LINE = 1;
const DELTA_PAGE = 2;

/**
 * A wheel delta in CSS pixels.
 *
 * Firefox reports a mouse wheel in lines and some devices in pages; a line here
 * is a row of the dump, which is what a notch of the wheel should move.
 */
export function wheelPixels(delta: number, mode: number, line: number, page: number): number {
  if (mode === DELTA_LINE) return delta * line;
  if (mode === DELTA_PAGE) return delta * page;
  return delta;
}
