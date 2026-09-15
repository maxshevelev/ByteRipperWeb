import { describe, expect, it } from "vitest";
import { ChunkCache } from "@/core/storage/chunkCache";
import { asArray } from "@/core/testing/support";

/** Ported from `ChunkCacheTests.swift`, cases and all. */

const filled = (value: number, count = 16) => new Uint8Array(count).fill(value);

// @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/ChunkCacheTests.swift#ChunkCacheTests.testMapOperations
describe("ChunkCache as a map", () => {
  // Every case here runs under a budget far larger than it stores, so nothing
  // is evicted and only the map behaviour shows. Eviction has its own tests.
  const cases: {
    name: string;
    act: (cache: ChunkCache) => void;
    present: [index: number, value: number][];
    absent: number[];
    count: number;
    cachedBytes: number;
  }[] = [
    {
      name: "insert and retrieve",
      act: (cache) => {
        cache.set(0, filled(0xaa));
        cache.set(1, filled(0xbb));
      },
      present: [
        [0, 0xaa],
        [1, 0xbb],
      ],
      absent: [],
      count: 2,
      cachedBytes: 32,
    },
    {
      name: "a chunk that was never inserted is missing",
      act: () => {},
      present: [],
      absent: [99],
      count: 0,
      cachedBytes: 0,
    },
    {
      name: "replacing a chunk keeps one entry",
      act: (cache) => {
        cache.set(3, filled(0x01));
        cache.set(3, filled(0x02));
      },
      present: [[3, 0x02]],
      absent: [],
      count: 1,
      cachedBytes: 16,
    },
    {
      name: "remove drops just that entry",
      act: (cache) => {
        cache.set(7, filled(0));
        cache.set(8, filled(0));
        cache.remove(7);
      },
      present: [[8, 0]],
      absent: [7],
      count: 1,
      cachedBytes: 16,
    },
    {
      name: "removeAll empties the cache",
      act: (cache) => {
        for (let i = 0; i < 5; i++) cache.set(i, filled(0));
        cache.removeAll();
      },
      present: [],
      absent: [0, 4],
      count: 0,
      cachedBytes: 0,
    },
  ];

  for (const testCase of cases) {
    it(testCase.name, () => {
      const cache = new ChunkCache({ chunkSize: 16, byteBudget: 1024 });
      testCase.act(cache);
      for (const [index, value] of testCase.present) {
        expect(asArray(cache.get(index) ?? new Uint8Array(0))).toEqual(asArray(filled(value)));
      }
      for (const index of testCase.absent) expect(cache.get(index)).toBeUndefined();
      expect(cache.count).toBe(testCase.count);
      expect(cache.cachedByteCount).toBe(testCase.cachedBytes);
    });
  }
});

describe("ChunkCache eviction", () => {
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/ChunkCacheTests.swift#ChunkCacheTests.testEvictsLeastRecentlyUsed
  it("evicts the least recently used", () => {
    const cache = new ChunkCache({ chunkSize: 16, byteBudget: 64 }); // exactly 4
    for (let i = 0; i < 4; i++) cache.set(i, filled(0));

    cache.set(4, filled(0)); // evicts the LRU: chunk 0
    expect(cache.get(0)).toBeUndefined();
    expect(cache.get(1)).toBeDefined();
    expect(cache.get(4)).toBeDefined();
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/ChunkCacheTests.swift#ChunkCacheTests.testAccessUpdatesRecency
  it("counts a read as use", () => {
    const cache = new ChunkCache({ chunkSize: 16, byteBudget: 64 });
    for (let i = 0; i < 4; i++) cache.set(i, filled(0));

    cache.get(0); // touch 0, making 1 the least recent
    cache.set(4, filled(0));
    expect(cache.get(0)).toBeDefined();
    expect(cache.get(1)).toBeUndefined();
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/ChunkCacheTests.swift#ChunkCacheTests.testCachedByteCountTracksBudget
  it("evicts down to the budget and no further", () => {
    const cache = new ChunkCache({ chunkSize: 16, byteBudget: 48 });
    for (let i = 0; i < 5; i++) cache.set(i, filled(0));
    // 5 × 16 = 80 written, evicted down to ≤ 48 → exactly 3 remain.
    expect(cache.count).toBe(3);
    expect(cache.cachedByteCount).toBe(48);
  });

  it("does not let `has` disturb the recency order", () => {
    // `has` exists so residency can be checked without a read; if it counted as
    // use, prefetching a window would reorder the very chunks it is protecting.
    const cache = new ChunkCache({ chunkSize: 16, byteBudget: 64 });
    for (let i = 0; i < 4; i++) cache.set(i, filled(0));

    cache.has(0);
    cache.set(4, filled(0));
    expect(cache.get(0)).toBeUndefined();
  });
});
