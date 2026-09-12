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

describe("the bytes after a swap", () => {
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

describe("the swap as one undo step", () => {
  // The whole swap is one transaction, so one undo takes it all back — however
  // many chunks it was written in.
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
  it("moves no cut", async () => {
    const document = documentOf(countingBytes(16));
    const partition = cutAt8();

    await replaceSegment({ document, start: 8, end: 16, donor: storageOver(donorBytes) });
    const after = partition.applyEdit({ kind: "overwrite", start: 8, end: 16 }, document.size);

    expect(after.partition.cuts).toEqual([8]);
    expect(after.moved).toBe(false);
  });
});
