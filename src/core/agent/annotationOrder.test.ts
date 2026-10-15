import { describe, expect, it } from "vitest";
import type { AgentAnnotation } from "@/core/agent/agentAnnotation";
import { arranged, carried, inCardOrder } from "@/core/agent/annotationOrder";

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

  it("carries a card before another, or last", () => {
    const ids = ["a1", "a2", "a3", "a4"];
    expect(carried(ids, "a4", "a2")).toEqual(["a1", "a4", "a2", "a3"]);
    expect(carried(ids, "a1", undefined)).toEqual(["a2", "a3", "a4", "a1"]);
    expect(carried(ids, "a2", "a2")).toEqual(ids);
    expect(carried(ids, "a9", "a2")).toEqual(ids);
  });
});
