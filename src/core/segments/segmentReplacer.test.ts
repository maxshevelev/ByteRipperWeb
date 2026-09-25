import { describe, expect, it } from "vitest";
import { BinaryDocument } from "@/core/document/binaryDocument";
import { type Segmentation, wholeFile } from "@/core/segments/segmentation";
import { replaceSegment, SegmentLengthMismatch } from "@/core/segments/segmentReplacer";
import type { ByteStorage, Bytes } from "@/core/storage/byteStorage";
import { ContentUnreadable } from "@/core/storage/contentStream";
import { EditOverlayStorage } from "@/core/storage/editOverlayStorage";
import { asArray, countingBytes, readAll, storageOver } from "@/core/testing/support";

/**
 * Ported from `SegmentReplaceTests.swift`, which drives the swap through
 * `MainViewController` and its open panel. The panel is the platform layer's;
 * what upstream's tests assert about the *document* — the bytes after a swap,
 * that one undo takes it all back, the refusal's two sizes, and that no cut
 * moves — is all here.
 */

const documentOf = (bytes: Uint8Array) =>
  new BinaryDocument(new EditOverlayStorage(storageOver(bytes)));

const content = async (document: BinaryDocument) => asArray(await readAll(document.storage));

/** S0 [0, 8), S1 [8, 16) — upstream's partition throughout these tests. */
const cutAt8 = (): Segmentation => {
  const split = wholeFile(16).addCut(8);
  if (split === undefined) throw new Error("the fixture's cut was refused");
  return split;
};

const donorBytes = new Uint8Array([0xa0, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7]);

// @upstream ByteRipperTests/SegmentReplaceTests.swift#SegmentReplaceTests.testTheBytesAfterASwap
describe("the bytes after a swap", () => {
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SegmentReplacerTests.swift#SegmentReplacerTests.testTheDonorsBytesLandInTheRange
  it("gives the piece the donor's bytes and leaves the rest alone", async () => {
    const document = documentOf(countingBytes(16));

    await replaceSegment({ document, start: 8, end: 16, donor: storageOver(donorBytes) });

    expect(await content(document)).toEqual([...countingBytes(8), ...donorBytes]);
  });

  it("streams a large donor in bounded chunks rather than reading it whole", async () => {
    const document = documentOf(countingBytes(4096));
    const source = storageOver(countingBytes(2048, 0x80));
    const reads: number[] = [];
    const donor: ByteStorage = {
      size: source.size,
      read: (at, length) => {
        reads.push(length);
        return source.read(at, length);
      },
      peek: (at, length) => source.peek(at, length),
      prefetch: (at, length) => source.prefetch(at, length),
    };

    await replaceSegment({ document, start: 2048, end: 4096, donor, chunkSize: 512 });

    expect(reads).toEqual([512, 512, 512, 512]);
    expect((await content(document)).slice(2048)).toEqual(asArray(countingBytes(2048, 0x80)));
  });
});

describe("a swap that changes the length", () => {
  // A longer donor writes the stretch both sides have in place and adds the
  // rest at the piece's tail, so the bytes after the piece move by exactly the
  // difference and nothing inside it is disturbed.
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SegmentReplacerTests.swift#SegmentReplacerTests.testALongerDonorAddsItsTailAtThePiecesEnd
  it("adds the longer donor's tail at the piece's end", async () => {
    const document = documentOf(countingBytes(16));
    const donor = storageOver(new Uint8Array([0xa0, 0xa1, 0xa2, 0xa3]));

    const outcome = await replaceSegment({
      document,
      start: 4,
      end: 6,
      donor,
      allowingLengthChange: true,
    });

    expect(outcome).toEqual({ kind: "inserted", at: 6, length: 2 });
    expect(document.size).toBe(18);
    const bytes = await content(document);
    expect(bytes.slice(4, 8)).toEqual([0xa0, 0xa1, 0xa2, 0xa3]);
    // the bytes after the piece moved right by the difference
    expect(bytes.slice(8, 10)).toEqual([0x06, 0x07]);
    // and the bytes before it did not move at all
    expect(bytes.slice(0, 4)).toEqual([0x00, 0x01, 0x02, 0x03]);
  });

  // A shorter donor removes the leftover from the piece's tail, and the bytes
  // after it move left by the difference.
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SegmentReplacerTests.swift#SegmentReplacerTests.testAShorterDonorCutsThePiecesTail
  it("cuts the shorter donor's leftover off the piece's tail", async () => {
    const document = documentOf(countingBytes(16));
    const donor = storageOver(new Uint8Array([0xa0, 0xa1]));

    const outcome = await replaceSegment({
      document,
      start: 4,
      end: 8,
      donor,
      allowingLengthChange: true,
    });

    expect(outcome).toEqual({ kind: "deleted", start: 6, end: 8 });
    expect(document.size).toBe(14);
    const bytes = await content(document);
    expect(bytes.slice(4, 6)).toEqual([0xa0, 0xa1]);
    // the bytes after the piece moved left by the difference
    expect(bytes.slice(6, 8)).toEqual([0x08, 0x09]);
  });

  // The whole of a length-changing swap — the overwrite and the tail — is one
  // transaction, so undo takes it back in one step.
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SegmentReplacerTests.swift#SegmentReplacerTests.testALengthChangingSwapIsOneTransaction
  it("is taken back by a single undo, length change and all", async () => {
    const document = documentOf(countingBytes(16));
    const donor = storageOver(new Uint8Array([0xa0, 0xa1, 0xa2, 0xa3]));
    await replaceSegment({
      document,
      start: 4,
      end: 6,
      donor,
      allowingLengthChange: true,
    });

    expect(await document.undo()).toBeDefined();

    expect(document.size).toBe(16);
    expect(await content(document)).toEqual(asArray(countingBytes(16)));
    // one step took the whole swap back
    expect(document.canUndo).toBe(false);
  });

  // Without being asked for by name, a mismatch is still refused before a byte
  // is written: making it an insert-and-shift is a decision.
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SegmentReplacerTests.swift#SegmentReplacerTests.testAMismatchIsStillRefusedByDefault
  it("still refuses a mismatch when the length change was not asked for", async () => {
    const document = documentOf(countingBytes(16));
    const donor = storageOver(new Uint8Array([0xa0, 0xa1]));

    const error = await replaceSegment({ document, start: 4, end: 8, donor }).catch((e) => e);

    expect(error).toBeInstanceOf(SegmentLengthMismatch);
    expect(error).toMatchObject({ pieceLength: 4, donorLength: 2 });
    expect(document.size).toBe(16);
  });
});

// @upstream ByteRipperTests/SegmentReplaceTests.swift#SegmentReplaceTests.testOneUndoRestoresTheSwap
describe("the swap as one undo step", () => {
  // The whole swap is one transaction, so one undo takes it all back — however
  // many chunks it was written in.
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SegmentReplacerTests.swift#SegmentReplacerTests.testAMultiChunkSwapIsOneTransaction
  it("is taken back by a single undo", async () => {
    const document = documentOf(countingBytes(16));
    await replaceSegment({
      document,
      start: 8,
      end: 16,
      donor: storageOver(donorBytes),
      chunkSize: 2,
    });
    expect((await content(document)).slice(8)).toEqual(asArray(donorBytes));

    expect(await document.undo()).toBeDefined();

    expect(await content(document)).toEqual(asArray(countingBytes(16)));
    expect(document.canUndo).toBe(false);
  });

  it("names the undo step after the piece", async () => {
    const document = documentOf(countingBytes(16));

    await replaceSegment({
      document,
      start: 8,
      end: 16,
      donor: storageOver(donorBytes),
      label: "Replace S1",
    });

    expect(document.undoHistory.undoLabel).toBe("Replace S1");
  });
});

describe("the refusal", () => {
  // Making a mismatch an insert-and-shift is a decision, not a default: every
  // offset after the piece would move.
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SegmentReplacerTests.swift#SegmentReplacerTests.testALengthMismatchIsRefusedWithBothSizes
  // @upstream ByteRipperTests/SegmentReplaceTests.swift#SegmentReplaceTests.testTheRefusalNamesBothSizes
  it("names both sizes when the donor is the wrong length", async () => {
    const document = documentOf(countingBytes(16));
    const donor = storageOver(new Uint8Array([0xb0, 0xb1, 0xb2]));

    const error = await replaceSegment({ document, start: 8, end: 16, donor }).catch((e) => e);

    expect(error).toBeInstanceOf(SegmentLengthMismatch);
    expect(error).toMatchObject({ pieceLength: 8, donorLength: 3 });
  });

  it("writes nothing at all when it refuses", async () => {
    const document = documentOf(countingBytes(16));
    const donor = storageOver(new Uint8Array([0xb0, 0xb1, 0xb2]));

    await expect(replaceSegment({ document, start: 8, end: 16, donor })).rejects.toThrow(
      SegmentLengthMismatch
    );

    expect(await content(document)).toEqual(asArray(countingBytes(16)));
    expect(document.canUndo).toBe(false);
    expect(document.isDirty).toBe(false);
  });

  // A short read means the donor shrank under us. Stopping quietly would commit
  // HALF a swap as one transaction and call it a success: the piece would hold
  // the donor's first chunks and the document's own bytes after them.
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SegmentReplacerTests.swift#SegmentReplacerTests.testAShortDonorReadLeavesTheDocumentUnchanged
  it("rolls the whole swap back when the donor shrinks part-way", async () => {
    const document = documentOf(countingBytes(16));
    let served = 0;
    const donor: ByteStorage = {
      size: 8,
      // The first chunk arrives; the second comes back short.
      read: async (_at, length) => new Uint8Array(served++ === 0 ? length : 1) as Bytes,
      peek: () => undefined,
      prefetch: async () => undefined,
    };

    await expect(
      replaceSegment({ document, start: 8, end: 16, donor, chunkSize: 4 })
    ).rejects.toThrow(ContentUnreadable);

    expect(await content(document)).toEqual(asArray(countingBytes(16)));
    expect(document.canUndo).toBe(false);
    expect(document.isDirty).toBe(false);
  });
});

describe("what a swap does to the partition", () => {
  // A same-length swap changes no size, so the partition's boundaries do not
  // shift: the cuts stay where they were.
  // @upstream ByteRipperTests/SegmentStoreTests.swift#SegmentStoreTests.testOverwritingNeverMovesACut
  it("moves no cut", async () => {
    const document = documentOf(countingBytes(16));
    const partition = cutAt8();

    await replaceSegment({ document, start: 8, end: 16, donor: storageOver(donorBytes) });
    const after = partition.applyEdit({ kind: "overwrite", start: 8, end: 16 }, document.size);

    expect(after.partition.cuts).toEqual([8]);
    expect(after.moved).toBe(false);
  });
});
