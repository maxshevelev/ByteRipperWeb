import { sourceOver } from "@/firmware/byteSource";
import type { DecompressionFailure } from "@/firmware/compression/firmwareDecompression";
import { type ImageRange, ImageReader } from "@/firmware/imageReader";
import { type ByteSpace, spaceKey } from "@/firmware/uefi/byteSpace";
import {
  type CompressionAlgorithm,
  decodeCompressedSection,
  locateCompressedSection,
} from "@/firmware/uefi/compressedSection";

/**
 * The buffers compressed sections decompress to, kept so that a branch opened,
 * closed and opened again is decoded once.
 *
 * A decoded DXE volume is megabytes, so what is kept is bounded: past the budget
 * the least recently used buffer goes, and the next read that needs it decodes
 * it again from the file. That is always possible, because a `ByteSpace` names
 * every compressed section on the way in by its offset, and the section headers
 * at those offsets are all a decode needs.
 *
 * Ported from `Packages/UEFIImage/Sources/UEFIImage/DecompressedBuffers.swift`.
 * Upstream takes a lock around every access, its materializations running on
 * whatever thread `Task.detached` picks; here a worker is one thread, so there
 * is nothing to take.
 */

/**
 * Why a space could not be read: the compressed section that did not decode, in
 * the space its header is in.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DecompressedBuffers.swift#DecompressedBuffers.Problem
 */
export interface BufferProblem {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/DecompressedBuffers.swift#DecompressedBuffers.Problem.section */
  readonly section: number;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/DecompressedBuffers.swift#DecompressedBuffers.Problem.space */
  readonly space: ByteSpace;
  /**
   * Nothing when there was no decodable section at that offset at all — the
   * bytes changed under a space that named one.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/DecompressedBuffers.swift#DecompressedBuffers.Problem.algorithm
   */
  readonly algorithm?: CompressionAlgorithm | undefined;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/DecompressedBuffers.swift#DecompressedBuffers.Problem.failure */
  readonly failure: DecompressionFailure;
}

/** A reader over a space's bytes, or the section on the way in that stopped it. */
export type SpaceRead =
  | { readonly ok: true; readonly reader: ImageReader }
  | { readonly ok: false; readonly problem: BufferProblem };

/** @upstream Packages/UEFIImage/Sources/UEFIImage/DecompressedBuffers.swift#DecompressedBuffers.Entry */
interface Entry {
  readonly bytes: Uint8Array;
  /**
   * The outermost compressed section's bytes in the file — what an edit has to
   * touch for this buffer to be stale.
   */
  readonly fileRange: ImageRange;
  lastUse: number;
}

/** @upstream Packages/UEFIImage/Sources/UEFIImage/DecompressedBuffers.swift#DecompressedBuffers */
export class DecompressedBuffers {
  private readonly entries = new Map<string, Entry>();
  private clock = 0;
  private held = 0;
  private readonly budget: number;

  /** @upstream Packages/UEFIImage/Sources/UEFIImage/DecompressedBuffers.swift#DecompressedBuffers.init */
  constructor(budget = 256 * 1024 * 1024) {
    this.budget = budget;
  }

  /**
   * How many buffers are held, for the tests that pin the cache down.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/DecompressedBuffers.swift#DecompressedBuffers.count
   */
  get count(): number {
    return this.entries.size;
  }

  /**
   * A reader over the bytes of `space`: the file itself, or the buffer at the
   * end of its chain, decoding whatever on the way is not held.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/DecompressedBuffers.swift#DecompressedBuffers.reader
   */
  readerFor(space: ByteSpace, file: ImageReader, limit: number): SpaceRead {
    const outermost = space[0];
    if (outermost === undefined) return { ok: true, reader: file };

    let parent = file;
    let parentSpace: ByteSpace = [];
    let outerRange: ImageRange | undefined;

    for (let depth = 0; depth < space.length; depth++) {
      const key = space.slice(0, depth + 1);
      const offset = space[depth] ?? 0;
      const held = this.use(spaceKey(key));
      if (held !== undefined) {
        parent = new ImageReader(sourceOver(held.bytes));
        parentSpace = key;
        outerRange = held.fileRange;
        continue;
      }
      const located = locateCompressedSection(offset, parent);
      if (located === undefined) {
        return {
          ok: false,
          problem: { section: offset, space: parentSpace, failure: { kind: "corrupt" } },
        };
      }
      const fileRange = outerRange ?? { start: outermost, end: located.body.end };
      const decoded = decodeCompressedSection(located, parent, limit);
      if (!decoded.ok) {
        return {
          ok: false,
          problem: {
            section: offset,
            space: parentSpace,
            algorithm: located.algorithm,
            failure: decoded.failure,
          },
        };
      }
      this.store(spaceKey(key), decoded.bytes, fileRange);
      parent = new ImageReader(sourceOver(decoded.bytes));
      parentSpace = key;
      outerRange = fileRange;
    }
    return { ok: true, reader: parent };
  }

  /**
   * Forgets every buffer whose section an overwrite of `range` touched.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/DecompressedBuffers.swift#DecompressedBuffers.drop
   */
  dropOverlapping(range: ImageRange): void {
    this.removeWhere(
      (entry) => entry.fileRange.start < range.end && range.start < entry.fileRange.end
    );
  }

  /**
   * Forgets every buffer whose section reaches `offset` or beyond — what an
   * insert or a delete there may have moved.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/DecompressedBuffers.swift#DecompressedBuffers.drop
   */
  dropFrom(offset: number): void {
    this.removeWhere((entry) => entry.fileRange.end > offset);
  }

  // MARK: - Private

  /** @upstream Packages/UEFIImage/Sources/UEFIImage/DecompressedBuffers.swift#DecompressedBuffers.use */
  private use(key: string): Entry | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) return undefined;
    this.clock += 1;
    entry.lastUse = this.clock;
    return entry;
  }

  /** @upstream Packages/UEFIImage/Sources/UEFIImage/DecompressedBuffers.swift#DecompressedBuffers.store */
  private store(key: string, bytes: Uint8Array, fileRange: ImageRange): void {
    this.clock += 1;
    const old = this.entries.get(key);
    if (old !== undefined) this.held -= old.bytes.length;
    this.entries.set(key, { bytes, fileRange, lastUse: this.clock });
    this.held += bytes.length;

    // Never the one just stored: a buffer larger than the whole budget is still
    // the one the caller is about to read.
    while (this.held > this.budget && this.entries.size > 1) {
      let oldestKey: string | undefined;
      let oldest: Entry | undefined;
      for (const [candidate, entry] of this.entries) {
        if (candidate === key) continue;
        if (oldest === undefined || entry.lastUse < oldest.lastUse) {
          oldestKey = candidate;
          oldest = entry;
        }
      }
      if (oldestKey === undefined || oldest === undefined) break;
      this.held -= oldest.bytes.length;
      this.entries.delete(oldestKey);
    }
  }

  /** @upstream Packages/UEFIImage/Sources/UEFIImage/DecompressedBuffers.swift#DecompressedBuffers.removeEntries */
  private removeWhere(stale: (entry: Entry) => boolean): void {
    for (const [key, entry] of [...this.entries]) {
      if (!stale(entry)) continue;
      this.held -= entry.bytes.length;
      this.entries.delete(key);
    }
  }
}
