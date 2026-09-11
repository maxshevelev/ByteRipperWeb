import { assertRepresentableSize } from "@/core/limits";
import type { Bytes, EditableByteStorage } from "@/core/storage/byteStorage";

/**
 * An editable buffer held entirely in memory — File ▸ New File, and the fixture
 * every test in `src/core` reaches for first.
 *
 * Ported from `MemoryBackedStorage.swift`. Nothing reaches disk until the
 * document layer saves it; the buffer is where a dump is built up before it has
 * anywhere to live.
 *
 * The growth strategy is the one divergence worth naming. Swift's `Array`
 * amortises appends for free; a `Uint8Array` has a fixed length, so this keeps
 * a capacity of its own and doubles it, rather than allocating and copying the
 * whole buffer per typed byte.
 */
export class MemoryBackedStorage implements EditableByteStorage {
  private buffer: Bytes;
  private length: number;

  constructor(bytes: Uint8Array = new Uint8Array(0)) {
    this.buffer = bytes.slice();
    this.length = this.buffer.length;
  }

  get size(): number {
    return this.length;
  }

  /** In memory nothing is ever absent, so `peek` always answers. */
  peek(at: number, length: number): Bytes {
    if (length <= 0 || at < 0 || at >= this.length) return new Uint8Array(0);
    const count = Math.min(length, this.length - at);
    return this.buffer.slice(at, at + count);
  }

  read(at: number, length: number): Promise<Bytes> {
    return Promise.resolve(this.peek(at, length));
  }

  /** Nothing to fetch; the bytes are already here. */
  prefetch(): Promise<void> {
    return Promise.resolve();
  }

  overwrite(at: number, bytes: Uint8Array): Promise<void> {
    if (bytes.length === 0) return Promise.resolve();
    const end = assertRepresentableSize(at + bytes.length, "This edit");
    // Writing past EOF zero-fills the gap and then lays the bytes over it — the
    // same shape the piece-table overlay produces, so the two storages cannot
    // disagree about what a write past the end means.
    if (end > this.length) this.grow(end);
    this.buffer.set(bytes, at);
    return Promise.resolve();
  }

  insert(at: number, bytes: Uint8Array): Promise<void> {
    if (bytes.length === 0) return Promise.resolve();
    const start = Math.min(Math.max(at, 0), this.length);
    const wasLength = this.length;
    this.grow(assertRepresentableSize(this.length + bytes.length, "This edit"));
    this.buffer.copyWithin(start + bytes.length, start, wasLength);
    this.buffer.set(bytes, start);
    return Promise.resolve();
  }

  delete(start: number, end: number): Promise<void> {
    const from = Math.min(Math.max(start, 0), this.length);
    const to = Math.min(Math.max(end, 0), this.length);
    if (to <= from) return Promise.resolve();
    this.buffer.copyWithin(from, to, this.length);
    this.length -= to - from;
    return Promise.resolve();
  }

  append(bytes: Uint8Array): Promise<void> {
    return this.overwrite(this.length, bytes);
  }

  /** Grows the logical length to `length`, zero-filling whatever it passes. */
  private grow(length: number): void {
    if (length > this.buffer.length) {
      const capacity = Math.max(length, this.buffer.length * 2, 64);
      const grown = new Uint8Array(capacity);
      grown.set(this.buffer.subarray(0, this.length));
      this.buffer = grown;
    } else if (length > this.length) {
      this.buffer.fill(0, this.length, length);
    }
    this.length = length;
  }
}
