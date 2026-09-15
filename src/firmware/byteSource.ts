/**
 * Where an image's bytes come from, for the firmware parsers.
 *
 * An interface rather than a `Uint8Array`, for the reason upstream gives: the
 * application already holds the open file as a chunked, zero-copy snapshot, and
 * turning that into one contiguous buffer would copy tens of megabytes for a
 * parse that only ever reads headers.
 *
 * **Reads here are synchronous**, which everything else in this application's
 * storage layer is not. That is the whole reason parsing happens in a worker: a
 * worker has `FileReaderSync`, so a `Blob` can be read a chunk at a time
 * without a promise, and the parser — six thousand lines of it upstream, all
 * written against synchronous reads — ports as it stands rather than being
 * turned inside out into continuations.
 *
 * Implementations may assume a range is within `byteCount`: `ImageReader`
 * checks every range before it asks, which is the one place worth having that
 * check.
 */

/** @upstream Packages/UEFIImage/Sources/UEFIImage/ByteSource.swift#ByteSource */
export interface ByteSource {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/ByteSource.swift#ByteSource.byteCount */
  readonly byteCount: number;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/ByteSource.swift#ByteSource.bytes */
  bytes(start: number, end: number): Uint8Array;
  /**
   * `count` bytes at `offset`, little-endian, as one number.
   *
   * Every field this parser reads is one of these, and there are millions of
   * them in a walk that steps byte by byte, so a source with the bytes already
   * in hand says so here rather than building an array per field.
   *
   * `count` is 1 to 8. Assembled by multiplication, not by shifting:
   * JavaScript's bitwise operators are 32-bit, and a dword with its top bit set
   * comes back negative from `<<`.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/ByteSource.swift#ByteSource.word
   */
  word(offset: number, count: number): number;
}

/**
 * The little-endian assembly every `word` ends in, in one place.
 *
 * Exact to 2^53, which covers every offset and size a real image holds. A
 * corrupt eight-byte length can exceed it and come back rounded — and then
 * every bounds check it feeds fails, which is the same answer as reading it
 * exactly. Where the *bits* matter rather than the magnitude — a magic number
 * — {@link assembleBits} answers in full.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/ByteSource.swift#ByteSourceWord
 * @upstream Packages/UEFIImage/Sources/UEFIImage/ByteSource.swift#ByteSourceWord.assemble
 */
export function assembleWord(bytes: Uint8Array, from: number, count: number): number {
  let value = 0;
  for (let index = count - 1; index >= 0; index--) {
    value = value * 0x100 + (bytes[from + index] ?? 0);
  }
  return value;
}

/** The same, as a `bigint`, for the comparisons that are about every bit. */
export function assembleBits(bytes: Uint8Array, from: number, count: number): bigint {
  let value = 0n;
  for (let index = count - 1; index >= 0; index--) {
    value = (value << 8n) | BigInt(bytes[from + index] ?? 0);
  }
  return value;
}

/**
 * A source over bytes already in memory — what the tests and the worker use.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/ByteSource.swift#Data.byteCount
 * @upstream Packages/UEFIImage/Sources/UEFIImage/ByteSource.swift#Data.bytes
 * @upstream Packages/UEFIImage/Sources/UEFIImage/ByteSource.swift#Data.word
 * @upstream Packages/UEFIImage/Sources/UEFIImage/ByteSource.swift#Array.byteCount
 * @upstream Packages/UEFIImage/Sources/UEFIImage/ByteSource.swift#Array.bytes
 * @upstream Packages/UEFIImage/Sources/UEFIImage/ByteSource.swift#Array.word
 * @upstream-differs one source over a Uint8Array stands for both Data and [UInt8]
 */
export function sourceOver(bytes: Uint8Array): ByteSource {
  return {
    byteCount: bytes.length,
    bytes: (start, end) => bytes.subarray(start, end),
    word: (offset, count) => assembleWord(bytes, offset, count),
  };
}

/**
 * A source that keeps the last window it read from another one, so a parse pays
 * one read per window instead of one per field.
 *
 * The parser reads in small, mostly forward steps — a dword here, a GUID there
 * — and each is a round trip to the source. Upstream measured what that costs
 * against live storage: the NVRAM store walk asks twelve recognisers at every
 * byte no store claimed, and a quarter-megabyte run of written-over padding
 * inside one volume is three million round trips for bytes already in hand. On
 * a 16 MiB image, opening that one volume took 6.8 seconds.
 *
 * Only small reads are windowed. A scan asking for its next megabyte, or a
 * free-space check walking a volume in 64 KiB chunks, is already reading in
 * bulk and would do nothing but evict the window.
 *
 * The window is a read cache, so a source whose bytes change under it can be
 * read inconsistently within one parse. That is already true of a live source
 * without it — a parse is not a snapshot — and it is what invalidation answers.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/WindowedByteSource.swift#WindowedByteSource
 */
export class WindowedByteSource implements ByteSource {
  /**
   * Reads longer than this are the caller's own bulk reads and pass through.
   * Every header field this parser reads is far shorter — the longest is a
   * 16-byte GUID.
   */
  private static readonly MAX_CACHED_READ = 512;

  private readonly source: ByteSource;
  private readonly size: number;
  private windowStartOffset = 0;
  private windowEndOffset = 0;
  private cache: Uint8Array = new Uint8Array(0);

  /** @upstream Packages/UEFIImage/Sources/UEFIImage/WindowedByteSource.swift#WindowedByteSource.init */
  constructor(source: ByteSource, window = 64 * 1024) {
    this.source = source;
    this.size = window;
  }

  /** @upstream Packages/UEFIImage/Sources/UEFIImage/WindowedByteSource.swift#WindowedByteSource.byteCount */
  get byteCount(): number {
    return this.source.byteCount;
  }

  /** @upstream Packages/UEFIImage/Sources/UEFIImage/WindowedByteSource.swift#WindowedByteSource.bytes */
  bytes(start: number, end: number): Uint8Array {
    const from = this.window(start, end);
    if (from === undefined) return this.source.bytes(start, end);
    return this.cache.subarray(start - from, end - from);
  }

  /** @upstream Packages/UEFIImage/Sources/UEFIImage/WindowedByteSource.swift#WindowedByteSource.word */
  word(offset: number, count: number): number {
    const from = this.window(offset, offset + count);
    if (from === undefined) {
      return assembleWord(this.source.bytes(offset, offset + count), 0, count);
    }
    return assembleWord(this.cache, offset - from, count);
  }

  /**
   * Makes sure `[start, end)` is inside the window and answers where the window
   * starts, or nothing for a read not worth windowing.
   */
  private window(start: number, end: number): number | undefined {
    if (end - start > WindowedByteSource.MAX_CACHED_READ) return undefined;
    if (this.windowStartOffset <= start && end <= this.windowEndOffset) {
      return this.windowStartOffset;
    }
    const to = Math.min(start + this.size, this.byteCount);
    if (to < end) return undefined;
    const read = this.source.bytes(start, to);
    if (read.length !== to - start) {
      this.cache = new Uint8Array(0);
      this.windowStartOffset = 0;
      this.windowEndOffset = 0;
      return undefined;
    }
    this.cache = read;
    this.windowStartOffset = start;
    this.windowEndOffset = to;
    return start;
  }
}
