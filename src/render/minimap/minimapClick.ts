import { type MinimapMode, offsetAtY } from "@/render/minimap/minimapGeometry";
import { BOOKMARK_MARK_SIDE, type MinimapLayout, type Rect } from "@/render/minimap/minimapLayout";

/**
 * What a click on a map means, where it lands near something worth aiming at.
 *
 * On a full-dump overview a row is kilobytes, so the pointer can be dead on a
 * bookmark's arrow — or on a boundary in the segment strip — and still resolve
 * to an offset a dozen rows away from it. The mark is the target the user aimed
 * at, and these read the click that way. Dragging the band never comes through
 * here: a continuous scroll that jumped to a mark would fight the drag.
 *
 * Ported from the click half of `ByteRipperApp/Minimap/MinimapView.swift`. Pure
 * arithmetic over one map's layout and the heights its marks were painted at, so
 * what is tested is what the pointer finds.
 */

/**
 * How near a mark — a bookmark's arrow, a cut on the strip — a click may land
 * and still mean it.
 *
 * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.bookmarkSnapDistance
 */
export const BOOKMARK_SNAP_DISTANCE = 4;

/** Something on the map a click can snap to: the offset it names, and its y. */
export interface MapMark {
  readonly offset: number;
  readonly y: number;
}

/**
 * The box a bookmark's arrow is painted in on this map, at a mark's centre `y`,
 * or nothing when the map has no margin to draw one.
 *
 * The same rule the renderer draws by: the base on the margin's outer edge, the
 * apex just short of its inner one, the side centred on the row.
 *
 * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.marginMarkerBox
 */
export function bookmarkMarkBox(
  layout: MinimapLayout,
  y: number
):
  | { readonly x: number; readonly width: number; readonly top: number; readonly height: number }
  | undefined {
  const margin = layout.bookmarkMargin;
  if (margin === undefined) return undefined;
  return {
    x: margin.x,
    width: margin.width,
    top: y - BOOKMARK_MARK_SIDE / 2,
    height: BOOKMARK_MARK_SIDE,
  };
}

/**
 * The bookmark whose mark is nearest the point, within the snap distance of its
 * box — or nothing.
 *
 * Nearest by the mark's own centre line: two marks a few rows apart on an
 * overview can both be in range, and the one aimed at is the closer.
 *
 * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.nearestBookmarkMark
 */
export function nearestBookmarkMark(
  layout: MinimapLayout,
  marks: readonly MapMark[],
  x: number,
  y: number
): number | undefined {
  let best: { offset: number; distance: number } | undefined;
  for (const mark of marks) {
    const box = bookmarkMarkBox(layout, mark.y);
    if (box === undefined) return undefined;
    const inside =
      x >= box.x - BOOKMARK_SNAP_DISTANCE &&
      x <= box.x + box.width + BOOKMARK_SNAP_DISTANCE &&
      y >= box.top - BOOKMARK_SNAP_DISTANCE &&
      y <= box.top + box.height + BOOKMARK_SNAP_DISTANCE;
    if (!inside) continue;
    const distance = Math.abs(y - mark.y);
    if (best === undefined || distance < best.distance) best = { offset: mark.offset, distance };
  }
  return best?.offset;
}

/**
 * The cut nearest `y`, within the snap distance of it — or nothing.
 *
 * The cuts are the pieces' starts past the first, which is the file's start
 * rather than a cut.
 *
 * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.nearestCut
 */
export function nearestCut(cuts: readonly MapMark[], y: number): number | undefined {
  let best: { offset: number; distance: number } | undefined;
  for (const cut of cuts) {
    const distance = Math.abs(y - cut.y);
    if (distance > BOOKMARK_SNAP_DISTANCE) continue;
    if (best === undefined || distance < best.distance) best = { offset: cut.offset, distance };
  }
  return best?.offset;
}

/**
 * The byte a click on the segment strip stands for, or nothing when the point is
 * not on the strip.
 *
 * The strip positions like the map does — a click anywhere on it means "take me
 * here" — and a cut is a target worth snapping to, the way a bookmark's mark is:
 * the nearest cut in reach gives its exact offset, and anywhere else the byte the
 * click's y stands for, clamped to the file's own end.
 *
 * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.segmentStripClick
 */
export function segmentStripClick(options: {
  readonly strip: Rect | undefined;
  readonly cuts: readonly MapMark[];
  readonly x: number;
  readonly y: number;
  readonly mode: MinimapMode;
  readonly areaHeight: number;
  readonly topRow: number;
  readonly extent: number;
  readonly overviewRows: number;
  readonly fileSize: number;
}): number | undefined {
  const { strip, x, y } = options;
  // Grown by the snap distance, so a cut at the strip's very edge is still
  // reachable; vertically the map's own height bounds it.
  if (strip === undefined || options.fileSize <= 0) return undefined;
  if (x < strip.x - BOOKMARK_SNAP_DISTANCE || x > strip.x + strip.width + BOOKMARK_SNAP_DISTANCE) {
    return undefined;
  }
  if (y < -BOOKMARK_SNAP_DISTANCE || y > options.areaHeight + BOOKMARK_SNAP_DISTANCE)
    return undefined;
  const cut = nearestCut(options.cuts, y);
  if (cut !== undefined) return cut;
  return Math.min(offsetAtY(options), options.fileSize - 1);
}
