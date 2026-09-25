import type { ByteStorage, Bytes } from "@/core/storage/byteStorage";

/**
 * A window onto part of another storage: byte `i` of the slice is byte
 * `start + i` of the base (§21.7).
 *
 * What a piece's *source* is, when the piece stands for a stretch of a file
 * rather than the whole of it: a segment split in two leaves two pieces linked
 * to one file at different offsets, and a revert or a comparison against either
 * of them wants that stretch as a storage of its own, without copying its
 * bytes.
 *
 * The window is fixed at the offsets it was built with and clamped to the
 * base's size *at read time*, so a base that shrinks underneath (a source file
 * rewritten on disk) short-reads at the end rather than reading someone else's
 * bytes: `size` never exceeds what the base can actually supply.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SlicedStorage.swift#SlicedStorage
 * @upstream-differs `size` is a getter where upstream's is a computed property,
 * and the class carries `peek`/`prefetch` — the web's synchronous read path
 * (`byteStorage.ts`) — delegating to the base the way every other read does
 */
export class SlicedStorage implements ByteStorage {
  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SlicedStorage.swift#SlicedStorage.base */
  private readonly base: ByteStorage;
  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SlicedStorage.swift#SlicedStorage.start */
  private readonly start: number;
  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SlicedStorage.swift#SlicedStorage.length */
  private readonly length: number;

  /**
   * The slice of `base` covering `[start, end)`, clamped to the base's
   * current size.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SlicedStorage.swift#SlicedStorage.init
   * @upstream-differs the half-open range as two offsets, per D13, rather than
   * a `Range` value
   */
  constructor(base: ByteStorage, start: number, end: number) {
    this.base = base;
    this.start = Math.max(start, 0);
    this.length = end > this.start ? end - this.start : 0;
  }

  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SlicedStorage.swift#SlicedStorage.size */
  get size(): number {
    const baseSize = this.base.size;
    if (this.start >= baseSize) return 0;
    return Math.min(this.length, baseSize - this.start);
  }

  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SlicedStorage.swift#SlicedStorage.read */
  async read(at: number, length: number): Promise<Bytes> {
    const span = this.clamp(at, length);
    if (span === undefined) return new Uint8Array(0);
    return this.base.read(this.start + span.at, span.count);
  }

  /** The window's bytes from the base's own cache, or `undefined` on a miss. */
  peek(at: number, length: number): Bytes | undefined {
    const span = this.clamp(at, length);
    if (span === undefined) return new Uint8Array(0);
    return this.base.peek(this.start + span.at, span.count);
  }

  /** Brings the window's bytes into the base's cache, so a later `peek` hits. */
  async prefetch(at: number, length: number): Promise<void> {
    const span = this.clamp(at, length);
    if (span === undefined) return;
    await this.base.prefetch(this.start + span.at, span.count);
  }

  /**
   * The window actually available at `at`, or `undefined` when there is none —
   * a read past the slice's end, or of nothing. As upstream's contract
   * requires, reads are clamped rather than refused: the window is the whole
   * of what the slice can answer for, never the base's next bytes.
   */
  private clamp(at: number, length: number): { at: number; count: number } | undefined {
    if (length <= 0 || at < 0) return undefined;
    const available = this.size;
    if (at >= available) return undefined;
    return { at, count: Math.min(length, available - at) };
  }
}
