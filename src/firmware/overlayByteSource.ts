import { assembleWord, type ByteSource } from "@/firmware/byteSource";

/**
 * A source read as though a set of writes had already been made.
 *
 * A checksum describes bytes *as they will be*, not as they are — so an edit
 * that changes a file's body and has to leave that file's `IntegrityCheck`
 * correct must compute the new sum over the image the transaction is about to
 * produce. Without this the repair would describe the bytes it is replacing,
 * which is precisely the defect the repair exists to fix.
 *
 * It writes nothing. The patches sit in front of the base for the length of a
 * read and no longer, which is what lets the whole of a transaction be checked
 * before any of it is applied.
 *
 * Ported from `Packages/UEFIImage/OverlayByteSource.swift`.
 */

export interface OverlayPatch {
  readonly offset: number;
  readonly bytes: Uint8Array;
}

export class OverlayByteSource implements ByteSource {
  private readonly base: ByteSource;
  private readonly patches: readonly OverlayPatch[];

  /** Later patches win, so they are applied in the order they were given. */
  constructor(base: ByteSource, patches: readonly OverlayPatch[]) {
    this.base = base;
    this.patches = patches;
  }

  get byteCount(): number {
    return this.base.byteCount;
  }

  bytes(start: number, end: number): Uint8Array {
    const read = Uint8Array.from(this.base.bytes(start, end));
    for (const patch of this.patches) {
      // Where the patch and the read actually meet, which is nowhere at all for
      // most patches of most reads.
      const from = Math.max(patch.offset, start);
      const to = Math.min(patch.offset + patch.bytes.length, end);
      if (from >= to) continue;
      read.set(patch.bytes.subarray(from - patch.offset, to - patch.offset), from - start);
    }
    return read;
  }

  word(offset: number, count: number): number {
    return assembleWord(this.bytes(offset, offset + count), 0, count);
  }
}
