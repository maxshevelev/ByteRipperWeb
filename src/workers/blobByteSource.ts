import { ChunkCache } from "@/core/storage/chunkCache";
import { assembleWord, type ByteSource } from "@/firmware/byteSource";

/** How much of the `Blob` a source keeps in hand: four MiB, in chunks of 64 KiB. */
const BLOB_CACHE_BUDGET = 4 * 1024 * 1024;

/** A read over this many chunks or more is read whole, and kept by nobody. */
const BLOB_CACHE_SPAN = 4;

/** What reads a `Blob` synchronously: `FileReaderSync`, which only a worker has. */
export interface BlobReader {
  readAsArrayBuffer(blob: Blob): ArrayBuffer;
}

/**
 * A `Blob`, read synchronously, which is a thing only a worker can do.
 *
 * @upstream Packages/UEFIContentSource/Sources/UEFIContentSource/ToolContentByteSource.swift#ToolContentByteSource
 * @upstream Packages/UEFIContentSource/Sources/UEFIContentSource/ToolContentByteSource.swift#ToolContentByteSource.byteCount
 * @upstream Packages/UEFIContentSource/Sources/UEFIContentSource/ToolContentByteSource.swift#ToolContentByteSource.bytes
 * @upstream-differs reads the pane's Blob in the worker, not a live reader over the document
 * @upstream-differs a read that fails throws, where upstream's hands back zeros of the length asked
 * for: here the failure is a `File` gone stale under a changed file, and the request it was part of
 * fails and says so, rather than a tree being read off bytes that were never there
 * @upstream ByteRipperApp/Tools/PaneToolHost.swift#LiveDocumentByteSource
 * @upstream ByteRipperApp/Tools/PaneToolHost.swift#LiveDocumentByteSource.byteCount
 * @upstream ByteRipperApp/Tools/PaneToolHost.swift#LiveDocumentByteSource.bytes
 */
export class BlobByteSource implements ByteSource {
  private readonly blob: Blob;
  private readonly reader: BlobReader;
  /**
   * The chunks small reads came from. A read of a `Blob` is a call into the browser whatever its
   * length, and a parse makes thousands of small ones — every entry of an NVRAM store, read again
   * for each row's value whenever the tree crosses the wire: on an HP image of eight hundred
   * entries, seconds per reveal. A long read — a hash, a stream to decompress — goes past it, so
   * as not to push out what the small ones keep coming back to.
   *
   * @web-only upstream reads a document already in memory
   */
  private readonly chunks = new ChunkCache({ byteBudget: BLOB_CACHE_BUDGET });

  constructor(blob: Blob, reader: BlobReader = new FileReaderSync()) {
    this.blob = blob;
    this.reader = reader;
  }

  get byteCount(): number {
    return this.blob.size;
  }

  bytes(start: number, end: number): Uint8Array {
    const to = Math.min(end, this.blob.size);
    if (to <= start) return new Uint8Array(0);
    const size = this.chunks.config.chunkSize;
    const first = Math.floor(start / size);
    const last = Math.floor((to - 1) / size);
    if (last - first >= BLOB_CACHE_SPAN) return this.read(start, to);
    if (first === last) {
      const chunk = this.chunk(first);
      return chunk.slice(start - first * size, to - first * size);
    }
    const out = new Uint8Array(to - start);
    for (let index = first; index <= last; index++) {
      const chunk = this.chunk(index);
      const from = Math.max(start, index * size);
      const until = Math.min(to, (index + 1) * size);
      out.set(chunk.subarray(from - index * size, until - index * size), from - start);
    }
    return out;
  }

  private chunk(index: number): Uint8Array {
    const held = this.chunks.get(index);
    if (held !== undefined) return held;
    const size = this.chunks.config.chunkSize;
    const read = this.read(index * size, Math.min(this.blob.size, (index + 1) * size));
    this.chunks.set(index, read);
    return read;
  }

  private read(start: number, end: number): Uint8Array {
    return new Uint8Array(this.reader.readAsArrayBuffer(this.blob.slice(start, end)));
  }

  word(offset: number, count: number): number {
    return assembleWord(this.bytes(offset, offset + count), 0, count);
  }
}
