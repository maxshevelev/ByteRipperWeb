/**
 * Replacing one piece's bytes with a file's, same length (§21.6).
 *
 * Ported from `SegmentReplacer.swift`. The read-side mirror of
 * `segmentWriter.ts`: that one streams pieces *out* to files, this one streams
 * one file *into* a piece. The donor is read in bounded slices and each slice
 * is written through the document, so a large piece is never held whole; the
 * whole swap is one edit group, so it undoes in one step.
 *
 * **The length must match exactly, and a mismatch is refused.** Making it an
 * insert-and-shift is a decision, not a default — every offset after the piece
 * would move, which for a firmware dump is the difference between a patched
 * image and a ruined one. The refusal names both sizes so the caller can say
 * what it expected and what it got.
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

export interface SegmentReplaceRequest {
  readonly document: BinaryDocument;
  /** The piece, half-open `[start, end)`. Clamped to what the document holds. */
  readonly start: number;
  readonly end: number;
  readonly donor: ByteStorage;
  /** Names the undo step — "Undo Replace S1". */
  readonly label?: string;
  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SegmentReplacer.swift#SegmentReplacer.chunkSize */
  readonly chunkSize?: number;
}

/** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SegmentReplacer.swift#SegmentReplacer.replace */
export async function replaceSegment(request: SegmentReplaceRequest): Promise<void> {
  const { document, donor } = request;
  // The piece as the document actually holds it: a range past the end would
  // otherwise be *appended* by the overwrite below, growing the file and moving
  // every cut after it.
  const start = Math.min(Math.max(request.start, 0), document.size);
  const end = Math.min(Math.max(request.end, 0), document.size);
  const length = Math.max(end - start, 0);

  if (donor.size !== length) throw new SegmentLengthMismatch(length, donor.size);
  if (length === 0) return;

  document.beginEditGroup(request.label);
  let target = start;
  try {
    for await (const chunk of rangeStream(
      donor,
      0,
      donor.size,
      request.chunkSize ?? CONTENT_CHUNK_SIZE
    )) {
      // A short read means the donor shrank under us, and `rangeStream` throws
      // rather than returning it. Stopping quietly here would commit HALF a
      // swap as one transaction and call it a success: the piece would hold the
      // donor's first chunks and the document's own bytes after them.
      await document.overwrite(target, chunk);
      target += chunk.length;
    }
  } catch (error) {
    // Revert the partial group and record nothing, so the document is left
    // exactly as it was.
    await document.cancelEditGroup();
    throw error;
  }
  document.endEditGroup();
}
