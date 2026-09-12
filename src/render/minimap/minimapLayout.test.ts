import { describe, expect, it } from "vitest";
import {
  CONTENT_PADDING,
  MinimapLayout,
  type MinimapLayoutOptions,
  SEGMENT_STRIP_GAP,
  SEGMENT_STRIP_WIDTH,
  ZONE_BRACKET_ARM,
  ZONE_GUTTER_GAP,
  ZONE_LANE_STEP,
  ZONE_MAX_LANES,
} from "@/render/minimap/minimapLayout";

/**
 * The index guide: where everything sits across a map's width.
 *
 * These are the numbers every layer reads, so they are asserted here rather than
 * through a render pass — which is the whole reason the layout is a value.
 */

const layout = (options: Partial<MinimapLayoutOptions> = {}) =>
  new MinimapLayout({
    width: 100,
    placement: "single",
    segmentStripVisible: false,
    zoneLaneCount: 0,
    ...options,
  });

describe("the content area", () => {
  it("pads a lone map on both sides", () => {
    const content = layout().contentArea;

    expect(content.x).toBe(CONTENT_PADDING);
    expect(content.width).toBe(100 - CONTENT_PADDING * 2);
  });

  it("drops the inner padding of a side-by-side pair", () => {
    // The visible gap between the two maps is the panel's own gutter and
    // nothing else — a pad here would make it the gutter plus two fixed slivers,
    // which stops scaling with the panel.
    const left = layout({ placement: "left" }).contentArea;
    expect(left.x).toBe(CONTENT_PADDING);
    expect(left.x + left.width).toBe(100);

    const right = layout({ placement: "right" }).contentArea;
    expect(right.x).toBe(0);
    expect(right.x + right.width).toBe(100 - CONTENT_PADDING);
  });

  it("retreats past the segment strip so the strip keeps the padding", () => {
    // The strip's own outer edge lands where the content's edge would have —
    // the same inset the content carries on the other side, so the margins read
    // as symmetric rather than as one wide and one narrow.
    const one = layout({ segmentStripVisible: true });
    const strip = one.segmentStripRect;

    expect(strip?.x).toBe(one.contentArea.x + one.contentArea.width + SEGMENT_STRIP_GAP);
    expect((strip?.x ?? 0) + (strip?.width ?? 0)).toBe(100 - CONTENT_PADDING);
  });

  it("retreats past the zone gutter on the other side", () => {
    const one = layout({ zoneLaneCount: 1 });
    const gutter = one.zoneGutterRect;

    expect(gutter?.x).toBe(CONTENT_PADDING);
    expect(one.contentArea.x).toBe(CONTENT_PADDING + ZONE_BRACKET_ARM + ZONE_GUTTER_GAP);
  });

  it("gives the width back when neither is there", () => {
    // A file nobody has cut and nobody is parsing loses no width to a legend
    // that would say nothing — which is why the strip and the gutter are
    // conditional rather than reserved.
    const bare = layout().contentArea;
    const both = layout({ segmentStripVisible: true, zoneLaneCount: 2 }).contentArea;

    expect(bare.width).toBeGreaterThan(both.width);
    expect(layout({ segmentStripVisible: false }).segmentStripRect).toBeUndefined();
    expect(layout({ zoneLaneCount: 0 }).zoneGutterRect).toBeUndefined();
  });

  it("never goes negative on a map too narrow to hold its margins", () => {
    const tiny = layout({ width: 8, segmentStripVisible: true, zoneLaneCount: 3 });

    expect(tiny.contentArea.width).toBeGreaterThanOrEqual(0);
  });
});

describe("the segment strip", () => {
  it("sits on the outer side of each map of a pair", () => {
    // Never tucked together against the separator: each strip is on the far
    // side of its own map, so the two never share the gutter.
    const left = layout({ placement: "left", segmentStripVisible: true });
    const right = layout({ placement: "right", segmentStripVisible: true });

    // The left map's strip is at its inner edge, against the gutter.
    expect((left.segmentStripRect?.x ?? 0) + SEGMENT_STRIP_WIDTH).toBe(100 - SEGMENT_STRIP_GAP);
    // The right map's is in its own right margin, like a lone map's.
    expect((right.segmentStripRect?.x ?? 0) + SEGMENT_STRIP_WIDTH).toBe(100 - CONTENT_PADDING);
  });
});

describe("the zone gutter", () => {
  it("is one lane wide plus an arm, and steps by a lane per level", () => {
    expect(layout({ zoneLaneCount: 1 }).zoneGutterWidth).toBe(ZONE_BRACKET_ARM);
    expect(layout({ zoneLaneCount: 2 }).zoneGutterWidth).toBe(ZONE_LANE_STEP + ZONE_BRACKET_ARM);
    expect(layout({ zoneLaneCount: 3 }).zoneGutterWidth).toBe(
      ZONE_LANE_STEP * 2 + ZONE_BRACKET_ARM
    );
  });

  it("caps the lanes, whatever the tree's depth", () => {
    // A UEFI parse is a dozen levels deep and drawing all of it would leave no
    // map at all.
    expect(layout({ zoneLaneCount: 12 }).zoneGutterWidth).toBe(
      layout({ zoneLaneCount: ZONE_MAX_LANES }).zoneGutterWidth
    );
  });

  it("puts the outermost zones furthest from the map", () => {
    // Each level of nesting steps one lane toward it, so a child's bracket is
    // drawn inside its parent's and the gutter reads as the tree it stands for.
    const one = layout({ zoneLaneCount: 3 });

    expect(one.zoneLaneX(1) - one.zoneLaneX(0)).toBe(ZONE_LANE_STEP);
    expect(one.zoneLaneX(2) - one.zoneLaneX(1)).toBe(ZONE_LANE_STEP);
    expect(one.zoneLaneX(0)).toBe(one.zoneGutterRect?.x);
  });

  it("keeps a lane past the cap in the innermost one", () => {
    const one = layout({ zoneLaneCount: 3 });
    expect(one.zoneLaneX(9)).toBe(one.zoneLaneX(ZONE_MAX_LANES - 1));
  });
});

describe("the bookmark margin", () => {
  it("marks a lone map on the left, pointing right", () => {
    // Ties go left, which is where a reader looks first.
    const margin = layout().bookmarkMargin;

    expect(margin).toEqual({ x: 0, width: CONTENT_PADDING, pointsRight: true });
  });

  it("marks each map of a pair in its own outer margin", () => {
    // The left map's on the panel's far left and the right map's on its far
    // right — never in the gutter between them, which has no padding to draw in.
    const left = layout({ placement: "left" }).bookmarkMargin;
    expect(left).toEqual({ x: 0, width: CONTENT_PADDING, pointsRight: true });

    const right = layout({ placement: "right" });
    expect(right.bookmarkMargin).toEqual({
      x: right.contentArea.x + right.contentArea.width,
      width: CONTENT_PADDING,
      pointsRight: false,
    });
  });

  it("keeps off the strip's column", () => {
    // The strip's own paper is not a mark's, so the margin starts where the
    // strip ends — in the map's outer padding — rather than on top of it.
    const one = layout({ placement: "right", segmentStripVisible: true });
    const strip = one.segmentStripRect;
    const margin = one.bookmarkMargin;

    expect(margin?.pointsRight).toBe(false);
    expect(margin?.x).toBe((strip?.x ?? 0) + (strip?.width ?? 0));
    expect(margin?.width).toBe(CONTENT_PADDING);
    // And so the two never overlap, whatever else moves.
    expect(margin?.x).toBeGreaterThanOrEqual((strip?.x ?? 0) + (strip?.width ?? 0));
  });

  it("keeps off the gutter's lanes", () => {
    // The same rule on the other side: the lanes are not paper a mark may point
    // across, so the margin is the padding in front of the gutter.
    const one = layout({ zoneLaneCount: 3, segmentStripVisible: true });
    const gutter = one.zoneGutterRect;
    const margin = one.bookmarkMargin;

    // A tie between the two margins goes left, which is where a reader looks.
    expect(margin).toEqual({ x: 0, width: CONTENT_PADDING, pointsRight: true });
    expect((margin?.x ?? 0) + (margin?.width ?? 0)).toBeLessThanOrEqual(gutter?.x ?? 0);
  });

  it("takes the wider margin when only one side is padded", () => {
    const one = layout({ placement: "left", segmentStripVisible: true });

    // The left map's strip is at its *inner* edge, so its left padding is still
    // free and the marks go there.
    expect(one.bookmarkMargin?.pointsRight).toBe(true);
    expect(one.bookmarkMargin?.x).toBe(0);
  });
});
