import type { ByteSource, ByteStorage } from "@/core/storage/byteStorage";
import { ChunkCache, type ChunkCacheConfig } from "@/core/storage/chunkCache";
import { FileBackedStorage } from "@/core/storage/fileBackedStorage";
import { MemoryByteSource } from "@/core/storage/memoryByteSource";
import type { ScratchStore } from "@/core/storage/scratchStore";

/**
 * The fixtures the `src/core` tests share, ported from upstream's
 * `TestSupport.swift`.
 *
 * Upstream writes real temporary files because its storage opens paths. Ours
 * takes anything shaped like a `Blob`, so a test needs no filesystem at all —
 * which is the point of keeping the domain half free of the platform.
 */

/** Bytes 0, 1, 2 … wrapping at 256. Distinct enough that an off-by-one shows. */
export function countingBytes(count: number, from = 0): Uint8Array {
  const bytes = new Uint8Array(count);
  for (let i = 0; i < count; i++) bytes[i] = (from + i) & 0xff;
  return bytes;
}

/** A file-backed storage over bytes in memory, with a cache of its own. */
export function storageOver(
  bytes: Uint8Array,
  config: Partial<ChunkCacheConfig> = {}
): FileBackedStorage {
  return new FileBackedStorage(new MemoryByteSource(bytes), new ChunkCache(config));
}

/** Everything a storage holds, read in one go. */
export async function readAll(storage: ByteStorage): Promise<Uint8Array> {
  return await storage.read(0, storage.size);
}

/** `Uint8Array` comparison that reads as a list in a failure message. */
export function bytes(...values: number[]): number[] {
  return values;
}

/** A typed array as a plain array, so `toEqual` prints something legible. */
export function asArray(value: Uint8Array): number[] {
  return Array.from(value);
}

/**
 * A deterministic pseudo-random source, so a property test that fails fails
 * again.
 *
 * Upstream seeds an SplitMix64; JavaScript has no 64-bit integer arithmetic
 * that is not `bigint`, so this is mulberry32 instead. The sequences differ,
 * and that is fine: what these tests assert is agreement with a model over many
 * edit sequences, not one particular sequence.
 */
export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** A float in `[0, 1)`. */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** An integer in `[from, to)`. */
  int(from: number, to: number): number {
    return from + Math.floor(this.next() * (to - from));
  }

  /** `count` random bytes. */
  bytes(count: number): Uint8Array {
    const out = new Uint8Array(count);
    for (let i = 0; i < count; i++) out[i] = this.int(0, 256);
    return out;
  }
}

/**
 * A {@link ScratchStore} that keeps its copies in memory and counts them.
 *
 * Stands in for the origin-private file system the platform layer will supply
 * in M4. `liveCount` is this suite's equivalent of upstream counting files left
 * in a temporary directory: what both are really asserting is that a
 * materialisation keeps exactly one copy, not a pile of them.
 */
export class RecordingScratchStore implements ScratchStore {
  /** How many copies exist right now. */
  liveCount = 0;
  /** How many were ever written — how often the valve tripped. */
  writeCount = 0;

  async write(content: AsyncIterable<Uint8Array>): Promise<ByteSource> {
    const parts: Uint8Array[] = [];
    let total = 0;
    for await (const part of content) {
      parts.push(part);
      total += part.length;
    }
    const joined = new Uint8Array(total);
    let at = 0;
    for (const part of parts) {
      joined.set(part, at);
      at += part.length;
    }

    this.writeCount++;
    this.liveCount++;
    return new MemoryByteSource(joined);
  }

  releaseAllButLatest(): Promise<void> {
    this.liveCount = Math.min(this.liveCount, 1);
    return Promise.resolve();
  }
}
