import { beforeEach, describe, expect, it } from "vitest";
import {
  applySegments,
  canRedoSegments,
  canUndoSegments,
  clearSegments,
  noteSegmentEdit,
  redoSegments,
  resetSegments,
  segmentsFor,
  swapSegments,
  undoSegments,
} from "@/state/segmentsStore";

/**
 * The store over the partition: what survives an edit, and what a press of undo
 * takes back.
 *
 * The partition's own rules are `src/core/segments/segmentation.test.ts`; these
 * are about the pane's history of it.
 */

const cuts = (pane: "a" | "b") => segmentsFor(pane)?.cuts ?? [];

beforeEach(() => {
  clearSegments("a");
  clearSegments("b");
  resetSegments("a", 64);
});

describe("a pane's partition", () => {
  it("starts as one piece covering the file", () => {
    expect(cuts("a")).toEqual([]);
    expect(segmentsFor("a")?.segments).toHaveLength(1);
  });

  it("is gone when the pane closes", () => {
    clearSegments("a");
    expect(segmentsFor("a")).toBeUndefined();
  });

  it("changes places when the panes do", () => {
    resetSegments("b", 32);
    applySegments("a", (partition) => partition.addCut(16));

    swapSegments();

    expect(cuts("b")).toEqual([16]);
    expect(cuts("a")).toEqual([]);
  });
});

describe("undo over the partition", () => {
  // Each change is one entry, and taking it back is picking up the partition
  // from before it — which cannot go wrong halfway.
  it("takes back one change at a time", () => {
    applySegments("a", (partition) => partition.addCut(16));
    applySegments("a", (partition) => partition.addCut(32));
    expect(cuts("a")).toEqual([16, 32]);

    expect(undoSegments("a")).toBe(true);
    expect(cuts("a")).toEqual([16]);
    expect(undoSegments("a")).toBe(true);
    expect(cuts("a")).toEqual([]);
    expect(undoSegments("a")).toBe(false);
  });

  it("puts back what it took", () => {
    applySegments("a", (partition) => partition.addCut(16));
    undoSegments("a");

    expect(canRedoSegments("a")).toBe(true);
    expect(redoSegments("a")).toBe(true);
    expect(cuts("a")).toEqual([16]);
  });

  // A refused change must not push an entry nothing would undo: the commands
  // are offered whether or not they can act.
  it("records nothing for a change the partition refused", () => {
    expect(applySegments("a", (partition) => partition.addCut(0))).toBe(false);
    expect(canUndoSegments("a")).toBe(false);
  });

  it("drops what was undone once something new is done", () => {
    applySegments("a", (partition) => partition.addCut(16));
    undoSegments("a");
    applySegments("a", (partition) => partition.addCut(48));

    expect(canRedoSegments("a")).toBe(false);
    expect(cuts("a")).toEqual([48]);
  });
});

describe("an edit under the cuts", () => {
  // A cut travels with the content — which is the whole difference between a
  // cut and a bookmark.
  // @upstream ByteRipperTests/SegmentStoreTests.swift#SegmentStoreTests.testAnInsertBeforeACutMovesIt
  it("moves a cut that the insert came before", () => {
    applySegments("a", (partition) => partition.addCut(16));

    noteSegmentEdit("a", { kind: "insert", at: 8, length: 4 }, 68);

    expect(cuts("a")).toEqual([20]);
  });

  it("leaves a cut the insert came after", () => {
    applySegments("a", (partition) => partition.addCut(16));

    noteSegmentEdit("a", { kind: "insert", at: 32, length: 4 }, 68);

    expect(cuts("a")).toEqual([16]);
  });

  // The edit is the undoable step, not the shift it caused: taking the edit
  // back brings the cuts back with it. So the history's own entries shift too,
  // or an undo of an older cut would land on offsets that no longer mean
  // anything.
  it("shifts the history with the partition", () => {
    applySegments("a", (partition) => partition.addCut(16));
    applySegments("a", (partition) => partition.addCut(32));

    noteSegmentEdit("a", { kind: "insert", at: 0, length: 8 }, 72);
    undoSegments("a");

    expect(cuts("a")).toEqual([24]);
  });
});
