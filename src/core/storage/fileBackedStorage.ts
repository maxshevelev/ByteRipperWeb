import { assertRepresentableSize } from "@/core/limits";
import type { ByteSource, ByteStorage, Bytes } from "@/core/storage/byteStorage";
import { ChunkCache } from "@/core/storage/chunkCache";
import { StorageError } from "@/core/storage/storageError";

/**
 * Read-only storage over a file the browser handed us.
 *
 * Ported from `FileBackedStorage.swift`, where reads are `pread(2)` calls
 * through a chunk cache. Here the chunk source is `Blob.slice().arrayBuffer()`,
 * which means the read is a promise — and that single fact is the reason this
 * class has {@link peek} and {@link prefetch} that upstream has no need of.
 *
 * Three things the asynchronous world adds, none of them optional:
 *
 * - **Single flight.** Upstream's lock meant two threads could not both miss on
 *   one chunk and both read it. Here nothing serialises the awaits, so a
 *   viewport scrolling into a cold region would fetch the same chunk many times
 *   over. In-flight reads are shared.
 * - **A synchronous path that may fail.** {@link peek} answers out of the cache
 *   or not at all, because a canvas repaint has no way to wait.
 * - **Saying what is about to be needed.** {@link prefetch} is how the pane
 *   makes the rows around the viewport resident before it paints them.
 */
export class FileBackedStorage implements ByteStorage {
  readonly size: number;
  readonly cache: ChunkCache;

  private readonly source: ByteSource;
  private readonly inFlight = new Map<number, Promise<Bytes>>();

  /**
   * @param source The file, or anything shaped like a `Blob`.
   * @param cache This file's cache. A cache is keyed by chunk index alone, so
   * it must not be shared with another file — see `chunkCache.ts`.
   */
  constructor(source: ByteSource, cache: ChunkCache = new ChunkCache()) {
    this.size = assertRepresentableSize(source.size);
    this.source = source;
    this.cache = cache;
  }

  async read(at: number, length: number): Promise<Bytes> {
    const span = this.clamp(at, length);
    if (span === undefined) return new Uint8Array(0);

    await this.residency(span.first, span.last);
    const assembled = this.assemble(span.at, span.count);
    // Every chunk was just made resident, so a miss here is not possible unless
    // the cache budget is smaller than the window asked for. Fall back to
    // reading the window directly rather than returning something wrong.
    return assembled ?? (await this.readThrough(span.at, span.count));
  }

  peek(at: number, length: number): Bytes | undefined {
    const span = this.clamp(at, length);
    if (span === undefined) return new Uint8Array(0);
    return this.assemble(span.at, span.count);
  }

  async prefetch(at: number, length: number): Promise<void> {
    const span = this.clamp(at, length);
    if (span === undefined) return;
    await this.residency(span.first, span.last);
  }

  /**
   * The window actually available at `at`, or `undefined` when there is none —
   * a read past EOF, or of nothing. Reads are clamped rather than refused, as
   * upstream's contract requires.
   */
  private clamp(
    at: number,
    length: number
  ): { at: number; count: number; first: number; last: number } | undefined {
    if (length <= 0 || at < 0 || at >= this.size) return undefined;
    const count = Math.min(length, this.size - at);
    const { chunkSize } = this.cache.config;
    return {
      at,
      count,
      first: Math.floor(at / chunkSize),
      last: Math.floor((at + count - 1) / chunkSize),
    };
  }

  /** Brings chunks `first..last` into the cache, sharing any read already out. */
  private async residency(first: number, last: number): Promise<void> {
    const waiting: Promise<Uint8Array>[] = [];
    for (let index = first; index <= last; index++) {
      if (this.cache.has(index)) continue;
      waiting.push(this.chunk(index));
    }
    if (waiting.length > 0) await Promise.all(waiting);
  }

  /**
   * Copies `count` bytes from `at` out of the cache, or `undefined` if any
   * chunk it needs is missing. Pure bookkeeping — no I/O, no awaiting.
   */
  private assemble(at: number, count: number): Bytes | undefined {
    const { chunkSize } = this.cache.config;
    const result = new Uint8Array(count);
    let written = 0;

    while (written < count) {
      const position = at + written;
      const index = Math.floor(position / chunkSize);
      const chunk = this.cache.get(index);
      if (chunk === undefined) return undefined;

      const offsetInChunk = position - index * chunkSize;
      const take = Math.min(count - written, chunk.length - offsetInChunk);
      // A chunk shorter than its offset means the file shrank under us; stop
      // rather than reading past the buffer.
      if (take <= 0) break;
      result.set(chunk.subarray(offsetInChunk, offsetInChunk + take), written);
      written += take;
    }

    return written === count ? result : result.subarray(0, written);
  }

  /** Reads one chunk, sharing the promise with anyone else who wants it. */
  private chunk(index: number): Promise<Bytes> {
    const outstanding = this.inFlight.get(index);
    if (outstanding !== undefined) return outstanding;

    const started = this.readChunk(index).finally(() => {
      this.inFlight.delete(index);
    });
    this.inFlight.set(index, started);
    return started;
  }

  private async readChunk(index: number): Promise<Bytes> {
    const { chunkSize } = this.cache.config;
    const start = index * chunkSize;
    if (start >= this.size) return new Uint8Array(0);

    const bytes = await this.readThrough(start, Math.min(chunkSize, this.size - start));
    this.cache.set(index, bytes);
    return bytes;
  }

  /** One slice of the file, straight through, with the error the UI can read. */
  private async readThrough(at: number, count: number): Promise<Bytes> {
    try {
      const buffer = await this.source.slice(at, at + count).arrayBuffer();
      return new Uint8Array(buffer);
    } catch (cause) {
      throw StorageError.fromReadFailure(cause);
    }
  }
}
