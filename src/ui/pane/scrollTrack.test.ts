import { describe, expect, it } from "vitest";
import { contentToTrack, trackHeightFor, trackToContent, wheelPixels } from "@/ui/pane/scrollTrack";

describe("the scroll track", () => {
  it("is the content's own height while that fits", () => {
    expect(trackHeightFor(17_825_809, 30_000_000)).toBe(17_825_809);
  });

  it("stops at the limit for content taller than a browser lays out", () => {
    expect(trackHeightFor(35_651_618, 30_000_000)).toBe(30_000_000);
  });

  it("maps one-to-one and exactly when nothing is scaled", () => {
    const metrics = { contentHeight: 1_000_000, trackHeight: 1_000_000, viewportHeight: 340 };
    expect(contentToTrack(123_456.25, metrics)).toBe(123_456.25);
    expect(trackToContent(123_456.25, metrics)).toBe(123_456.25);
  });

  it("maps the top to the top and the last screen to the last screen", () => {
    const metrics = { contentHeight: 35_651_618, trackHeight: 30_000_000, viewportHeight: 340 };
    expect(contentToTrack(0, metrics)).toBe(0);
    expect(contentToTrack(35_651_618 - 340, metrics)).toBeCloseTo(30_000_000 - 340, 6);
    expect(trackToContent(30_000_000 - 340, metrics)).toBeCloseTo(35_651_618 - 340, 6);
  });

  it("comes back to the same content position", () => {
    const metrics = { contentHeight: 71_303_218, trackHeight: 16_000_000, viewportHeight: 800 };
    const top = 51_234_567;
    expect(trackToContent(contentToTrack(top, metrics), metrics)).toBeCloseTo(top, 4);
  });
});

describe("a wheel delta", () => {
  it("is pixels as it comes", () => {
    expect(wheelPixels(42, 0, 17, 340)).toBe(42);
  });

  it("is rows when the wheel counts lines", () => {
    expect(wheelPixels(3, 1, 17, 340)).toBe(51);
  });

  it("is screens when it counts pages", () => {
    expect(wheelPixels(-1, 2, 17, 340)).toBe(-340);
  });
});
