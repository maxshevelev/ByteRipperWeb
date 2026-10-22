import { describe, expect, it } from "vitest";
import { BinaryDocument } from "@/core/document/binaryDocument";
import { MemoryJournalStore } from "@/core/edit/undoJournal";
import { EditOverlayStorage } from "@/core/storage/editOverlayStorage";
import { asArray, readAll, storageOver } from "@/core/testing/support";
import type { KeptFile, KeptFolder } from "@/core/workspace/keptFolder";
import {
  type KeptContent,
  type PaneState,
  WORKSPACE_VERSION,
  type Workspace,
} from "@/core/workspace/workspace";
import { ContentKeeper, type KeptPane } from "@/state/workspace/contentKeeper";

/**
 * The content a workspace keeps of its documents — a base and the log of their history — written
 * behind the snapshots, read back, and put back into a fresh document that undoes and redoes as
 * the one it was taken from (`Design/PORT_WINDOW_07A3928_21A2889.md`, P6).
 *
 * @upstream ByteRipperTests/WorkspaceRestoreTests.swift#WorkspaceRestoreTests
 */

/** A `Kept/` held in memory, as the shell's and the private file system's are held on disk. */
function memoryFolder(): KeptFolder & { readonly names: () => string[] } {
  const files = new Map<string, MemoryJournalStore & { length: number }>();
  const fileOf = (name: string) => {
    let store = files.get(name);
    if (store === undefined) {
      const memory = new MemoryJournalStore() as MemoryJournalStore & { length: number };
      memory.length = 0;
      const write = memory.write.bind(memory);
      memory.write = async (at, bytes) => {
        await write(at, bytes);
        memory.length = Math.max(memory.length, at + bytes.length);
      };
      store = memory;
      files.set(name, store);
    }
    return store;
  };
  return {
    id: "memory",
    names: () => [...files.keys()].sort(),
    file: (name): KeptFile => {
      const store = () => fileOf(name);
      return {
        write: (at, bytes) => store().write(at, bytes),
        read: (at, count) => store().read(at, count),
        truncate: async (length) => {
          store().length = Math.min(store().length, length);
        },
        synchronize: async () => undefined,
        size: async () => (files.has(name) ? store().length : undefined),
        close: () => undefined,
      };
    },
    removeExcept: async (names) => {
      for (const name of [...files.keys()]) if (!names.has(name)) files.delete(name);
    },
  };
}

const documentOf = (bytes: number[]) =>
  new BinaryDocument(new EditOverlayStorage(storageOver(new Uint8Array(bytes))));

const content = async (doc: BinaryDocument) => asArray(await readAll(doc.storage));

const paneOf = (document: BinaryDocument, isUntitled: boolean): KeptPane => ({
  document,
  isUntitled,
  exportKeptEdits: () => (document.storage as EditOverlayStorage).exportEdits(),
  joins: () => ({ undo: [], redo: [] }),
});

/** A workspace of one pane holding `kept`, as the recorder would write it. */
const workspaceOf = (kept: KeptContent, untitled: boolean): Workspace => {
  const pane: PaneState = {
    document: untitled
      ? { kind: "untitled", untitled: { content: kept, size: 0, dirty: true } }
      : { kind: "file", file: { name: "bios.bin", size: 32, modified: 0 } },
    ...(untitled ? {} : { kept }),
    selectionStart: 0,
    selectionEnd: 0,
    inputRegion: "hex",
    insertMode: false,
    topOffset: 0,
  };
  return {
    version: WORKSPACE_VERSION,
    tab: {
      panes: [pane, undefined],
      activePane: 0,
      surface: { minimapVisible: false },
      fragments: [],
    },
  };
};

/** Snapshots `pane` through `keeper` and answers the kept content as the record names it. */
async function snapshot(keeper: ContentKeeper, pane: KeptPane): Promise<KeptContent> {
  keeper.beginSnapshot();
  const kept = await keeper.keep(pane);
  if (kept === undefined) throw new Error("nothing kept");
  let written: Workspace | undefined;
  await keeper.commit(workspaceOf(kept, pane.isUntitled), async (filled) => {
    written = filled;
  });
  const pane0 = written?.tab.panes[0];
  const filled =
    pane0?.document.kind === "untitled" ? pane0.document.untitled.content : pane0?.kept;
  if (filled === undefined) throw new Error("nothing written");
  return filled;
}

describe("the content a workspace keeps", () => {
  // @upstream ByteRipperTests/WorkspaceRestoreTests.swift#WorkspaceRestoreTests.testAnUntitledDocumentComesBackFromItsBaseAndLog
  // @upstream ByteRipperTests/WorkspaceRestoreTests.swift#WorkspaceRestoreTests.testOnlyWhatChangedIsWritten
  // @upstream ByteRipperTests/WorkspaceRestoreTests.swift#WorkspaceRestoreTests.testAnUntitledDocumentsUndoAndRedoComeBack
  it("brings an untitled document back with its history, appended to from snapshot to snapshot", async () => {
    const folder = memoryFolder();
    const keeper = new ContentKeeper(folder);
    const doc = documentOf([0, 0, 0, 0, 0, 0, 0, 0]);
    const pane = paneOf(doc, true);
    await doc.overwrite(0, new Uint8Array([1, 1]));
    const first = await snapshot(keeper, pane);
    expect(first.base.kind).toBe("bytes");
    expect(first.log?.length).toBeGreaterThan(0);
    await doc.insert(4, new Uint8Array([7]));
    const second = await snapshot(keeper, pane);
    expect(second.base, "the base stays; the log grows").toEqual(first.base);
    expect(second.log?.file).toBe(first.log?.file);
    expect(second.log?.length).toBeGreaterThan(first.log?.length ?? 0);

    // A relaunch: a keeper of its own over the same folder, and a document of the bytes read back.
    const after = new ContentKeeper(folder);
    const bytes = await after.bytesOf(second);
    expect(asArray(bytes)).toEqual(await content(doc));
    const copy = documentOf(asArray(bytes));
    await after.adopt(copy, second, "Untitled", true);
    expect(copy.canUndo).toBe(true);
    await copy.undo();
    await copy.undo();
    expect(await content(copy)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    await copy.redo();
    await copy.redo();
    expect(await content(copy)).toEqual(await content(doc));
  });

  // @upstream ByteRipperTests/WorkspaceRestoreTests.swift#WorkspaceRestoreTests.testAFilesHistoryKnowsItsSavedState
  it("lays a file's unsaved changes and their history over the file opened again", async () => {
    const folder = memoryFolder();
    const keeper = new ContentKeeper(folder);
    const file = Array.from({ length: 32 }, (_, index) => index);
    const doc = documentOf(file);
    const pane = paneOf(doc, false);
    await doc.overwrite(2, new Uint8Array([9, 9]));
    await doc.delete(10, 12);
    const kept = await snapshot(keeper, pane);
    expect(kept.base, "the file itself: the log leads from its saved state").toEqual({
      kind: "file",
      serial: kept.history?.savedState,
    });

    const after = new ContentKeeper(folder);
    const reopened = documentOf(file);
    await after.apply(kept, reopened.storage as EditOverlayStorage);
    await after.adopt(reopened, kept, "bios.bin", true);
    expect(await content(reopened)).toEqual(await content(doc));
    expect(reopened.isDirty).toBe(true);
    await reopened.undo();
    await reopened.undo();
    expect(await content(reopened)).toEqual(file);
    expect(reopened.isDirty, "back on the saved state").toBe(false);
  });

  // @upstream ByteRipperTests/WorkspaceRestoreTests.swift#WorkspaceRestoreTests.testADamagedLogIsReportedNotApplied
  it("refuses a damaged log, leaving the file as it is", async () => {
    const folder = memoryFolder();
    const keeper = new ContentKeeper(folder);
    const file = Array.from({ length: 16 }, (_, index) => index);
    const doc = documentOf(file);
    await doc.overwrite(0, new Uint8Array([5, 5, 5]));
    const kept = await snapshot(keeper, paneOf(doc, false));
    const log = kept.log;
    if (log === undefined) throw new Error("no log");
    const store = folder.file(log.file);
    const middle = Math.floor(log.length / 2);
    const byte = (await store.read(middle, 1))[0] as number;
    await store.write(middle, Uint8Array.of(byte ^ 0xff));

    const reopened = documentOf(file);
    await expect(
      new ContentKeeper(folder).apply(kept, reopened.storage as EditOverlayStorage)
    ).rejects.toThrow();
    expect(await content(reopened)).toEqual(file);
  });

  it("removes what no written workspace names: a log begun anew leaves the old one behind", async () => {
    const folder = memoryFolder();
    const keeper = new ContentKeeper(folder);
    const doc = documentOf([0, 0, 0, 0]);
    const pane = paneOf(doc, true);
    await doc.overwrite(0, new Uint8Array([1]));
    const first = await snapshot(keeper, pane);
    // Emptied: the content jumps with no transaction to say how, and is written whole again.
    doc.undoHistory.clearKeepingDirty();
    await doc.overwrite(1, new Uint8Array([2]));
    const second = await snapshot(keeper, pane);
    expect(second.base).not.toEqual(first.base);
    const named = new Set(
      [second.base, second.log].flatMap((one) =>
        one === undefined || !("file" in one) ? [] : [one.file]
      )
    );
    expect(folder.names()).toEqual([...named].sort());
  });

  it("keeps nothing of a clean file", async () => {
    const keeper = new ContentKeeper(memoryFolder());
    keeper.beginSnapshot();
    expect(await keeper.keep(paneOf(documentOf([1, 2, 3]), false))).toBeUndefined();
  });

  it("holds the current bytes once a snapshot is written, and not after an edit", async () => {
    const keeper = new ContentKeeper(memoryFolder());
    const doc = documentOf([0, 0, 0, 0]);
    await doc.overwrite(0, new Uint8Array([1]));
    await snapshot(keeper, paneOf(doc, true));
    expect(keeper.holdsCurrentBytes(doc)).toBe(true);
    await doc.overwrite(1, new Uint8Array([1]));
    expect(keeper.holdsCurrentBytes(doc)).toBe(false);
  });
});
