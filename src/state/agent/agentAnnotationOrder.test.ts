import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentAnnotation } from "@/core/agent/agentAnnotation";
import { memoryKeyValueStore } from "@/platform/storage/keyValueStore";
import {
  addAnnotation,
  agentAnnotationStore,
  annotationsToStore,
  arrangeAnnotations,
  claimAnnotationId,
  discardAnnotationsForTesting,
  orderedAnnotations,
  redoRemoval,
  removeFromPanel,
  restoreAnnotations,
  setAnnotationsStorage,
  undoRemoval,
} from "@/state/agent/agentAnnotationStore";
import { foldParts, notesPanelIsUp, openNotesPanel, workspaceStore } from "@/state/workspaceStore";

const make = (id: string, relatedTo: string[] = []): AgentAnnotation => ({
  id,
  file: { kind: "disk", identity: { name: "a.rom", size: 16, modified: 1, path: "/a.rom" } },
  range: [0, 4],
  node: undefined,
  title: `Title ${id}`,
  note: "note",
  decoded: {
    holder: "0.1",
    source: [0, 8],
    space: [0, 1],
    range: [0, 4],
    codecs: ["LZMA"],
    xorKey: undefined,
  },
  relatedTo,
  site: { label: "Volume", node: "0.1" },
  author: "person",
});

const ids = () => orderedAnnotations().map((one) => one.id);

/**
 * The Annotations cards' order, the New tag, the removals ⌘Z takes back, and what is kept for the
 * next visit.
 *
 * @upstream ByteRipperTests/AgentAnnotationTests.swift#AgentAnnotationTests.testANoteIsNewUntilTheWindowGoesOutOfView
 * @upstream ByteRipperTests/AgentAnnotationTests.swift#AgentAnnotationTests.testUndoPutsRemovedCardsBackWhereTheyStood
 * @upstream ByteRipperTests/AgentAnnotationTests.swift#AgentAnnotationTests.testTheAnnotationsAreKeptForTheNextLaunch
 * @upstream-differs the cards' drawing and the window's toolbar are AppKit's; kept in the browser's
 * database rather than a JSON file
 */
describe("the annotations' cards", () => {
  beforeEach(() => {
    foldParts();
    discardAnnotationsForTesting();
  });
  afterEach(() => {
    foldParts();
    discardAnnotationsForTesting();
  });

  it("puts the newest card first, and a card dragged stays where it was put", () => {
    for (const id of ["a1", "a2", "a3"]) addAnnotation(make(id), false);
    expect(ids()).toEqual(["a3", "a2", "a1"]);
    arrangeAnnotations(["a1"]);
    expect(ids()).toEqual(["a1", "a3", "a2"]);
    addAnnotation(make("a4"), false);
    expect(ids()).toEqual(["a4", "a1", "a3", "a2"]);
    // The agent's list stays oldest first.
    expect(agentAnnotationStore.getSnapshot().items.map((one) => one.id)).toEqual([
      "a1",
      "a2",
      "a3",
      "a4",
    ]);
  });

  it("marks a note new when the panel is up, at once or when it comes up, and not after", () => {
    addAnnotation(make("a1"), false);
    expect(agentAnnotationStore.getSnapshot().marked.size).toBe(0);
    expect(agentAnnotationStore.getSnapshot().fresh.has("a1")).toBe(true);
    openNotesPanel();
    expect([...agentAnnotationStore.getSnapshot().marked]).toEqual(["a1"]);
    addAnnotation(make("a2"), true);
    expect([...agentAnnotationStore.getSnapshot().marked].sort()).toEqual(["a1", "a2"]);
    foldParts();
    expect(agentAnnotationStore.getSnapshot().marked.size).toBe(0);
    openNotesPanel();
    expect(agentAnnotationStore.getSnapshot().marked.size).toBe(0);
  });

  it("puts removed cards back where they stood, with the relations the others lost", () => {
    addAnnotation(make("a1"), false);
    addAnnotation(make("a2", ["a1"]), false);
    addAnnotation(make("a3", ["a1", "a2"]), false);
    expect(ids()).toEqual(["a3", "a2", "a1"]);
    removeFromPanel(new Set(["a1"]));
    expect(ids()).toEqual(["a3", "a2"]);
    expect(orderedAnnotations().map((one) => one.relatedTo)).toEqual([["a2"], []]);
    undoRemoval();
    expect(ids()).toEqual(["a3", "a2", "a1"]);
    expect(orderedAnnotations().map((one) => one.relatedTo)).toEqual([["a1", "a2"], ["a1"], []]);
    expect([...agentAnnotationStore.getSnapshot().chosen]).toEqual(["a1"]);
    redoRemoval();
    expect(ids()).toEqual(["a3", "a2"]);
  });

  it("keeps the panel up, empty, while the removal that emptied it can be undone", () => {
    addAnnotation(make("a1"), false);
    openNotesPanel();
    expect(notesPanelIsUp(workspaceStore.getSnapshot())).toBe(true);
    removeFromPanel(new Set(["a1"]));
    expect(ids()).toEqual([]);
    expect(notesPanelIsUp(workspaceStore.getSnapshot())).toBe(true);
    undoRemoval();
    expect(ids()).toEqual(["a1"]);
    // Folded with nothing in it, the panel goes with the last annotation as it always did.
    removeFromPanel(new Set(["a1"]));
    foldParts();
    expect(workspaceStore.getSnapshot().notesPanel).toBeUndefined();
  });

  it("keeps the notes, their order and the ids for the next visit", async () => {
    const database = memoryKeyValueStore();
    setAnnotationsStorage(database);
    await restoreAnnotations();
    addAnnotation(make(claimAnnotationId()), false);
    addAnnotation(make(claimAnnotationId(), ["a1"]), true);
    arrangeAnnotations(["a1"]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const kept = await database.get<unknown>("annotations");
    expect(kept).toEqual(annotationsToStore());

    discardAnnotationsForTesting();
    expect(ids()).toEqual([]);
    await restoreAnnotations();
    expect(ids()).toEqual(["a1", "a2"]);
    const [first] = orderedAnnotations();
    expect(first?.decoded?.codecs).toEqual(["LZMA"]);
    expect(first?.site?.label).toBe("Volume");
    expect(claimAnnotationId()).toBe("a3");
  });
});
