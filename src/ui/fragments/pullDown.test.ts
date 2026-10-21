import { describe, expect, it } from "vitest";
import {
  COMMIT_FRACTION,
  directionOf,
  FLICK_DISTANCE,
  FLICK_SPEED,
  FLICK_WINDOW_MS,
  isFlick,
  MOVEMENT_THRESHOLD,
  type Movement,
  outcome,
  position,
  recentTravel,
  type Sample,
  throwTiming,
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

/**
 * How fast the hand was going: over the last tenth of a second, not the last movement.
 *
 * @upstream ByteRipperTests/FragmentPullDownTests.swift#FragmentPullDownTests
 */
describe("how fast the hand was going", () => {
  /** Upstream's samples are a window's, up being positive and in seconds: turned to the page's. */
  const samples = (points: readonly (readonly [number, number])[]): Sample[] =>
    points.map(([y, t]) => ({ y: -y, time: t * 1000 }));

  // A fling that slows in its last frames is still a fling. Recorded in the app: 270 points in
  // 150 ms, the last movement 4 points at 170 a second.
  // @upstream ByteRipperTests/FragmentPullDownTests.swift#FragmentPullDownTests.testAFlingThatSlowsAtTheEndIsStillAFlick
  it("calls a fling that slows at the end a flick", () => {
    const fling = samples([
      [869.3, 0.0],
      [837.1, 0.0112],
      [792.7, 0.0338],
      [740.6, 0.0449],
      [687.7, 0.0675],
      [637.1, 0.0788],
      [605.6, 0.1013],
      [602.0, 0.1125],
      [598.3, 0.135],
      [597.3, 0.1462],
      [597.3, 0.1574],
    ]);
    const recent = recentTravel(fling, "down");
    const movement = { direction: "down" as const, ...recent };
    expect(isFlick(movement), JSON.stringify(recent)).toBe(true);
    expect(outcome(287, 867, movement)).toBe("collapse");
  });

  // A fling followed by a pause is not one: the panel has stopped, so there is nothing to carry on.
  // @upstream ByteRipperTests/FragmentPullDownTests.swift#FragmentPullDownTests.testAFlingThenAPauseIsNotAFlick
  it("does not call a fling then a pause a flick", () => {
    const window = FLICK_WINDOW_MS / 1000;
    const paused = samples([
      [800, 0],
      [600, 0.08],
      [600, 0.08 + window + 0.05],
    ]);
    expect(recentTravel(paused, "down").distance).toBe(0);
  });

  // Only travel in the direction asked about counts.
  // @upstream ByteRipperTests/FragmentPullDownTests.swift#FragmentPullDownTests.testTravelTheOtherWayDoesNotCount
  it("counts only travel the way asked about", () => {
    const back = samples([
      [600, 0],
      [540, 0.03],
      [620, 0.06],
    ]);
    expect(recentTravel(back, "down").distance).toBe(0);
    expect(recentTravel(back, "up").distance).toBeCloseTo(20, 3);
    expect(recentTravel(back, "none").distance).toBe(0);
  });

  // The fold that carries a throw on starts at speed, and does not overshoot its end.
  // @upstream ByteRipperTests/FragmentPullDownTests.swift#FragmentPullDownTests.testAThrownFoldStartsAtSpeed
  it("starts a thrown fold at speed", () => {
    for (const speed of [0, 1200, 100_000]) {
      const [x1 = 0, y1 = 0] = (throwTiming(speed, 800, 200).match(/[\d.]+/g) ?? []).map(Number);
      expect(y1 / x1, `at ${speed} px/s`).toBeGreaterThanOrEqual(1);
      expect(y1, `does not overshoot at ${speed} px/s`).toBeLessThan(1);
    }
  });
});
