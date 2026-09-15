import { describe, expect, it } from "vitest";
import {
  type AutoscrollViewport,
  canAutoscrollToward,
  dragAutoscrollStep,
  isBeyondVisibleEdge,
} from "@/ui/pane/dragAutoscroll";

// Upstream's AutoscrollSelectionTests, against the step rather than a view.

const viewport = (top: number, maxTop = 10_000): AutoscrollViewport => ({
  top,
  viewportHeight: 340,
  maxTop,
});

/** Steps the way the timer does: the pointer stays put while the pane moves. */
function hold(pointerY: number, start: AutoscrollViewport, ticks: number): number {
  let top = start.top;
  for (let tick = 0; tick < ticks; tick++) {
    const here = { ...start, top };
    if (!canAutoscrollToward(pointerY, here)) break;
    top = dragAutoscrollStep(pointerY, here).top;
  }
  return top;
}

describe("scrolling while a drag is past the edge", () => {
  it("keeps going while the pointer is held still just past the edge", () => {
    const pastEdge = 340 + 20;
    const afterFirst = dragAutoscrollStep(pastEdge, viewport(0)).top;
    expect(afterFirst).toBeGreaterThan(0);

    const afterHold = hold(pastEdge, viewport(afterFirst), 10);
    expect(afterHold).toBeGreaterThan(afterFirst + 100);
  });

  it("scrolls by exactly the overshoot, so the speed rises with it", () => {
    const increments = [8, 16, 32].map((overshoot) => {
      return dragAutoscrollStep(340 + overshoot, viewport(1000)).top - 1000;
    });
    expect(increments).toEqual([8, 16, 32]);
  });

  it("stops at the document's end, and the drag settles at the edge row", () => {
    const far = 340 + 4000;
    const step = dragAutoscrollStep(far, viewport(0, 1000));
    expect(step.top).toBe(1000);
    expect(step.pointerY).toBe(339);
    expect(canAutoscrollToward(far, viewport(step.top, 1000))).toBe(false);
  });

  it("scrolls up past the top edge", () => {
    expect(dragAutoscrollStep(-100, viewport(1000)).top).toBe(900);
    expect(canAutoscrollToward(-100, viewport(1000))).toBe(true);
  });

  it("does not scroll above the document's start, and clamps the drag to the top row", () => {
    const step = dragAutoscrollStep(-50, viewport(0));
    expect(step).toEqual({ top: 0, pointerY: 0 });
    expect(canAutoscrollToward(-50, viewport(0))).toBe(false);
  });

  it("leaves a pointer inside the pane alone", () => {
    expect(isBeyondVisibleEdge(200, viewport(500))).toBe(false);
    expect(dragAutoscrollStep(200, viewport(500))).toEqual({ top: 500, pointerY: 200 });
    expect(canAutoscrollToward(200, viewport(500))).toBe(false);
  });
});
