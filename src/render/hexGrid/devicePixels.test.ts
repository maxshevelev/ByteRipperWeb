import { describe, expect, it } from "vitest";
import { bandOnDeviceGrid, snapToDevicePixels } from "@/render/hexGrid/devicePixels";

describe("snapping a scroll offset to device pixels", () => {
  it("lands on a whole device pixel at any density", () => {
    for (const ratio of [1, 1.25, 1.5, 2, 3]) {
      for (const top of [0, 10.3, 20.6, 1_234_567.49, 16_777_216.77]) {
        const devicePixels = snapToDevicePixels(top, ratio) * ratio;
        expect(Math.abs(devicePixels - Math.round(devicePixels))).toBeLessThan(1e-6);
      }
    }
  });

  // What the blit relies on: the difference between two snapped offsets is a
  // whole number of device pixels, so the copy moves the rows exactly as far as
  // the paint places the new ones.
  it("makes the distance between two frames a whole number of device pixels", () => {
    const ratio = 1.5;
    const before = snapToDevicePixels(10.3, ratio);
    const after = snapToDevicePixels(20.6, ratio);
    const shift = (after - before) * ratio;
    expect(Math.abs(shift - Math.round(shift))).toBeLessThan(1e-6);
  });

  it("moves an offset by less than one device pixel", () => {
    expect(Math.abs(snapToDevicePixels(10.3, 2) - 10.3)).toBeLessThanOrEqual(0.25);
    expect(snapToDevicePixels(7, 1)).toBe(7);
  });
});

describe("a row's band on the device grid", () => {
  /** The two ratios a 2× screen reports at the zoom levels that showed the seams. */
  const FRACTIONAL = [1.6, 1.8, 2.2];

  it("puts both of the band's edges on a whole device pixel", () => {
    for (const ratio of [1, 1.25, ...FRACTIONAL, 3]) {
      for (const row of [0, 1, 7, 1_048_576]) {
        const band = bandOnDeviceGrid(row * 16, (row + 1) * 16, ratio);
        expect(Math.abs(band.top * ratio - Math.round(band.top * ratio))).toBeLessThan(1e-6);
        const bottom = (band.top + band.height) * ratio;
        expect(Math.abs(bottom - Math.round(bottom))).toBeLessThan(1e-6);
      }
    }
  });

  // What the grid relies on: a row's bottom is the next row's top, because the
  // caller hands this band the top of the row below it. Two bands then meet on
  // the same pixel rather than each covering half of it, which is what left a
  // line between the rows at a fractional zoom.
  it("ends a row exactly where the row below it begins", () => {
    for (const ratio of FRACTIONAL) {
      for (let row = 0; row < 64; row++) {
        const band = bandOnDeviceGrid(row * 16, (row + 1) * 16, ratio);
        const below = bandOnDeviceGrid((row + 1) * 16, (row + 2) * 16, ratio);
        expect(band.top + band.height).toBe(below.top);
      }
    }
  });

  it("leaves no device pixel uncovered and none covered twice", () => {
    for (const ratio of FRACTIONAL) {
      const first = bandOnDeviceGrid(0, 16, ratio);
      const last = bandOnDeviceGrid(63 * 16, 64 * 16, ratio);
      let covered = 0;
      for (let row = 0; row < 64; row++) {
        const band = bandOnDeviceGrid(row * 16, (row + 1) * 16, ratio);
        expect(band.height).toBeGreaterThan(0);
        covered += band.height;
      }
      expect(covered).toBeCloseTo(last.top + last.height - first.top, 10);
    }
  });

  it("is the row itself at a whole density", () => {
    for (const ratio of [1, 2, 3]) {
      expect(bandOnDeviceGrid(0, 16, ratio)).toEqual({ top: 0, height: 16 });
      expect(bandOnDeviceGrid(48, 64, ratio)).toEqual({ top: 48, height: 16 });
    }
  });

  it("moves an edge by less than one device pixel", () => {
    for (const ratio of FRACTIONAL) {
      for (let row = 0; row < 64; row++) {
        const band = bandOnDeviceGrid(row * 16, (row + 1) * 16, ratio);
        expect(Math.abs(band.top - row * 16)).toBeLessThanOrEqual(1 / ratio);
        expect(Math.abs(band.height - 16)).toBeLessThanOrEqual(1 / ratio);
      }
    }
  });
});
