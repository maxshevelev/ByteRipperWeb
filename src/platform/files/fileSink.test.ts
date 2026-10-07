import { afterEach, describe, expect, it } from "vitest";
import { ChunkCache } from "@/core/storage/chunkCache";
import { EditOverlayStorage } from "@/core/storage/editOverlayStorage";
import { FileBackedStorage } from "@/core/storage/fileBackedStorage";
import { MemoryBackedStorage } from "@/core/storage/memoryBackedStorage";
import { StorageError } from "@/core/storage/storageError";
import type { FileCapabilities } from "@/platform/files/capabilities";
import { save, saveAs } from "@/platform/files/fileSink";

/**
 * A file on a disk that exists only here, behind the handle the File System
 * Access API would give for it — with the one property every case below leans
 * on: a writable is a swap file, published over the file only when it closes
 * and thrown away when it aborts.
 */
class FakeFile {
  content: Uint8Array;
  aborted = 0;
  /** Makes the next write fail, as a full disk or a revoked permission would. */
  failWrites = false;

  readonly name: string;

  constructor(name: string, bytes: readonly number[]) {
    this.name = name;
    this.content = new Uint8Array(bytes);
  }

  /** What the browser hands out for it: a `File` that is a snapshot of the content now. */
  get handle(): FileSystemFileHandle {
    return {
      kind: "file",
      name: this.name,
      getFile: async () => new File([this.content.slice()], this.name),
      createWritable: async (options?: { keepExistingData?: boolean }) => {
        let swap = options?.keepExistingData === true ? this.content.slice() : new Uint8Array(0);
        let cursor = 0;
        const place = (at: number, data: Uint8Array) => {
          if (this.failWrites) throw new DOMException("The disk is full.", "QuotaExceededError");
          if (at + data.length > swap.length) {
            const grown = new Uint8Array(at + data.length);
            grown.set(swap);
            swap = grown;
          }
          swap.set(data, at);
          cursor = at + data.length;
        };
        return {
          write: async (
            chunk: Uint8Array | { type: "write"; position: number; data: Uint8Array }
          ) => {
            if (chunk instanceof Uint8Array) place(cursor, chunk);
            else place(chunk.position, new Uint8Array(chunk.data));
          },
          truncate: async (size: number) => {
            const cut = new Uint8Array(size);
            cut.set(swap.subarray(0, size));
            swap = cut;
          },
          close: async () => {
            this.content = swap;
          },
          abort: async () => {
            this.aborted++;
          },
        };
      },
    } as unknown as FileSystemFileHandle;
  }

  get bytes(): number[] {
    return [...this.content];
  }
}

const chromium: FileCapabilities = {
  canSaveInPlace: true,
  canWriteDroppedFiles: true,
  canPickDirectory: true,
};

/** A document over `file`, the way the app opens one: an overlay on its bytes. */
async function editable(file: FakeFile): Promise<EditOverlayStorage> {
  return new EditOverlayStorage(
    new FileBackedStorage(await file.handle.getFile(), new ChunkCache())
  );
}

/** Saves `storage` back over `file`, asking what the app's own Save asks. */
function saveOver(storage: EditOverlayStorage, file: FakeFile) {
  return save({
    storage,
    name: file.name,
    handle: file.handle,
    capabilities: chromium,
    baseSize: storage.baseSize,
    changedRanges: storage.canPatchInPlace ? storage.changedRanges : undefined,
  });
}

/**
 * Writing a document back out: patched in place where only overwrites stand,
 * rewritten whole otherwise, and never leaving the file half-written.
 *
 * @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/StorageSaverTests.swift#StorageSaverTests
 * @upstream-differs the writes go through a File System Access writable, which is a swap file the browser publishes on close; the fake file stands in for the disk
 */
describe("saving a document", () => {
  afterEach(() => {
    delete (globalThis as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/StorageSaverTests.swift#StorageSaverTests.testPatchInPlaceExtendsFileAtEOF
  it("patches in place, growing the file at its end", async () => {
    const file = new FakeFile("dump.bin", [0x01, 0x02]);
    const storage = await editable(file);
    await storage.append(new Uint8Array([0x03, 0x04, 0x05]));
    expect(storage.canPatchInPlace).toBe(true);

    await saveOver(storage, file);

    expect(file.bytes).toEqual([0x01, 0x02, 0x03, 0x04, 0x05]);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/StorageSaverTests.swift#StorageSaverTests.testPatchInPlaceMultipleRanges
  it("patches several ranges in place", async () => {
    const file = new FakeFile("dump.bin", [0, 0, 0, 0, 0, 0]);
    const storage = await editable(file);
    await storage.overwrite(0, new Uint8Array([0x11]));
    await storage.overwrite(4, new Uint8Array([0x44]));
    await storage.append(new Uint8Array([0x99]));

    await saveOver(storage, file);

    expect(file.bytes).toEqual([0x11, 0x00, 0x00, 0x00, 0x44, 0x00, 0x99]);
  });

  // Once an edit has shifted an offset the file cannot be patched in place, so
  // saving rewrites it whole — and the rewritten file must hold the overlay's
  // current content, overwrites included.
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/StorageSaverTests.swift#StorageSaverTests.testRewriteAfterALengthChange
  it.each([
    {
      name: "after an insert",
      initial: [0x00, 0x01, 0x02, 0x03],
      edit: (s: EditOverlayStorage) => s.insert(2, new Uint8Array([0xff])),
      expected: [0x00, 0x01, 0xff, 0x02, 0x03],
    },
    {
      name: "after a delete",
      initial: [0x00, 0x01, 0x02, 0x03, 0x04],
      edit: (s: EditOverlayStorage) => s.delete(1, 3),
      expected: [0x00, 0x03, 0x04],
    },
    {
      name: "an overwrite made before the insert survives the rewrite",
      initial: [0x00, 0x01, 0x02, 0x03],
      edit: async (s: EditOverlayStorage) => {
        await s.overwrite(0, new Uint8Array([0x99]));
        await s.insert(4, new Uint8Array([0xee]));
      },
      expected: [0x99, 0x01, 0x02, 0x03, 0xee],
    },
  ])("rewrites the file whole $name", async ({ initial, edit, expected }) => {
    const file = new FakeFile("dump.bin", initial);
    const storage = await editable(file);
    await edit(storage);
    // The edit shifted an offset.
    expect(storage.canPatchInPlace).toBe(false);

    await saveOver(storage, file);

    expect(file.bytes).toEqual(expected);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/StorageSaverTests.swift#StorageSaverTests.testSavingCleanStorageIsNoop
  // @upstream-differs a clean document is written out whole rather than skipped: the swap file publishes the same bytes, and the app offers no Save for a clean document
  it("leaves the file as it was when nothing changed", async () => {
    const file = new FakeFile("dump.bin", [0x01]);
    const storage = await editable(file);

    await saveOver(storage, file);

    expect(file.bytes).toEqual([0x01]);
  });

  // Save As: the target is not the file the base reads from, so the content is
  // always written whole — from a file-backed base, from an untitled (in-memory)
  // one, and from an untitled one nothing was typed into.
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/StorageSaverTests.swift#StorageSaverTests.testSaveToANewLocation
  it.each([
    {
      name: "from a file-backed base",
      make: async () => {
        const storage = await editable(new FakeFile("dump.bin", [0x00, 0x01]));
        await storage.append(new Uint8Array([0x02, 0x03]));
        return storage;
      },
      expected: [0x00, 0x01, 0x02, 0x03],
    },
    {
      name: "from an untitled document",
      make: async () => {
        const storage = new EditOverlayStorage(new MemoryBackedStorage());
        await storage.append(new Uint8Array([0xab, 0xcd]));
        return storage;
      },
      expected: [0xab, 0xcd],
    },
    {
      name: "from an untitled document nothing was typed into",
      make: async () => new EditOverlayStorage(new MemoryBackedStorage()),
      expected: [],
    },
  ])("writes the content whole to a new file $name", async ({ make, expected }) => {
    const storage = await make();
    // The file the picker chose already held something, which must not survive.
    const target = new FakeFile("copy.bin", [0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8]);
    (globalThis as { showSaveFilePicker?: unknown }).showSaveFilePicker = async () => target.handle;

    const outcome = await saveAs({
      storage,
      name: "copy.bin",
      capabilities: chromium,
      changedRanges: storage.canPatchInPlace ? storage.changedRanges : undefined,
    });

    expect(outcome.kind).toBe("savedAs");
    expect(target.bytes).toEqual(expected);
  });

  // The case the direct write got wrong upstream: a plain Save of a
  // length-changing edit, where the file being written is the file the overlay
  // still reads its base from. The swap file is what keeps the base readable
  // until the new content is complete.
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/StorageSaverTests.swift#StorageSaverTests.testAPlainSaveThroughTheDirectWritePathKeepsTheContent
  it("keeps the content when the file written is the one the base reads", async () => {
    const file = new FakeFile("dump.bin", [0x01, 0x02, 0x03]);
    const storage = await editable(file);
    await storage.insert(1, new Uint8Array([0xff]));
    expect(storage.canPatchInPlace).toBe(false);

    await saveOver(storage, file);

    expect(file.bytes).toEqual([0x01, 0xff, 0x02, 0x03]);
  });

  // Writing content shorter than what the chosen file already held cannot leave
  // the tail of the older version behind, or the saved file ends in bytes from
  // a stranger.
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/StorageSaverTests.swift#StorageSaverTests.testTheDirectWriteLeavesNoTailOfWhatTheFileHeldBefore
  it("leaves no tail of what the file held before", async () => {
    const storage = await editable(new FakeFile("dump.bin", [0x01, 0x02, 0x03, 0x04, 0x05, 0x06]));
    await storage.delete(1, 5);
    const target = new FakeFile("copy.bin", [0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8]);
    (globalThis as { showSaveFilePicker?: unknown }).showSaveFilePicker = async () => target.handle;

    await saveAs({ storage, name: "copy.bin", capabilities: chromium });

    expect(target.bytes).toEqual([0x01, 0x06]);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/StorageSaverTests.swift#StorageSaverTests.testSaveFailureThrowsAndLeavesOriginalIntact
  it("throws on a failed save and leaves the file intact", async () => {
    const file = new FakeFile("dump.bin", [0x01]);
    const storage = await editable(file);
    await storage.overwrite(0, new Uint8Array([0xaa]));
    file.failWrites = true;

    await expect(saveOver(storage, file)).rejects.toThrow("full");

    expect(file.bytes).toEqual([0x01]);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/StorageSaverTests.swift#StorageSaverTests.testRewriteFailureLeavesNoTempLitter
  // @upstream-differs the swap file is the browser's: what is asserted is that a failed rewrite aborts it, which is what discards it
  it("discards the swap file of a failed rewrite", async () => {
    const file = new FakeFile("dump.bin", [0x01, 0x02]);
    const storage = await editable(file);
    await storage.insert(1, new Uint8Array([0x99]));
    file.failWrites = true;

    await expect(saveOver(storage, file)).rejects.toThrow();

    expect(file.aborted).toBe(1);
    expect(file.bytes).toEqual([0x01, 0x02]);
  });

  // Another program truncates the file the document was opened from. The overlay
  // reads the missing bytes as zeros so the offsets after them stay where they
  // are — right for the view, catastrophic for a save: the zeros would go into
  // the user's file and the save would report success. It must refuse, and leave
  // the file as the truncation left it.
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/StorageSaverTests.swift#StorageSaverTests.testASaveIsRefusedWhenTheBaseFileHasShrunk
  it("refuses to save over a file that has shrunk", async () => {
    const file = new FakeFile("dump.bin", new Array(4096).fill(0xab));
    const storage = await editable(file);
    await storage.overwrite(0, new Uint8Array([0x01]));

    // The file loses everything but its first byte.
    file.content = new Uint8Array([0xab]);

    const refusal = await saveOver(storage, file).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(StorageError);
    expect((refusal as StorageError).code).toBe("fileChanged");
    expect(file.bytes).toEqual([0xab]);
  });
});
