import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentAnnotation } from "@/core/agent/agentAnnotation";
import { type DesktopFiles, installDesktopFilesForTesting } from "@/platform/desktop/desktopFiles";
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
  selectAnnotations,
  setAnnotationsStorage,
  showAnnotationCards,
  undoRemoval,
} from "@/state/agent/agentAnnotationStore";
import {
  forgetOpenedFilesForTesting,
  keptHandles,
  rememberOpenedFile,
  rememberSavedFile,
} from "@/state/fileReopen";
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

  it("keeps the handles files were opened with, so a card finds its file after a restart", async () => {
    // The desktop shell's: a browser keeps none (below).
    installDesktopFilesForTesting({
      pathOf: () => undefined,
      file: () => Promise.reject(new Error("no files")),
    } as unknown as DesktopFiles);
    const database = memoryKeyValueStore();
    setAnnotationsStorage(database);
    forgetOpenedFilesForTesting();
    await restoreAnnotations();
    const handle = { kind: "file", name: "a.rom" } as unknown as FileSystemFileHandle;
    rememberOpenedFile({ name: "a.rom", size: 16, lastModified: 1, source: new Blob([]), handle });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await database.get<unknown[]>("handles")).toHaveLength(1);

    // The next visit: nothing kept in memory, the handles read back with the annotations.
    forgetOpenedFilesForTesting();
    discardAnnotationsForTesting();
    expect(keptHandles()).toHaveLength(0);
    await restoreAnnotations();
    expect(keptHandles().map((one) => one.identity.name)).toEqual(["a.rom"]);
    forgetOpenedFilesForTesting();
    installDesktopFilesForTesting();
  });

  it("keeps no handle from one visit to the next in a browser", async () => {
    installDesktopFilesForTesting(null);
    const database = memoryKeyValueStore();
    await database.put("handles", [{ identity: { name: "a.rom", size: 16, modified: 1 } }]);
    setAnnotationsStorage(database);
    forgetOpenedFilesForTesting();
    discardAnnotationsForTesting();
    await restoreAnnotations();
    expect(keptHandles()).toHaveLength(0);
    const handle = { kind: "file", name: "a.rom" } as unknown as FileSystemFileHandle;
    rememberOpenedFile({ name: "a.rom", size: 16, lastModified: 1, source: new Blob([]), handle });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(
      await database.get<unknown[]>("handles"),
      "what an earlier page kept goes"
    ).toBeUndefined();
    forgetOpenedFilesForTesting();
    installDesktopFilesForTesting();
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

  it("gives a kept annotation a new id when one made before the restore took its own", async () => {
    const database = memoryKeyValueStore();
    setAnnotationsStorage(database);
    await restoreAnnotations();
    addAnnotation(make(claimAnnotationId()), false);
    addAnnotation(make(claimAnnotationId(), ["a1"]), false);
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The next visit: an agent annotates before the database has been read.
    discardAnnotationsForTesting();
    addAnnotation(make(claimAnnotationId()), false);
    expect(ids()).toEqual(["a1"]);
    await Promise.all([restoreAnnotations(), restoreAnnotations()]);
    expect([...ids()].sort()).toEqual(["a1", "a2", "a3"]);
    const moved = orderedAnnotations().find((one) => one.relatedTo.length > 0);
    expect(moved?.id).toBe("a2");
    expect(moved?.relatedTo).toEqual(["a3"]);
    expect(claimAnnotationId()).toBe("a4");
  });

  it("selects a card from outside as the start of the next run, and asks the panel to show it", () => {
    for (const id of ["a1", "a2", "a3"]) addAnnotation(make(id), false);
    selectAnnotations(["a1"], "a1");
    showAnnotationCards(["a2"]);
    const state = agentAnnotationStore.getSnapshot();
    expect([...state.chosen]).toEqual(["a2"]);
    expect(state.anchor).toBe("a2");
    expect(state.reveal).toEqual({ id: "a2" });
    // Several cards — an undo's — leave the start where it was; the panel shows the first in order.
    showAnnotationCards(["a1", "a3"]);
    expect(agentAnnotationStore.getSnapshot().anchor).toBe("a2");
    expect(agentAnnotationStore.getSnapshot().reveal).toEqual({ id: "a3" });
  });

  it("keeps the annotations and the handle on a file a save in place gave a new date", () => {
    forgetOpenedFilesForTesting();
    const pathless = (one: AgentAnnotation): AgentAnnotation => ({
      ...one,
      file: { kind: "disk", identity: { name: "a.rom", size: 16, modified: 1 } },
    });
    addAnnotation(pathless(make("a1")), false);
    const handle = { kind: "file", name: "a.rom" } as unknown as FileSystemFileHandle;
    const before = { name: "a.rom", size: 16, lastModified: 1, source: new Blob([]), handle };
    rememberOpenedFile(before);
    rememberSavedFile(before, { ...before, size: 20, lastModified: 5000 });
    const [moved] = orderedAnnotations();
    expect(moved?.file).toEqual({
      kind: "disk",
      identity: { name: "a.rom", size: 20, modified: 5000 },
    });
    expect(keptHandles().map((one) => one.identity)).toEqual([
      { name: "a.rom", size: 20, modified: 5000 },
    ]);
    forgetOpenedFilesForTesting();
  });
});
