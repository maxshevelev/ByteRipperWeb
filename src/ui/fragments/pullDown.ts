/**
 * What letting go of a pulled-down fragment panel means: the rule every sheet uses — a
 * deliberate flick puts it away whatever distance it covered, and a slow drag has to have gone
 * far enough to count.
 *
 * Pure, so the feel of it can be tuned and pinned without a pointer. Offsets are in the page's
 * own direction, **positive being down**; upstream's are a window's, where up is positive, and
 * the signs are turned over here rather than the rule.
 *
 * @upstream ByteRipperApp/Fragments/FragmentPanelView.swift#PullDown
 */

/**
 * How far the hand has to move for it to count as a movement with a direction, in pixels. Two:
 * a hand holding something still trembles by a point, and every deliberate nudge clears this at
 * once. It is a distance rather than a speed on purpose — a nudge up and then a pause before
 * letting go is still a nudge up.
 *
 * @upstream ByteRipperApp/Fragments/FragmentPanelView.swift#PullDown.movementThreshold
 */
export const MOVEMENT_THRESHOLD = 2;
/**
 * How far down the pull has to have gone, as a share of the panel's height, before the panel is
 * treated as on its way out rather than merely lifted for a look.
 *
 * @upstream ByteRipperApp/Fragments/FragmentPanelView.swift#PullDown.commitFraction
 */
export const COMMIT_FRACTION = 0.5;
/**
 * The speed, in pixels a second, at which a movement reads as a flick rather than a drag.
 *
 * @upstream ByteRipperApp/Fragments/FragmentPanelView.swift#PullDown.flickSpeed
 */
export const FLICK_SPEED = 900;
/**
 * A flick has to be a real shove, not a fast tremble: the movement that carries the speed must
 * itself be this long.
 *
 * @upstream ByteRipperApp/Fragments/FragmentPanelView.swift#PullDown.flickDistance
 */
export const FLICK_DISTANCE = 8;
/**
 * How much of an upward pull the panel takes: resistance, not travel, the panel being already at
 * the top.
 *
 * @upstream ByteRipperApp/Fragments/FragmentPanelView.swift#PullDown.upwardResistance
 */
export const UPWARD_RESISTANCE = 0.25;
/** @upstream ByteRipperApp/Fragments/FragmentPanelView.swift#PullDown.upwardLimit */
export const UPWARD_LIMIT = 40;
/**
 * How far a press on a header has to move before it is a drag at all.
 *
 * @upstream ByteRipperApp/Pane/PaneHeaderView.swift#PaneHeaderView.dragThreshold
 */
export const DRAG_THRESHOLD = 4;

/** @upstream ByteRipperApp/Fragments/FragmentPanelView.swift#PullDown.Direction */
export type Direction = "down" | "up" | "none";

/**
 * The direction of a movement of `offset` pixels, positive being down, or nothing when it is too
 * small to be one.
 *
 * @upstream ByteRipperApp/Fragments/FragmentPanelView.swift#PullDown.Direction.of
 */
export function directionOf(offset: number): "down" | "up" | undefined {
  if (Math.abs(offset) < MOVEMENT_THRESHOLD) return undefined;
  return offset > 0 ? "down" : "up";
}

/**
 * What the last movement of a pull was: which way it went, how far, and how fast — measured over
 * that movement itself rather than over a window of time.
 *
 * @upstream ByteRipperApp/Fragments/FragmentPanelView.swift#PullDown.Movement
 */
export interface Movement {
  /** @upstream ByteRipperApp/Fragments/FragmentPanelView.swift#PullDown.Movement.direction */
  readonly direction: Direction;
  /** @upstream ByteRipperApp/Fragments/FragmentPanelView.swift#PullDown.Movement.distance */
  readonly distance: number;
  /** @upstream ByteRipperApp/Fragments/FragmentPanelView.swift#PullDown.Movement.speed */
  readonly speed: number;
}

export const NO_MOVEMENT: Movement = { direction: "none", distance: 0, speed: 0 };

/**
 * Whether it was a flick rather than a hand placing the panel.
 *
 * @upstream ByteRipperApp/Fragments/FragmentPanelView.swift#PullDown.Movement.isFlick
 */
export const isFlick = (movement: Movement): boolean =>
  movement.distance >= FLICK_DISTANCE && movement.speed >= FLICK_SPEED;

/** @upstream ByteRipperApp/Fragments/FragmentPanelView.swift#PullDown.Outcome */
export type Outcome = "springBack" | "collapse";

/**
 * What letting go means, given how far down the panel was pulled and what the hand last did.
 *
 * Two halves, because a pull means two different things depending where it ends up. **Near the
 * top it is a look**: the panel goes back, whatever the hand was doing, unless the hand flicked it
 * away. **Past the commit line the last movement is an instruction**: nudged up it springs back
 * from anywhere, nudged down it carries on down, however long the hand rested before letting go.
 *
 * @upstream ByteRipperApp/Fragments/FragmentPanelView.swift#PullDown.outcome
 */
export function outcome(travelled: number, height: number, movement: Movement): Outcome {
  if (travelled < height * COMMIT_FRACTION) {
    return movement.direction === "down" && isFlick(movement) ? "collapse" : "springBack";
  }
  return movement.direction === "up" ? "springBack" : "collapse";
}

/**
 * How far the panel is moved down while the pointer has moved `offset` pixels from where it was
 * grabbed. Downward it follows the hand exactly; upward it gives a quarter and stops, because
 * there is nothing above to reveal.
 *
 * @upstream ByteRipperApp/Fragments/FragmentPanelView.swift#PullDown.position
 */
export function position(offset: number): number {
  return offset >= 0 ? offset : -Math.min(-offset * UPWARD_RESISTANCE, UPWARD_LIMIT);
}
