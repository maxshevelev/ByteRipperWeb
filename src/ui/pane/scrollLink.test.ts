import { describe, expect, it } from "vitest";
import {
  type LinkedScroller,
  mirroredScroll,
  ScrollLink,
  type ScrollPosition,
} from "@/ui/pane/scrollLink";

function fakePane(maxTop: number, rowHeight = 17) {
  const state = { position: { top: 0, left: 0 } as ScrollPosition, moves: 0 };
  const scroller: LinkedScroller = {
    rowHeight: () => rowHeight,
    position: () => state.position,
    extent: () => ({ maxTop, maxLeft: 0, viewportHeight: 340 }),
    moveTo: (position) => {
      state.position = position;
      state.moves += 1;
    },
  };
  return { state, scroller };
}

describe("the link between two panes", () => {
  it("mirrors in content pixels, past any height a browser lays out", () => {
    const link = new ScrollLink();
    const a = fakePane(40_000_000);
    const b = fakePane(40_000_000);
    link.register("a", a.scroller);
    link.register("b", b.scroller);

    a.state.position = { top: 36_000_000, left: 0 };
    link.report("a");
    expect(b.state.position).toEqual({ top: 36_000_000, left: 0 });
  });

  it("leaves alone a pane that is already there", () => {
    const link = new ScrollLink();
    const a = fakePane(10_000);
    const b = fakePane(10_000);
    link.register("a", a.scroller);
    link.register("b", b.scroller);

    link.report("a");
    expect(b.state.moves).toBe(0);
  });

  it("takes a pane to an offset and brings the other along", () => {
    const link = new ScrollLink();
    const a = fakePane(40_000_000);
    const b = fakePane(40_000_000);
    link.register("a", a.scroller);
    link.register("b", b.scroller);

    link.scrollToOffset("a", 1000 * 16, 16);
    expect(a.state.position.top).toBe(17_000);
    expect(b.state.position.top).toBe(17_000);
  });

  it("says what a pane shows from where it is in the content", () => {
    const link = new ScrollLink();
    const a = fakePane(40_000_000);
    link.register("a", a.scroller);

    a.state.position = { top: 17_000, left: 0 };
    expect(link.visibleRange("a", 16)).toEqual({ start: 16_000, end: 16_320 });
  });
});

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
