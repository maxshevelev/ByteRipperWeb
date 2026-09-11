import { describe, expect, it } from "vitest";
import { diffBytes } from "@/core/diff/diffEngine";
import { DiffHunkIndex, type HunkRange } from "@/core/diff/diffHunkIndex";

/**
 * Ported from `DiffHunkIndexTests.swift`.
 *
 * Next and Previous Difference step by grouped hunks, not by byte-exact blocks.
 * A hunk merges difference blocks separated by a matching run shorter than the
 * grouping distance, is bounded by differing bytes, and is derived from the
 * index without changing it — highlighting stays per byte.
 */

/**
 * Two files of `count` matching bytes with single-byte differences at the given
 * offsets — the "holey diff" shape a rewritten config region has.
 */
function pair(count: number, differingAt: number[]): [Uint8Array, Uint8Array] {
  const left = new Uint8Array(count).fill(0xaa);
  const right = left.slice();
  for (const offset of differingAt) right[offset] = 0x55;
  return [left, right];
}

const hunksOf = (left: Uint8Array, right: Uint8Array, gap: number) =>
  DiffHunkIndex.from(diffBytes(left, right), gap);

/** Hunks as `10-41` strings, so a whole expectation fits on one line. */
const shape = (hunks: readonly HunkRange[]) => hunks.map((hunk) => `${hunk.start}-${hunk.end}`);
const one = (hunk: HunkRange | undefined) =>
  hunk === undefined ? undefined : `${hunk.start}-${hunk.end}`;

describe("grouping", () => {
  it("makes one hunk of differences closer than the gap", () => {
    // The hunk runs from its first differing byte to its last — never rounded
    // out to a row, never including the matching run that follows.
    expect(shape(hunksOf(...pair(512, [0x10, 0x13, 0x40]), 256).hunks)).toEqual(["16-65"]);
    expect(shape(hunksOf(...pair(512, [0x23, 0x2f]), 256).hunks)).toEqual(["35-48"]);
  });

  it("keeps differences farther apart than the gap separate", () => {
    expect(shape(hunksOf(...pair(2048, [0x100, 0x400]), 256).hunks)).toEqual([
      "256-257",
      "1024-1025",
    ]);
  });

  it("puts the boundary exactly at the matching run's length", () => {
    // A run of gap - 1 bytes is swallowed; a run of gap bytes separates.
    expect(shape(hunksOf(...pair(256, [0, 16]), 16).hunks)).toEqual(["0-17"]);
    expect(shape(hunksOf(...pair(256, [0, 17]), 16).hunks)).toEqual(["0-1", "17-18"]);
  });

  it("does not depend on where the bytes fall inside a row", () => {
    // The reason grouping is by distance and not by the 16-byte row: row
    // grouping would merge or split the same spacing depending on its phase.
    for (let start = 0; start < 16; start++) {
      const [left, right] = pair(512, [start, start + 17]);
      expect(DiffHunkIndex.from(diffBytes(left, right), 32).count, `start ${start}`).toBe(1);
      expect(DiffHunkIndex.from(diffBytes(left, right), 16).count, `start ${start}`).toBe(2);
    }
  });

  it("collapses a byte-alternating region to one target", () => {
    // The case that made the command useless: differing bytes alternating with
    // matching ones, a block per byte.
    const left = new Uint8Array(4096).fill(0xaa);
    const right = left.slice();
    for (let offset = 0; offset < 4096; offset += 2) right[offset] = 0x55;

    const blocks = diffBytes(left, right);
    expect(blocks.blockCount).toBeGreaterThan(1000);
    expect(shape(DiffHunkIndex.from(blocks, 16).hunks)).toEqual(["0-4095"]);
  });

  it("merges nothing at a gap of one", () => {
    // Blocks are separated by at least one matching byte, so navigation falls
    // back to the byte-exact blocks.
    const [left, right] = pair(512, [0x10, 0x12, 0x14]);
    const blocks = diffBytes(left, right);
    const hunks = DiffHunkIndex.from(blocks, 1);
    expect(shape(hunks.hunks)).toEqual(
      blocks.blocks
        .filter((block) => block.kind === "different")
        .map((block) => `${block.start}-${block.end}`)
    );
  });

  it("groups the EOF-only tail with a nearby difference", () => {
    const left = new Uint8Array(300).fill(0xaa);
    const right = new Uint8Array(256).fill(0xaa);
    right[250] = 0x55;

    const hunks = DiffHunkIndex.from(diffBytes(left, right), 256);
    expect(hunks.extent).toBe(300);
    expect(shape(hunks.hunks)).toEqual(["250-300"]);
  });
});

describe("navigation", () => {
  const threeDifferences = () => hunksOf(...pair(2048, [0x10, 0x40, 0x400]), 256);

  it("finds the next hunk from inside the current one", () => {
    const hunks = threeDifferences();
    expect(shape(hunks.hunks)).toEqual(["16-65", "1024-1025"]);

    expect(one(hunks.nextDifference(0))).toBe("16-65");
    // From the hunk's first byte the next target is the following hunk.
    expect(one(hunks.nextDifference(0x10))).toBe("1024-1025");
    // A caret inside a swallowed matching run is inside the hunk.
    expect(one(hunks.nextDifference(0x20))).toBe("1024-1025");
    expect(hunks.nextDifference(0x400)).toBeUndefined();
  });

  it("skips the hunk the caret is in, going backwards", () => {
    const hunks = threeDifferences();
    expect(one(hunks.previousDifference(2048))).toBe("1024-1025");
    expect(one(hunks.previousDifference(0x400))).toBe("16-65");
    expect(one(hunks.previousDifference(0x41))).toBe("16-65");
    expect(hunks.previousDifference(0x10)).toBeUndefined();
  });

  it("skips the matching runs a hunk swallowed", () => {
    // Otherwise Next Same Block would land in the middle of what Next
    // Difference treats as one change.
    const hunks = threeDifferences();

    expect(one(hunks.nextSame(0))).toBe("65-1024");
    expect(one(hunks.nextSame(0x20))).toBe("65-1024");
    expect(one(hunks.nextSame(0x41))).toBe("1025-2048");
    expect(hunks.nextSame(0x401)).toBeUndefined();

    expect(one(hunks.previousSame(2048))).toBe("1025-2048");
    expect(one(hunks.previousSame(0x400))).toBe("65-1024");
    expect(one(hunks.previousSame(0x30))).toBe("0-16");
    expect(hunks.previousSame(0)).toBeUndefined();
  });

  it("keeps the file's edge runs as targets even when shorter than the gap", () => {
    // Nothing was merged across them; they are simply what is left at the edge.
    const hunks = hunksOf(...pair(32, [4, 27]), 256);
    expect(shape(hunks.hunks)).toEqual(["4-28"]);
    expect(one(hunks.nextSame(0))).toBe("28-32");
    expect(one(hunks.previousSame(32))).toBe("28-32");
    expect(one(hunks.previousSame(10))).toBe("0-4");
  });
});

describe("the degenerate shapes", () => {
  it("gives identical files one matching run and no differences", () => {
    const left = new Uint8Array(128).fill(0xaa);
    const hunks = DiffHunkIndex.from(diffBytes(left, left), 256);

    expect(hunks.isEmpty).toBe(true);
    expect(hunks.nextDifference(0)).toBeUndefined();
    expect(hunks.previousDifference(128)).toBeUndefined();
    // A run starting at 0 is not strictly after offset 0.
    expect(hunks.nextSame(0)).toBeUndefined();
    expect(one(hunks.previousSame(128))).toBe("0-128");
  });

  it("gives empty files no targets at all", () => {
    const hunks = DiffHunkIndex.from(diffBytes(new Uint8Array(0), new Uint8Array(0)), 256);
    expect(hunks.isEmpty).toBe(true);
    expect(hunks.extent).toBe(0);
    expect(hunks.nextDifference(0)).toBeUndefined();
    expect(hunks.previousSame(0)).toBeUndefined();
  });

  it("reports no matching runs when a hunk touches both file edges", () => {
    const left = new Uint8Array(64).fill(0xaa);
    const right = new Uint8Array(64).fill(0x55);
    const hunks = DiffHunkIndex.from(diffBytes(left, right), 16);

    expect(shape(hunks.hunks)).toEqual(["0-64"]);
    expect(hunks.nextSame(0)).toBeUndefined();
    expect(hunks.previousSame(64)).toBeUndefined();
    expect(hunks.nextDifference(0)).toBeUndefined();
    expect(one(hunks.previousDifference(64))).toBe("0-64");
  });
});
