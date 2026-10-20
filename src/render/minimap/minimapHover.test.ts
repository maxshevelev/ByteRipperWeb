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
} from "@/render/minimap/minimapHover";
import { MinimapLayout } from "@/render/minimap/minimapLayout";

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
    zoneColors: { focused: "blue", other: "grey" },
    x,
    y,
  });

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

  // Anywhere that is not a mark says nothing, which shows no tooltip at all.
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

  // The tooltip answers from the pointer's position, so the mark on the second map
  // of a comparison — in its own margin, on the other side — is found too.
  // @upstream ByteRipperTests/BookmarkMinimapTests.swift#BookmarkMinimapTests.testHoveringAMarkOnTheSecondMapNamesItToo
  test("names a mark on the second map of a comparison", () => {
    const layout = layoutOf({ placement: "right" });
    const { x, y } = centreOfMark(layout, 0x800);
    expect(hoverOf(layout, [{ offset: 0x800, name: "NVRAM" }], x, y)).toBe("00000800: NVRAM");
  });
});

describe("the callout's glyph and place", () => {
  // The name is up at once, wearing the mark it names, and stands beside the mark's box.
  // @upstream ByteRipperTests/BookmarkMinimapTests.swift#BookmarkMinimapTests.testTheCalloutNamesAMarkAtOnceAndGoesWhenThePointerLeaves
  test("a mark's callout wears the bookmark and stands beside its box", () => {
    const layout = layoutOf({});
    const { x, y } = centreOfMark(layout, 0x400);
    const hover = minimapHover({
      layout,
      cuts: [],
      pieces: [],
      brackets: [],
      marks: [{ offset: 0x400, name: "EC table", y: yOf(0x400) }],
      zoneColors: { focused: "blue", other: "grey" },
      x,
      y,
    });
    expect(hover?.text).toBe("00000400: EC table");
    expect(hover?.mark).toEqual({ kind: "bookmark" });
    const box = bookmarkMarkBox(layout, yOf(0x400));
    expect(hover?.box).toEqual({ x: box?.x, y: box?.top, width: box?.width, height: box?.height });
  });

  // A bracket's callout wears the bracket, in the colour the gutter draws it in; a legend's
  // stands at the pointer, not at a box — a strip or a bracket is long, so its callout follows
  // the pointer along it.
  // @upstream ByteRipperTests/BookmarkMinimapTests.swift#BookmarkMinimapTests.testALegendsCalloutFollowsThePointer
  test("a bracket's callout wears its colour and follows the pointer", () => {
    const layout = layoutOf({ lanes: 1 });
    const gutter = layout.zoneGutterRect;
    if (gutter === undefined) throw new Error("premise: the map has a gutter");
    const hover = minimapHover({
      layout,
      cuts: [],
      pieces: [],
      brackets: [
        {
          id: "z",
          name: "BIOS",
          start: 0x100,
          end: 0x300,
          top: yOf(0x100),
          height: yOf(0x300) - yOf(0x100),
          depth: 0,
          focused: true,
        },
      ],
      marks: [],
      zoneColors: { focused: "blue", other: "grey" },
      x: gutter.x,
      y: yOf(0x200),
    });
    expect(hover?.mark).toEqual({ kind: "zone", color: "blue" });
    expect(hover?.box).toBeUndefined();
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
      tint: `tint-${index}`,
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
    expect(
      segmentStripMark({ strip, cuts, pieces: piecesOf([]), x, y: yOf(96) }),
      "and wears S1's tint"
    ).toEqual({ kind: "segment", color: "tint-1" });
  });

  // Hovering a boundary — within the snap distance of a cut — names the cut's
  // offset, not a piece: the pointer is on the line between two colours, and the
  // line is the more precise fact.
  // @upstream ByteRipperTests/MinimapTests.swift#MinimapTests.testTheStripHoverNamesABoundaryNearACut
  test("names a boundary near a cut", () => {
    const text = segmentStripHoverText({ strip, cuts, pieces: piecesOf([]), x, y: yOf(64) });
    expect(text).toBe("0x40");
    expect(text).not.toContain("S1");
    expect(
      segmentStripMark({ strip, cuts, pieces: piecesOf([]), x, y: yOf(64) }),
      "the two pieces the cut separates, the one before it on top"
    ).toEqual({ kind: "cut", above: "tint-0", below: "tint-1" });
  });
});
