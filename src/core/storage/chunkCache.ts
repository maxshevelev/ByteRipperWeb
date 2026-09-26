/**
 * A bounded LRU cache of fixed-size byte chunks.
 *
 * Ported from `ChunkCache.swift`. This is what lets a very large file be opened
 * without loading it: the file is read lazily in chunks and only the most
 * recently used ones are kept.
 *
 * Two things from upstream are deliberately not here. The lock is gone — a
 * JavaScript realm runs one thing at a time, and a worker has its own realm, so
 * there is nothing to serialise against. And the hand-built doubly linked list
 * is gone too: a `Map` iterates in insertion order, so delete-then-set moves an
 * entry to the back and the first key is always the least recently used. The
 * behaviour is upstream's, verified against upstream's own tests; only the
 * fifty lines of pointer bookkeeping are missing.
 *
 * **One cache per file.** Entries are keyed by chunk index alone, so a cache
 * shared between two files serves one file's bytes for the other's offsets.
 * Upstream found this the hard way when materialisation swapped a base out from
 * under a shared cache; every construction site here passes a fresh cache, and
 * {@link ChunkCache.forSameBudget} exists so that stays easy.
 */

/** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/ChunkCache.swift#ChunkCache.Config */
export interface ChunkCacheConfig {
  /**
   * Bytes per chunk. Upstream's default, and what the benchmarks measure.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/ChunkCache.swift#ChunkCache.Config.chunkSize
   */
  readonly chunkSize: number;
  /**
   * How much the cache may hold before it starts evicting.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/ChunkCache.swift#ChunkCache.Config.byteBudget
   */
  readonly byteBudget: number;
}

/** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/ChunkCache.swift#ChunkCache.Config.init */
export const DEFAULT_CHUNK_CACHE_CONFIG: ChunkCacheConfig = {
  chunkSize: 64 * 1024,
  byteBudget: 32 * 1024 * 1024,
};

/** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/ChunkCache.swift#ChunkCache */
// help: core.storage.chunked
export class ChunkCache {
  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/ChunkCache.swift#ChunkCache.config */
  readonly config: ChunkCacheConfig;

  /** Insertion order is recency order: the first key is the least recent. */
  private readonly entries = new Map<number, Uint8Array>();
  private bytes = 0;

  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/ChunkCache.swift#ChunkCache.init */
  constructor(config: Partial<ChunkCacheConfig> = {}) {
    this.config = { ...DEFAULT_CHUNK_CACHE_CONFIG, ...config };
  }

  /** A cache with this one's budget but none of its contents — for a new base. */
  forSameBudget(): ChunkCache {
    return new ChunkCache(this.config);
  }

  /**
   * The chunk at `index`, or `undefined`. A hit becomes the most recent.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/ChunkCache.swift#ChunkCache.chunk
   */
  get(index: number): Uint8Array | undefined {
    const found = this.entries.get(index);
    if (found === undefined) return undefined;
    this.entries.delete(index);
    this.entries.set(index, found);
    return found;
  }

  /** Whether the chunk is held, without disturbing the recency order. */
  has(index: number): boolean {
    return this.entries.has(index);
  }

  /**
   * Inserts or replaces a chunk, then evicts until back inside the budget.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/ChunkCache.swift#ChunkCache.setChunk
   */
  set(index: number, chunk: Uint8Array): void {
    const existing = this.entries.get(index);
    if (existing !== undefined) {
      this.bytes -= existing.length;
      this.entries.delete(index);
    }
    this.entries.set(index, chunk);
    this.bytes += chunk.length;
    this.evictWhileOverBudget();
  }

  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/ChunkCache.swift#ChunkCache.remove */
  remove(index: number): void {
    const found = this.entries.get(index);
    if (found === undefined) return;
    this.entries.delete(index);
    this.bytes -= found.length;
  }

  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/ChunkCache.swift#ChunkCache.removeAll */
  removeAll(): void {
    this.entries.clear();
    this.bytes = 0;
  }

  /**
   * How many chunks are held.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/ChunkCache.swift#ChunkCache.count
   */
  get count(): number {
    return this.entries.size;
  }

  /**
   * How many bytes are held — what the budget is measured against.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/ChunkCache.swift#ChunkCache.cachedByteCount
   */
  get cachedByteCount(): number {
    return this.bytes;
  }

  private evictWhileOverBudget(): void {
    while (this.bytes > this.config.byteBudget) {
      const oldest = this.entries.keys().next();
      if (oldest.done === true) return;
      const victim = this.entries.get(oldest.value);
      if (victim === undefined) return;
      this.entries.delete(oldest.value);
      this.bytes -= victim.length;
    }
  }
}
