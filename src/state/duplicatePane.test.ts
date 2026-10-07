import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Whether the browser grants the origin-private file system the snapshot is
 * written into — the one thing Duplicate needs from the platform.
 */
const opfs = vi.hoisted(() => ({ available: true }));

// The origin-private file system, in memory: Node has none, and what is under
// test is the workspace's copy, not the browser's storage.
vi.mock("@/platform/files/opfsScratchStore", async () => {
  const { RecordingScratchStore } = await import("@/core/testing/support");
  return {
    OpfsScratchStore: class extends RecordingScratchStore {
      static isAvailable(): boolean {
        return opfs.available;
      }
    },
  };
});

const { closePane, duplicatePane, openInPane, workspaceStore } = await import(
  "@/state/workspaceStore"
);

/** Opens `bytes` in pane A, as a file of its own. */
function openSource(bytes: readonly number[]) {
  openInPane("a", {
    name: "dump.bin",
    size: bytes.length,
    lastModified: 0,
    source: new Blob([new Uint8Array(bytes)]),
  });
  return documentIn("a");
}

function documentIn(pane: "a" | "b") {
  const document = workspaceStore.getSnapshot().panes[pane]?.document;
  if (document === undefined) throw new Error(`pane ${pane} holds nothing`);
  return document;
}

async function readAll(pane: "a" | "b"): Promise<number[]> {
  const document = documentIn(pane);
  return [...(await document.read(0, document.size))];
}

const range = (from: number, to: number) => Array.from({ length: to - from }, (_, at) => from + at);

/**
 * §23 Duplicate: a pane hands the other slot a copy of its current content as
 * an untitled, never-saved document. The copy is a snapshot — the bytes as they
 * were at the moment of the call — and the two documents are independent from
 * then on: an edit or a close on either side leaves the other exactly as it was.
 *
 * @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/BinaryDocumentDuplicateTests.swift#BinaryDocumentDuplicateTests
 * @upstream-differs a workspace operation over two panes, where upstream's is the document's own
 */
describe("Duplicate", () => {
  beforeEach(() => {
    opfs.available = true;
    workspaceStore.update((state) => ({ ...state, panes: { a: undefined, b: undefined } }));
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/BinaryDocumentDuplicateTests.swift#BinaryDocumentDuplicateTests.testTheCopyHoldsTheSourcesBytes
  it("gives the copy the source's bytes", async () => {
    openSource(range(0x10, 0x20));
    await duplicatePane("a");
    expect(documentIn("b").size).toBe(documentIn("a").size);
    expect(await readAll("b")).toEqual(range(0x10, 0x20));
  });

  // The copy is of the content the pane *shows*, not of the file on disk: a
  // source with unsaved edits is duplicated with them.
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/BinaryDocumentDuplicateTests.swift#BinaryDocumentDuplicateTests.testTheCopyCarriesTheSourcesUnsavedEdits
  it("carries the source's unsaved edits", async () => {
    const source = openSource([0x00, 0x01, 0x02, 0x03]);
    await source.overwrite(1, new Uint8Array([0xaa]));
    await source.insert(4, new Uint8Array([0xbb]));
    await duplicatePane("a");
    expect(await readAll("b")).toEqual([0x00, 0xaa, 0x02, 0x03, 0xbb]);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/BinaryDocumentDuplicateTests.swift#BinaryDocumentDuplicateTests.testTheCopyOfAnEmptyDocumentIsEmpty
  it("makes the copy of an empty document empty", async () => {
    openSource([]);
    await duplicatePane("a");
    expect(documentIn("b").size).toBe(0);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/BinaryDocumentDuplicateTests.swift#BinaryDocumentDuplicateTests.testDuplicatingAStorageThatCannotBeSnapshottedThrows
  // @upstream-differs what cannot be snapshotted here is a browser with no private storage to write the copy into
  it("refuses where there is nowhere to write the copy", async () => {
    openSource([1, 2, 3]);
    opfs.available = false;
    await expect(duplicatePane("a")).rejects.toThrow("private storage");
    expect(workspaceStore.getSnapshot().panes.b).toBeUndefined();
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/BinaryDocumentDuplicateTests.swift#BinaryDocumentDuplicateTests.testTheCopyIsDetachedDirtyAndWritable
  it("makes the copy detached, dirty and editable", async () => {
    openSource([0x01, 0x02]);
    await duplicatePane("a");
    const copy = workspaceStore.getSnapshot().panes.b;
    // The copy came from no file of its own: nothing to save in place.
    expect(copy?.untitled).toBe(true);
    expect(copy?.writable).toBe(false);
    // Content that has never been on disk must warn on close.
    expect(documentIn("b").isDirty).toBe(true);
    // There is no state before the copy to return to.
    expect(documentIn("b").canUndo).toBe(false);
    expect(documentIn("b").canRedo).toBe(false);
    // And it can be edited, like any new document.
    await documentIn("b").overwrite(0, new Uint8Array([0xee]));
    expect(await readAll("b")).toEqual([0xee, 0x02]);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/BinaryDocumentDuplicateTests.swift#BinaryDocumentDuplicateTests.testDuplicatingChangesNothingAboutTheSource
  it("changes nothing about the source", async () => {
    const source = openSource([0x00, 0x01, 0x02]);
    await source.overwrite(0, new Uint8Array([0xaa]));
    const before = workspaceStore.getSnapshot().panes.a;
    const dirtyBefore = source.isDirty;
    const depthBefore = source.undoHistory.undoDepth;

    await duplicatePane("a");

    const after = workspaceStore.getSnapshot().panes.a;
    // The source keeps its file.
    expect(after?.file).toBe(before?.file);
    expect(after?.untitled).toBe(before?.untitled);
    expect(source.isDirty).toBe(dirtyBefore);
    // A duplicate is not an edit: it records no undo step.
    expect(source.undoHistory.undoDepth).toBe(depthBefore);
    expect(await readAll("a")).toEqual([0xaa, 0x01, 0x02]);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/BinaryDocumentDuplicateTests.swift#BinaryDocumentDuplicateTests.testEditingTheCopyDoesNotChangeTheSource
  it("leaves the source alone when the copy is edited", async () => {
    openSource([0x00, 0x01, 0x02]);
    await duplicatePane("a");
    await documentIn("b").overwrite(1, new Uint8Array([0xee]));
    await documentIn("b").insert(0, new Uint8Array([0xdd]));
    expect(await readAll("b")).toEqual([0xdd, 0x00, 0xee, 0x02]);
    expect(await readAll("a")).toEqual([0x00, 0x01, 0x02]);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/BinaryDocumentDuplicateTests.swift#BinaryDocumentDuplicateTests.testEditingTheSourceDoesNotChangeTheCopy
  it("leaves the copy alone when the source is edited", async () => {
    const source = openSource([0x00, 0x01, 0x02]);
    await duplicatePane("a");
    await source.overwrite(1, new Uint8Array([0xee]));
    await source.delete(0, 1);
    expect(await readAll("a")).toEqual([0xee, 0x02]);
    expect(await readAll("b")).toEqual([0x00, 0x01, 0x02]);
  });

  // Closing the source is what the reader does when they close its pane, and the
  // copy must go on reading what it was given.
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/BinaryDocumentDuplicateTests.swift#BinaryDocumentDuplicateTests.testTheCopyOutlivesTheSource
  it("outlives the source", async () => {
    const bytes = range(0x00, 0x40);
    const source = openSource(bytes);
    // An edit, so the snapshot cannot simply be the file.
    await source.overwrite(0, new Uint8Array([0xaa]));
    await duplicatePane("a");

    closePane("a");

    expect(await readAll("b")).toEqual([0xaa, ...bytes.slice(1)]);
  });
});
