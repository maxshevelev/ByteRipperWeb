import { describe, expect, it } from "vitest";
import { type DiffBlock, DiffBlockIndex, type DiffKind } from "@/core/diff/diffBlock";
import { OverviewBinning } from "@/render/minimap/overviewBinning";
import { shareOverviewRows } from "@/render/minimap/overviewSharing";

/**
 * § 19.9: the overview of a comparison bins a row both files hold the same bytes for once and
 * copies its density to the other file. The copy must be invisible, and it must save the reads.
 *
 * @upstream ByteRipperTests/OverviewSharingTests.swift#OverviewSharingTests
 */

/**
 * The comparison index of two byte arrays: runs of same and different over the longer file, the
 * shorter file's missing tail counting as different.
 *
 * @upstream ByteRipperTests/OverviewSharingTests.swift#OverviewSharingTests.index
 */
function indexOf(left: Uint8Array, right: Uint8Array): DiffBlockIndex {
  const extent = Math.max(left.length, right.length);
  const blocks: DiffBlock[] = [];
  let runStart = 0;
  let runKind: DiffKind | undefined;
  for (let offset = 0; offset < extent; offset++) {
    const same = offset < left.length && offset < right.length && left[offset] === right[offset];
    const kind: DiffKind = same ? "same" : "different";
    if (kind !== runKind) {
      if (runKind !== undefined) blocks.push({ kind: runKind, start: runStart, end: offset });
      runKind = kind;
      runStart = offset;
    }
  }
  if (runKind !== undefined) blocks.push({ kind: runKind, start: runStart, end: extent });
  return DiffBlockIndex.of(left.length, right.length, blocks);
}

describe("sharing a comparison's overview", () => {
  // A run of rows starting mid-file — a patch after an edit — still gets the marks of a difference
  // that began before it. The first byte of such a run can divide into the row before, and `mark`
  // used to drop the block.
  // @upstream ByteRipperTests/OverviewSharingTests.swift#OverviewSharingTests.testARunOfRowsMidFileKeepsADifferenceThatBeganEarlier
  it("keeps a difference that began before a run of rows mid-file", () => {
    const binning = new OverviewBinning(300_000, 997);
    const bits = new Uint16Array(100);
    binning.mark(0, 300_000, { from: 500, to: 600 }, bits);
    expect(
      [...bits].every((word) => word === 0xffff),
      "a block spanning the run marks all of it"
    ).toBe(true);
  });

  // A row is the same only when every byte it is computed from is the same in both files and
  // inside both of them.
  // @upstream ByteRipperTests/OverviewSharingTests.swift#OverviewSharingTests.testRowsWithSameBytes
  it("calls a row the same only when all its bytes are, in both files", () => {
    const left = new Uint8Array(1000).fill(0x41);
    const right = left.slice(0, 900);
    right[250] = 0x42;
    // 100 bytes per row.
    const binning = new OverviewBinning(1000, 10);
    expect(
      binning.rowsWithSameBytes(indexOf(left, right), { from: 0, to: 10 }),
      "row 2 holds the difference, row 9 lies past the shorter file's end"
    ).toEqual([true, true, false, true, true, true, true, true, true, false]);

    // Rows thinner than a byte: several rows stand for byte 3, all of them differ.
    const small = new Uint8Array(10).fill(0x41);
    const other = small.slice();
    other[3] = 0;
    const thin = new OverviewBinning(10, 40);
    const same = thin.rowsWithSameBytes(indexOf(small, other), { from: 0, to: 40 });
    for (let row = 0; row < 40; row++) {
      expect(same[row], `row ${row} reads byte ${thin.startOfRow(row)}`).toBe(
        thin.startOfRow(row) !== 3
      );
    }
  });

  // An index that describes other files — a size that does not match — is not trusted.
  // @upstream ByteRipperTests/OverviewSharingTests.swift#OverviewSharingTests.testAnIndexOfOtherSizesSharesNothing
  it("shares nothing under an index of other sizes", () => {
    const left = new Uint8Array(1000);
    const index = indexOf(left, left);
    expect(shareOverviewRows(index, [1000, 999], 1000, 10)).toBeUndefined();
    expect(shareOverviewRows(index, [1000, 1000], 1000, 10)).toBeDefined();
  });

  // The rows both files hold the same are split between them, the first half to the first file,
  // so each reads about half of them.
  // @upstream ByteRipperTests/OverviewSharingTests.swift#OverviewSharingTests.testASharedRowIsReadOnce
  it("splits the shared rows half and half", () => {
    const left = new Uint8Array(1000).fill(0x41);
    const right = left.slice();
    right[250] = 0x42;
    const owners = shareOverviewRows(indexOf(left, right), [1000, 1000], 1000, 10);
    expect(owners).toEqual([0, 0, undefined, 0, 0, 1, 1, 1, 1, 1]);
  });
});
