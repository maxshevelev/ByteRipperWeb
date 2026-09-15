import { CONTENT_PADDING } from "@/render/minimap/minimapLayout";

/**
 * How the overview marks where the panes are.
 *
 * A visible page of a large dump is a fraction of a pixel on a full-file
 * overview, so the band there gets a floor of two device pixels and reads as a
 * position rather than an extent. A band tall enough to be seen is drawn as a
 * translucent rectangle over the cells, like the detail band; a sliver is not
 * drawn over the content at all — it would hide a row of the picture for
 * nothing — and becomes a triangle in each outer margin, level with the middle
 * of the slice, pointing in at the map.
 */

/**
 * The band heights that switch between the two looks, overlapping by a point:
 * past the tall edge a band becomes a rectangle, below the short one it becomes
 * the markers, and between them it keeps the look it has — so a scroll hovering
 * on the boundary does not flicker between the two.
 *
 * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.overviewBandShortHeight
 */
export const OVERVIEW_BAND_SHORT_HEIGHT = 4;
/** @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.overviewBandTallHeight */
export const OVERVIEW_BAND_TALL_HEIGHT = 5;

/**
 * The base of the viewport marker's triangle: findable at a glance, small
 * enough to stay an index, and small enough that its height fits the margin.
 *
 * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.viewportMarkerSide
 */
export const VIEWPORT_MARKER_SIDE = 9;

/**
 * The paper between the marker's apex and the map's content edge: the arrow
 * points at the map without costing it a pixel.
 *
 * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.overviewMarkerInset
 */
export const OVERVIEW_MARKER_INSET = 2;

/**
 * The band's floor in overview: two device pixels, enough to carry a position.
 *
 * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.overviewRowHeight
 * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.viewportRect
 */
export function overviewBandFloor(devicePixelRatio: number): number {
  return 2 / (devicePixelRatio > 0 ? devicePixelRatio : 1);
}

/**
 * The look a band of `height` has, given the look it had: sticky across the
 * overlap between the two edges.
 *
 * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.overviewUsesRectangle
 */
export function overviewUsesRectangle(previous: boolean, height: number): boolean {
  if (height > OVERVIEW_BAND_TALL_HEIGHT) return true;
  if (height < OVERVIEW_BAND_SHORT_HEIGHT) return false;
  return previous;
}

/**
 * An equilateral triangle's height for a base of `side` — how far a marker
 * reaches back from its apex.
 *
 * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.marginMarkerReach
 */
export function marginMarkerReach(side: number): number {
  return (side * Math.sqrt(3)) / 2;
}

export interface MarkerBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** The left marker points right, at the map; the right one points left. */
  readonly pointsRight: boolean;
}

/**
 * The box a margin marker occupies: `side` tall, centred on `midY`, reaching
 * back from its apex toward the outer edge.
 *
 * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.marginMarkerBox
 */
export function marginMarkerBox(
  pointsRight: boolean,
  apexX: number,
  midY: number,
  side: number
): MarkerBox {
  const reach = marginMarkerReach(side);
  return {
    x: pointsRight ? apexX - reach : apexX,
    y: midY - side / 2,
    width: reach,
    height: side,
    pointsRight,
  };
}

/**
 * The two markers for a band spanning `left`…`left + width`: one in each outer
 * margin, level with the middle of the band, apex the inset short of the
 * content. None when the margin is too narrow to hold one.
 *
 * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.overviewMarkerRects
 */
export function overviewMarkerRects(band: {
  readonly left: number;
  readonly width: number;
  readonly top: number;
  readonly height: number;
}): MarkerBox[] {
  const side = VIEWPORT_MARKER_SIDE;
  const inset = OVERVIEW_MARKER_INSET;
  if (marginMarkerReach(side) + inset > CONTENT_PADDING) return [];
  const midY = band.top + band.height / 2;
  return [
    marginMarkerBox(true, band.left + CONTENT_PADDING - inset, midY, side),
    marginMarkerBox(false, band.left + band.width - CONTENT_PADDING + inset, midY, side),
  ];
}
