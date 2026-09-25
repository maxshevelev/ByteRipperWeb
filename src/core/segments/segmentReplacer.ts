/**
 * Replacing one piece's bytes with a file's (§21.6).
 *
 * Ported from `SegmentReplacer.swift`. The read-side mirror of
 * `segmentWriter.ts`: that one streams pieces *out* to files, this one streams
 * one file *into* a piece. The donor is read in bounded slices and each slice
 * is written through the document, so a large piece is never held whole; the
 * whole swap is one edit group, so it undoes in one step.
 *
 * **By default the length must match exactly, and a mismatch is refused.**
 * Making it an insert-and-shift is a decision, not a default — every offset
 * after the piece would move, which for a firmware dump is the difference
 * between a patched image and a ruined one. The refusal names both sizes so
 * the caller can say what it expected and what it got. A swap that is
 * *allowed* to change the length (Revert Segment, §21.7, and a replace the
 * user agreed to resize) writes the stretch both sides have in place and adds
 * or removes the difference at the piece's tail, so the cuts after it move by
 * exactly that much and no cut inside the piece is disturbed.
 *
 * A same-length overwrite moves no cut (§21.2): the document's size is
 * unchanged, so the partition's boundaries do not shift.
 */

import type { BinaryDocument } from "@/core/document/binaryDocument";
import type { ByteStorage } from "@/core/storage/byteStorage";
import { CONTENT_CHUNK_SIZE, rangeStream } from "@/core/storage/contentStream";

/**
 * The one refusal the swap makes. Both sizes, so the caller can say both.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SegmentReplacer.swift#SegmentReplaceError
 */
export class SegmentLengthMismatch extends Error {
  readonly pieceLength: number;
  readonly donorLength: number;

  constructor(pieceLength: number, donorLength: number) {
    super(
      `This piece is ${pieceLength} bytes and the file is ${donorLength}. ` +
        "The file must be exactly the same length to replace the piece."
    );
    this.name = "SegmentLengthMismatch";
    this.pieceLength = pieceLength;
    this.donorLength = donorLength;
  }
}

/**
 * What a swap did to the document's length (§21.6, §21.7), so the caller can
 * move the partition's boundaries with it. A same-length swap reports
 * `none` — the cuts do not move.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SegmentReplacer.swift#SegmentReplaceOutcome
 * @upstream-differs a tagged union, the web's shape for sum types (D13's
 * half-open `deleted` range as two offsets, not a `Range` value)
 */
export type SegmentReplaceOutcome =
  /** The donor matched the piece: bytes changed, no offset did. */
  | { readonly kind: "none" }
  /** The donor was longer: `length` bytes were inserted at `at`, the piece's old end. */
  | { readonly kind: "inserted"; readonly at: number; readonly length: number }
  /** The donor was shorter: `[start, end)` was removed from the piece's tail. */
  | { readonly kind: "deleted"; readonly start: number; readonly end: number };

export interface SegmentReplaceRequest {
  readonly document: BinaryDocument;
  /** The piece, half-open `[start, end)`. Clamped to what the document holds. */
  readonly start: number;
  readonly end: number;
  readonly donor: ByteStorage;
  /** Names the undo step — "Undo Replace S1". */
  readonly label?: string;
  /**
   * Lets the donor's length differ from the piece's, adding or removing the
   * difference at the piece's tail. Off by default: the mismatch is refused.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SegmentReplacer.swift#SegmentReplacer.replace
   */
  readonly allowingLengthChange?: boolean;
  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SegmentReplacer.swift#SegmentReplacer.chunkSize */
  readonly chunkSize?: number;
}

/** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SegmentReplacer.swift#SegmentReplacer.replace */
export async function replaceSegment(
  request: SegmentReplaceRequest
): Promise<SegmentReplaceOutcome> {
  const { document, donor } = request;
  // The piece as the document actually holds it: a range past the end would
  // otherwise be *appended* by the overwrite below, growing the file and moving
  // every cut after it.
  const start = Math.min(Math.max(request.start, 0), document.size);
  const end = Math.min(Math.max(request.end, 0), document.size);
  const length = Math.max(end - start, 0);
  const donorLength = donor.size;

  if (!request.allowingLengthChange && donorLength !== length) {
    throw new SegmentLengthMismatch(length, donorLength);
  }
  if (length === 0 && donorLength === 0) return { kind: "none" };

  // The stretch both sides have: written in place, wherever the lengths end
  // up. What is left over is the tail — added after it, or cut off it — and
  // it is the only part that moves an offset.
  const common = Math.min(length, donorLength);
  let outcome: SegmentReplaceOutcome = { kind: "none" };
  const chunkSize = request.chunkSize ?? CONTENT_CHUNK_SIZE;

  document.beginEditGroup(request.label);
  let target = start;
  try {
    for await (const chunk of rangeStream(donor, 0, common, chunkSize)) {
      // A short read means the donor shrank under us, and `rangeStream` throws
      // rather than returning it. Stopping quietly here would commit HALF a
      // swap as one transaction and call it a success: the piece would hold the
      // donor's first chunks and the document's own bytes after them.
      await document.overwrite(target, chunk);
      target += chunk.length;
    }
    if (donorLength > length) {
      // The donor's tail goes in at the piece's old end, in the same bounded
      // chunks, so a long donor is never held whole in RAM.
      let at = end;
      for await (const chunk of rangeStream(donor, common, donorLength, chunkSize)) {
        await document.insert(at, chunk);
        at += chunk.length;
      }
      outcome = { kind: "inserted", at: end, length: donorLength - length };
    } else if (donorLength < length) {
      const tailStart = start + donorLength;
      await document.delete(tailStart, end);
      outcome = { kind: "deleted", start: tailStart, end };
    }
  } catch (error) {
    // Revert the partial group and record nothing, so the document is left
    // exactly as it was.
    await document.cancelEditGroup();
    throw error;
  }
  document.endEditGroup();
  return outcome;
}
