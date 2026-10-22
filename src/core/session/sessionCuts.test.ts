import { describe, expect, it } from "vitest";
import { wholeFile } from "@/core/segments/segmentation";
import { CutHistory, partitionData, partitionFrom } from "@/core/session/sessionCuts";
import { crossed } from "@/core/testing/sessionLines";

/**
 * A session's partition and its history: what survives an edit, and what a press of undo takes
 * back. The partition's own rules are `src/core/segments/segmentation.test.ts`; these are about
 * its history.
 */

const cutAt = (history: CutHistory, offset: number) => {
  const next = history.partition.addCut(offset);
  return next !== undefined && history.apply(next);
};

describe("a session's partition", () => {
  it("starts as one piece covering the file", () => {
    const history = new CutHistory(64);
    expect(history.partition.cuts).toEqual([]);
    expect(history.partition.segments).toHaveLength(1);
  });

  it("crosses a port as data and comes back the same, links and names with it", () => {
    const history = new CutHistory(64);
    cutAt(history, 16);
    const named = history.partition.rename(1, "donor.bin").linkUnlinkedPieces({ raw: 7 });
    if (named === undefined) throw new Error("nothing linked");
    const back = partitionFrom(crossed(partitionData(named)));
    expect(back.cuts).toEqual([16]);
    expect(back.segments.map((one) => one.name)).toEqual(["", "donor.bin"]);
    expect(back.segments[1]?.link?.equals(named.segments[1]?.link)).toBe(true);
  });
});

describe("undo over the partition", () => {
  // Each change is one entry, and taking it back is picking up the partition from before it —
  // which cannot go wrong halfway.
  it("takes back one change at a time", () => {
    const history = new CutHistory(64);
    cutAt(history, 16);
    cutAt(history, 32);
    expect(history.partition.cuts).toEqual([16, 32]);
    expect(history.undo()).toBe(true);
    expect(history.partition.cuts).toEqual([16]);
    expect(history.undo()).toBe(true);
    expect(history.partition.cuts).toEqual([]);
    expect(history.undo()).toBe(false);
  });

  it("puts back what it took", () => {
    const history = new CutHistory(64);
    cutAt(history, 16);
    history.undo();
    expect(history.canRedo).toBe(true);
    expect(history.redo()).toBe(true);
    expect(history.partition.cuts).toEqual([16]);
  });

  // A refused change must not push an entry nothing would undo.
  it("records nothing for a partition that is the one it has", () => {
    const history = new CutHistory(64);
    expect(history.apply(wholeFile(64))).toBe(false);
    expect(history.canUndo).toBe(false);
  });

  it("drops what was undone once something new is done", () => {
    const history = new CutHistory(64);
    cutAt(history, 16);
    history.undo();
    cutAt(history, 48);
    expect(history.canRedo).toBe(false);
    expect(history.partition.cuts).toEqual([48]);
  });
});

describe("an edit under the cuts", () => {
  // A cut travels with the content — which is the whole difference between a cut and a bookmark.
  // @upstream ByteRipperTests/SegmentStoreTests.swift#SegmentStoreTests.testAnInsertBeforeACutMovesIt
  it("moves a cut that the insert came before", () => {
    const history = new CutHistory(64);
    cutAt(history, 16);
    history.noteEdit({ kind: "insert", at: 8, length: 4 }, 68);
    expect(history.partition.cuts).toEqual([20]);
  });

  it("leaves a cut the insert came after", () => {
    const history = new CutHistory(64);
    cutAt(history, 16);
    history.noteEdit({ kind: "insert", at: 32, length: 4 }, 68);
    expect(history.partition.cuts).toEqual([16]);
  });

  // The edit is the undoable step, not the shift it caused: so the history's own entries shift
  // too, or an undo of an older cut would land on offsets that no longer mean anything.
  it("shifts the history with the partition", () => {
    const history = new CutHistory(64);
    cutAt(history, 16);
    cutAt(history, 32);
    history.noteEdit({ kind: "insert", at: 0, length: 8 }, 72);
    history.undo();
    expect(history.partition.cuts).toEqual([24]);
  });
});
