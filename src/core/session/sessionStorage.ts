import type { OperationSpan } from "@/core/session/sessionProtocol";
import type { ByteStorage, Bytes } from "@/core/storage/byteStorage";
import { ChunkCache } from "@/core/storage/chunkCache";

/**
 * How a window reads a session's bytes: the host's answer to a read, and the content generation it
 * was read at.
 *
 * @web-only see {@link SessionStorage}
 */
export interface SessionReader {
  readonly size: number;
  readonly contentGeneration: number;
  readChunk(at: number, length: number): Promise<{ bytes: Bytes; generation: number }>;
}

/**
 * A session's bytes as a window reads them (`Design/FILE_SESSIONS.md`): read from the host in
 * chunks, kept in the window's own cache, and forgotten where the host says they changed.
 *
 * It is a `ByteStorage`, so the renderer's `peek` and `prefetch`, a save's stream and a tool's
 * reads take it as they took the document's storage. A chunk the host read before an edit the
 * window has since heard of is not kept: its generation is older than the mirror's.
 *
 * @web-only upstream's window reads the document's storage itself
 */
export class SessionStorage implements ByteStorage {
  private readonly reader: SessionReader;
  private readonly cache: ChunkCache;
  private readonly inFlight = new Map<number, Promise<void>>();

  constructor(reader: SessionReader, cache: ChunkCache = new ChunkCache()) {
    this.reader = reader;
    this.cache = cache;
  }

  get size(): number {
    return this.reader.size;
  }

  async read(at: number, length: number): Promise<Bytes> {
    const span = this.clamp(at, length);
    if (span === undefined) return new Uint8Array(0);
    await this.residency(span.first, span.last);
    const assembled = this.assemble(span.at, span.count);
    if (assembled !== undefined) return assembled;
    // Changed while it was read, or more than the cache holds: ask for the window itself.
    return (await this.reader.readChunk(span.at, span.count)).bytes;
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

  /** Forgets what the operations changed: an overwrite its own bytes, a shift everything after. */
  invalidate(spans: readonly OperationSpan[]): void {
    if (spans.length === 0) {
      this.cache.removeAll();
      return;
    }
    const { chunkSize } = this.cache.config;
    for (const span of spans) {
      const first = Math.floor(span.at / chunkSize);
      if (span.kind !== "overwrite") {
        this.forgetFrom(first);
        continue;
      }
      const last = Math.floor((span.at + Math.max(span.count, 1) - 1) / chunkSize);
      for (let index = first; index <= last; index++) this.cache.remove(index);
    }
  }

  private forgetFrom(first: number): void {
    const { chunkSize } = this.cache.config;
    // The size before a shift may be larger than after it; the cache holds nothing past either.
    const last = Math.ceil((this.size + chunkSize * 2) / chunkSize);
    for (let index = first; index <= last; index++) this.cache.remove(index);
  }

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

  private async residency(first: number, last: number): Promise<void> {
    const waiting: Promise<void>[] = [];
    for (let index = first; index <= last; index++) {
      if (!this.cache.has(index)) waiting.push(this.chunk(index));
    }
    if (waiting.length > 0) await Promise.all(waiting);
  }

  private chunk(index: number): Promise<void> {
    const out = this.inFlight.get(index);
    if (out !== undefined) return out;
    const { chunkSize } = this.cache.config;
    const read = this.reader
      .readChunk(index * chunkSize, chunkSize)
      .then(({ bytes, generation }) => {
        if (generation === this.reader.contentGeneration) this.cache.set(index, bytes);
      })
      .finally(() => this.inFlight.delete(index));
    this.inFlight.set(index, read);
    return read;
  }

  private assemble(at: number, count: number): Bytes | undefined {
    const { chunkSize } = this.cache.config;
    const first = Math.floor(at / chunkSize);
    const last = Math.floor((at + count - 1) / chunkSize);
    if (first === last) {
      const chunk = this.cache.get(first);
      if (chunk === undefined) return undefined;
      const from = at - first * chunkSize;
      if (from + count > chunk.length) return undefined;
      return chunk.slice(from, from + count);
    }
    const out = new Uint8Array(count);
    for (let index = first; index <= last; index++) {
      const chunk = this.cache.get(index);
      if (chunk === undefined || (index < last && chunk.length < chunkSize)) return undefined;
      const chunkStart = index * chunkSize;
      const from = Math.max(at, chunkStart);
      const to = Math.min(at + count, chunkStart + chunk.length);
      if (to <= from) return undefined;
      out.set(chunk.subarray(from - chunkStart, to - chunkStart), from - at);
    }
    return out;
  }
}
