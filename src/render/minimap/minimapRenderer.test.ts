import { describe, expect, it, test } from "vitest";
import { matchBarFor, overviewTone, withAlpha } from "@/render/minimap/minimapRenderer";

// The renderer itself needs a canvas; what is testable without one is the
// colour arithmetic the tone scale rests on. The drawing is checked in the
// browser, and the paint page measures it.

test("a resolved rgb colour takes an alpha", () => {
  expect(withAlpha("rgb(20, 30, 40)", 0.5)).toBe("rgba(20, 30, 40, 0.5)");
  expect(withAlpha("rgb(20 30 40)", 0.25)).toBe("rgba(20, 30, 40, 0.25)");
  expect(withAlpha("rgba(20, 30, 40, 0.8)", 0.1)).toBe("rgba(20, 30, 40, 0.1)");
});

test("a hex colour takes an alpha", () => {
  expect(withAlpha("#102030", 0.5)).toBe("rgba(16, 32, 48, 0.5)");
  expect(withAlpha("#123", 1)).toBe("rgba(17, 34, 51, 1)");
});

test("a colour that cannot be read is drawn at full strength, not dropped", () => {
  expect(withAlpha("color(display-p3 0.1 0.2 0.3)", 0.5)).toBe("color(display-p3 0.1 0.2 0.3)");
  expect(withAlpha("", 0.5)).toBe("");
});

describe("the tone an overview cell is drawn at", () => {
  // Ported from `MinimapView.overviewTone`. The shape of the ramp matters less
  // than its floor: a cell holding nothing but 0x00/0xFF fill is still part of
  // the file and is drawn, faintly. Skipping it made an erased chip look like
  // an absent one.
  it("gives an empty cell the floor, not nothing", () => {
    expect(overviewTone(0)).toBeCloseTo(0.1, 5);
  });

  it("rises to the ceiling for a cell that is all content", () => {
    expect(overviewTone(255)).toBeCloseTo(0.55, 5);
  });

  it("never leaves the band the dump's own ink occupies", () => {
    for (let density = 0; density <= 255; density++) {
      expect(overviewTone(density)).toBeGreaterThanOrEqual(0.1);
      expect(overviewTone(density)).toBeLessThanOrEqual(0.55);
    }
  });

  it("lifts the low end so a sparse cell separates from an empty one", () => {
    // The gamma is what does this: without it a cell one per cent inked would
    // sit one per cent above the floor and be indistinguishable from it.
    const sparse = overviewTone(3);
    expect(sparse).toBeGreaterThan(overviewTone(0) + 0.01);
  });
});

// @upstream ByteRipperTests/MinimapTests.swift#MinimapTests.testOverviewMatchMarksFollowTheSetAndThenThePlate
describe("a match's mark on the overview", () => {
  // Ported from `MinimapView.overviewMatchBars`. A row there is kilobytes, so
  // precision is not the point — being *visible* is. A match whose bytes fall
  // in one cell would otherwise be a mark a few pixels wide on a map a hundred
  // and fifty wide.
  const cellWidth = 5;

  it("spans the cells its bytes fall in", () => {
    // Columns 2 through 5 set.
    expect(matchBarFor(0b0000_0000_0011_1100, cellWidth, 80)).toEqual({ x: 10, width: 20 });
  });

  it("widens a mark too narrow to see", () => {
    const bar = matchBarFor(0b0000_0000_0000_0001, cellWidth, 80);
    expect(bar?.width).toBe(7);
    expect(bar?.x).toBe(0);
  });

  it("keeps a widened mark inside the map", () => {
    // The last column, on a map barely wider than the mark itself.
    const bar = matchBarFor(0b1000_0000_0000_0000, cellWidth, 80);
    if (bar === undefined) throw new Error("the last column should mark");
    expect(bar.x + bar.width).toBeLessThanOrEqual(80);
  });

  it("marks nothing for an empty mask", () => {
    expect(matchBarFor(0, cellWidth, 80)).toBeUndefined();
  });
});
