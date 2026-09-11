import type { ByteSource, ByteSourceSlice } from "@/core/storage/byteStorage";

/**
 * A {@link ByteSource} over bytes already in memory.
 *
 * The browser's own `File` is the usual source, but not the only one: bytes
 * that were built rather than opened — a new document, a segment read back out,
 * a scratch copy a piece table was folded into — need the same interface, and
 * every test in this directory needs one that does not involve a browser at
 * all.
 *
 * Slices are views, not copies. `arrayBuffer()` copies, because that is what a
 * real `Blob` does and a test that relied on aliasing would pass here and fail
 * in a browser.
 */
export class MemoryByteSource implements ByteSource {
  private readonly bytes: Uint8Array;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  get size(): number {
    return this.bytes.length;
  }

  slice(start: number, end: number): ByteSourceSlice {
    const from = Math.min(Math.max(start, 0), this.bytes.length);
    const to = Math.min(Math.max(end, from), this.bytes.length);
    const view = this.bytes.subarray(from, to);
    return {
      arrayBuffer: () => Promise.resolve(view.slice().buffer),
    };
  }
}
