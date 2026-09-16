/**
 * Clicks that snap to what they were aimed at. Upstream's cases drive a window;
 * these check the same claims against one map's layout and the heights its
 * marks are painted at.
 */

import { describe, expect, test } from "vitest";
import {
  BOOKMARK_SNAP_DISTANCE,
  nearestBookmarkMark,
  nearestCut,
  segmentStripClick,
  type ZoneBracketBox,
  zoneBracketClick,
} from "@/render/minimap/minimapClick";
import { offsetAtY, yOfOffset } from "@/render/minimap/minimapGeometry";
import { MinimapLayout, ZONE_LANE_STEP } from "@/render/minimap/minimapLayout";

const plain = new MinimapLayout({
  width: 60,
  placement: "single",
  segmentStripVisible: false,
  zoneLaneCount: 0,
});

describe("a click near a bookmark's mark", () => {
  // @upstream ByteRipperTests/BookmarkMinimapTests.swift#BookmarkMinimapTests.testAClickNearAMarkLandsOnTheBookmark
  test("lands on the bookmark, where the byte under it would not", () => {
    const marks = [{ offset: 0x30000, y: 100 }];
    const margin = plain.bookmarkMargin;
    if (margin === undefined) throw new Error("premise: the map has a margin");
    const x = margin.x + margin.width / 2;
    expect(nearestBookmarkMark(plain, marks, x, 100)).toBe(0x30000);
    // Three pixels below its centre — inside the snap distance.
    expect(nearestBookmarkMark(plain, marks, x, 103)).toBe(0x30000);
    // And a click on the map beside it, just past the margin, still reaches it.
    expect(nearestBookmarkMark(plain, marks, margin.x + margin.width + 3, 100)).toBe(0x30000);
    const overview = {
      mode: "overview" as const,
      areaHeight: 400,
      topRow: 0,
      extent: 0x40000,
      overviewRows: 800,
    };
    expect(offsetAtY({ ...overview, y: 103 })).not.toBe(0x30000);
  });

  // @upstream ByteRipperTests/BookmarkMinimapTests.swift#BookmarkMinimapTests.testAClickWellAwayFromAMarkIsNotSnapped
  test("means nothing twenty pixels away", () => {
    const marks = [{ offset: 0x30000, y: 100 }];
    expect(nearestBookmarkMark(plain, marks, 5, 120)).toBeUndefined();
    expect(nearestBookmarkMark(plain, marks, 40, 100)).toBeUndefined();
  });

  // @upstream ByteRipperTests/BookmarkMinimapTests.swift#BookmarkMinimapTests.testTheNearerMarkWins
  test("goes to the nearer of two marks in range", () => {
    const marks = [
      { offset: 0x20000, y: 100 },
      { offset: 0x20800, y: 106 },
    ];
    // A point between them is in range of both, so the tie-break is what answers.
    expect(106 - 101.8).toBeLessThan(BOOKMARK_SNAP_DISTANCE + 3.5);
    expect(nearestBookmarkMark(plain, marks, 5, 101.8)).toBe(0x20000);
    expect(nearestBookmarkMark(plain, marks, 5, 104.2)).toBe(0x20800);
  });
});

describe("a click on the segment strip", () => {
  const striped = new MinimapLayout({
    width: 60,
    placement: "single",
    segmentStripVisible: true,
    zoneLaneCount: 0,
  });
  const strip = striped.segmentStripRect;
  const detail = {
    mode: "detail" as const,
    areaHeight: 300,
    topRow: 0,
    extent: 0,
    overviewRows: 0,
  };
  const cutsAt = (...offsets: number[]) =>
    offsets.map((offset) => ({ offset, y: yOfOffset({ ...detail, offset }) }));
  const click = (y: number, cuts: ReturnType<typeof cutsAt>, x = (strip?.x ?? 0) + 3) =>
    segmentStripClick({ ...detail, strip, cuts, x, y, fileSize: 256 });

  // @upstream ByteRipperTests/MinimapTests.swift#MinimapTests.testAClickNearACutLandsOnItsExactOffset
  test("near a cut lands on the cut's exact offset, not the row's start", () => {
    const cuts = cutsAt(64, 65, 128);
    const y = yOfOffset({ ...detail, offset: 65 }) + 2;
    expect(click(y, cuts)).toBe(65);
    expect(offsetAtY({ ...detail, y })).not.toBe(65);
  });

  // @upstream ByteRipperTests/MinimapTests.swift#MinimapTests.testTheNearerCutWins
  test("goes to the nearer of two cuts in reach", () => {
    const cuts = cutsAt(64, 80, 128);
    expect(click(yOfOffset({ ...detail, offset: 80 }) + 1, cuts)).toBe(80);
    expect(click(yOfOffset({ ...detail, offset: 64 }) - 1, cuts)).toBe(64);
    expect(nearestCut(cuts, 1000)).toBeUndefined();
  });

  // @upstream ByteRipperTests/MinimapTests.swift#MinimapTests.testAClickInTheMiddleOfABlockPositionsThere
  test("in the middle of a piece means the byte its height stands for", () => {
    expect(click(yOfOffset({ ...detail, offset: 96 }), cutsAt(64, 128))).toBe(96);
  });

  test("is the strip's only when it is on the strip, and stops at the file's end", () => {
    expect(click(18, cutsAt(64), 20)).toBeUndefined();
    expect(click(290, cutsAt(64))).toBe(255);
    const unstriped = segmentStripClick({
      ...detail,
      strip: plain.segmentStripRect,
      cuts: [],
      x: 50,
      y: 10,
      fileSize: 256,
    });
    expect(unstriped).toBeUndefined();
  });
});

describe("a click on a zone's bracket", () => {
  const zoned = new MinimapLayout({
    width: 60,
    placement: "single",
    segmentStripVisible: false,
    zoneLaneCount: 1,
  });
  const nested = new MinimapLayout({
    width: 60,
    placement: "single",
    segmentStripVisible: false,
    zoneLaneCount: 2,
  });
  const gutter = zoned.zoneGutterRect;
  const nestedGutter = nested.zoneGutterRect;
  if (gutter === undefined || nestedGutter === undefined) {
    throw new Error("premise: the map has a gutter");
  }
  const detail = {
    mode: "detail" as const,
    areaHeight: 300,
    topRow: 0,
    extent: 0,
  };
  const yOf = (offset: number) => yOfOffset({ ...detail, offset });
  const bracket = (id: string, start: number, end: number, depth = 0): ZoneBracketBox => ({
    id,
    start,
    end,
    depth,
    top: yOf(start),
    height: yOf(end) - yOf(start),
  });
  const click = (
    x: number,
    y: number,
    brackets: readonly ZoneBracketBox[],
    fileSize = 0x400,
    layout = zoned
  ) => zoneBracketClick({ ...detail, fileSize, layout, brackets, x, y });

  // @upstream ByteRipperTests/MinimapZoneTests.swift#MinimapZoneTests.testAClickOnAZonesEndsSnapsToThem
  test("goes to the end it is near, and to the start of the same zone", () => {
    const bios = [bracket("bios", 0x100, 0x300)];
    expect(click(gutter.x, yOf(0x100), bios)).toEqual({ id: "bios", offset: 0x100 });
    expect(click(gutter.x, yOf(0x300), bios)).toEqual({
      id: "bios",
      // The end is the zone's last byte, not the byte after it.
      offset: 0x2ff,
    });
  });

  test("means nothing in the middle of a bracket, or off every bracket", () => {
    const bios = [bracket("bios", 0x100, 0x300)];
    expect(click(gutter.x, yOf(0x200), bios)).toBeUndefined();
    expect(click(gutter.x, yOf(0x380), bios)).toBeUndefined();
    // And nothing outside the gutter, however near an end the height is.
    expect(
      click(gutter.x + gutter.width + BOOKMARK_SNAP_DISTANCE + 1, yOf(0x100), bios)
    ).toBeUndefined();
  });

  test("stops at the file's end when the zone runs past it", () => {
    const tail = [bracket("tail", 0x100, 0x400)];
    expect(click(gutter.x, yOf(0x400), tail, 0x300)?.offset).toBe(0x2ff);
  });

  test("takes the shortest bracket in the lane the pointer is in", () => {
    const zones = [bracket("outer", 0x000, 0x400, 0), bracket("inner", 0x100, 0x200, 1)];
    // Lane 1's column, at the inner zone's end: the inner bracket is the one
    // the pointer is on, and the outer's end is nowhere near.
    expect(click(nestedGutter.x + ZONE_LANE_STEP, yOf(0x200), zones)).toEqual({
      id: "inner",
      offset: 0x1ff,
    });
    // A lane with no bracket at that height falls back to the one beside it.
    expect(click(nestedGutter.x + ZONE_LANE_STEP, yOf(0x400), zones)).toEqual({
      id: "outer",
      offset: 0x3ff,
    });
  });
});
