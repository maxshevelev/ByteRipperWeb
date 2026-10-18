/**
 * What hovering the map says. Upstream's cases drive a window; these check the
 * same claims against one map's layout and the heights its marks are painted at.
 */

import { describe, expect, test } from "vitest";
import { bookmarkMarkBox } from "@/render/minimap/minimapClick";
import { yOfOffset } from "@/render/minimap/minimapGeometry";
import {
  minimapHover,
  minimapHoverText,
  type NamedBracket,
  type StripPiece,
  segmentStripHoverText,
  segmentStripMark,
  zoneBracketHoverText,
  zoneBracketMark,
} from "@/render/minimap/minimapHover";
import { MinimapLayout } from "@/render/minimap/minimapLayout";
import { capsuleFrame, opensRight } from "@/ui/callout/hoverCalloutGeometry";

/** A detail map of a small file, so every byte has its own height. */
const detail = { mode: "detail" as const, areaHeight: 400, topRow: 0, extent: 0 };
const yOf = (offset: number) => yOfOffset({ ...detail, offset });

const layoutOf = (options: {
  placement?: "single" | "left" | "right";
  strip?: boolean;
  lanes?: number;
}) =>
  new MinimapLayout({
    width: 60,
    placement: options.placement ?? "single",
    segmentStripVisible: options.strip ?? false,
    zoneLaneCount: options.lanes ?? 0,
  });

/** What the whole map would say at a point, with only the marks given. */
const hoverOf = (
  layout: MinimapLayout,
  marks: readonly { offset: number; name: string }[],
  x: number,
  y: number
) =>
  minimapHoverText({
    layout,
    cuts: [],
    pieces: [],
    brackets: [],
    marks: marks.map((mark) => ({ ...mark, y: yOf(mark.offset) })),
    zoneColors: ZONES,
    x,
    y,
  });

const ZONES = { focused: "teal", other: "khaki" };

/** The middle of a bookmark's mark box on `layout`. */
function centreOfMark(layout: MinimapLayout, offset: number): { x: number; y: number } {
  const box = bookmarkMarkBox(layout, yOf(offset));
  if (box === undefined) throw new Error("premise: the map has a margin");
  return { x: box.x + box.width / 2, y: box.top + box.height / 2 };
}

describe("hovering a bookmark's mark (§19.4.3)", () => {
  // A mark carries no text, so hovering it says which row it marks — and what the
  // bookmark is called, when it is called anything.
  // @upstream ByteRipperTests/BookmarkMinimapTests.swift#BookmarkMinimapTests.testHoveringAMarkNamesIt
  test("names the row it marks, and the bookmark's name", () => {
    const layout = layoutOf({});
    const { x, y } = centreOfMark(layout, 0x400);
    expect(hoverOf(layout, [{ offset: 0x400, name: "" }], x, y)).toBe("00000400");
    expect(hoverOf(layout, [{ offset: 0x400, name: "EC table" }], x, y)).toBe("00000400: EC table");
  });

  // Anywhere that is not a mark says nothing, which shows no callout at all.
  // @upstream ByteRipperTests/BookmarkMinimapTests.swift#BookmarkMinimapTests.testHoveringElsewhereSaysNothing
  test("says nothing anywhere else", () => {
    const layout = layoutOf({});
    const marks = [{ offset: 0x400, name: "" }];
    const { x, y } = centreOfMark(layout, 0x400);
    // The map's own content is not a mark…
    expect(hoverOf(layout, marks, layout.contentArea.x + layout.contentArea.width / 2, y)).toBe("");
    // …and an unmarked row's margin is not either.
    expect(hoverOf(layout, marks, x, y + 30)).toBe("");
  });

  // The callout answers from the pointer's position, so the mark on the second map
  // of a comparison — in its own margin, on the other side — is found too.
  // @upstream ByteRipperTests/BookmarkMinimapTests.swift#BookmarkMinimapTests.testHoveringAMarkOnTheSecondMapNamesItToo
  test("names a mark on the second map of a comparison", () => {
    const layout = layoutOf({ placement: "right" });
    const { x, y } = centreOfMark(layout, 0x800);
    expect(hoverOf(layout, [{ offset: 0x800, name: "NVRAM" }], x, y)).toBe("00000800: NVRAM");
  });
});

describe("hovering a zone's bracket (§19.4.5)", () => {
  const layout = layoutOf({ lanes: 1 });
  const gutter = layout.zoneGutterRect;
  if (gutter === undefined) throw new Error("premise: the map has a gutter");
  const bracket = (name: string, start: number, end: number): NamedBracket => ({
    id: name || "x",
    name,
    start,
    end,
    top: yOf(start),
    height: yOf(end) - yOf(start),
    depth: 0,
  });

  // Hovering a bracket names its zone: the name, the range and the size — the
  // shape the segment strip's own hover text takes (§19.4.4).
  // @upstream ByteRipperTests/MinimapZoneTests.swift#MinimapZoneTests.testHoveringABracketNamesTheZone
  test("names the zone, its range and its size", () => {
    const brackets = [bracket("BIOS region", 0x100, 0x300)];
    const text = zoneBracketHoverText(layout, brackets, gutter.x, yOf(0x200));
    expect(text).toContain("BIOS region");
    expect(text).toContain("0x100");
    // Its last byte, not the bound.
    expect(text).toContain("0x2FF");
    expect(text).toContain("512");
    // And nothing off every bracket.
    expect(zoneBracketHoverText(layout, brackets, gutter.x, yOf(0x380))).toBe("");
  });

  // An unnamed zone is named by its range alone — a stretch worth drawing is
  // worth naming even before it has a name.
  // @upstream ByteRipperTests/MinimapZoneTests.swift#MinimapZoneTests.testAnUnnamedZoneIsNamedByItsRange
  test("names an unnamed zone by its range", () => {
    const text = zoneBracketHoverText(layout, [bracket("", 0x100, 0x180)], gutter.x, yOf(0x140));
    expect(text.startsWith("0x100")).toBe(true);
    expect(text).not.toContain("—");
  });

  // The glyph is the bracket in the colour of the zone's state: a zone not in
  // focus in the other zones' colour.
  // @upstream ByteRipperTests/MinimapZoneTests.swift#MinimapZoneTests.testHoveringABracketNamesTheZone
  test("wears the bracket's colour", () => {
    const brackets = [bracket("BIOS region", 0x100, 0x300)];
    expect(zoneBracketMark(layout, brackets, ZONES, gutter.x, yOf(0x200))).toEqual({
      kind: "zone",
      color: "khaki",
    });
    const focused = [{ ...bracket("BIOS region", 0x100, 0x300), focused: true }];
    expect(zoneBracketMark(layout, focused, ZONES, gutter.x, yOf(0x200))).toEqual({
      kind: "zone",
      color: "teal",
    });
  });
});

describe("hovering the segment strip (§19.4.4)", () => {
  const layout = layoutOf({ strip: true });
  const strip = layout.segmentStripRect;
  if (strip === undefined) throw new Error("premise: the map has a strip");
  const piecesOf = (names: readonly string[]): StripPiece[] =>
    [
      [0, 64],
      [64, 128],
      [128, 256],
    ].map(([start = 0, end = 0], index) => ({
      index,
      start,
      end,
      name: names[index] ?? "",
      top: yOf(start),
      height: yOf(end) - yOf(start),
      tint: `tint${index}`,
    }));
  const cuts = [64, 128].map((offset) => ({ offset, y: yOf(offset) }));
  const x = strip.x + strip.width / 2;

  // Hovering a piece names it: its label, its range, its size, and its name — the
  // legend the strip is.
  // @upstream ByteRipperTests/MinimapTests.swift#MinimapTests.testTheStripHoverNamesAPiece
  test("names a piece, and its name as it is now", () => {
    const text = segmentStripHoverText({ strip, cuts, pieces: piecesOf([]), x, y: yOf(96) });
    expect(text).toContain("S1");
    expect(text).toContain("0x40");
    // First to last byte: S1 = [64, 128) → 0x40…0x7F.
    expect(text).toContain("0x7F");
    expect(text).toContain("64");
    // A renamed piece is drawn with its new name, and the hover reads it.
    const named = segmentStripHoverText({
      strip,
      cuts,
      pieces: piecesOf(["", "testpiece"]),
      x,
      y: yOf(96),
    });
    expect(named).toContain("testpiece");
    // And it wears S1's tint.
    expect(segmentStripMark({ strip, cuts, pieces: piecesOf([]), x, y: yOf(96) })).toEqual({
      kind: "segment",
      tint: "tint1",
    });
  });

  // Hovering a boundary — within the snap distance of a cut — names the cut's
  // offset, not a piece: the pointer is on the line between two colours, and the
  // line is the more precise fact.
  // @upstream ByteRipperTests/MinimapTests.swift#MinimapTests.testTheStripHoverNamesABoundaryNearACut
  test("names a boundary near a cut", () => {
    const text = segmentStripHoverText({ strip, cuts, pieces: piecesOf([]), x, y: yOf(64) });
    expect(text).toBe("0x40");
    expect(text).not.toContain("S1");
    // Its glyph is the two pieces it separates, the earlier one on top.
    expect(segmentStripMark({ strip, cuts, pieces: piecesOf([]), x, y: yOf(64) })).toEqual({
      kind: "cut",
      above: "tint0",
      below: "tint1",
    });
  });

  // A strip is long, so its callout follows the pointer along it rather than
  // standing at one end — and stays clear of the cursor.
  // @upstream ByteRipperTests/BookmarkMinimapTests.swift#BookmarkMinimapTests.testALegendsCalloutFollowsThePointer
  test("its callout follows the pointer, clear of it", () => {
    const at = (y: number) =>
      minimapHover({
        layout,
        cuts,
        pieces: piecesOf([]),
        brackets: [],
        marks: [],
        zoneColors: ZONES,
        x,
        y,
      });
    const high = at(yOf(20));
    const low = at(yOf(40));
    expect(high?.mark).toEqual({ kind: "segment", tint: "tint0" });
    expect((low?.anchor.y ?? 0) - (high?.anchor.y ?? 0)).toBeCloseTo(yOf(40) - yOf(20), 5);
    const anchor = low?.anchor ?? { x: 0, y: 0, width: 0, height: 0 };
    const frame = capsuleFrame({ width: 80, height: 20 }, anchor, true, {
      x: -500,
      y: -500,
      width: 2000,
      height: 2000,
    });
    const under =
      x >= frame.x &&
      x <= frame.x + frame.width &&
      yOf(40) >= frame.y &&
      yOf(40) <= frame.y + frame.height;
    expect(under).toBe(false);
  });
});

describe("the callout on a bookmark's mark (§19.4.3)", () => {
  // The name is up the moment the pointer reaches the mark, beside the arrow and
  // opening into the map — never over the mark.
  // @upstream ByteRipperTests/BookmarkMinimapTests.swift#BookmarkMinimapTests.testTheCalloutNamesAMarkAtOnceAndGoesWhenThePointerLeaves
  test("stands beside the mark, level with it, opening into the map", () => {
    const layout = layoutOf({});
    const { x, y } = centreOfMark(layout, 0x400);
    const shown = minimapHover({
      layout,
      cuts: [],
      pieces: [],
      brackets: [],
      marks: [{ offset: 0x400, name: "EC table", y: yOf(0x400) }],
      zoneColors: ZONES,
      x,
      y,
    });
    expect(shown?.text).toBe("00000400: EC table");
    expect(shown?.mark).toEqual({ kind: "bookmark" });
    const box = bookmarkMarkBox(layout, yOf(0x400));
    expect(shown?.anchor).toEqual({
      x: box?.x,
      y: box?.top,
      width: box?.width,
      height: box?.height,
    });
    const map = { x: 0, y: 0, width: 60, height: 400 };
    const anchor = shown?.anchor ?? map;
    expect(opensRight(anchor, map)).toBe(true);
    const frame = capsuleFrame({ width: 100, height: 20 }, anchor, true, {
      x: 0,
      y: 0,
      width: 800,
      height: 600,
    });
    expect(frame.x).toBeGreaterThan(anchor.x + anchor.width);
    expect(frame.y + frame.height / 2).toBeCloseTo(anchor.y + anchor.height / 2, 5);
    // An unmarked row's margin has nothing to say.
    expect(hoverOf(layout, [{ offset: 0x400, name: "EC table" }], x, y + 30)).toBe("");
  });

  // The second map of a comparison marks its rows in the right margin, so its
  // callout opens to the left — into its own map.
  // @upstream ByteRipperTests/BookmarkMinimapTests.swift#BookmarkMinimapTests.testASecondMapsCalloutOpensToTheLeft
  test("opens to the left on the second map of a comparison", () => {
    const layout = layoutOf({ placement: "right" });
    const { x, y } = centreOfMark(layout, 0x800);
    const shown = minimapHover({
      layout,
      cuts: [],
      pieces: [],
      brackets: [],
      marks: [{ offset: 0x800, name: "NVRAM", y: yOf(0x800) }],
      zoneColors: ZONES,
      x,
      y,
    });
    expect(shown?.text).toBe("00000800: NVRAM");
    const anchor = shown?.anchor ?? { x: 0, y: 0, width: 0, height: 0 };
    expect(opensRight(anchor, { x: 0, y: 0, width: 60, height: 400 })).toBe(false);
  });
});
