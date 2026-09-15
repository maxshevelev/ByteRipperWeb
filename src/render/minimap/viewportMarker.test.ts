import { describe, expect, it } from "vitest";
import {
  BOOKMARK_MARK_SIDE,
  CONTENT_PADDING,
  MARGIN_MARKER_INSET,
} from "@/render/minimap/minimapLayout";
import {
  marginMarkerReach,
  OVERVIEW_BAND_SHORT_HEIGHT,
  OVERVIEW_BAND_TALL_HEIGHT,
  overviewBandFloor,
  overviewMarkerRects,
  overviewUsesRectangle,
  VIEWPORT_MARKER_SIDE,
} from "@/render/minimap/viewportMarker";

/** How the overview marks the viewport — upstream's `MinimapTests` and `BookmarkMinimapTests` where they are about geometry. */

describe("the overview's viewport look", () => {
  // Sticky across the overlap: a scroll hovering on the edge does not flicker.
  // @upstream ByteRipperTests/MinimapTests.swift#MinimapTests.testOverviewViewportStyleIsStickyAcrossTheHysteresisZone
  it("keeps the look it has between the two edges", () => {
    let rectangle = false;
    rectangle = overviewUsesRectangle(rectangle, 6);
    expect(rectangle).toBe(true);
    rectangle = overviewUsesRectangle(rectangle, 4.5);
    expect(rectangle).toBe(true);
    rectangle = overviewUsesRectangle(rectangle, 3);
    expect(rectangle).toBe(false);
    rectangle = overviewUsesRectangle(rectangle, 4.5);
    expect(rectangle).toBe(false);
    expect(OVERVIEW_BAND_TALL_HEIGHT - OVERVIEW_BAND_SHORT_HEIGHT).toBe(1);
  });

  it("gives a sliver a floor of two device pixels", () => {
    expect(overviewBandFloor(2)).toBe(1);
    expect(overviewBandFloor(1)).toBe(2);
  });
});

describe("the viewport markers", () => {
  const band = { left: 0, width: 200, top: 100, height: 1 };

  it("stand in both margins, level with the middle of the band, pointing in", () => {
    const [left, right] = overviewMarkerRects(band);
    expect(left?.pointsRight).toBe(true);
    expect(right?.pointsRight).toBe(false);
    expect((left?.y ?? 0) + VIEWPORT_MARKER_SIDE / 2).toBe(100.5);
    // The apex stops the inset short of the content on both sides.
    expect((left?.x ?? 0) + (left?.width ?? 0)).toBeCloseTo(CONTENT_PADDING - 2);
    expect(right?.x).toBeCloseTo(200 - CONTENT_PADDING + 2);
  });

  it("are equilateral, and the bigger of the margin's two arrows while still fitting it", () => {
    const [left] = overviewMarkerRects(band);
    expect(left?.height).toBe(VIEWPORT_MARKER_SIDE);
    expect(left?.width).toBeCloseTo(marginMarkerReach(VIEWPORT_MARKER_SIDE));
    expect(BOOKMARK_MARK_SIDE).toBeLessThan(VIEWPORT_MARKER_SIDE);
    expect((left?.x ?? -1) >= 0).toBe(true);
  });

  // A bookmark's mark and the viewport marker point at the same line.
  it("aim at the same line a bookmark's mark does", () => {
    const [left] = overviewMarkerRects(band);
    expect((left?.x ?? 0) + (left?.width ?? 0)).toBeCloseTo(CONTENT_PADDING - MARGIN_MARKER_INSET);
  });
});
