import { describe, expect, it } from "vitest";
import {
  HEADER_COVERED_SHARE,
  MINIMUM_PANEL_HEIGHT,
  PARENT_PEEK,
  panelHeight,
} from "@/ui/fragments/fragmentPanelLayout";

/**
 * The geometry that leaves the parent showing.
 *
 * @upstream ByteRipperTests/FragmentPanelTests.swift#FragmentPanelTests
 */
describe("a fragment panel's geometry", () => {
  /**
   * The panel's top edge covers a fifth of the parent's header: enough of an
   * overlap to say the panel is over it, little enough that the header is
   * still readable.
   *
   * @upstream ByteRipperTests/FragmentPanelTests.swift#FragmentPanelTests.testThePanelCoversAFifthOfTheParentsHeader
   */
  it("covers a fifth of the parent's header", () => {
    expect(panelHeight(600)).toBe(600 - PARENT_PEEK);
    expect(HEADER_COVERED_SHARE).toBe(0.2);
    expect(PARENT_PEEK).toBeCloseTo(28 * 0.8, 3);
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
