import { describe, expect, it } from "vitest";
import type { EditableByteStorage } from "@/core/storage/byteStorage";
import { EditOverlayStorage } from "@/core/storage/editOverlayStorage";
import { MemoryBackedStorage } from "@/core/storage/memoryBackedStorage";
import { asArray, readAll, storageOver } from "@/core/testing/support";

/**
 * Ported from `EditableByteStorageContractTests.swift`.
 *
 * The `EditableByteStorage` contract, asserted once against every
 * implementation of it. `EditOverlayStorage` (a piece table over a file) and
 * `MemoryBackedStorage` (a plain buffer) must be indistinguishable through the
 * interface: the same fixture, the same operation, the same content and size
 * afterwards. Anything specific to one of them lives in its own test file.
 */

const implementations: { name: string; make: (bytes: number[]) => EditableByteStorage }[] = [
  {
    name: "EditOverlayStorage",
    make: (bytes) => new EditOverlayStorage(storageOver(new Uint8Array(bytes))),
  },
  { name: "MemoryBackedStorage", make: (bytes) => new MemoryBackedStorage(new Uint8Array(bytes)) },
];

interface Case {
  name: string;
  initial: number[];
  expected: number[];
  apply: (storage: EditableByteStorage) => Promise<void>;
}

/**
 * `size` is asserted from the same expectation as the content, so a storage
 * that reads right but counts wrong still fails.
 */
function check(group: string, cases: Case[]): void {
  describe(group, () => {
    for (const implementation of implementations) {
      for (const testCase of cases) {
        it(`${implementation.name}: ${testCase.name}`, async () => {
          const storage = implementation.make(testCase.initial);
          await testCase.apply(storage);
          expect(asArray(await readAll(storage))).toEqual(testCase.expected);
          expect(storage.size).toBe(testCase.expected.length);
        });
      }
    }
  });
}

check("overwrite", [
  {
    name: "in place, read back",
    initial: [0x00, 0x00, 0x00, 0x00],
    expected: [0x00, 0xaa, 0xbb, 0x00],
    apply: (s) => s.overwrite(1, new Uint8Array([0xaa, 0xbb])),
  },
  {
    name: "starting at EOF extends the file",
    initial: [0x00],
    expected: [0x00, 0x01, 0x02],
    apply: (s) => s.overwrite(1, new Uint8Array([0x01, 0x02])),
  },
  {
    // The gap a write past EOF leaves has always read as zeros.
    name: "far beyond EOF zero-fills the gap",
    initial: [0x01, 0x02],
    expected: [0x01, 0x02, 0x00, 0x00, 0x00, 0x99],
    apply: (s) => s.overwrite(5, new Uint8Array([0x99])),
  },
  {
    name: "empty bytes are a no-op",
    initial: [0x01, 0x02],
    expected: [0x01, 0x02],
    apply: (s) => s.overwrite(0, new Uint8Array()),
  },
]);

check("insert", [
  {
    name: "in the middle shifts the tail",
    initial: [0x01, 0x02, 0x03, 0x04],
    expected: [0x01, 0x02, 0xff, 0xfe, 0x03, 0x04],
    apply: (s) => s.insert(2, new Uint8Array([0xff, 0xfe])),
  },
  {
    name: "at EOF appends",
    initial: [0x01, 0x02],
    expected: [0x01, 0x02, 0x03],
    apply: (s) => s.insert(2, new Uint8Array([0x03])),
  },
  {
    name: "past EOF is clamped to EOF",
    initial: [0x01, 0x02],
    expected: [0x01, 0x02, 0x03],
    apply: (s) => s.insert(50, new Uint8Array([0x03])),
  },
]);

check("delete", [
  {
    name: "a middle range shrinks the file",
    initial: [0x00, 0x01, 0x02, 0x03, 0x04, 0x05],
    expected: [0x00, 0x01, 0x04, 0x05],
    apply: (s) => s.delete(2, 4),
  },
  {
    name: "an end past EOF is clamped",
    initial: [0x00, 0x01],
    expected: [0x00],
    apply: (s) => s.delete(1, 10),
  },
  {
    name: "everything leaves an empty file",
    initial: [0x01, 0x02, 0x03],
    expected: [],
    apply: (s) => s.delete(0, 3),
  },
  {
    name: "an empty range is a no-op",
    initial: [0x01, 0x02],
    expected: [0x01, 0x02],
    apply: (s) => s.delete(1, 1),
  },
]);

check("append", [
  {
    name: "onto content",
    initial: [0x01],
    expected: [0x01, 0x02, 0x03],
    apply: (s) => s.append(new Uint8Array([0x02, 0x03])),
  },
  {
    name: "onto an empty file",
    initial: [],
    expected: [0xde, 0xad],
    apply: (s) => s.append(new Uint8Array([0xde, 0xad])),
  },
]);

check("sequences of edits", [
  {
    name: "an untouched empty file reads empty",
    initial: [],
    expected: [],
    apply: async () => {},
  },
  {
    // Growing an empty file, then editing inside what was added.
    name: "empty: append then insert",
    initial: [],
    expected: [0xde, 0xbe, 0xad],
    apply: async (s) => {
      await s.append(new Uint8Array([0xde, 0xad]));
      await s.insert(1, new Uint8Array([0xbe]));
    },
  },
  {
    name: "empty: append, insert, delete",
    initial: [],
    expected: [0xbe, 0xad],
    apply: async (s) => {
      await s.append(new Uint8Array([0xde, 0xad]));
      await s.insert(1, new Uint8Array([0xbe]));
      await s.delete(0, 1);
    },
  },
  {
    // 99 01 02 77 78 03 04 05 06 07 → delete 5..8 (03 04 05) → +EE
    name: "overwrite, insert, delete, append",
    initial: [0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07],
    expected: [0x99, 0x01, 0x02, 0x77, 0x78, 0x06, 0x07, 0xee],
    apply: async (s) => {
      await s.overwrite(0, new Uint8Array([0x99]));
      await s.insert(3, new Uint8Array([0x77, 0x78]));
      await s.delete(5, 8);
      await s.append(new Uint8Array([0xee]));
    },
  },
]);

describe("reads clamp at EOF", () => {
  const reads: { name: string; at: number; length: number; expected: number[] }[] = [
    { name: "whole file", at: 0, length: 3, expected: [0x01, 0x02, 0x03] },
    { name: "length past EOF", at: 2, length: 100, expected: [0x03] },
    { name: "offset exactly at EOF", at: 3, length: 100, expected: [] },
    { name: "offset far past EOF", at: 50, length: 2, expected: [] },
    { name: "zero length", at: 1, length: 0, expected: [] },
  ];

  for (const implementation of implementations) {
    for (const read of reads) {
      it(`${implementation.name}: ${read.name}`, async () => {
        const storage = implementation.make([0x01, 0x02, 0x03]);
        expect(asArray(await storage.read(read.at, read.length))).toEqual(read.expected);
      });
    }
  }
});

describe("peek answers the same bytes as read, once they are resident", () => {
  // The renderer paints through `peek`; if the two could disagree, a scrolled
  // row would show something the document does not contain.
  for (const implementation of implementations) {
    it(implementation.name, async () => {
      const storage = implementation.make([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]);
      await storage.overwrite(1, new Uint8Array([0xaa]));
      await storage.insert(4, new Uint8Array([0xbb, 0xcc]));

      for (let at = 0; at < storage.size; at++) {
        for (const length of [1, 3, storage.size]) {
          await storage.prefetch(at, length);
          expect(asArray(storage.peek(at, length) ?? new Uint8Array(0))).toEqual(
            asArray(await storage.read(at, length))
          );
        }
      }
    });
  }
});
