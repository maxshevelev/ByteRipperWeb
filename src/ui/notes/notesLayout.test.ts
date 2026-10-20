import { describe, expect, it } from "vitest";
import {
  carryTarget,
  layOutCards,
  NOTES_GAP,
  NOTES_INSET,
  notesColumns,
} from "@/ui/notes/notesLayout";

/**
 * Where the Annotations panel's cards stand, and where one carried lands.
 *
 * @upstream ByteRipperTests/AgentAnnotationTests.swift#AgentAnnotationTests
 */
describe("the cards' layout", () => {
  it("takes one column below 640 pixels, two below 980, three above", () => {
    expect([notesColumns(600), notesColumns(800), notesColumns(1200)]).toEqual([1, 2, 3]);
  });

  it("puts each card in the shortest column, in order", () => {
    const heights = [100, 40, 40, 40];
    const layout = layOutCards(heights.length, 800, (index) => heights[index] ?? 0);
    const width = (800 - 2 * NOTES_INSET - NOTES_GAP) / 2;
    expect(layout.columnWidth).toBe(width);
    expect(layout.frames.map((frame) => [frame.x, frame.y])).toEqual([
      [NOTES_INSET, NOTES_INSET],
      [NOTES_INSET + width + NOTES_GAP, NOTES_INSET],
      [NOTES_INSET + width + NOTES_GAP, NOTES_INSET + 40 + NOTES_GAP],
      // The right column is still the shorter one: 12 + 40 + 12 + 40 + 12 against 12 + 100 + 12.
      [NOTES_INSET + width + NOTES_GAP, NOTES_INSET + 2 * (40 + NOTES_GAP)],
    ]);
    expect(layout.contentHeight).toBe(NOTES_INSET + 3 * 40 + 2 * NOTES_GAP + NOTES_INSET);
  });

  // A card carried well inside another takes that card's place; on its rim, or over a gap, it
  // does not move.
  // @upstream ByteRipperTests/AgentAnnotationTests.swift#AgentAnnotationTests.testACardDraggedOntoAnotherTakesItsPlace
  it("gives a carried card the place of the card well under the pointer", () => {
    const layout = layOutCards(3, 800, () => 100);
    const second = layout.frames[1];
    if (second === undefined) throw new Error("three cards");
    const middle = { x: second.x + second.width / 2, y: second.y + 50 };
    expect(carryTarget(layout, middle, 0)).toBe(1);
    expect(carryTarget(layout, { x: second.x + 2, y: second.y + 50 }, 0)).toBeUndefined();
    // Over its own empty place, nothing.
    const first = layout.frames[0];
    if (first === undefined) throw new Error("three cards");
    expect(carryTarget(layout, { x: first.x + 100, y: first.y + 50 }, 0)).toBeUndefined();
  });

  // Below the last card of the column under the pointer is the last place — the empty end of the
  // shorter of two columns too.
  // @upstream ByteRipperTests/AgentAnnotationTests.swift#AgentAnnotationTests.testACardCarriedBelowTheShorterColumnGoesLast
  it("sends a card carried below the shorter column to the last place", () => {
    const heights = [300, 40, 40];
    const layout = layOutCards(heights.length, 800, (index) => heights[index] ?? 0);
    const right = layout.frames[1];
    if (right === undefined) throw new Error("three cards");
    const below = { x: right.x + right.width / 2, y: 250 };
    expect(carryTarget(layout, below, 0)).toBe(2);
    // Beside the tall card, in its own column, still within it: nothing.
    const left = layout.frames[0];
    if (left === undefined) throw new Error("three cards");
    expect(carryTarget(layout, { x: left.x + left.width / 2, y: 250 }, 1)).toBe(0);
  });
});
