/**
 * Ported from `SegmentStoreTests.swift`, with its own sizes and offsets.
 *
 * The edit-shifting rules are the substance: a cut travels with the content,
 * which is the opposite of a bookmark, and what happens when an edit lands on
 * or across a cut is exactly the part that is easy to get plausibly wrong.
 */

import { describe, expect, it } from "vitest";
import {
  mergeTitle,
  type Segmentation,
  segmentLabel,
  wholeFile,
} from "@/core/segments/segmentation";

/** A 16-byte file with a cut at 8, which is upstream's usual fixture. */
const cutAt8 = (): Segmentation => {
  const split = wholeFile(16).addCut(8);
  if (split === undefined) throw new Error("the fixture's cut was refused");
  return split;
};
const extents = (of: Segmentation) => of.segments.map((piece) => [piece.start, piece.end]);

describe("a partition", () => {
  it("starts as one piece covering the file", () => {
    const one = wholeFile(16);
    expect(one.cuts).toEqual([]);
    expect(extents(one)).toEqual([[0, 16]]);
  });

  it("builds its labels in one place", () => {
    expect(segmentLabel(0)).toBe("S0");
    expect(segmentLabel(7)).toBe("S7");
    expect(mergeTitle(1)).toBe("Merge S1 into S0");
    // S0 has no piece above it, so it merges into the one below.
    expect(mergeTitle(0)).toBe("Merge S0 into S1");
  });

  it("makes two pieces from a cut, and renumbers", () => {
    const split = cutAt8();
    expect(split.cuts).toEqual([8]);
    expect(extents(split)).toEqual([
      [0, 8],
      [8, 16],
    ]);
    expect(split.segments.map((piece) => piece.index)).toEqual([0, 1]);
  });

  it("refuses a cut at 0, at EOF, or where one already is", () => {
    const one = wholeFile(16);
    expect(one.addCut(0)).toBeUndefined();
    expect(one.addCut(16)).toBeUndefined();
    expect(cutAt8().addCut(8)).toBeUndefined();
  });

  it("gives the same partition whichever order the cuts arrive in", () => {
    const forward = wholeFile(16).addCut(4)?.addCut(12);
    const backward = wholeFile(16).addCut(12)?.addCut(4);
    expect(forward?.cuts).toEqual([4, 12]);
    expect(backward?.cuts).toEqual(forward?.cuts);
  });

  it("is half-open at both ends: a cut belongs to the piece that starts there", () => {
    const split = cutAt8();
    expect(split.containing(0)?.index).toBe(0);
    expect(split.containing(7)?.index).toBe(0);
    expect(split.containing(8)?.index).toBe(1);
    expect(split.containing(15)?.index).toBe(1);
    expect(split.containing(16)).toBeUndefined();
  });
});

describe("removing", () => {
  it("merges a removed cut into the earlier piece, which keeps its name", () => {
    const named = cutAt8().rename(0, "header").rename(1, "second");
    const merged = named.removeCut(8);
    expect(merged?.segments).toEqual([{ index: 0, start: 0, end: 16, name: "header" }]);
  });

  it("merges a removed piece into the one above", () => {
    const named = cutAt8().rename(0, "header").rename(1, "second");
    const merged = named.removePiece(1);
    expect(merged?.segments).toEqual([{ index: 0, start: 0, end: 16, name: "header" }]);
  });

  it("promotes the piece below when S0 goes", () => {
    // It reopens at the file start and keeps its own name: what was S1 is S0.
    const named = cutAt8().rename(0, "header").rename(1, "body");
    const merged = named.removePiece(0);
    expect(merged?.segments).toEqual([{ index: 0, start: 0, end: 16, name: "body" }]);
  });

  it("refuses to remove the only piece, or an index that is not there", () => {
    expect(wholeFile(16).removePiece(0)).toBeUndefined();
    expect(cutAt8().removePiece(5)).toBeUndefined();
    expect(cutAt8().removeCut(4)).toBeUndefined();
  });
});

describe("sliding a cut", () => {
  const three = () => {
    const split = wholeFile(16).addCut(4)?.addCut(8)?.rename(1, "middle");
    if (split === undefined) throw new Error("the fixture's cuts were refused");
    return split;
  };

  it("moves inside its own interval, carrying the name with it", () => {
    // The cut at 4 bounds (0, 8), so it may move to 6.
    const moved = three().moveCut(4, 6);
    expect(moved?.cuts).toEqual([6, 8]);
    expect(moved?.segments[1]?.name).toBe("middle");
  });

  it("refuses to land on a neighbouring cut, or to jump over one", () => {
    const moved = three().moveCut(4, 6);
    if (moved === undefined) throw new Error("the first move should be allowed");
    expect(moved.moveCut(6, 8)).toBeUndefined();
    expect(moved.moveCut(6, 10)).toBeUndefined();
  });

  it("stops short of the bounds it may not reach", () => {
    expect(three().moveCut(4, 0)).toBeUndefined();
    expect(three().moveCut(8, 16)).toBeUndefined();
  });
});

describe("a cut travels with the content", () => {
  it("moves with an insert before it", () => {
    const { partition, moved } = cutAt8().applyEdit({ kind: "insert", at: 4, length: 4 }, 20);
    expect(partition.cuts).toEqual([12]);
    expect(moved).toBe(true);
  });

  it("stays where it is when the insert lands on it", () => {
    // The new bytes join the piece that *starts* there, so the cut does not
    // move — which also means the piece above it does not grow.
    const { partition } = cutAt8().applyEdit({ kind: "insert", at: 8, length: 4 }, 20);
    expect(partition.cuts).toEqual([8]);
    expect(extents(partition)).toEqual([
      [0, 8],
      [8, 20],
    ]);
  });

  it("never moves for an overwrite", () => {
    const { partition, moved } = cutAt8().applyEdit({ kind: "overwrite", start: 4, end: 12 }, 16);
    expect(partition.cuts).toEqual([8]);
    expect(moved).toBe(false);
  });

  it("merges the pieces when a delete swallows the cut between them", () => {
    const named = cutAt8().rename(0, "dump.bin").rename(1, "second");
    const { partition } = named.applyEdit({ kind: "delete", start: 4, end: 12 }, 8);
    expect(partition.segments).toEqual([{ index: 0, start: 0, end: 8, name: "dump.bin" }]);
  });

  it("drops a piece a delete empties, with its name", () => {
    const named = cutAt8().rename(0, "dump.bin").rename(1, "second");
    const { partition } = named.applyEdit({ kind: "delete", start: 8, end: 16 }, 8);
    expect(partition.segments).toEqual([{ index: 0, start: 0, end: 8, name: "dump.bin" }]);
  });

  it("reports nothing moved when a delete leaves every cut where it was", () => {
    // The content edit repaints the bytes on its own; the partition only has to
    // repaint when a boundary actually shifted.
    const { moved } = wholeFile(16).applyEdit({ kind: "delete", start: 8, end: 12 }, 12);
    expect(moved).toBe(false);
  });

  it("keeps the whole-file piece when a delete empties the file", () => {
    const { partition } = cutAt8().applyEdit({ kind: "delete", start: 0, end: 16 }, 0);
    expect(partition.pieces).toHaveLength(1);
    expect(partition.pieces[0]?.start).toBe(0);
  });
});

describe("re-basing onto a new size", () => {
  it("keeps the cuts that still fall inside the file", () => {
    const rebased = cutAt8().resized(32);
    expect(rebased.cuts).toEqual([8]);
    expect(extents(rebased)).toEqual([
      [0, 8],
      [8, 32],
    ]);
  });

  it("drops a cut at or past the new end", () => {
    expect(cutAt8().resized(8).cuts).toEqual([]);
    expect(cutAt8().resized(4).cuts).toEqual([]);
  });

  it("keeps the whole-file piece when the file becomes empty", () => {
    const empty = cutAt8().resized(0);
    expect(empty.pieces).toHaveLength(1);
    expect(empty.contentSize).toBe(0);
  });
});
