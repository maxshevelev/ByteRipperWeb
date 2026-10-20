import { afterEach, describe, expect, it } from "vitest";
import { hideCallout, hoverCalloutStore, showCallout } from "@/state/hoverCalloutStore";

/**
 * Which way the hover callout opens, and whose events take it down.
 *
 * @upstream ByteRipperTests/HoverCalloutTests.swift#HoverCalloutTests
 */
describe("the hover callout", () => {
  afterEach(() => hideCallout());
  const view = { x: 1000, y: 0, width: 200, height: 600 };

  // A mark in a map's right margin — the second map of a comparison — opens its callout to the
  // left, into its own map, and one in a left margin to the right.
  // @upstream ByteRipperTests/BookmarkMinimapTests.swift#BookmarkMinimapTests.testASecondMapsCalloutOpensToTheLeft
  it("opens toward the middle of its view", () => {
    showCallout(
      "map",
      "00000800: NVRAM",
      { kind: "bookmark" },
      { x: 1190, y: 50, width: 8, height: 8 },
      view
    );
    expect(hoverCalloutStore.getSnapshot()?.opensRight).toBe(false);
    showCallout(
      "map",
      "00000400",
      { kind: "bookmark" },
      { x: 1002, y: 50, width: 8, height: 8 },
      view
    );
    expect(hoverCalloutStore.getSnapshot()?.opensRight).toBe(true);
  });

  it("is taken down by its own view only, and by nothing to say", () => {
    showCallout("map", "A", undefined, { x: 1002, y: 50, width: 8, height: 8 }, view);
    hideCallout("hex:a");
    expect(hoverCalloutStore.getSnapshot()?.text).toBe("A");
    showCallout("map", "", undefined, { x: 1002, y: 50, width: 8, height: 8 }, view);
    expect(hoverCalloutStore.getSnapshot()).toBeUndefined();
  });
});
