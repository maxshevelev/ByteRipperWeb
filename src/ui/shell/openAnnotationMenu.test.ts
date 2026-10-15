import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentAnnotation } from "@/core/agent/agentAnnotation";
import {
  addAnnotation,
  agentAnnotationStore,
  discardAnnotationsForTesting,
} from "@/state/agent/agentAnnotationStore";
import { EMPTY_DOCK } from "@/state/fragmentDock";
import {
  foldParts,
  notesPanelIsUp,
  openEmptyInPane,
  paneState,
  workspaceStore,
} from "@/state/workspaceStore";
import { isMenuAction, type MenuEntry } from "@/ui/shell/menuModel";
import { dumpMenu, type PaneMenuActions } from "@/ui/shell/paneMenus";

/**
 * The offset menu's *Open Annotation “title”*: one item for every annotation whose place holds the
 * clicked byte, the innermost first, standing with Add Annotation… — and choosing one brings the
 * Annotations panel up with that card selected.
 *
 * @upstream ByteRipperTests/AgentAnnotationTests.swift#AgentAnnotationTests.testTheOffsetMenuOpensTheAnnotationsOnTheByte
 * @upstream-differs the panel is not a step of the history its Back returns from (G93)
 */

const actions = new Proxy({} as PaneMenuActions, { get: () => () => {} });

const menu = (offset: number): (MenuEntry | undefined)[] =>
  dumpMenu(workspaceStore.getSnapshot(), "a", offset, actions);

const labels = (offset: number): string[] =>
  menu(offset).flatMap((entry) =>
    entry !== undefined && isMenuAction(entry) ? [entry.label] : []
  );

const noteOn = (id: string, range: [number, number]): AgentAnnotation => {
  const slot = paneState("a");
  if (slot === undefined) throw new Error("pane A should be open");
  return {
    id,
    file: { kind: "document", document: new WeakRef(slot.document), name: "bios.bin" },
    range,
    node: undefined,
    title: `Title ${id}`,
    note: "",
    decoded: undefined,
    relatedTo: [],
    site: undefined,
    author: "person",
  };
};

beforeEach(async () => {
  discardAnnotationsForTesting();
  openEmptyInPane("a", "bios.bin");
  await paneState("a")?.document.insert(
    0,
    Uint8Array.from({ length: 64 }, (_, index) => index)
  );
});

afterEach(() => {
  foldParts();
  discardAnnotationsForTesting();
  workspaceStore.update((state) => ({
    ...state,
    panes: { a: undefined, b: undefined },
    parts: {},
    dock: EMPTY_DOCK,
  }));
});

describe("Open Annotation in the offset menu", () => {
  it("offers each annotation on the byte, the innermost first", () => {
    addAnnotation(noteOn("a1", [0, 32]), false);
    addAnnotation(noteOn("a2", [8, 12]), false);
    addAnnotation(noteOn("a3", [40, 48]), false);
    expect(labels(10).filter((label) => label.startsWith("Open Annotation"))).toEqual([
      "Open Annotation “Title a2”",
      "Open Annotation “Title a1”",
    ]);
    expect(labels(60).some((label) => label.startsWith("Open Annotation"))).toBe(false);
  });

  it("raises the panel with that card selected", () => {
    addAnnotation(noteOn("a1", [0, 32]), false);
    addAnnotation(noteOn("a2", [8, 12]), false);
    const item = menu(10).find(
      (entry) =>
        entry !== undefined && isMenuAction(entry) && entry.label === "Open Annotation “Title a1”"
    );
    if (item === undefined || !isMenuAction(item)) throw new Error("no such item");
    expect(notesPanelIsUp(workspaceStore.getSnapshot())).toBe(false);
    item.onSelect();
    expect(notesPanelIsUp(workspaceStore.getSnapshot())).toBe(true);
    expect([...agentAnnotationStore.getSnapshot().chosen]).toEqual(["a1"]);
  });
});
