import { type MinimapMode, offsetAtY, yOfOffset } from "@/render/minimap/minimapGeometry";
import {
  BOOKMARK_MARK_SIDE,
  type MinimapLayout,
  type Rect,
  ZONE_BRACKET_MIN_HEIGHT,
  ZONE_LANE_STEP,
} from "@/render/minimap/minimapLayout";

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

/**
 * One bracket down the gutter, as the pointer sees it: the zone it stands for,
 * and the box it was painted in.
 *
 * The range is carried beside the box because a click near an end needs the
 * byte at that end and the length that decides which nested bracket answers —
 * neither of which can be read off the pixel heights alone.
 *
 * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.ZoneBracket
 */
export interface ZoneBracketBox {
  /** The zone's own id, which is what the tool that published it is told. */
  readonly id: string;
  readonly start: number;
  readonly end: number;
  readonly top: number;
  readonly height: number;
  /** @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.ZoneBracket.lane */
  readonly depth: number;
}

/**
 * Which bracket a point on the gutter is on, or nothing — the lane nearest the
 * pointer answers first, and the shortest bracket in it that covers the point.
 *
 * Each lane owns the half an indent on either side of its stem, so pointing at
 * a parent's stem names the parent even where a child's bracket runs alongside
 * it. Within one lane the **shortest** zone containing the point wins: deeper
 * zones share the innermost lane once the nesting runs past the cap, and the
 * smallest zone under the pointer is the one being aimed at.
 *
 * A point in a lane with no bracket at that height falls back to any lane's, so
 * the pointer finds the one bracket beside it rather than nothing: the gutter is
 * mostly paper, and a zone map is sparse.
 *
 * The vertical reach is the snap distance either way, because a bracket is a
 * one-point line and one nobody can hit is one that does not answer.
 *
 * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.zoneBracket
 * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.zoneBracketBounds
 */
export function zoneBracket(
  layout: MinimapLayout,
  brackets: readonly ZoneBracketBox[],
  x: number,
  y: number
): ZoneBracketBox | undefined {
  const gutter = layout.zoneGutterRect;
  if (gutter === undefined || brackets.length === 0) return undefined;
  const reach = BOOKMARK_SNAP_DISTANCE;
  // The gutter runs the map's whole height, so its own vertical reach is what
  // bounds the point; the brackets below narrow it further.
  if (x < gutter.x - reach || x > gutter.x + gutter.width + reach) return undefined;
  const lanes = Math.max(1, layout.zoneLaneCount);
  const nearest = Math.min(lanes - 1, Math.max(0, Math.round((x - gutter.x) / ZONE_LANE_STEP)));

  const smallest = (lane: number | undefined): ZoneBracketBox | undefined => {
    let best: ZoneBracketBox | undefined;
    for (const bracket of brackets) {
      if (lane !== undefined && Math.min(bracket.depth, lanes - 1) !== lane) continue;
      const box = grownBracketBox(bracket);
      if (y < box.top - reach || y > box.top + box.height + reach) continue;
      if (best === undefined || bracket.end - bracket.start < best.end - best.start) best = bracket;
    }
    return best;
  };
  return smallest(nearest) ?? smallest(undefined);
}

/**
 * The box a bracket is hit-tested against: the painted one, with a zone of a few
 * bytes grown around its own middle, because on a whole-file overview it is
 * thinner than a pixel and a bracket the pointer cannot find is one that does
 * not answer.
 *
 * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.zoneBracketBounds
 */
function grownBracketBox(bracket: ZoneBracketBox): {
  readonly top: number;
  readonly height: number;
} {
  const height = Math.max(ZONE_BRACKET_MIN_HEIGHT, bracket.height);
  // Grown about the middle, as upstream grows it, so a bracket stays where it
  // was painted rather than growing downward from it.
  return { top: bracket.top - (height - bracket.height) / 2, height };
}

/**
 * The byte a click on the gutter stands for: the nearer of the clicked zone's two
 * ends, when one is within the snap distance of the click.
 *
 * A bracket states two facts — where the zone starts and where it ends — so
 * those are what a click near one snaps to, the way a click on the segment strip
 * snaps to a cut and a click near a bookmark's mark to its row. Nothing anywhere
 * else on the bracket, the middle of a long one included: there the click means
 * the byte drawn at that height, and sending the pane to the top of a zone the
 * reader pointed at the middle of would be a worse answer than the one they
 * aimed at.
 *
 * The **end** is the zone's last byte, not the half-open bound: the bound is the
 * first byte after the zone, and taking the pane there would put the caret
 * outside the thing that was clicked.
 *
 * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.zoneBracketClick
 */
export function zoneBracketClick(options: {
  readonly layout: MinimapLayout;
  readonly brackets: readonly ZoneBracketBox[];
  readonly x: number;
  readonly y: number;
  readonly mode: MinimapMode;
  readonly areaHeight: number;
  readonly topRow: number;
  readonly extent: number;
  readonly fileSize: number;
}): { readonly id: string; readonly offset: number } | undefined {
  const bracket = zoneBracket(options.layout, options.brackets, options.x, options.y);
  if (bracket === undefined) return undefined;
  const at = (offset: number): number =>
    yOfOffset({
      mode: options.mode,
      offset,
      areaHeight: options.areaHeight,
      topRow: options.topRow,
      extent: options.extent,
    });
  const ends: readonly (readonly [number, number])[] = [
    [bracket.start, at(bracket.start)],
    [bracket.end - 1, at(bracket.end)],
  ];
  let best: { offset: number; distance: number } | undefined;
  for (const [offset, endY] of ends) {
    const distance = Math.abs(options.y - endY);
    if (distance > BOOKMARK_SNAP_DISTANCE) continue;
    if (best === undefined || distance < best.distance) best = { offset, distance };
  }
  if (best === undefined) return undefined;
  return { id: bracket.id, offset: Math.min(best.offset, Math.max(options.fileSize, 1) - 1) };
}
