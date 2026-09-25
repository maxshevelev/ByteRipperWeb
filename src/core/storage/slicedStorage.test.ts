import { describe, expect, it } from "vitest";
import type { ByteStorage } from "@/core/storage/byteStorage";
import { MemoryBackedStorage } from "@/core/storage/memoryBackedStorage";
import { SlicedStorage } from "@/core/storage/slicedStorage";
import { asArray } from "@/core/testing/support";

/**
 * Ported from `SlicedStorageTests.swift`.
 *
 * §21.7 a window onto part of another storage: what a piece's *source* is when
 * the piece stands for a stretch of a file rather than the whole of it.
 */

const base = new MemoryBackedStorage(new Uint8Array(16).map((_, index) => index));

describe("SlicedStorage", () => {
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SlicedStorageTests.swift#SlicedStorageTests.testTheSliceIsItsOwnStorage
  it("is its own storage over the base's bytes", () => {
    const slice = new SlicedStorage(base, 4, 10);

    expect(slice.size).toBe(6);
    // byte 0 of the slice is byte 4 of the base
    expect(slice.peek(0, 6)).toEqual(new Uint8Array([4, 5, 6, 7, 8, 9]));
    expect(slice.peek(2, 2)).toEqual(new Uint8Array([6, 7]));
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SlicedStorageTests.swift#SlicedStorageTests.testAReadPastTheSliceStopsAtItsEnd
  it("stops a read past the slice at its end, never at the base's next bytes", async () => {
    const slice = new SlicedStorage(base, 4, 10);

    expect(asArray(slice.peek(4, 8) ?? new Uint8Array(0))).toEqual([8, 9]);
    expect(asArray(slice.peek(6, 4) ?? new Uint8Array(0))).toEqual([]);
    // A read past EOF is an empty answer, as the interface's contract says.
    expect(await slice.read(6, 4)).toEqual(new Uint8Array(0));
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SlicedStorageTests.swift#SlicedStorageTests.testASliceOfABaseThatShrankReportsWhatIsLeft
  it("reports what a base that shrank underneath still holds", () => {
    // The window is clamped to the base's size *at read time*: a source file
    // rewritten on disk short-reads at the end rather than reading someone
    // else's bytes.
    const shrunk = new MemoryBackedStorage(new Uint8Array(6).map((_, index) => index));
    const slice = new SlicedStorage(shrunk, 4, 10);

    expect(slice.size).toBe(2);
    expect(slice.peek(0, 6)).toEqual(new Uint8Array([4, 5]));
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SlicedStorageTests.swift#SlicedStorageTests.testASliceBeyondTheBaseIsEmpty
  it("is empty where it opens past the base's end", async () => {
    const slice = new SlicedStorage(base, 20, 24);

    expect(slice.size).toBe(0);
    expect(slice.peek(0, 4)).toEqual(new Uint8Array(0));
    expect(await slice.read(0, 4)).toEqual(new Uint8Array(0));
  });

  it("holds a zero window where the range is empty or backwards", () => {
    expect(new SlicedStorage(base, 8, 8).size).toBe(0);
    expect(new SlicedStorage(base, 10, 4).size).toBe(0);
  });

  it("asks the base for the window's bytes at the base's offsets", async () => {
    // @web-only the web's read-ahead path (`byteStorage.ts`): `peek`, `read` and
    // `prefetch` all delegate, so the base's cache serves the slice without a
    // second source of truth.
    const asks: { method: "read" | "peek" | "prefetch"; at: number; length: number }[] = [];
    const recording: ByteStorage = {
      size: 16,
      read: (at, length) => {
        asks.push({ method: "read", at, length });
        return Promise.resolve(new Uint8Array(length).map((_, i) => (at + i) & 0xff));
      },
      peek: (at, length) => {
        asks.push({ method: "peek", at, length });
        return new Uint8Array(length).map((_, i) => (at + i) & 0xff);
      },
      prefetch: (at, length) => {
        asks.push({ method: "prefetch", at, length });
        return Promise.resolve();
      },
    };
    const slice = new SlicedStorage(recording, 4, 10);

    slice.peek(2, 4);
    await slice.read(3, 3);
    await slice.prefetch(0, 6);
    expect(asks).toEqual([
      { method: "peek", at: 6, length: 4 },
      { method: "read", at: 7, length: 3 },
      { method: "prefetch", at: 4, length: 6 },
    ]);
  });
});
