import { describe, expect, it } from "vitest";
import { mirroredScroll } from "@/ui/pane/scrollLink";

const metrics = (rowHeight: number, maxTop: number, maxLeft = 0) => ({
  rowHeight,
  maxTop,
  maxLeft,
});

describe("mirroring a scroll to the other pane", () => {
  it("copies the position, because the panes show the same offsets", () => {
    expect(mirroredScroll({ top: 340, left: 0 }, { rowHeight: 17 }, metrics(17, 10_000))).toEqual({
      top: 340,
      left: 0,
    });
  });

  it("clamps to the other pane's extent, so a shorter file shows its end", () => {
    // Without this, scrolling the longer file drags the shorter one into blank
    // space below its own last row.
    expect(mirroredScroll({ top: 9000, left: 0 }, { rowHeight: 17 }, metrics(17, 500))).toEqual({
      top: 500,
      left: 0,
    });
  });

  it("mirrors sideways too, clamped the same way", () => {
    expect(
      mirroredScroll({ top: 0, left: 300 }, { rowHeight: 17 }, metrics(17, 1000, 120))
    ).toEqual({ top: 0, left: 120 });
  });

  it("does not move the other pane while the two are measured differently", () => {
    // A font change re-lays out the panes one at a time. Crossing that gap
    // hands the other pane a position pointing at different bytes, it corrects
    // and syncs back, and both walk away from where the user was.
    expect(
      mirroredScroll({ top: 340, left: 0 }, { rowHeight: 17 }, metrics(21, 10_000))
    ).toBeUndefined();
  });

  it("does nothing for a pane that has not been laid out yet", () => {
    expect(mirroredScroll({ top: 0, left: 0 }, { rowHeight: 0 }, metrics(0, 0))).toBeUndefined();
  });

  it("never scrolls above the top", () => {
    // Elastic overscroll on a trackpad reports a negative offset; the other
    // pane must not be asked for one.
    expect(
      mirroredScroll({ top: -30, left: -10 }, { rowHeight: 17 }, metrics(17, 900, 50))
    ).toEqual({ top: 0, left: 0 });
  });
});
