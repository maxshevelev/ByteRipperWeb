import type { OperationSpan, SessionId } from "@/core/session/sessionProtocol";
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
  /** The session these are the bytes of — what a join from them names, rather than the bytes. */
  readonly session: SessionId;
  private readonly reader: SessionReader;
  private readonly cache: ChunkCache;
  private readonly inFlight = new Map<number, Promise<void>>();

  constructor(session: SessionId, reader: SessionReader, cache: ChunkCache = new ChunkCache()) {
    this.session = session;
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

  /**
   * Brings what this window has read up to date with an edit the host made: an overwrite's bytes
   * laid over the chunks they fall in, an insert's or a delete's shift applied to every chunk after
   * it — so what is on screen is painted from the news of the edit, not read again. What the news
   * did not carry the bytes of is forgotten and read again when asked for. No operations at all
   * is the content replaced outright: everything goes.
   *
   * `sizeAfter` is the size once every operation is applied, which is what the mirror holds by
   * the time the news is heard.
   */
  apply(spans: readonly OperationSpan[], sizeAfter: number): void {
    if (spans.length === 0) {
      this.cache.removeAll();
      return;
    }
    let size = sizeAfter;
    for (const span of spans) {
      if (span.kind === "insert") size -= span.count;
      else if (span.kind === "delete") size += span.count;
    }
    for (const span of spans) {
      if (span.kind === "overwrite") {
        this.overwritten(span);
        continue;
      }
      const delta = span.kind === "insert" ? span.count : -span.count;
      this.shifted(span, size);
      size += delta;
    }
  }

  private overwritten(span: OperationSpan): void {
    const { chunkSize } = this.cache.config;
    const end = span.at + span.count;
    const bytes =
      span.bytes !== undefined && span.bytes.length === span.count ? span.bytes : undefined;
    for (const index of this.cache.indices()) {
      const start = index * chunkSize;
      const chunk = this.cache.get(index);
      if (chunk === undefined || start + chunk.length <= span.at || start >= end) continue;
      if (bytes === undefined) {
        this.cache.remove(index);
        continue;
      }
      const from = Math.max(start, span.at);
      const to = Math.min(start + chunk.length, end);
      const patched = chunk.slice();
      patched.set(bytes.subarray(from - span.at, to - span.at), from - start);
      this.cache.set(index, patched);
    }
  }

  /**
   * An insert or a delete at `span.at`: every chunk from the one it falls in onwards is taken out,
   * runs of neighbouring chunks are put together, the edit is applied to them, and they go back
   * at their new offsets — whole chunks only, and the last part of one only where it is the end of
   * the content.
   */
  private shifted(span: OperationSpan, sizeBefore: number): void {
    const { chunkSize } = this.cache.config;
    const at = span.at;
    const count = span.count;
    const sizeAfter = span.kind === "insert" ? sizeBefore + count : sizeBefore - count;
    const first = Math.floor(at / chunkSize);

    const taken = this.cache
      .indices()
      .filter((index) => index >= first)
      .sort((left, right) => left - right);
    const runs: { start: number; parts: Uint8Array[]; length: number }[] = [];
    for (const index of taken) {
      const chunk = this.cache.get(index);
      this.cache.remove(index);
      if (chunk === undefined) continue;
      const start = index * chunkSize;
      const last = runs.at(-1);
      if (last !== undefined && last.start + last.length === start) {
        last.parts.push(chunk);
        last.length += chunk.length;
      } else runs.push({ start, parts: [chunk], length: chunk.length });
    }

    for (const run of runs) {
      const old = concat(run.parts, run.length);
      const start = run.start;
      const end = start + old.length;
      const reachesEnd = end === sizeBefore;
      let placed: { start: number; bytes: Uint8Array; complete: boolean } | undefined;
      if (span.kind === "insert") {
        if (start <= at) {
          const prefix = old.subarray(0, at - start);
          const suffix = old.subarray(at - start);
          placed =
            span.bytes !== undefined && span.bytes.length === count
              ? { start, bytes: concat([prefix, span.bytes, suffix]), complete: reachesEnd }
              : { start, bytes: prefix, complete: false };
        } else placed = { start: start + count, bytes: old, complete: reachesEnd };
      } else {
        const gone = at + count;
        if (start <= at) {
          const prefix = old.subarray(0, at - start);
          placed =
            gone <= end
              ? { start, bytes: concat([prefix, old.subarray(gone - start)]), complete: reachesEnd }
              : { start, bytes: prefix, complete: false };
        } else if (end > gone) {
          const kept = Math.max(start, gone);
          placed = { start: kept - count, bytes: old.subarray(kept - start), complete: reachesEnd };
        }
      }
      if (placed !== undefined) this.place(placed.start, placed.bytes, placed.complete, sizeAfter);
    }
  }

  /** Puts bytes found at `start` back as chunks: whole ones, and the content's last one. */
  private place(start: number, bytes: Uint8Array, complete: boolean, size: number): void {
    const { chunkSize } = this.cache.config;
    const end = start + bytes.length;
    for (let index = Math.ceil(start / chunkSize); index * chunkSize < end; index++) {
      const chunkStart = index * chunkSize;
      const chunkEnd = Math.min(chunkStart + chunkSize, size);
      if (chunkEnd > end || (chunkEnd < chunkStart + chunkSize && !(complete && end === size))) {
        break;
      }
      this.cache.set(index, bytes.slice(chunkStart - start, chunkEnd - start));
    }
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

function concat(parts: readonly Uint8Array[], length?: number): Uint8Array {
  const out = new Uint8Array(length ?? parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
