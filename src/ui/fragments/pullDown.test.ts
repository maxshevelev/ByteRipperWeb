import { describe, expect, it } from "vitest";
import {
  COMMIT_FRACTION,
  directionOf,
  FLICK_DISTANCE,
  FLICK_SPEED,
  MOVEMENT_THRESHOLD,
  type Movement,
  outcome,
  position,
  UPWARD_LIMIT,
  UPWARD_RESISTANCE,
} from "@/ui/fragments/pullDown";

/**
 * A fragment panel pulled down by its header: let go, it either springs back or carries on into
 * its pill — and which of the two is a rule that can be read without a pointer.
 */

const HEIGHT = 500;

const look = (direction: Movement["direction"], flick = false): Movement => ({
  direction,
  distance: flick ? FLICK_DISTANCE : 3,
  speed: flick ? FLICK_SPEED : 120,
});

describe("letting go of a pulled panel", () => {
  // @upstream ByteRipperTests/FragmentPullDownTests.swift#FragmentPullDownTests.testALookNearTheTopAlwaysSpringsBack
  it("springs back from a look near the top, whatever the hand was doing", () => {
    const short = HEIGHT * COMMIT_FRACTION - 1;
    for (const direction of ["down", "up", "none"] as const) {
      expect(outcome(short, HEIGHT, look(direction))).toBe("springBack");
    }
  });

  // @upstream ByteRipperTests/FragmentPullDownTests.swift#FragmentPullDownTests.testAFlickDownFromTheTopStillCollapses
  it("still collapses on a flick down from the top, and not on one up", () => {
    const short = HEIGHT * COMMIT_FRACTION - 1;
    expect(outcome(short, HEIGHT, look("down", true))).toBe("collapse");
    expect(outcome(short, HEIGHT, look("up", true))).toBe("springBack");
  });

  // @upstream ByteRipperTests/FragmentPullDownTests.swift#FragmentPullDownTests.testAFastTrembleIsNotAFlick
  it("does not take a fast tremble for a flick", () => {
    const jitter: Movement = {
      direction: "down",
      distance: FLICK_DISTANCE - 1,
      speed: FLICK_SPEED * 4,
    };
    expect(outcome(10, HEIGHT, jitter)).toBe("springBack");
  });

  // @upstream ByteRipperTests/FragmentPullDownTests.swift#FragmentPullDownTests.testANudgeUpPastTheLineSpringsBack
  it("springs back from a nudge up past the commit line, from anywhere", () => {
    for (const travelled of [HEIGHT * COMMIT_FRACTION, HEIGHT * 0.7, HEIGHT * 0.98]) {
      expect(outcome(travelled, HEIGHT, look("up"))).toBe("springBack");
    }
  });

  // @upstream ByteRipperTests/FragmentPullDownTests.swift#FragmentPullDownTests.testANudgeDownPastTheLineCollapses
  it("carries on down past the commit line, even when simply let go", () => {
    expect(outcome(HEIGHT * 0.6, HEIGHT, look("down"))).toBe("collapse");
    expect(outcome(HEIGHT * 0.6, HEIGHT, look("none"))).toBe("collapse");
  });

  // @upstream ByteRipperTests/FragmentPullDownTests.swift#FragmentPullDownTests.testATrembleIsNotAMovement
  it("does not take a tremble for a movement", () => {
    expect(directionOf(MOVEMENT_THRESHOLD - 0.5)).toBeUndefined();
    expect(directionOf(-MOVEMENT_THRESHOLD + 0.5)).toBeUndefined();
    expect(directionOf(MOVEMENT_THRESHOLD)).toBe("down");
    expect(directionOf(-MOVEMENT_THRESHOLD)).toBe("up");
  });
});

describe("where a pulled panel sits", () => {
  // @upstream ByteRipperTests/FragmentPullDownTests.swift#FragmentPullDownTests.testItFollowsTheHandDownward
  it("follows the hand downward", () => {
    expect(position(120)).toBe(120);
    expect(position(10)).toBe(10);
  });

  // @upstream ByteRipperTests/FragmentPullDownTests.swift#FragmentPullDownTests.testItResistsUpward
  it("resists upward, and never rises past its limit", () => {
    expect(position(-40)).toBeCloseTo(-40 * UPWARD_RESISTANCE);
    expect(position(-40)).toBeGreaterThan(-40);
    expect(position(-10_000)).toBe(-UPWARD_LIMIT);
  });
});
