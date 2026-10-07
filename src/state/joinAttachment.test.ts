import { afterEach, describe, expect, it } from "vitest";
import { ChunkCache } from "@/core/storage/chunkCache";
import { FileBackedStorage } from "@/core/storage/fileBackedStorage";
import type { OpenedFile } from "@/platform/files/openedFile";
import { forgetActs, redoLast, undoLast } from "@/state/undoRouter";
import { joinIntoPane, openInPane, workspaceStore } from "@/state/workspaceStore";

const file = (name: string, bytes: readonly number[]): OpenedFile => ({
  name,
  size: bytes.length,
  lastModified: 0,
  source: new Blob([new Uint8Array(bytes)]),
});

/** Joins `bytes` onto the end of pane A, as a drop on its end band does. */
function joinAtEnd(bytes: readonly number[]): Promise<void> {
  const donor = file("donor.bin", bytes);
  return joinIntoPane({
    pane: "a",
    source: new FileBackedStorage(donor.source, new ChunkCache()),
    sourceName: donor.name,
    position: "end",
  });
}

const slot = () => {
  const pane = workspaceStore.getSnapshot().panes.a;
  if (pane === undefined) throw new Error("pane A holds nothing");
  return pane;
};

async function readAll(): Promise<number[]> {
  const { document } = slot();
  return [...(await document.read(0, document.size))];
}

/** Attached: the pane holds the file it was opened from, and can be saved over it. */
const isAttachedTo = (original: OpenedFile) =>
  slot().file === original && slot().saved !== undefined;

const range = (from: number, to: number) => Array.from({ length: to - from }, (_, at) => from + at);

/**
 * What a join does to the pane's file (§22.2): it detaches from it, because what
 * is on screen is no longer that file — and undoing the join gives the file
 * back, redoing it takes it away again.
 *
 * @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/BinaryDocumentJoinTests.swift#BinaryDocumentJoinTests
 * @upstream-differs the attachment is the pane's (`syncJoinAttachment`), not the document's: what "attached" means here is the pane holding its file and a saved copy to compare against
 */
describe("a join and the pane's file", () => {
  afterEach(() => {
    forgetActs("a");
    workspaceStore.update((state) => ({ ...state, panes: { a: undefined, b: undefined } }));
  });

  // The join detaches the pane from the file it came from: the result is never
  // saved and dirty, so a close warns instead of silently discarding the joined
  // content. The history is not cleared — the join is one undoable step on top
  // of any earlier edits (§22.2).
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/BinaryDocumentJoinTests.swift#BinaryDocumentJoinTests.testTheJoinedDocumentIsNeverSavedAndDirty
  it("leaves the joined document never saved and dirty", async () => {
    const original = file("dump.bin", range(0x10, 0x20));
    openInPane("a", original);
    await slot().document.overwrite(0, new Uint8Array([0x01, 0x02, 0x03, 0x04]));
    expect(slot().document.canUndo).toBe(true);

    await joinAtEnd([0xa0, 0xa1]);

    // The join is an undoable step, not a history clear.
    expect(slot().document.canUndo).toBe(true);
    expect(slot().document.canRedo).toBe(false);
    expect(slot().document.isDirty).toBe(true);
    // The join detaches from the file: nothing to save over, nothing saved.
    expect(isAttachedTo(original)).toBe(false);
    expect(slot().saved).toBeUndefined();
    expect(slot().writable).toBe(false);
    expect(slot().name).not.toBe("dump.bin");
  });

  // Undoing the join removes the inserted bytes and re-attaches the pane to the
  // file it came from — the pane looks exactly as it did before the join.
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/BinaryDocumentJoinTests.swift#BinaryDocumentJoinTests.testUndoingAJoinReattachesToTheOriginalFile
  it("re-attaches the file when the join is undone", async () => {
    const original = file("dump.bin", range(0x10, 0x20));
    openInPane("a", original);
    await joinAtEnd([0xa0, 0xa1]);
    expect(isAttachedTo(original)).toBe(false);
    expect(slot().document.size).toBe(18);

    await undoLast("a", false);

    expect(isAttachedTo(original)).toBe(true);
    expect(slot().name).toBe("dump.bin");
    expect(slot().document.size).toBe(16);
    expect(await readAll()).toEqual(range(0x10, 0x20));
  });

  // Redoing the join re-inserts the bytes and re-detaches — the inverse of the undo.
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/BinaryDocumentJoinTests.swift#BinaryDocumentJoinTests.testRedoingAJoinRedetaches
  it("detaches again when the join is redone", async () => {
    const original = file("dump.bin", range(0x10, 0x20));
    openInPane("a", original);
    await joinAtEnd([0xa0, 0xa1]);
    await undoLast("a", false);
    expect(isAttachedTo(original)).toBe(true);

    await redoLast("a");

    expect(isAttachedTo(original)).toBe(false);
    expect(slot().saved).toBeUndefined();
    expect(slot().document.size).toBe(18);
    expect(await readAll()).toEqual([...range(0x10, 0x20), 0xa0, 0xa1]);
  });

  // Two joins in a row, then undo both: the document is byte-identical to the
  // file it came from, so it must be attached to that file again — and redoing
  // walks the attachment back out again, join by join.
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/BinaryDocumentJoinTests.swift#BinaryDocumentJoinTests.testUndoingTwoJoinsReattachesTheOriginalFile
  it("re-attaches the file after two joins are both undone", async () => {
    const original = file("dump.bin", [0x11, 0x22]);
    openInPane("a", original);
    await joinAtEnd([0xaa]);
    await joinAtEnd([0xbb]);
    // Each join detaches.
    expect(isAttachedTo(original)).toBe(false);

    await undoLast("a", false);
    // The first join is still in force.
    expect(isAttachedTo(original)).toBe(false);
    expect(await readAll()).toEqual([0x11, 0x22, 0xaa]);

    await undoLast("a", false);
    expect(await readAll()).toEqual([0x11, 0x22]);
    expect(isAttachedTo(original)).toBe(true);

    await redoLast("a");
    expect(isAttachedTo(original)).toBe(false);
    expect(await readAll()).toEqual([0x11, 0x22, 0xaa]);
    await redoLast("a");
    expect(isAttachedTo(original)).toBe(false);
    expect(await readAll()).toEqual([0x11, 0x22, 0xaa, 0xbb]);
  });
});
