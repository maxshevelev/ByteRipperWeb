/**
 * The hover callout's geometry: where the capsule goes beside the thing it
 * names, and what glyph it wears. Pure arithmetic, so the placement rules are
 * unit-tested; `HoverCallout.tsx` is the half that draws.
 *
 * The callout names the thing under the pointer the moment the pointer reaches
 * it and goes the moment it leaves — a bookmark's mark, a segment piece or a
 * cut, a zone's bracket, a note's outline. The browser's own `title` tooltip is
 * the wrong instrument for marks the pointer sweeps across, as the system
 * tooltip is upstream: it waits before it appears, the wait cannot be changed,
 * and "point at each mark in turn" is exactly how a map of marks is read.
 *
 * Ported from `ByteRipperApp/Window/HoverCallout.swift`.
 */

/** A rectangle in the window's coordinates (CSS pixels, y running down). */
export interface CalloutRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * What the callout is naming, which decides its glyph. The colours are the
 * ones the thing itself is drawn with; the glyph makes them louder where they
 * are washes, so they still read on the grey.
 *
 * @upstream ByteRipperApp/Window/HoverCallout.swift#HoverCallout.Mark
 * @upstream-differs colours are CSS colour strings, resolved by the view that names the thing
 */
export type HoverMark =
  /** A bookmark (§20.4): the Offset column's purple pentagon. */
  | { readonly kind: "bookmark" }
  /** A piece of the segment partition (§21.3), in its tint. */
  | { readonly kind: "segment"; readonly tint: string }
  /**
   * A cut (§21.2): the piece before it above the line, the one after it
   * below — the boundary between two colours that it is.
   */
  | { readonly kind: "cut"; readonly above: string; readonly below: string }
  /**
   * A tool-module's zone (§19.4.5), in its bracket's colour — drawn in the
   * vivid shade the bracket itself goes to under the pointer.
   */
  | { readonly kind: "zone"; readonly color: string }
  /** A note on the bytes (`AgentAnnotation`), in its author's hue. */
  | { readonly kind: "annotation"; readonly color: string };

/**
 * The text size, the regular size of the interface rather than a tooltip's.
 *
 * @upstream ByteRipperApp/Window/HoverCallout.swift#HoverCallout.font
 */
export const CALLOUT_FONT_SIZE = 13;
/**
 * The longest a line may run before it wraps: a note can be a paragraph.
 *
 * @upstream ByteRipperApp/Window/HoverCallout.swift#HoverCallout.maximumTextWidth
 */
export const CALLOUT_MAXIMUM_TEXT_WIDTH = 360;
/**
 * The room between the capsule's ends and what it holds.
 *
 * @upstream ByteRipperApp/Window/HoverCallout.swift#HoverCallout.horizontalPadding
 */
export const CALLOUT_HORIZONTAL_PADDING = 10;
/**
 * The room above and below the lines.
 *
 * @upstream ByteRipperApp/Window/HoverCallout.swift#HoverCallout.verticalPadding
 */
export const CALLOUT_VERTICAL_PADDING = 5;
/**
 * The glyph's own column, and the room between it and the words.
 *
 * @upstream ByteRipperApp/Window/HoverCallout.swift#HoverCallout.glyphWidth
 * @upstream ByteRipperApp/Window/HoverCallout.swift#HoverCallout.glyphGap
 */
export const CALLOUT_GLYPH_WIDTH = 13;
export const CALLOUT_GLYPH_GAP = 5;
/**
 * How far the capsule stands off the thing it names.
 *
 * @upstream ByteRipperApp/Window/HoverCallout.swift#HoverCallout.gap
 */
export const CALLOUT_GAP = 4;
/**
 * The rounding of the capsule's ends — half a single line's height, so one
 * line reads as a pill and several as a rounded plate.
 *
 * @upstream ByteRipperApp/Window/HoverCallout.swift#HoverCallout.maximumCornerRadius
 */
export const CALLOUT_MAXIMUM_CORNER_RADIUS = 13;

/**
 * How far round the pointer a callout that follows it keeps clear: the arrow
 * cursor hangs below and to the right of its hot spot.
 *
 * @upstream ByteRipperApp/Hex/HexView.swift#HexView.pointerClearance
 * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.pointerClearance
 */
export const POINTER_CLEARANCE = 12;

/**
 * The anchor of a callout that follows the pointer — a legend's on the
 * minimap, a note's in the dump: a square round the pointer, so the capsule
 * stands beside it and never under it.
 *
 * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.hoverCallout
 * @upstream-differs the square upstream builds inline at both call sites, said once
 */
export function aroundPointer(x: number, y: number): CalloutRect {
  return {
    x: x - POINTER_CLEARANCE,
    y: y - POINTER_CLEARANCE,
    width: 2 * POINTER_CLEARANCE,
    height: 2 * POINTER_CLEARANCE,
  };
}

/**
 * Whether a capsule beside `anchor` opens to its right: toward the middle of
 * the view it describes, so a mark in a left margin opens its callout to the
 * right and one in a right margin to the left.
 *
 * @upstream ByteRipperApp/Window/HoverCallout.swift#HoverCallout.show
 */
export function opensRight(anchor: CalloutRect, view: CalloutRect): boolean {
  return anchor.x + anchor.width / 2 <= view.x + view.width / 2;
}

/**
 * Where a capsule of `size` goes beside `anchor`: level with the anchor's
 * middle, `CALLOUT_GAP` off the side `toRight` names — or off the other side
 * when that one runs out of `bounds` — and moved back inside `bounds` when it
 * still does not fit.
 *
 * @upstream ByteRipperApp/Window/HoverCallout.swift#HoverCallout.capsuleFrame
 */
export function capsuleFrame(
  size: { readonly width: number; readonly height: number },
  anchor: CalloutRect,
  toRight: boolean,
  bounds: CalloutRect
): CalloutRect {
  const right = anchor.x + anchor.width + CALLOUT_GAP;
  const left = anchor.x - CALLOUT_GAP - size.width;
  const maxX = bounds.x + bounds.width;
  const maxY = bounds.y + bounds.height;
  let x: number;
  if (toRight) x = right + size.width <= maxX ? right : left;
  else x = left >= bounds.x ? left : right;
  x = Math.max(bounds.x, Math.min(x, maxX - size.width));
  const middle = anchor.y + anchor.height / 2;
  const y = Math.max(bounds.y, Math.min(middle - size.height / 2, maxY - size.height));
  return { x, y, width: size.width, height: size.height };
}
