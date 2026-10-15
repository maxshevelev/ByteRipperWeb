import { describe, expect, it } from "vitest";
import type { AgentAnnotation } from "@/core/agent/agentAnnotation";
import {
  arranged,
  cardChange,
  carryTarget,
  inCardOrder,
  movedTo,
  stillSettled,
} from "@/core/agent/annotationOrder";

const note = (id: string): AgentAnnotation => ({
  id,
  file: { kind: "disk", identity: { name: "a.rom", size: 1, modified: 0 } },
  range: undefined,
  node: undefined,
  title: id,
  note: "",
  decoded: undefined,
  relatedTo: [],
  site: undefined,
  author: "person",
});

/**
 * The cards' order: the newest first, then wherever the person drags a card.
 *
 * @upstream ByteRipperTests/AgentAnnotationTests.swift#AgentAnnotationTests.testACardDraggedOntoAnotherTakesItsPlace
 */
describe("the cards' order", () => {
  it("lists the cards as the order says, and one it does not know before the rest", () => {
    const all = ["a1", "a2", "a3"].map(note);
    expect(inCardOrder(all, ["a2", "a1"]).map((one) => one.id)).toEqual(["a3", "a2", "a1"]);
  });

  it("arranges the named cards first and keeps the rest as they stood", () => {
    expect(arranged(["a3", "a2", "a1"], ["a1", "a3"])).toEqual(["a1", "a3", "a2"]);
    expect(arranged(["a2", "a1"], ["zzz", "a1"])).toEqual(["a1", "a2"]);
  });

  it("takes a card to another place, the ones between making room", () => {
    const ids = ["a1", "a2", "a3", "a4"];
    expect(movedTo(ids, 3, 1)).toEqual(["a1", "a4", "a2", "a3"]);
    expect(movedTo(ids, 0, 3)).toEqual(["a2", "a3", "a4", "a1"]);
    expect(movedTo(ids, 2, 2)).toEqual(ids);
    expect(movedTo(ids, 7, 1)).toEqual(ids);
  });

  it("lands a carried card on the card well under the pointer, or last below a column", () => {
    // Two columns: a1 and a3 on the left, a2 on the right, shorter.
    const frames = [
      { x: 12, y: 12, width: 100, height: 100 },
      { x: 124, y: 12, width: 100, height: 60 },
      { x: 12, y: 124, width: 100, height: 100 },
    ];
    const columns = [
      { left: 6, right: 118 },
      { left: 118, right: 230 },
    ];
    expect(carryTarget(frames, columns, 0, 170, 40)).toBe(1);
    // On a card's rim, in a gap, or on the carried card's own place: nowhere.
    expect(carryTarget(frames, columns, 0, 126, 40)).toBeUndefined();
    expect(carryTarget(frames, columns, 1, 60, 118)).toBeUndefined();
    expect(carryTarget(frames, columns, 0, 60, 60)).toBeUndefined();
    // Below the short column: the last place.
    expect(carryTarget(frames, columns, 0, 170, 150)).toBe(2);
    expect(carryTarget([], columns, 0, 170, 150)).toBeUndefined();
  });

  it("moves the cards again only once the pointer has gone on", () => {
    expect(stillSettled(undefined, 0, 0)).toBe(false);
    expect(stillSettled({ x: 10, y: 10 }, 14, 14)).toBe(true);
    expect(stillSettled({ x: 10, y: 10 }, 18, 10)).toBe(false);
  });

  it("tells cards that only went, or only came, from any other change", () => {
    expect(cardChange(["a1", "a2", "a3"], ["a1", "a3"])).toBe("remove");
    expect(cardChange(["a1", "a2"], ["a3", "a1", "a2"])).toBe("insert");
    expect(cardChange(["a1", "a2", "a3"], ["a3", "a1"])).toBe("other");
    expect(cardChange(["a1", "a2"], ["a2", "a1"])).toBe("other");
    expect(cardChange(["a1"], ["a1"])).toBe("other");
    expect(cardChange([], ["a1"])).toBe("other");
  });
});
