import { assembleBits, type ByteSource } from "@/firmware/byteSource";
import { type EFIGUID, guidFromBytes } from "@/firmware/uefi/efiGuid";

/**
 * Bounds-checked, little-endian reads over a {@link ByteSource}.
 *
 * Every field the parser reads comes from untrusted data, so every read
 * returns `undefined` rather than throwing, and every range is built through
 * {@link ImageReader.range}, which is written to survive the additions that
 * overflow — `offset + size` where both came out of a corrupt image. A parser
 * that bounds-checks in one place is a parser where "did we check?" has one
 * answer.
 *
 * Offsets are absolute, from the start of the image, never relative to a
 * parent. Nesting is deep here — volume, file, section, volume again — and
 * relative offsets that far down are how a node ends up drawn in the wrong
 * place.
 */

/** A half-open byte range, the application's convention throughout. */
export interface ImageRange {
  readonly start: number;
  readonly end: number;
}

export const rangeLength = (range: ImageRange): number => range.end - range.start;

/** Where a chunked read stops. Free space is megabytes; the answer rarely is. */
const CHUNK_SIZE = 64 * 1024;

/** @upstream Packages/UEFIImage/Sources/UEFIImage/ByteSource.swift#ImageReader */
export class ImageReader {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/ByteSource.swift#ImageReader.source */
  readonly source: ByteSource;

  /** @upstream Packages/UEFIImage/Sources/UEFIImage/ByteSource.swift#ImageReader.init */
  constructor(source: ByteSource) {
    this.source = source;
  }

  /** @upstream Packages/UEFIImage/Sources/UEFIImage/ByteSource.swift#ImageReader.count */
  get count(): number {
    return this.source.byteCount;
  }

  /**
   * The whole image as one range.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/ByteSource.swift#ImageReader.all
   */
  get all(): ImageRange {
    return { start: 0, end: this.count };
  }

  /**
   * `[offset, offset + count)`, or nothing if that would overflow or run past
   * the end of the image.
   *
   * "Overflow" here is a number that has stopped being an integer: a corrupt
   * eight-byte size read as a double is past 2^53 long before it is past the
   * image, and arithmetic on it silently stops being exact.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/ByteSource.swift#ImageReader.range
   */
  range(offset: number, count: number): ImageRange | undefined {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(count)) return undefined;
    if (offset < 0 || count < 0) return undefined;
    const end = offset + count;
    if (!Number.isSafeInteger(end) || end > this.count) return undefined;
    return { start: offset, end };
  }

  /** @upstream Packages/UEFIImage/Sources/UEFIImage/ByteSource.swift#ImageReader.has */
  has(range: ImageRange): boolean {
    return range.start >= 0 && range.end <= this.count && range.start <= range.end;
  }

  /** @upstream Packages/UEFIImage/Sources/UEFIImage/ByteSource.swift#ImageReader.bytes */
  bytes(range: ImageRange): Uint8Array | undefined {
    if (!this.has(range)) return undefined;
    if (range.end === range.start) return new Uint8Array(0);
    return this.source.bytes(range.start, range.end);
  }

  /** @upstream Packages/UEFIImage/Sources/UEFIImage/ByteSource.swift#ImageReader.bytes */
  bytesAt(offset: number, count: number): Uint8Array | undefined {
    const range = this.range(offset, count);
    return range === undefined ? undefined : this.bytes(range);
  }

  /**
   * The fields, all through {@link ByteSource.word}: bounds-checked here,
   * assembled by whoever can do it cheapest. A source with the bytes already in
   * hand answers without building an array, which is what keeps a walk that
   * reads a dword at every byte from allocating millions of them.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/ByteSource.swift#ImageReader.uint8
   */
  uint8(offset: number): number | undefined {
    return this.range(offset, 1) === undefined ? undefined : this.source.word(offset, 1);
  }

  /** @upstream Packages/UEFIImage/Sources/UEFIImage/ByteSource.swift#ImageReader.uint16 */
  uint16(offset: number): number | undefined {
    return this.range(offset, 2) === undefined ? undefined : this.source.word(offset, 2);
  }

  /**
   * The three-byte size field FFS files and sections use.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/ByteSource.swift#ImageReader.uint24
   */
  uint24(offset: number): number | undefined {
    return this.range(offset, 3) === undefined ? undefined : this.source.word(offset, 3);
  }

  /** @upstream Packages/UEFIImage/Sources/UEFIImage/ByteSource.swift#ImageReader.uint32 */
  uint32(offset: number): number | undefined {
    return this.range(offset, 4) === undefined ? undefined : this.source.word(offset, 4);
  }

  /**
   * Exact to 2^53, which covers every offset and size a real image holds. A
   * corrupt length past that comes back rounded — and then every bounds check
   * it feeds fails, which is the same answer as reading it exactly.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/ByteSource.swift#ImageReader.uint64
   */
  uint64(offset: number): number | undefined {
    return this.range(offset, 8) === undefined ? undefined : this.source.word(offset, 8);
  }

  /** The same eight bytes where every one of them matters — a magic number. */
  uint64Bits(offset: number): bigint | undefined {
    const bytes = this.bytesAt(offset, 8);
    return bytes === undefined ? undefined : assembleBits(bytes, 0, 8);
  }

  /** @upstream Packages/UEFIImage/Sources/UEFIImage/ByteSource.swift#ImageReader.guid */
  guid(offset: number): EFIGUID | undefined {
    const bytes = this.bytesAt(offset, 16);
    return bytes === undefined ? undefined : guidFromBytes(bytes);
  }

  /**
   * Whether every byte of `range` is `byte` — how free space, an empty padding
   * element and an empty microcode slot are told apart from data.
   *
   * Out of bounds is "no", not "vacuously yes": free space is decided with
   * this, and a range past the end must never read as empty space.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/ByteSource.swift#ImageReader.isFilled
   */
  isFilled(range: ImageRange, byte: number): boolean {
    if (!this.has(range) || rangeLength(range) === 0) return this.has(range);
    let filled = true;
    this.forEachChunk(range, (chunk) => {
      filled = chunk.every((one) => one === byte);
      return filled;
    });
    return filled;
  }

  /**
   * The first byte of `range` that is not `byte`, or nothing if there is none.
   *
   * This is how the end of a volume's free space is found, so it reads in
   * chunks: the range is usually most of a volume.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/ByteSource.swift#ImageReader.firstOffset
   */
  firstOffsetNotEqualTo(range: ImageRange, byte: number): number | undefined {
    let found: number | undefined;
    let scanned = 0;
    this.forEachChunk(range, (chunk) => {
      const index = chunk.findIndex((one) => one !== byte);
      if (index >= 0) {
        found = range.start + scanned + index;
        return false;
      }
      scanned += chunk.length;
      return true;
    });
    return found;
  }

  /**
   * Walks `range` in chunks, stopping early when `body` returns false. Out of
   * bounds is no chunks at all, which every caller reads as "nothing matched"
   * rather than as a silent success.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/ByteSource.swift#ImageReader.forEachChunk
   */
  forEachChunk(range: ImageRange, body: (chunk: Uint8Array) => boolean, size = CHUNK_SIZE): void {
    if (!this.has(range) || size <= 0) return;
    let offset = range.start;
    while (offset < range.end) {
      const end = Math.min(offset + size, range.end);
      if (!body(this.source.bytes(offset, end))) return;
      offset = end;
    }
  }
}
