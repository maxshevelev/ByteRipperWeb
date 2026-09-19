import { afterEach, describe, expect, it } from "vitest";
import {
  isSlot,
  openEmptyInPane,
  type PaneId,
  type PartId,
  paneIn,
  paneState,
  workspaceStore,
} from "@/state/workspaceStore";

/**
 * Which pane an id names. A workspace has two file slots, and a part opened
 * over one of those files is a pane too — its own document, its own name, its
 * own editing controller — so everything that asks "what is in this pane" has
 * to be able to take either.
 *
 * The parts themselves arrive with the panel that opens them; what is checked
 * here is that the identity already tells them apart and finds them.
 */

afterEach(() => {
  workspaceStore.update((state) => ({
    ...state,
    panes: { a: undefined, b: undefined },
    parts: {},
  }));
});

const part = (index: number): PartId => `part:${index}`;

describe("a pane's identity", () => {
  it("tells a file slot from a part", () => {
    expect(isSlot("a")).toBe(true);
    expect(isSlot("b")).toBe(true);
    expect(isSlot(part(1))).toBe(false);
  });

  it("finds the pane in a slot", () => {
    openEmptyInPane("a");

    expect(paneState("a")?.document).toBeDefined();
    expect(paneState("b")).toBeUndefined();
  });

  it("finds a part beside the slots", () => {
    openEmptyInPane("a");
    const one = part(7);
    const slot = paneState("a");
    if (slot === undefined) throw new Error("pane A should be open");
    workspaceStore.update((state) => ({ ...state, parts: { [one]: slot } }));

    expect(paneState(one)).toBe(slot);
    // And the slots are untouched by a part sitting beside them.
    expect(paneState("a")).toBe(slot);
    expect(workspaceStore.getSnapshot().panes.b).toBeUndefined();
  });

  it("finds nothing for a part the dock does not hold", () => {
    expect(paneState(part(3))).toBeUndefined();
  });

  it("reads a pane out of a snapshot the caller already has", () => {
    openEmptyInPane("b");
    const state = workspaceStore.getSnapshot();

    expect(paneIn(state, "b")).toBe(state.panes.b);
    expect(paneIn(state, part(2))).toBeUndefined();
  });

  /**
   * The two kinds are one type, so a caller that does not care which it has
   * does not have to ask — which is the whole point of widening it.
   */
  it("takes either kind where a pane is wanted", () => {
    const ids: PaneId[] = ["a", "b", part(1)];

    expect(ids.filter(isSlot)).toEqual(["a", "b"]);
  });
});
