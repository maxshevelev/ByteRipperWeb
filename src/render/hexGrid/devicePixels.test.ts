import { describe, expect, it } from "vitest";
import { snapToDevicePixels } from "@/render/hexGrid/devicePixels";

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
