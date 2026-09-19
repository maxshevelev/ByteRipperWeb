import { afterEach, describe, expect, it } from "vitest";
import { EMPTY_DOCK } from "@/state/fragmentDock";
import {
  closePart,
  foldParts,
  isSlot,
  openEmptyInPane,
  openPart,
  type PaneId,
  type PartId,
  paneIn,
  paneState,
  raisePart,
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
    dock: EMPTY_DOCK,
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

describe("opening a part", () => {
  const bytes = Uint8Array.from({ length: 16 }, (_, index) => index);

  /**
   * A part is a pane with a document of its own, and the dock has a pill for
   * it, raised — a part you asked for and cannot see is a part you did not get.
   */
  it("gives the part a pane and raises its panel", async () => {
    const pane = openPart(bytes, "NVRAM @0x300000");
    const state = workspaceStore.getSnapshot();

    expect(isSlot(pane)).toBe(false);
    expect(paneIn(state, pane)?.name).toBe("NVRAM @0x300000");
    expect(await paneIn(state, pane)?.document.size).toBe(16);
    expect(state.dock.panels).toHaveLength(1);
    expect(state.dock.expanded).toBe(state.dock.panels[0]);
  });

  /** The workspace's own panes are behind it, not touched by it. */
  it("leaves the file slots alone", () => {
    openEmptyInPane("a");
    const before = workspaceStore.getSnapshot();

    openPart(bytes, "a part");
    const after = workspaceStore.getSnapshot();

    expect(after.panes.a).toBe(before.panes.a);
    expect(after.panes.b).toBeUndefined();
    expect(after.activePane).toBe(before.activePane);
  });

  // Opening a second part folds the first, which is the dock's own rule.
  it("folds the part that was up when another opens", () => {
    const first = openPart(bytes, "first");
    const second = openPart(bytes, "second");
    const state = workspaceStore.getSnapshot();

    expect(state.dock.panels).toHaveLength(2);
    expect(paneIn(state, first)).toBeDefined();
    expect(paneIn(state, second)).toBeDefined();
    expect(state.dock.expanded).toBe(state.dock.panels[1]);
  });

  it("raises a folded part, and folds the one that was up", () => {
    const first = openPart(bytes, "first");
    openPart(bytes, "second");

    raisePart(first);

    expect(workspaceStore.getSnapshot().dock.expanded).toBe(
      workspaceStore.getSnapshot().dock.panels[0]
    );
  });

  it("folds every part, leaving the panes in full view", () => {
    openPart(bytes, "one");

    foldParts();

    const state = workspaceStore.getSnapshot();
    expect(state.dock.expanded).toBeUndefined();
    // Folding keeps the pill and the part behind it.
    expect(state.dock.panels).toHaveLength(1);
    expect(Object.keys(state.parts)).toHaveLength(1);
  });

  it("takes the part and its pill away when it closes", () => {
    const pane = openPart(bytes, "one");

    closePart(pane);

    const state = workspaceStore.getSnapshot();
    expect(paneIn(state, pane)).toBeUndefined();
    expect(state.dock.panels).toHaveLength(0);
    expect(state.dock.expanded).toBeUndefined();
  });
});
