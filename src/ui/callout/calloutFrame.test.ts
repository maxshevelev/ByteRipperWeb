import { describe, expect, it } from "vitest";
import { CALLOUT_GAP, calloutFrame } from "@/ui/callout/calloutFrame";

/**
 * Where the hover callout's capsule goes.
 *
 * @upstream ByteRipperTests/HoverCalloutTests.swift#HoverCalloutTests
 */
describe("the hover callout's place", () => {
  const size = { width: 80, height: 20 };
  const bounds = { x: 0, y: 0, width: 400, height: 300 };

  // @upstream ByteRipperTests/HoverCalloutTests.swift#HoverCalloutTests.testItOpensOnTheSideItIsAskedTo
  it("opens on the side it is asked to", () => {
    const anchor = { x: 100, y: 100, width: 10, height: 10 };
    const right = calloutFrame(size, anchor, true, bounds);
    expect(right.x).toBe(anchor.x + anchor.width + CALLOUT_GAP);
    expect(right.y + right.height / 2, "level with what it names").toBe(
      anchor.y + anchor.height / 2
    );
    const left = calloutFrame(size, anchor, false, bounds);
    expect(left.x + left.width).toBe(anchor.x - CALLOUT_GAP);
  });

  // A side without room is given up for the other one rather than cut off.
  // @upstream ByteRipperTests/HoverCalloutTests.swift#HoverCalloutTests.testItTurnsToTheOtherSideWhenOneHasNoRoom
  it("turns to the other side when one has no room", () => {
    const nearTheRight = { x: 360, y: 100, width: 10, height: 10 };
    const frame = calloutFrame(size, nearTheRight, true, bounds);
    expect(frame.x + frame.width).toBe(nearTheRight.x - CALLOUT_GAP);
    const nearTheLeft = { x: 20, y: 100, width: 10, height: 10 };
    expect(calloutFrame(size, nearTheLeft, false, bounds).x).toBe(
      nearTheLeft.x + nearTheLeft.width + CALLOUT_GAP
    );
  });

  // Next to the top or bottom edge it is moved in, never cut off.
  // @upstream ByteRipperTests/HoverCalloutTests.swift#HoverCalloutTests.testItStaysInsideTheWindow
  it("stays inside the window", () => {
    const atTheBottom = { x: 100, y: 295, width: 10, height: 10 };
    const low = calloutFrame(size, atTheBottom, true, bounds);
    expect(low.y + low.height).toBe(bounds.height);
    const atTheTop = { x: 100, y: -5, width: 10, height: 10 };
    expect(calloutFrame(size, atTheTop, true, bounds).y).toBe(0);
  });
});
