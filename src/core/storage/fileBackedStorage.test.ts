import { describe, expect, it } from "vitest";
import type { ByteSource } from "@/core/storage/byteStorage";
import { ChunkCache } from "@/core/storage/chunkCache";
import { FileBackedStorage } from "@/core/storage/fileBackedStorage";
import { MemoryByteSource } from "@/core/storage/memoryByteSource";
import { StorageError } from "@/core/storage/storageError";
import { asArray, countingBytes, storageOver } from "@/core/testing/support";

/** Ported from `FileBackedStorageTests.swift`. */

describe("reads are clamped to EOF", () => {
  const cases: {
    name: string;
    file: number[];
    at: number;
    length: number;
    expected: number[];
  }[] = [
    {
      name: "the whole file, asking for more than it holds",
      file: [0x01, 0x02, 0x03, 0x04, 0x05],
      at: 0,
      length: 10,
      expected: [0x01, 0x02, 0x03, 0x04, 0x05],
    },
    {
      name: "from the middle, past the end",
      file: [0xaa, 0xbb, 0xcc],
      at: 1,
      length: 5,
      expected: [0xbb, 0xcc],
    },
    { name: "the last byte", file: [0xaa, 0xbb, 0xcc], at: 2, length: 3, expected: [0xcc] },
    { name: "an offset exactly at EOF", file: [0xaa, 0xbb, 0xcc], at: 3, length: 1, expected: [] },
    { name: "an offset far past EOF", file: [0xaa, 0xbb, 0xcc], at: 100, length: 4, expected: [] },
    { name: "an empty file", file: [], at: 0, length: 10, expected: [] },
    { name: "a zero-length read", file: [0x01], at: 0, length: 0, expected: [] },
  ];

  for (const testCase of cases) {
    it(testCase.name, async () => {
      const storage = storageOver(new Uint8Array(testCase.file));
      expect(storage.size).toBe(testCase.file.length);
      expect(asArray(await storage.read(testCase.at, testCase.length))).toEqual(testCase.expected);
    });
  }
});

describe("FileBackedStorage", () => {
  it("reads across chunk boundaries", async () => {
    const data = countingBytes(50);
    const storage = storageOver(data, { chunkSize: 4, byteBudget: 1024 });

    expect(asArray(await storage.read(0, 50))).toEqual(asArray(data));
    expect(asArray(await storage.read(3, 10))).toEqual(asArray(data.subarray(3, 13)));
    expect(asArray(await storage.read(49, 5))).toEqual([49]);
    expect(asArray(await storage.read(15, 1))).toEqual([15]);
  });

  it("preserves content across repeated overlapping reads", async () => {
    const data = countingBytes(1000);
    // A budget of two chunks against a file of sixteen: every window evicts
    // something, so this is the eviction path as much as the read path.
    const storage = storageOver(data, { chunkSize: 64, byteBudget: 128 });

    for (let start = 0; start < 1000; start += 13) {
      const read = await storage.read(start, 40);
      expect(asArray(read)).toEqual(asArray(data.subarray(start, Math.min(start + 40, 1000))));
    }
  });

  it("reads a 1 GB file at arbitrary offsets with a bounded working set", async () => {
    // Upstream makes a sparse file; a browser has no such thing, so the source
    // here answers slices of a gigabyte it never materialises. What is being
    // checked is the same: the offsets come out right and the cache stays far
    // below the file size (§13, and M1's definition of done).
    const size = 1 << 30;
    const sparse: ByteSource = {
      size,
      slice: (start, end) => ({
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(Math.max(0, end - start))),
      }),
    };
    const cache = new ChunkCache({ chunkSize: 64 * 1024, byteBudget: 1024 * 1024 });
    const storage = new FileBackedStorage(sparse, cache);
    expect(storage.size).toBe(size);

    for (const at of [0, 64 * 1024 - 1, 64 * 1024, 1_000_000, size - 1]) {
      const read = await storage.read(at, 8);
      expect(asArray(read)).toEqual(asArray(new Uint8Array(read.length)));
    }
    expect(cache.cachedByteCount).toBeLessThanOrEqual(1024 * 1024);
  });

  it("reads a chunk once however many readers want it at once", async () => {
    // The asynchronous divergence, tested: upstream's lock made this impossible,
    // and here nothing serialises the awaits. A viewport scrolling into a cold
    // region must not fetch one chunk five times.
    let slices = 0;
    const counted: ByteSource = {
      size: 4096,
      slice: (start, end) => {
        slices++;
        return { arrayBuffer: () => Promise.resolve(new ArrayBuffer(end - start)) };
      },
    };
    const storage = new FileBackedStorage(counted, new ChunkCache({ chunkSize: 4096 }));

    await Promise.all([
      storage.read(0, 16),
      storage.read(16, 16),
      storage.read(100, 16),
      storage.prefetch(0, 4096),
    ]);
    expect(slices).toBe(1);
  });

  it("turns a stale file into the error the interface can explain", async () => {
    // A `File` goes stale when the file changes underneath it, and the browser
    // says so with NotReadableError. Reporting that as a generic failure is how
    // a user ends up staring at empty rows (ANALYSIS.md § File access).
    const changed: ByteSource = {
      size: 64,
      slice: () => ({
        arrayBuffer: () =>
          Promise.reject(Object.assign(new Error("gone"), { name: "NotReadableError" })),
      }),
    };
    const storage = new FileBackedStorage(changed);

    await expect(storage.read(0, 16)).rejects.toMatchObject({
      name: "StorageError",
      code: "fileChanged",
    });
    await expect(storage.read(0, 16)).rejects.toBeInstanceOf(StorageError);
  });
});

describe("the read-ahead window", () => {
  it("peeks only what is resident, and never awaits", async () => {
    const data = countingBytes(256);
    const storage = storageOver(data, { chunkSize: 64, byteBudget: 1024 });

    // Cold: the renderer gets nothing and paints a placeholder row.
    expect(storage.peek(128, 16)).toBeUndefined();

    await storage.prefetch(128, 16);
    expect(asArray(storage.peek(128, 16) ?? new Uint8Array(0))).toEqual(
      asArray(data.subarray(128, 144))
    );
    // Still cold either side of the window that was asked for.
    expect(storage.peek(0, 16)).toBeUndefined();
  });

  it("peeks a window spanning several chunks once they are all in", async () => {
    const data = countingBytes(256);
    const storage = storageOver(data, { chunkSize: 16, byteBudget: 4096 });

    await storage.prefetch(8, 40);
    expect(asArray(storage.peek(8, 40) ?? new Uint8Array(0))).toEqual(
      asArray(data.subarray(8, 48))
    );
  });

  it("answers a peek past EOF with nothing rather than a miss", async () => {
    // Empty is the true answer and the renderer can draw it; `undefined` would
    // make it wait for bytes that are never coming.
    const storage = storageOver(countingBytes(16));
    expect(asArray(storage.peek(16, 8) ?? new Uint8Array([1]))).toEqual([]);
  });

  it("serves a read out of what a prefetch already brought in", async () => {
    let slices = 0;
    const source = new MemoryByteSource(countingBytes(512));
    const counted: ByteSource = {
      size: source.size,
      slice: (start, end) => {
        slices++;
        return source.slice(start, end);
      },
    };
    const storage = new FileBackedStorage(counted, new ChunkCache({ chunkSize: 128 }));

    await storage.prefetch(0, 512);
    const before = slices;
    await storage.read(64, 128);
    expect(slices).toBe(before);
  });
});
