import { describe, expect, it } from "vitest";
import {
  type LinkedScroller,
  mirroredScroll,
  remeasuredTop,
  ScrollLink,
  type ScrollPosition,
} from "@/ui/pane/scrollLink";

// Upstream's HexViewAppearanceTests: the row at the viewport's centre stays
// centred across a row-height or font-size change.
describe("a change of measure", () => {
  const centreRow = (top: number, rowHeight: number, viewport: number) =>
    Math.floor((top + viewport / 2) / rowHeight);

  it("keeps the visible centre when rows grow taller", () => {
    const before = centreRow(1_000, 17, 600);
    const top = remeasuredTop({ top: 1_000, rowHeight: 17 }, 24, 600);
    expect(before).toBeGreaterThan(0);
    expect(centreRow(top, 24, 600)).toBe(before);
  });

  it("keeps the visible centre when rows grow shorter", () => {
    const before = centreRow(52_345, 22, 480);
    const top = remeasuredTop({ top: 52_345, rowHeight: 22 }, 15, 480);
    expect(centreRow(top, 15, 480)).toBe(before);
  });

  it("finds the middle in the viewport the position was taken in", () => {
    // A bigger font makes the column header taller, so the viewport is shorter
    // after the change than it was before it.
    const before = centreRow(48_008, 16, 664);
    const top = remeasuredTop({ top: 48_008, rowHeight: 16, viewportHeight: 664 }, 21, 650);
    expect(centreRow(top, 21, 650)).toBe(before);
    // Measured in the new viewport instead, the middle would be another row.
    expect(centreRow(48_008, 16, 650)).not.toBe(before);
  });

  it("leaves the pixels alone when the measure did not change", () => {
    expect(remeasuredTop({ top: 1_234.5, rowHeight: 17 }, 17, 600)).toBe(1_234.5);
  });

  it("never goes above the top", () => {
    // Row 10 in the middle at 30 pixels would sit above the top at 15.
    expect(remeasuredTop({ top: 0, rowHeight: 30 }, 15, 600)).toBe(0);
  });
});

function fakePane(maxTop: number, rowHeight = 17) {
  const state = { position: { top: 0, left: 0 } as ScrollPosition, moves: 0, maxTop, rowHeight };
  const scroller: LinkedScroller = {
    rowHeight: () => state.rowHeight,
    position: () => state.position,
    extent: () => ({ maxTop: state.maxTop, maxLeft: 0, viewportHeight: 340 }),
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

  it("brings a pane that joins to where the open one already is", () => {
    // Compare with…: the second file opens at the offsets the first is showing,
    // not at the top of the file.
    const link = new ScrollLink();
    const a = fakePane(40_000);
    const b = fakePane(40_000);
    link.register("a", a.scroller);
    a.state.position = { top: 17_000, left: 0 };
    link.report("a");

    link.register("b", b.scroller);
    expect(b.state.position.top).toBe(17_000);
    // The pane already open is the one followed, never dragged back.
    expect(a.state.position.top).toBe(17_000);
  });

  it("clamps a joining pane to its own extent", () => {
    const link = new ScrollLink();
    const a = fakePane(40_000);
    const b = fakePane(1_000);
    link.register("a", a.scroller);
    a.state.position = { top: 17_000, left: 0 };
    link.report("a");
    link.register("b", b.scroller);
    expect(b.state.position.top).toBe(1_000);
  });

  it("puts a pane whose file was replaced back where it was", () => {
    // Opening another file into the same pane remounts it; the viewport stays.
    const link = new ScrollLink();
    const first = fakePane(40_000);
    const stop = link.register("a", first.scroller);
    first.state.position = { top: 8_500, left: 0 };
    link.report("a");
    stop();

    const second = fakePane(40_000);
    link.register("a", second.scroller);
    expect(second.state.position.top).toBe(8_500);
  });

  it("starts a pane at the top once it has been closed on purpose", () => {
    const link = new ScrollLink();
    const first = fakePane(40_000);
    const stop = link.register("a", first.scroller);
    first.state.position = { top: 8_500, left: 0 };
    link.report("a");
    stop();
    link.forget("a");

    const second = fakePane(40_000);
    link.register("a", second.scroller);
    expect(second.state.moves).toBe(0);
  });

  it("follows the open pane rather than its own old place", () => {
    const link = new ScrollLink();
    const a = fakePane(40_000);
    const b = fakePane(40_000);
    link.register("a", a.scroller);
    const stopB = link.register("b", b.scroller);
    b.state.position = { top: 3_400, left: 0 };
    link.report("b");
    stopB();

    a.state.position = { top: 6_800, left: 0 };
    link.report("a");
    const again = fakePane(40_000);
    link.register("b", again.scroller);
    expect(again.state.position.top).toBe(6_800);
  });
});

describe("panes that never drift apart", () => {
  /** A long file scrolled far past the end of a short one. */
  function pastTheShortEnd() {
    const link = new ScrollLink();
    const long = fakePane(100_000);
    const short = fakePane(1_000);
    link.register("a", long.scroller);
    link.register("b", short.scroller);
    long.state.position = { top: 50_000, left: 0 };
    link.report("a");
    return { link, long, short };
  }

  it("differ only past the end of the shorter file", () => {
    const { long, short } = pastTheShortEnd();
    expect(long.state.position.top).toBe(50_000);
    expect(short.state.position.top).toBe(1_000);
  });

  it("do not drag the long pane back when the short one re-lays out", () => {
    // A resize or an edit clamps the short pane at its own end; that clamp is
    // not a scroll, and the long pane stays where the reader put it.
    const { link, long, short } = pastTheShortEnd();
    short.state.maxTop = 900;
    link.settle("b");
    expect(short.state.position.top).toBe(900);
    expect(long.state.position.top).toBe(50_000);
  });

  it("come level again once the short file reaches the position", () => {
    const { link, short } = pastTheShortEnd();
    short.state.maxTop = 80_000;
    link.settle("b");
    expect(short.state.position.top).toBe(50_000);
  });

  it("bring the long pane back when the short one is scrolled", () => {
    const { link, long, short } = pastTheShortEnd();
    short.state.position = { top: 500, left: 0 };
    link.report("b");
    expect(long.state.position.top).toBe(500);
  });

  it("keep the middle row in the middle through a font change, one pane at a time", () => {
    const link = new ScrollLink();
    const a = fakePane(100_000);
    const b = fakePane(100_000);
    link.register("a", a.scroller);
    link.register("b", b.scroller);
    // Row 110 sits at the middle of a 340-pixel view: (1700 + 170) / 17.
    a.state.position = { top: 1_700, left: 0 };
    link.report("a");

    a.state.rowHeight = 20;
    link.settle("a");
    // Row 110 centred at the new pitch: 110 × 20 + 10 − 170.
    expect(a.state.position.top).toBe(2_040);
    // The other pane has not re-laid out yet, and is not moved in pixels that
    // mean different bytes to it.
    expect(b.state.position.top).toBe(1_700);
    b.state.rowHeight = 20;
    link.settle("b");
    expect(b.state.position.top).toBe(2_040);
  });

  it("have nothing to settle to before anything has scrolled", () => {
    const link = new ScrollLink();
    const a = fakePane(100_000);
    link.register("a", a.scroller);
    expect(link.settle("a")).toBe(false);
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

// @upstream ByteRipperTests/ViewportAnchorTests.swift#ViewportAnchorTests.testAScrollStillMovesTheOtherPane
describe("mirroring a scroll to the other pane", () => {
  it("copies the position, because the panes show the same offsets", () => {
    expect(mirroredScroll({ top: 340, left: 0 }, { rowHeight: 17 }, metrics(17, 10_000))).toEqual({
      top: 340,
      left: 0,
    });
  });

  // @upstream ByteRipperTests/ScrollPreservationTests.swift#ScrollPreservationTests.testLoadingAShorterFileClampsTheScrollToItsEnd
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
