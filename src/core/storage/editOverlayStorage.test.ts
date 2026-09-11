import { describe, expect, it } from "vitest";
import type { ByteSource } from "@/core/storage/byteStorage";
import { EditOverlayStorage } from "@/core/storage/editOverlayStorage";
import { FileBackedStorage } from "@/core/storage/fileBackedStorage";
import { MemoryByteSource } from "@/core/storage/memoryByteSource";
import {
  asArray,
  countingBytes,
  RecordingScratchStore,
  readAll,
  SeededRandom,
  storageOver,
} from "@/core/testing/support";

/**
 * Ported from `EditOverlayStorageTests.swift` and
 * `EditOverlayStorageCostTests.swift`.
 *
 * What is specific to the overlay. The `EditableByteStorage` contract it shares
 * with `MemoryBackedStorage` is in `editableByteStorage.contract.test.ts`.
 */

const overlayOver = (bytes: Uint8Array | number[], scratch?: RecordingScratchStore) =>
  new EditOverlayStorage(
    storageOver(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)),
    scratch === undefined ? {} : { scratch }
  );

const rangeStrings = (storage: EditOverlayStorage) =>
  storage.changedRanges.map((range) => `${range.start}-${range.end}`);

describe("what saving is allowed to do", () => {
  it("may patch in place until an edit shifts an offset", async () => {
    const overwritten = overlayOver([0x00, 0x00, 0x00, 0x00]);
    expect(overwritten.isDirty).toBe(false); // an untouched overlay holds no edit
    await overwritten.overwrite(1, new Uint8Array([0xaa, 0xbb]));
    expect(overwritten.canPatchInPlace).toBe(true); // an overwrite moves no byte
    expect(overwritten.isDirty).toBe(true);

    const appended = overlayOver([0x00, 0x00, 0x00]);
    await appended.append(new Uint8Array([0x01]));
    await appended.overwrite(0, new Uint8Array([0xff]));
    expect(appended.canPatchInPlace).toBe(true); // an append moves no existing byte

    const inserted = overlayOver([0x01, 0x02, 0x03, 0x04]);
    await inserted.insert(2, new Uint8Array([0xff, 0xfe]));
    expect(inserted.canPatchInPlace).toBe(false); // an insert shifts the tail

    const deleted = overlayOver([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]);
    await deleted.delete(2, 4);
    expect(deleted.canPatchInPlace).toBe(false); // a delete shifts the tail
  });
});

describe("reading through the overlay", () => {
  it("overwrites at the current offsets, not the base's", async () => {
    const storage = overlayOver([0x00, 0x01, 0x02, 0x03]);
    await storage.insert(2, new Uint8Array([0xff]));
    await storage.overwrite(0, new Uint8Array([0x99]));
    expect(asArray(await readAll(storage))).toEqual([0x99, 0x01, 0xff, 0x02, 0x03]);
  });

  it("merges overlay and base in one window", async () => {
    const storage = overlayOver([0x00, 0x00, 0x00, 0x00, 0x00]);
    await storage.overwrite(1, new Uint8Array([0xee]));
    await storage.append(new Uint8Array([0xff]));
    // Overlay has [1,2)=EE and [5,6)=FF; a window spanning both must merge.
    expect(asArray(await storage.read(0, 6))).toEqual([0x00, 0xee, 0x00, 0x00, 0x00, 0xff]);
  });
});

describe("what counts as changed", () => {
  it("marks the whole tail after a shift", async () => {
    // One shifted byte marks everything from the insert or delete point to EOF:
    // nothing there holds the content the file held at that offset any more.
    // This is the rule the minimap paints, and the reason a single inserted
    // byte reddens everything after it.
    const inserted = overlayOver(new Uint8Array(100));
    await inserted.insert(10, new Uint8Array([0xff]));
    expect(inserted.size).toBe(101);
    expect(rangeStrings(inserted)).toEqual(["10-101"]);

    const deleted = overlayOver(new Uint8Array(100));
    await deleted.delete(40, 45);
    expect(deleted.size).toBe(95);
    expect(rangeStrings(deleted)).toEqual(["40-95"]);

    // A delete that reaches EOF leaves no tail to mark at all.
    const truncated = overlayOver(new Uint8Array(100));
    await truncated.delete(90, 100);
    expect(truncated.changedRanges).toEqual([]);
  });
});

describe("a base that changes underneath", () => {
  it("pads a truncated base instead of shifting the offsets after it", async () => {
    // The base is immutable by contract, so a short read means the file was
    // truncated behind the overlay's back. The missing bytes read as zeros
    // rather than sliding the bytes after them left — an offset must never
    // change meaning because someone else shortened the file.
    const full = countingBytes(100);
    let visible = 100;
    const shrinking: ByteSource = {
      size: 100,
      slice: (start, end) => new MemoryByteSource(full.subarray(0, visible)).slice(start, end),
    };
    const storage = new EditOverlayStorage(new FileBackedStorage(shrinking));

    visible = 40; // the file on disk is shorter now
    expect(storage.size).toBe(100); // the overlay still describes the file as opened

    // A window straddling the truncation point: the bytes that survive, then
    // zeros where the file ended, each still at its own offset.
    expect(asArray(await storage.read(35, 10))).toEqual([35, 36, 37, 38, 39, 0, 0, 0, 0, 0]);
    // And a window entirely past it is all zeros, not empty.
    expect(asArray(await storage.read(90, 4))).toEqual([0, 0, 0, 0]);
  });
});

describe("what the piece table exists for", () => {
  // These pin the properties, not the timings — but the properties are what
  // make the timings possible, and they are what a future change could lose.

  it("copies nothing for a typed run, and stays compact", async () => {
    const scratch = new RecordingScratchStore();
    const storage = overlayOver(new Uint8Array(200_000).fill(0xff), scratch);

    for (let i = 0; i < 100; i++) await storage.insert(1000 + i, new Uint8Array([i]));

    expect(storage.size).toBe(200_100);
    expect(scratch.writeCount).toBe(0); // no edit materialised a copy of the file
    expect(storage.pieceCount).toBe(3); // the run coalesced into one piece

    expect(asArray(await storage.read(998, 6))).toEqual([0xff, 0xff, 0, 1, 2, 3]);
    expect(asArray(await storage.read(1100, 2))).toEqual([0xff, 0xff]);
  });

  it("copies nothing for a delete either", async () => {
    const scratch = new RecordingScratchStore();
    const storage = overlayOver(countingBytes(100), scratch);

    for (let i = 0; i < 20; i++) await storage.delete(10, 11);

    expect(storage.size).toBe(80);
    expect(asArray(await storage.read(8, 4))).toEqual([8, 9, 30, 31]);
    expect(scratch.writeCount).toBe(0);
  });
});

describe("the materialisation valve", () => {
  const withBudgets = (
    bytes: Uint8Array,
    scratch: RecordingScratchStore,
    budgets: { maxInlineInsert?: number; maxAddedBytes?: number; maxPieces?: number }
  ) => new EditOverlayStorage(storageOver(bytes), { scratch, budgets });

  it("folds an oversized insert once and keeps one copy", async () => {
    const scratch = new RecordingScratchStore();
    const storage = withBudgets(new Uint8Array(4096).fill(0x11), scratch, {
      maxInlineInsert: 1024,
    });

    await storage.insert(100, new Uint8Array(2048).fill(0x22));
    expect(storage.pieceCount).toBe(1); // the table collapsed into one base piece
    expect(scratch.liveCount).toBe(1);

    await storage.insert(200, new Uint8Array(2048).fill(0x33));
    expect(scratch.liveCount).toBe(1); // the previous copy is not kept

    expect(storage.size).toBe(4096 + 4096);
    expect(asArray(await storage.read(199, 3))).toEqual([0x22, 0x33, 0x33]);
  });

  it("folds the add buffer into the base when it grows too large", async () => {
    const scratch = new RecordingScratchStore();
    const storage = withBudgets(new Uint8Array(1000).fill(0xff), scratch, { maxAddedBytes: 4096 });

    for (let i = 0; i < 6000; i++) await storage.insert(i, new Uint8Array([0xab]));

    expect(storage.size).toBe(7000);
    expect(scratch.writeCount).toBeGreaterThanOrEqual(1); // the buffer was folded in
    expect(scratch.liveCount).toBe(1); // and only the latest fold is kept
    expect(asArray(await storage.read(0, 4))).toEqual([0xab, 0xab, 0xab, 0xab]);
    expect(asArray(await storage.read(6999, 1))).toEqual([0xff]);
  });

  it("collapses a scattered edit pattern on the piece budget", async () => {
    // A scattered pattern collapses once the list gets long, so reads never
    // walk thousands of pieces.
    const scratch = new RecordingScratchStore();
    const storage = withBudgets(new Uint8Array(10_000).fill(0xff), scratch, { maxPieces: 50 });

    // Insert at descending offsets, so no two inserts continue one another.
    for (let i = 9000; i > 0; i -= 100) await storage.insert(i, new Uint8Array([0xee]));

    expect(storage.pieceCount).toBeLessThanOrEqual(51);
    expect(storage.size).toBe(10_090);
  });

  it("keeps changed ranges across a fold", async () => {
    // Otherwise saving after a long overwrite-only session would write nothing.
    const scratch = new RecordingScratchStore();
    const storage = withBudgets(new Uint8Array(100), scratch, { maxAddedBytes: 8 });

    await storage.overwrite(10, new Uint8Array([1, 2, 3, 4]));
    await storage.overwrite(50, new Uint8Array([5, 6, 7, 8, 9, 10])); // trips the fold

    expect(storage.canPatchInPlace).toBe(true); // overwrites never shift offsets
    expect(rangeStrings(storage)).toEqual(["10-14", "50-56"]);
    expect(storage.isDirty).toBe(true);
    expect(asArray(await storage.read(10, 4))).toEqual([1, 2, 3, 4]);
    expect(asArray(await storage.read(50, 6))).toEqual([5, 6, 7, 8, 9, 10]);
  });

  it("does nothing at all when no scratch store was supplied", async () => {
    // The browser divergence, stated as a test: without somewhere to write, the
    // valve is simply absent. The content must still be right — only the piece
    // list grows.
    const storage = new EditOverlayStorage(storageOver(new Uint8Array(1000).fill(0xff)), {
      budgets: { maxPieces: 4 },
    });
    for (let i = 900; i > 0; i -= 100) await storage.insert(i, new Uint8Array([0xee]));

    expect(storage.pieceCount).toBeGreaterThan(4);
    expect(storage.size).toBe(1009);
    expect(asArray(await storage.read(99, 3))).toEqual([0xff, 0xee, 0xff]);
  });
});

describe("against a plain array", () => {
  it("matches over a random edit sequence", async () => {
    // The piece table's arithmetic has many boundary cases, and this is the
    // cheapest way to be sure none of them drifts.
    const seed = 0x0ddc0ffe;
    for (let round = 0; round < 20; round++) {
      const random = new SeededRandom(seed + round);
      const context = `seed ${seed.toString(16)} round ${round}`;
      const model = Array.from({ length: 200 }, (_, i) => i % 251);
      const storage = overlayOver(new Uint8Array(model));

      for (let step = 0; step < 40; step++) {
        const size = model.length;
        switch (random.int(0, 3)) {
          case 0: {
            const at = random.int(0, size + 1);
            const bytes = Array.from(random.bytes(random.int(1, 6)));
            await storage.insert(at, new Uint8Array(bytes));
            model.splice(at, 0, ...bytes);
            break;
          }
          case 1: {
            if (size === 0) break;
            const lower = random.int(0, size);
            const upper = Math.min(size, lower + random.int(1, 7));
            await storage.delete(lower, upper);
            model.splice(lower, upper - lower);
            break;
          }
          default: {
            if (size === 0) break;
            const at = random.int(0, size);
            const bytes = Array.from(random.bytes(random.int(1, 6)));
            await storage.overwrite(at, new Uint8Array(bytes));
            for (let i = 0; i < bytes.length; i++) {
              const byte = bytes[i] ?? 0;
              if (at + i < model.length) model[at + i] = byte;
              else model.push(byte);
            }
            break;
          }
        }

        expect(storage.size, context).toBe(model.length);
        expect(asArray(await storage.read(0, model.length)), context).toEqual(model);
      }

      // And window reads agree with the whole-file read.
      const whole = asArray(await storage.read(0, model.length));
      for (let start = 0; start < model.length; start += 7) {
        const length = Math.min(11, model.length - start);
        expect(asArray(await storage.read(start, length)), context).toEqual(
          whole.slice(start, start + length)
        );
      }
    }
  });
});
