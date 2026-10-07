/**
 * What hovering the map says. Upstream's cases drive a window; these check the
 * same claims against one map's layout and the heights its marks are painted at.
 */

import { describe, expect, test } from "vitest";
import { bookmarkMarkBox } from "@/render/minimap/minimapClick";
import { yOfOffset } from "@/render/minimap/minimapGeometry";
import { MinimapLayout } from "@/render/minimap/minimapLayout";
import {
  minimapTooltip,
  type NamedBracket,
  type StripPiece,
  segmentStripTooltipText,
  zoneBracketTooltipText,
} from "@/render/minimap/minimapTooltip";

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
  minimapTooltip({
    layout,
    cuts: [],
    pieces: [],
    brackets: [],
    marks: marks.map((mark) => ({ ...mark, y: yOf(mark.offset) })),
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
    const text = zoneBracketTooltipText(layout, brackets, gutter.x, yOf(0x200));
    expect(text).toContain("BIOS region");
    expect(text).toContain("0x100");
    // Its last byte, not the bound.
    expect(text).toContain("0x2FF");
    expect(text).toContain("512");
    // And nothing off every bracket.
    expect(zoneBracketTooltipText(layout, brackets, gutter.x, yOf(0x380))).toBe("");
  });

  // An unnamed zone is named by its range alone — a stretch worth drawing is
  // worth naming even before it has a name.
  // @upstream ByteRipperTests/MinimapZoneTests.swift#MinimapZoneTests.testAnUnnamedZoneIsNamedByItsRange
  test("names an unnamed zone by its range", () => {
    const text = zoneBracketTooltipText(layout, [bracket("", 0x100, 0x180)], gutter.x, yOf(0x140));
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
    }));
  const cuts = [64, 128].map((offset) => ({ offset, y: yOf(offset) }));
  const x = strip.x + strip.width / 2;

  // Hovering a piece names it: its label, its range, its size, and its name — the
  // legend the strip is.
  // @upstream ByteRipperTests/MinimapTests.swift#MinimapTests.testTheStripHoverNamesAPiece
  test("names a piece, and its name as it is now", () => {
    const text = segmentStripTooltipText({ strip, cuts, pieces: piecesOf([]), x, y: yOf(96) });
    expect(text).toContain("S1");
    expect(text).toContain("0x40");
    // First to last byte: S1 = [64, 128) → 0x40…0x7F.
    expect(text).toContain("0x7F");
    expect(text).toContain("64");
    // A renamed piece is drawn with its new name, and the hover reads it.
    const named = segmentStripTooltipText({
      strip,
      cuts,
      pieces: piecesOf(["", "testpiece"]),
      x,
      y: yOf(96),
    });
    expect(named).toContain("testpiece");
  });

  // Hovering a boundary — within the snap distance of a cut — names the cut's
  // offset, not a piece: the pointer is on the line between two colours, and the
  // line is the more precise fact.
  // @upstream ByteRipperTests/MinimapTests.swift#MinimapTests.testTheStripHoverNamesABoundaryNearACut
  test("names a boundary near a cut", () => {
    const text = segmentStripTooltipText({ strip, cuts, pieces: piecesOf([]), x, y: yOf(64) });
    expect(text).toBe("0x40");
    expect(text).not.toContain("S1");
  });
});
