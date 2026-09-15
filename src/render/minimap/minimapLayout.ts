/**
 * Where everything sits across a map's width.
 *
 * The byte-to-pixel mapping lives in `minimapGeometry.ts`; this is the other
 * axis — the margins, the strip, the gutter and what is left for the dump. It is
 * a value with no canvas in it, so the layout can be reasoned about and tested
 * without a render pass, which is what upstream's own design note (§
 * `Design/MINIMAP_LAYERS_IDEA.md`, "the part worth doing first: the index
 * guide") says to build before anything else. Every layer asks this rather than
 * deriving its own margins, which is what stopped them agreeing.
 *
 * Ported from the geometry half of `ByteRipperApp/Minimap/MinimapView.swift` —
 * `contentArea(within:forMapAt:)`, `segmentStripRect(forMapAt:)`,
 * `zoneGutterRect(forMapAt:)` and `bookmarkMargin(forMapAt:)`.
 *
 * One structural difference from upstream, and it changes nothing about the
 * numbers: upstream is a single view that splits itself into map areas, and the
 * web gives each map its own canvas and lets CSS do the splitting. So a
 * `MinimapLayout` describes *one* map, and the panel's own 5% gutter is the CSS
 * gap between the two canvases. What a map's area is differs; what happens
 * inside it does not — and it still depends on *which* map it is, because the
 * inner edge of a side-by-side pair carries no padding.
 */

/**
 * The side inset of a map's content — the cells sit in a ten-point frame,
 * matching the breathing room the hex panes give their dumps.
 *
 * Horizontal only: the rows run edge to edge top and bottom, because a top inset
 * would put every offset a few rows out from the bytes it stands for.
 *
 * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.contentPadding
 */
export const CONTENT_PADDING = 10;

/**
 * The colour strip's width — the legend beside a map that paints the partition
 * at a glance. Six points: wide enough to read as a swatch, narrow enough to
 * stay a margin and not a second map.
 *
 * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.segmentStripWidth
 */
export const SEGMENT_STRIP_WIDTH = 6;

/**
 * The paper between the strip and the content, so the legend does not crowd the
 * dump it names.
 *
 * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.segmentStripGap
 */
export const SEGMENT_STRIP_GAP = 2;

/**
 * How far one level of nesting indents its bracket. Four points: enough that two
 * stems read as two lanes and no more, because every one of them comes off the
 * map's own width — which is why the levels are capped rather than open-ended.
 *
 * Deliberately smaller than the arm, so a parent's arm reaches across its
 * children's lanes. That is what a nest of brackets looks like on paper, and it
 * costs nothing: the arms are at the zones' ends and the stems are between them.
 *
 * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.zoneLaneStep
 */
export const ZONE_LANE_STEP = 4;

/**
 * The paper between the gutter and the content — the strip's gap, mirrored.
 *
 * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.zoneGutterGap
 */
export const ZONE_GUTTER_GAP = 2;

/**
 * How far the brackets indent before deeper zones share the innermost lane.
 *
 * A UEFI parse is a tree a dozen levels deep and drawing all of it would leave
 * no map: the panel says where the published zones are, and the panel beside it
 * holds the tree.
 *
 * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.zoneMaxLanes
 */
export const ZONE_MAX_LANES = 3;

/**
 * How far a bracket's arms reach toward the map from its stem — what makes the
 * shape a bracket and not a rule.
 *
 * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.zoneBracketArm
 */
export const ZONE_BRACKET_ARM = 5;

/**
 * The smallest a bracket may be drawn, so a few bytes are still findable.
 *
 * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.zoneBracketMinHeight
 */
export const ZONE_BRACKET_MIN_HEIGHT = 4;

/**
 * The bookmark mark's height, and so the base of the triangle.
 *
 * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.bookmarkMarkSide
 */
export const BOOKMARK_MARK_SIDE = 7;

/** How far a margin marker's apex stops short of the margin's own edge. */
export const MARGIN_MARKER_INSET = 2;

/**
 * Which map this is, and what the pair looks like.
 *
 * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.MapLayout
 */
export type MapPlacement =
  /** The only map, or one of two stacked — padded on both sides. */
  | "single"
  /** The left of a side-by-side pair: padded outside, flush to the gutter inside. */
  | "left"
  /** The right of one: flush to the gutter inside, padded outside. */
  | "right";

export interface Rect {
  readonly x: number;
  readonly width: number;
}

/** Which side of a map its bookmark marks sit in, and which way they point. */
export interface BookmarkMargin extends Rect {
  readonly pointsRight: boolean;
}

export interface MinimapLayoutOptions {
  /** The map's own width in CSS pixels — its canvas, here. */
  readonly width: number;
  readonly placement: MapPlacement;
  /**
   * Whether the segment strip is drawn: only when the pane is actually
   * partitioned. A single piece has nothing to separate, so the legend is
   * absent — the same rule the dump's row tint follows, and the reason the map
   * does not give up width for a legend that would say nothing.
   *
   * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.segmentStripVisible
   */
  readonly segmentStripVisible: boolean;
  /**
   * How many lanes the zone gutter is wide — one per level of nesting the
   * published zones reach, capped. Zero when no tool has published any, so a
   * file nobody is parsing loses no width to a gutter.
   *
   * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.zoneGutterLaneCount
   */
  readonly zoneLaneCount: number;
}

/**
 * The whole of one map's horizontal layout.
 *
 * Built once per paint and handed to every layer, so the strip, the gutter, the
 * marks and the dump cannot disagree about where the margins are — which is
 * exactly what happened when each derived its own.
 *
 * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.layout
 * @upstream-differs one layout object both the painter and the hit-tests read
 */
export class MinimapLayout {
  readonly width: number;
  readonly placement: MapPlacement;
  readonly segmentStripVisible: boolean;
  readonly zoneLaneCount: number;

  constructor(options: MinimapLayoutOptions) {
    this.width = Math.max(0, options.width);
    this.placement = options.placement;
    this.segmentStripVisible = options.segmentStripVisible;
    this.zoneLaneCount = Math.max(0, Math.min(options.zoneLaneCount, ZONE_MAX_LANES));
  }

  /**
   * The strip's full claim on the right margin: its paper plus its own width.
   * Added to the padding, it is how far the content retreats so the strip can
   * sit `CONTENT_PADDING` from the map's edge — the same inset the content
   * carries on the other side, so the margins read as symmetric.
   */
  private get stripSpan(): number {
    return this.segmentStripVisible ? SEGMENT_STRIP_GAP + SEGMENT_STRIP_WIDTH : 0;
  }

  /**
   * The gutter's own width: one indent per level past the first, plus the arm.
   *
   * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.zoneGutterVisible
   */
  get zoneGutterWidth(): number {
    if (this.zoneLaneCount <= 0) return 0;
    return (this.zoneLaneCount - 1) * ZONE_LANE_STEP + ZONE_BRACKET_ARM;
  }

  /** Its claim on the left margin: its width plus its paper. Zero when absent. */
  private get zoneSpan(): number {
    const width = this.zoneGutterWidth;
    return width > 0 ? width + ZONE_GUTTER_GAP : 0;
  }

  /**
   * The padded region the dump is drawn in.
   *
   * Side by side the inner edges drop the inset entirely, so the visible gap
   * between the two maps is exactly the panel's own gutter rather than the
   * gutter plus two fixed pads — and it scales with the panel where a fixed pad
   * would not.
   *
   * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.contentAreaForTesting
   */
  get contentArea(): Rect {
    const leftPad = this.placement === "right" ? 0 : CONTENT_PADDING;
    const rightPad = this.placement === "left" ? 0 : CONTENT_PADDING;
    const x = leftPad + this.zoneSpan;
    // The left map's strip lives at its inner edge, where it has no padding of
    // its own, so it takes only its gap of paper either side.
    const rightInset =
      this.placement === "left"
        ? this.segmentStripVisible
          ? SEGMENT_STRIP_GAP * 2 + SEGMENT_STRIP_WIDTH
          : 0
        : rightPad + this.stripSpan;
    return { x, width: Math.max(0, this.width - rightInset - x) };
  }

  /**
   * The strip a map's partition is painted in, or nothing when the pane is one
   * piece.
   *
   * It sits on the *outer* side of its own map — the left map's against the
   * gutter, every other map's in its own right margin — so a pair of them is
   * never tucked together against the separator.
   *
   * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.segmentStripRect
   */
  get segmentStripRect(): Rect | undefined {
    if (!this.segmentStripVisible) return undefined;
    const content = this.contentArea;
    const x = content.x + content.width + SEGMENT_STRIP_GAP;
    if (x + SEGMENT_STRIP_WIDTH > this.width) return undefined;
    return { x, width: SEGMENT_STRIP_WIDTH };
  }

  /**
   * The column the zone brackets are drawn in, or nothing when no tool has
   * published any.
   *
   * Immediately left of the content, which has already retreated past it — so a
   * bracket never covers a byte — and on the side the strip does not use, so the
   * two legends never share a column whatever the layout.
   *
   * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.zoneGutterRect
   */
  get zoneGutterRect(): Rect | undefined {
    const width = this.zoneGutterWidth;
    if (width <= 0) return undefined;
    const x = this.contentArea.x - ZONE_GUTTER_GAP - width;
    return x < 0 ? undefined : { x, width };
  }

  /**
   * The x a lane's stem sits at: lane 0 is furthest from the map.
   *
   * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.zoneBracketBounds
   */
  zoneLaneX(lane: number): number {
    const gutter = this.zoneGutterRect;
    if (gutter === undefined) return 0;
    return gutter.x + Math.min(lane, Math.max(0, this.zoneLaneCount - 1)) * ZONE_LANE_STEP;
  }

  /**
   * The margin the bookmark marks are drawn in, and which way they point.
   *
   * The marks live in a side margin — outside the content, so a mark never
   * covers a byte — pointing inward at the row they mark. Which margin is
   * whichever is wider once the gutter and the strip have taken their share,
   * because neither of those is paper a mark may share: a mark past the strip
   * would point at the strip rather than at the row it names. Ties go left,
   * which is where a reader looks first.
   *
   * Side by side that comes out as the *outer* margin of each map — the left
   * map's marks on the panel's far left and the right map's on its far right —
   * since the inner edges have no padding at all to draw in.
   *
   * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.marginMarkerBox
   * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.marginMarkerReach
   */
  get bookmarkMargin(): BookmarkMargin | undefined {
    const content = this.contentArea;
    const contentEnd = content.x + content.width;
    // What each side has left once its legend has taken its share. The gutter
    // sits between the map's edge and the content, so the paper left on the
    // left is the padding in front of it; the strip sits between the content
    // and the map's edge, so the paper left on the right is the padding behind
    // it. Both are measured from the *outside*, which is where a mark goes.
    const left = Math.max(0, content.x - this.zoneSpan);
    const right = Math.max(0, this.width - contentEnd - this.stripSpan);
    if (left >= right && left > 1) return { x: 0, width: left, pointsRight: true };
    if (right > 1) {
      // Past the strip, not in front of it. Upstream reduces this margin's
      // *width* by the strip's claim and leaves its origin at the content's
      // edge, which puts the mark on top of the strip — the one thing its own
      // comment says must not happen ("a mark past it would point at the strip,
      // not the row it names"). Starting where the strip ends is what that
      // width was computed for, and it is the outer padding either way.
      return { x: contentEnd + this.stripSpan, width: right, pointsRight: false };
    }
    return undefined;
  }
}
