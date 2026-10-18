import { describe, expect, it } from "vitest";
import {
  aroundPointer,
  CALLOUT_GAP,
  type CalloutRect,
  capsuleFrame,
  opensRight,
} from "@/ui/callout/hoverCalloutGeometry";

/**
 * Where the capsule goes (§19.4.3, §20.3). Upstream's window has its y running
 * up; here it runs down, and the rules are symmetric in y, so the cases are
 * upstream's with the top and bottom edges named for the browser's axis.
 */
const size = { width: 80, height: 20 };
const bounds: CalloutRect = { x: 0, y: 0, width: 400, height: 300 };
const rect = (x: number, y: number, width = 10, height = 10): CalloutRect => ({
  x,
  y,
  width,
  height,
});

describe("the hover callout's placement", () => {
  // @upstream ByteRipperTests/HoverCalloutTests.swift#HoverCalloutTests.testItOpensOnTheSideItIsAskedTo
  it("opens on the side it is asked to, level with what it names", () => {
    const anchor = rect(100, 100);
    const right = capsuleFrame(size, anchor, true, bounds);
    expect(right.x).toBe(anchor.x + anchor.width + CALLOUT_GAP);
    expect(right.y + right.height / 2).toBe(anchor.y + anchor.height / 2);

    const left = capsuleFrame(size, anchor, false, bounds);
    expect(left.x + left.width).toBe(anchor.x - CALLOUT_GAP);
  });

  // @upstream ByteRipperTests/HoverCalloutTests.swift#HoverCalloutTests.testItTurnsToTheOtherSideWhenOneHasNoRoom
  it("turns to the other side when one has no room, rather than being cut off", () => {
    const nearTheRight = rect(360, 100);
    const frame = capsuleFrame(size, nearTheRight, true, bounds);
    expect(frame.x + frame.width).toBe(nearTheRight.x - CALLOUT_GAP);

    const nearTheLeft = rect(20, 100);
    const other = capsuleFrame(size, nearTheLeft, false, bounds);
    expect(other.x).toBe(nearTheLeft.x + nearTheLeft.width + CALLOUT_GAP);
  });

  // @upstream ByteRipperTests/HoverCalloutTests.swift#HoverCalloutTests.testItStaysInsideTheWindow
  it("is moved in next to the top or the bottom edge, never cut off", () => {
    const atTheBottom = rect(100, 295);
    const low = capsuleFrame(size, atTheBottom, true, bounds);
    expect(low.y + low.height).toBe(bounds.height);
    const atTheTop = rect(100, -5);
    expect(capsuleFrame(size, atTheTop, true, bounds).y).toBe(0);
  });

  // @web-only the side is decided by the view's middle, which upstream computes inline in show
  it("opens toward the middle of the view it describes", () => {
    const view = rect(0, 0, 200, 300);
    expect(opensRight(rect(10, 50), view)).toBe(true);
    expect(opensRight(rect(180, 50), view)).toBe(false);
  });

  // @web-only the square round the pointer, which upstream builds inline at each call site
  it("keeps a callout that follows the pointer clear of the cursor", () => {
    const frame = capsuleFrame(size, aroundPointer(100, 100), true, bounds);
    const covers = frame.x <= 100 && frame.x + frame.width >= 100;
    expect(covers).toBe(false);
  });
});
