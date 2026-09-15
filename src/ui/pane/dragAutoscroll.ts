/**
 * Scrolling a pane while a drag holds the pointer past its top or bottom edge
 * (§6).
 *
 * The step is HexFiend's, as upstream took it: each step scrolls exactly the
 * distance the pointer sits past the edge, so a pointer barely past it creeps
 * and one far out glides — no ramp, no saturation. The drag itself goes on at
 * the visible edge, so the selection keeps reaching the row there while the
 * pane scrolls.
 *
 * The steps repeat while the pointer is *held* past the edge, not only while it
 * moves: a pointer kept still just below the dump is the ordinary way to select
 * a long range, and a view that scrolled once and stopped there was the bug
 * upstream's tests were written against.
 *
 * Pure, so the rules can be tested without a pane. A pointer's y is in the
 * viewport's own coordinates: 0 is the top edge, `viewportHeight` the bottom.
 */

export interface AutoscrollViewport {
  /** Where the pane is scrolled to, in content pixels. */
  readonly top: number;
  readonly viewportHeight: number;
  /**
   * The furthest the pane can scroll: content height less the viewport.
   *
   * @upstream ByteRipperApp/Hex/HexView.swift#HexView.maxVerticalScroll
   */
  readonly maxTop: number;
}

/**
 * How often a held pointer steps the scroll: upstream's timer, 30 times a second.
 *
 * @upstream ByteRipperApp/Hex/HexView.swift#HexView.autoscrollTimer
 */
export const AUTOSCROLL_INTERVAL_MS = 1000 / 30;

/** @upstream ByteRipperApp/Hex/HexView.swift#HexView.isBeyondVisibleEdge */
export function isBeyondVisibleEdge(pointerY: number, viewport: AutoscrollViewport): boolean {
  return pointerY < 0 || pointerY > viewport.viewportHeight;
}

/**
 * Whether the pane has room to keep scrolling toward a pointer past its edge:
 * the document still has rows in that direction.
 *
 * @upstream ByteRipperApp/Hex/HexView.swift#HexView.canAutoscrollToward
 */
export function canAutoscrollToward(pointerY: number, viewport: AutoscrollViewport): boolean {
  if (pointerY < 0) return viewport.top > 0;
  if (pointerY > viewport.viewportHeight) return viewport.top < viewport.maxTop;
  return false;
}

/**
 * One step: where the pane scrolls to, and the pointer position that drives the
 * drag — clamped to the visible edge, even when nothing scrolled (the document's
 * edge), so the selection settles at the edge row rather than where the last
 * step happened to land.
 *
 * @upstream ByteRipperApp/Hex/HexView.swift#HexView.dragAutoscrollStep
 */
export function dragAutoscrollStep(
  pointerY: number,
  viewport: AutoscrollViewport
): { readonly top: number; readonly pointerY: number } {
  const height = viewport.viewportHeight;
  const overshoot = pointerY < 0 ? pointerY : pointerY > height ? pointerY - height : 0;
  const top =
    overshoot === 0
      ? viewport.top
      : Math.min(Math.max(0, viewport.top + overshoot), Math.max(0, viewport.maxTop));
  return { top, pointerY: Math.min(Math.max(pointerY, 0), Math.max(0, height - 1)) };
}
