import { describe, expect, it, test } from "vitest";
import {
  type MinimapColors,
  MinimapRenderer,
  matchBarFor,
  type OverviewPicture,
  overviewModifiedTone,
  overviewTone,
  withAlpha,
} from "@/render/minimap/minimapRenderer";

// The colour arithmetic the tone scale rests on, and — over a canvas that records its fills —
// what the overview draws over what. The pixels are checked in the browser, and the paint page
// measures them.

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

describe("the overview's marks", () => {
  /** A canvas whose 2D context writes down every fill, in order. */
  function recorded() {
    const fills: { readonly style: string; readonly x: number; readonly y: number }[] = [];
    const context = {
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
      setTransform: () => undefined,
      fillRect(x: number, y: number) {
        fills.push({ style: String(this.fillStyle), x, y });
      },
      strokeRect: () => undefined,
    };
    const canvas = { width: 0, height: 0, getContext: () => context };
    const colors = new Proxy({} as MinimapColors, {
      get: (_, key) =>
        key === "modified" ? "rgb(255, 0, 0)" : key === "byte" ? "rgb(0, 0, 0)" : `#${String(key)}`,
    });
    const renderer = new MinimapRenderer(canvas as unknown as HTMLCanvasElement, colors);
    renderer.resize(200, 64, 1);
    return { renderer, fills };
  }

  /** A picture of `rows` rows over a file that fills them all. */
  function picture(rows: number, change: Partial<OverviewPicture>): OverviewPicture {
    const density = new Uint8Array(rows * 16);
    // The upper half erased padding, the lower half dense content.
    density.fill(255, (rows / 2) * 16);
    return {
      extent: rows * 1024,
      fileSize: rows * 1024,
      rowCount: rows,
      density,
      modified: new Uint16Array(rows),
      different: new Uint16Array(rows),
      ...change,
    };
  }

  // A difference is drawn behind the overview's content, not instead of it: the longer file's
  // tail, differing whole, kept its padding and its code apart.
  // @upstream ByteRipperTests/MinimapTests.swift#MinimapTests.testOverviewDrawsContentOverTheDifference
  it("draws the content over a difference", () => {
    const { renderer, fills } = recorded();
    renderer.draw({
      mode: "overview",
      picture: picture(8, { different: new Uint16Array(8).fill(0xffff) }),
    });
    const difference = fills.findIndex((one) => one.style === "#difference");
    expect(difference).toBeGreaterThanOrEqual(0);
    // After the row's difference come its cells' tones, over it.
    const after = fills.slice(difference).find((one) => one.style !== "#difference");
    expect(after?.style).toBe(withAlpha("rgb(0, 0, 0)", overviewTone(0)));
    const dense = fills.filter((one) => one.style === withAlpha("rgb(0, 0, 0)", overviewTone(255)));
    expect(dense.length).toBe(4 * 16);
  });

  // A modified row is drawn in red ink, not filled red: its padding and its content still read
  // apart, the content the darker.
  // @upstream ByteRipperTests/MinimapTests.swift#MinimapTests.testModifiedRowsKeepTheirContentInTheOverview
  it("draws a modified row's content in the modified ink", () => {
    const { renderer, fills } = recorded();
    renderer.draw({
      mode: "overview",
      picture: picture(8, { modified: new Uint16Array(8).fill(1) }),
    });
    const sparse = withAlpha("rgb(255, 0, 0)", overviewModifiedTone(0));
    const dense = withAlpha("rgb(255, 0, 0)", overviewModifiedTone(255));
    expect(fills.filter((one) => one.style === sparse).length).toBe(4 * 16);
    expect(fills.filter((one) => one.style === dense).length).toBe(4 * 16);
    // Plainly red even where the row holds nothing but padding.
    expect(overviewModifiedTone(0)).toBeGreaterThan(overviewTone(255) - 0.2);
    expect(overviewModifiedTone(255)).toBe(1);
  });
});
