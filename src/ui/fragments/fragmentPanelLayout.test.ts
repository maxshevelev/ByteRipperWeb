import { describe, expect, it } from "vitest";
import {
  MINIMUM_PANEL_HEIGHT,
  PARENT_PEEK,
  panelHeight,
  restingFrame,
  SIDE_INSET,
} from "@/ui/fragments/fragmentPanelLayout";

/**
 * The geometry that leaves the parent showing.
 *
 * @upstream ByteRipperTests/FragmentPanelTests.swift#FragmentPanelTests
 */
describe("a fragment panel's geometry", () => {
  /**
   * The panel stands in from the panes on three sides — twice as far at the top as at either side
   * — and sits on the dock: a margin all round, with the panes dimmed through it, is what says it
   * lies over them.
   *
   * @upstream ByteRipperTests/FragmentPanelTests.swift#FragmentPanelTests.testThePanelStandsInFromThePanesBehind
   */
  it("stands in from the panes behind", () => {
    expect(PARENT_PEEK).toBe(SIDE_INSET * 2);
    expect(restingFrame(800, 600)).toEqual({
      x: SIDE_INSET,
      width: 800 - SIDE_INSET * 2,
      height: 600 - PARENT_PEEK,
    });
  });

  /**
   * In a window too narrow for the margins they give way rather than the panel shrinking to
   * nothing.
   *
   * @upstream ByteRipperTests/FragmentPanelTests.swift#FragmentPanelTests.testTheSideMarginsGiveWayInANarrowArea
   */
  it("gives up the side margins in a narrow area", () => {
    const frame = restingFrame(40, 600);
    expect(frame.width, "a quarter of the width at each side at most").toBe(20);
    expect(frame.x + frame.width / 2, "and still centred").toBe(20);
  });

  /**
   * In a short window the peek gives way before the panel does: the part is
   * what was asked for.
   *
   * @upstream ByteRipperTests/FragmentPanelTests.swift#FragmentPanelTests.testAShortAreaGivesUpThePeekBeforeTheMinimum
   */
  it("gives up the peek before the minimum in a short area", () => {
    const short = MINIMUM_PANEL_HEIGHT + PARENT_PEEK - 10;

    expect(panelHeight(short)).toBe(MINIMUM_PANEL_HEIGHT);
  });

  /**
   * And in an area smaller than the minimum the panel takes what there is
   * rather than hanging off the bottom.
   *
   * @upstream ByteRipperTests/FragmentPanelTests.swift#FragmentPanelTests.testThePanelNeverOutgrowsItsArea
   */
  it("never outgrows its area", () => {
    for (const height of [0, 40, 100, 159, 200, 600, 2000]) {
      expect(panelHeight(height)).toBeGreaterThanOrEqual(0);
      expect(panelHeight(height)).toBeLessThanOrEqual(height);
    }
  });
});
