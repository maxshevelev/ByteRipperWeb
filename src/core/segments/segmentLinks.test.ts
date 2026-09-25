/**
 * Ported from `SegmentLinkTests.swift` — the arithmetic half: how a link
 * travels with the content under the partition's own edits (§21.7).
 *
 * A link is never dropped to be safe: misalignment paints red, which is true,
 * and dropping the link would throw away a working revert to avoid a red byte
 * that is correct.
 */

import { describe, expect, it } from "vitest";
import {
  Segmentation,
  SegmentLink,
  type Segment,
  type SegmentSourceID,
  wholeFile,
} from "@/core/segments/segmentation";

const source: SegmentSourceID = { raw: 0 };
const other: SegmentSourceID = { raw: 1 };
const linked = (start: number, end: number): SegmentLink => new SegmentLink(source, start, end);

/** One piece of 16 bytes, linked to the whole of a 16-byte file. */
const linkedWholeFile = (size = 16): Segmentation =>
  new Segmentation(size, [{ start: 0, name: "chip.bin", link: linked(0, size) }]);

const extents = (of: Segmentation) => of.segments.map((piece) => [piece.start, piece.end]);

const piece = (partition: Segmentation, index: number): Segment => {
  const found = partition.segments[index];
  if (found === undefined) throw new Error(`the partition has no piece at ${index}`);
  return found;
};

describe("the link's arithmetic", () => {
  // @upstream ByteRipperTests/SegmentLinkTests.swift#SegmentLinkTests.testACutSplitsTheLinkWithThePiece
  it("splits the link with the piece when a cut lands inside it", () => {
    const split = linkedWholeFile().addCut(6);
    if (split === undefined) throw new Error("the cut was refused");
    expect(piece(split, 0).link?.equals(linked(0, 6)), "the earlier half keeps the source's first six bytes").toBe(
      true
    );
    expect(piece(split, 1).link?.equals(linked(6, 16)), "and the new piece opens six bytes into the same file").toBe(
      true
    );
  });

  // @upstream ByteRipperTests/SegmentLinkTests.swift#SegmentLinkTests.testMergingGrowsTheAbsorbingPiecesExtent
  it("grows the absorbing piece's extent when a merge swallows the later one", () => {
    const merged = linkedWholeFile().addCut(6)?.removePiece(1);
    if (merged === undefined) throw new Error("the merge was refused");
    expect(merged.segments.length).toBe(1);
    expect(piece(merged, 0).link?.equals(linked(0, 16)), "S0 absorbed S1's bytes, so its extent in the file covers them again").toBe(
      true
    );
  });

  // @upstream ByteRipperTests/SegmentLinkTests.swift#SegmentLinkTests.testMergingTheFirstPieceShiftsTheSurvivorsExtentBack
  it("shifts the survivor's extent back when S0 is merged into it", () => {
    const merged = linkedWholeFile().addCut(6)?.removePiece(0);
    if (merged === undefined) throw new Error("the merge was refused");
    expect(extents(merged)).toEqual([[0, 16]]);
    expect(piece(merged, 0).link?.equals(linked(0, 16)), "what was S1 reopens at the file start, and so does its extent").toBe(
      true
    );
  });

  // @upstream ByteRipperTests/SegmentLinkTests.swift#SegmentLinkTests.testMergingTheFirstPieceDropsALinkThatWouldUnderflow
  it("drops a survivor's link where its source has no room for the absorbed bytes", () => {
    const partition = new Segmentation(16, [
      { start: 0, name: "a" },
      { start: 8, name: "b", link: new SegmentLink(other, 0, 8) },
    ]);
    const merged = partition.removePiece(0);
    if (merged === undefined) throw new Error("the merge was refused");
    expect(piece(merged, 0).link, "the piece now opens eight bytes before anything its source holds").toBeUndefined();
  });

  // @upstream ByteRipperTests/SegmentLinkTests.swift#SegmentLinkTests.testMovingACutSlidesBothExtents
  it("slides both extents when a cut moves", () => {
    const moved = linkedWholeFile().addCut(6)?.moveCut(6, 10);
    if (moved === undefined) throw new Error("the move was refused");
    expect(piece(moved, 0).link?.equals(linked(0, 10))).toBe(true);
    expect(piece(moved, 1).link?.equals(linked(10, 16))).toBe(true);
  });

  // @upstream ByteRipperTests/SegmentLinkTests.swift#SegmentLinkTests.testAnInsertLeavesTheLinksAlone
  it("leaves the links alone when bytes are inserted", () => {
    const edited = linkedWholeFile()
      .addCut(6)
      ?.applyEdit({ kind: "insert", at: 2, length: 4 }, 20).partition;
    if (edited === undefined) throw new Error("the insert was refused");
    expect(extents(edited)).toEqual([
      [0, 10],
      [10, 20],
    ]);
    expect(piece(edited, 0).link?.equals(linked(0, 6)), "the piece grew with the insert, but its extent did not").toBe(
      true
    );
    expect(piece(edited, 1).link?.equals(linked(6, 16)), "and the piece after it moved whole, extent untouched").toBe(
      true
    );
  });

  // @upstream ByteRipperTests/SegmentLinkTests.swift#SegmentLinkTests.testADeleteMovesOnlyATrimmedHead
  it("moves only a head the deletion trimmed", () => {
    const edited = linkedWholeFile()
      .addCut(8)
      ?.applyEdit({ kind: "delete", start: 8, end: 11 }, 13).partition;
    if (edited === undefined) throw new Error("the delete was refused");
    expect(piece(edited, 0).link?.equals(linked(0, 8)), "S0 still opens where it did, so its extent is unchanged").toBe(
      true
    );
    expect(piece(edited, 1).link?.equals(linked(11, 16)), "S1 lost its first three bytes, so it opens three bytes later in the file").toBe(
      true
    );
  });

  // @upstream ByteRipperTests/SegmentLinkTests.swift#SegmentLinkTests.testADeleteBeforeACutLeavesTheLaterPiecesAlone
  it("leaves the pieces after a delete as themselves: same names, same links", () => {
    const partition = new Segmentation(16, [
      { start: 0, name: "a", link: linked(0, 8) },
      { start: 8, name: "b", link: new SegmentLink(other, 0, 8) },
    ]);
    const edited = partition.applyEdit({ kind: "delete", start: 2, end: 4 }, 14).partition;
    expect(edited.segments.map((p) => p.name)).toEqual(["a", "b"]);
    expect(extents(edited)).toEqual([
      [0, 6],
      [6, 14],
    ]);
    expect(
      piece(edited, 1).link?.equals(new SegmentLink(other, 0, 8)),
      "the piece moved whole, so its extent in its own file did not move"
    ).toBe(true);
  });

  // @upstream ByteRipperTests/SegmentLinkTests.swift#SegmentLinkTests.testResetDropsTheLinks
  it("drops every link when the partition is reset to the whole file", () => {
    // The web's reset is building the fresh partition: a fresh file is one
    // piece of itself, with nothing it came from.
    expect(piece(wholeFile(16), 0).link).toBeUndefined();
  });
});

describe("a growth at a piece's closing boundary", () => {
  // @upstream ByteRipperTests/SegmentLinkTests.swift#SegmentGrowthTests.testGrowthMovesTheLaterPiecesWhole
  it("gives the added bytes to the piece they replaced, and moves the rest whole", () => {
    const partition = new Segmentation(16, [
      { start: 0, name: "a", link: new SegmentLink(source, 0, 8) },
      { start: 8, name: "b", link: new SegmentLink(other, 0, 8) },
    ]);
    const grown = partition.applyGrowth(0, 4, 20);
    expect(extents(grown)).toEqual([
      [0, 12],
      [12, 20],
    ]);
    expect(
      piece(grown, 0).link?.equals(new SegmentLink(source, 0, 12)),
      "its extent in its own source grew with it"
    ).toBe(true);
    expect(
      piece(grown, 1).link?.equals(new SegmentLink(other, 0, 8)),
      "and the piece after it moved whole, so its extent did not move"
    ).toBe(true);
  });

  // @upstream ByteRipperTests/SegmentLinkTests.swift#SegmentGrowthTests.testGrowingTheLastPieceMovesNothing
  it("lets the last piece run to the new end when it grows", () => {
    const partition = new Segmentation(16, [
      { start: 0, name: "a" },
      { start: 8, name: "b", link: new SegmentLink(other, 0, 8) },
    ]);
    const grown = partition.applyGrowth(1, 4, 20);
    expect(extents(grown)).toEqual([
      [0, 8],
      [8, 20],
    ]);
  });
});
