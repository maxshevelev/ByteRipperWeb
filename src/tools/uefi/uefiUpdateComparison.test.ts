import { describe, expect, it } from "vitest";
import { biosGuardFile, block } from "@/firmware/testing/testBiosGuard";
import type { BIOSGuardUpdate } from "@/firmware/uefi/biosGuardUpdate";
import { validateTransaction } from "@/tools/toolTransaction";
import { isBIOSRegion } from "@/tools/uefi/uefiPresenter";
import {
  compareFile,
  compareUpdate,
  isBoardData,
  nameText,
  problemMessage,
  stateText,
  summary,
  updateTransaction,
  updateZones,
  writesByDefault,
} from "@/tools/uefi/uefiUpdateComparison";

/**
 * A dump's BIOS region held against an update's (`UEFIUpdateComparison`): each part's state,
 * what is ticked before the user touches anything, and the transaction that writes only what
 * differs.
 */

/** Where the BIOS region starts in the dump. */
const BASE = 0xb0_0000;

const concat = (...parts: Uint8Array[]) => Uint8Array.from(parts.flatMap((part) => [...part]));

/** Code, NVRAM, a vendor's per-board store the update leaves empty, and more code. */
const UPDATE: BIOSGuardUpdate = {
  platform: "RAPTORLAKE",
  entries: [
    { name: "FV_BB", key: "/B", blockCount: 1, range: { start: 0, end: 0x1000 } },
    { name: "NVRAM", key: "/N", blockCount: 1, range: { start: 0x1000, end: 0x2000 } },
    { name: "PEGA_GPNV", key: "/PEGAGPNV", blockCount: 1, range: { start: 0x2000, end: 0x2800 } },
    { name: "FV_MAIN_WRAPPER", key: "/P", blockCount: 3, range: { start: 0x2800, end: 0x5000 } },
  ],
  region: concat(block(0x11, 0x1000), block(0x22, 0x1000), block(0xff, 0x800), block(0x44, 0x2800)),
};

/** The update's region as a board's dump holds it: its own NVRAM and store, and — where asked —
 * code that is not the vendor's. */
function dump(changingCodeAt: number[] = []): Uint8Array {
  const bytes = UPDATE.region.slice();
  bytes.fill(0x99, 0x1000, 0x1010);
  bytes.set([0x47, 0x50, 0x4e, 0x56], 0x2000);
  for (const offset of changingCodeAt) bytes[offset] = (bytes[offset] ?? 0) ^ 0xff;
  return bytes;
}

function compare(bytes: Uint8Array) {
  const result = compareUpdate(UPDATE, bytes, BASE);
  if (!result.ok) throw new Error(problemMessage(result.problem));
  return result.comparison;
}

describe("a dump's BIOS region against an update's", () => {
  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIUpdateComparisonTests.swift#UEFIUpdateComparisonTests.testEachPartSaysWhetherItIsTheSameAndWhereItLiesInTheDump
  it("says for each part whether it is the same and where it lies in the dump", () => {
    const comparison = compare(dump([0x3000]));
    expect(comparison.platform).toBe("RAPTORLAKE");
    expect(comparison.region).toEqual({ start: BASE, end: BASE + 0x5000 });
    expect(comparison.rows.map((row) => row.range)).toEqual([
      { start: BASE, end: BASE + 0x1000 },
      { start: BASE + 0x1000, end: BASE + 0x2000 },
      { start: BASE + 0x2000, end: BASE + 0x2800 },
      { start: BASE + 0x2800, end: BASE + 0x5000 },
    ]);
    expect(comparison.rows.map((row) => row.differingBytes)).toEqual([0, 0x10, 4, 1]);
    expect(comparison.rows.map((row) => row.isBoardData)).toEqual([false, true, true, false]);
    expect(comparison.rows.map((row) => row.isErasedInUpdate)).toEqual([false, false, true, false]);
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIUpdateComparisonTests.swift#UEFIUpdateComparisonTests.testOnlyCodeThatDiffersIsTickedAndBoardDataIsKept
  it("ticks only code that differs and keeps board data", () => {
    const comparison = compare(dump([0x3000]));
    expect(comparison.rows.map(writesByDefault)).toEqual([false, false, false, true]);
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIUpdateComparisonTests.swift#UEFIUpdateComparisonTests.testTheStateColumnSaysWhatThePartIs
  it("says what the part is in the state column", () => {
    const { rows } = compare(dump([0x3000]));
    expect(rows.map(stateText)).toEqual([
      "Identical",
      "Board data; 16 bytes differ",
      "Board data; empty in the update",
      "1 bytes differ",
    ]);
    expect(rows.map(nameText)).toEqual([
      "FV_BB",
      "NVRAM",
      "PEGA_GPNV",
      "FV_MAIN_WRAPPER (3 blocks)",
    ]);
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIUpdateComparisonTests.swift#UEFIUpdateComparisonTests.testDifferencesCloseTogetherAreOneWriteAndFarApartAreTwo
  it("joins differences close together and keeps those far apart", () => {
    const { rows } = compare(dump([0x3000, 0x3008, 0x4000]));
    expect(rows[3]?.differences).toEqual([
      { start: BASE + 0x3000, end: BASE + 0x3009 },
      { start: BASE + 0x4000, end: BASE + 0x4001 },
    ]);
    expect(rows[3]?.differingBytes).toBe(3);
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIUpdateComparisonTests.swift#UEFIUpdateComparisonTests.testTheTransactionWritesTheUpdatesBytesOnlyWhereTheDumpDiffers
  it("writes the update's bytes only where the dump differs", () => {
    const comparison = compare(dump([0x3000, 0x3008]));
    const transaction = updateTransaction(comparison, new Set([1, 3]), UPDATE);
    expect(transaction?.name).toBe("Write from Update File");
    expect(transaction?.writes.map((write) => [write.offset, Array.from(write.bytes)])).toEqual([
      [BASE + 0x1000, Array(0x10).fill(0x22)],
      [BASE + 0x3000, Array(9).fill(0x44)],
    ]);
    expect(transaction && validateTransaction(transaction).ok).toBe(true);
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIUpdateComparisonTests.swift#UEFIUpdateComparisonTests.testWritingAPartThatIsTheSameWritesNothing
  it("writes nothing for a part that is the same", () => {
    const comparison = compare(dump());
    expect(updateTransaction(comparison, new Set([0, 3]), UPDATE)).toBeUndefined();
    expect(updateTransaction(comparison, new Set(), UPDATE)).toBeUndefined();
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIUpdateComparisonTests.swift#UEFIUpdateComparisonTests.testARegionOfAnotherSizeIsNotThisBoardsUpdate
  it("is not this board's update for a region of another size", () => {
    const result = compareUpdate(UPDATE, new Uint8Array(0x4000), BASE);
    expect(result).toEqual({
      ok: false,
      problem: { kind: "sizeMismatch", update: 0x5000, region: 0x4000 },
    });
    if (!result.ok) {
      expect(problemMessage(result.problem)).toContain("0x5000");
      expect(problemMessage(result.problem)).toContain("0x4000");
    }
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIUpdateComparisonTests.swift#UEFIUpdateComparisonTests.testAFileThatIsNotAnUpdateIsSaidToBeNone
  it("says a file that is not an update is none", () => {
    const result = compareFile(block(0xff, 0x100), dump(), BASE);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem).toEqual({ kind: "notAnUpdate" });
    expect(problemMessage(result.problem)).toBe("This is not an AMI BIOS Guard update file.");
  });

  it("compares a file read as an update", () => {
    const file = biosGuardFile([
      { key: "/B", name: "FV_BB", blocks: [block(0x11, 0x100)] },
      { key: "/P", name: "FV_MAIN", blocks: [block(0x44, 0x100)] },
    ]);
    const region = concat(block(0x11, 0x100), block(0x44, 0x100));
    region[0x180] = 0;
    const result = compareFile(file, region, BASE);
    expect(result.ok && result.comparison.rows.map((row) => row.differingBytes)).toEqual([0, 1]);
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIUpdateComparisonTests.swift#UEFIUpdateComparisonTests.testBoardDataIsToldByTheFlashersSwitchOrByTheVendorsName
  it("tells board data by the flasher's switch or by the vendor's name", () => {
    for (const [name, key] of [
      ["NVRAM", "/N"],
      ["NVRAM_BACKUP", "/NB"],
      ["OA_TABLE", "/OA"],
      ["AsusNVRAM", "/AsusNVRAM"],
      ["PEGA_GPNV", "/PEGAGPNV"],
      ["SMBIOS", ""],
    ] as const) {
      expect(isBoardData(name, key), name).toBe(true);
    }
    for (const [name, key] of [
      ["FV_MAIN_WRAPPER", "/P"],
      ["FV_BB", "/B"],
      ["PEGA_EC", "/PEGAEC"],
      ["FV_DATA", "/DATA"],
      ["FV_NETWORK_WRAPPER", "/NETWORK"],
    ] as const) {
      expect(isBoardData(name, key), name).toBe(false);
    }
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIUpdateComparisonTests.swift#UEFIUpdateComparisonTests.testTheSummaryCountsThePartsAndTheBytes
  it("counts the parts and the bytes in the summary", () => {
    const comparison = compare(dump([0x3000]));
    expect(summary(comparison, new Set([3]))).toBe(
      "1 of 4 parts identical. To write: 1 parts, 1 bytes. Kept as they are: 2."
    );
  });

  // @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolModule.swift#UEFIToolSession.showUpdatePart
  it("draws the parts as zones, the selected one in focus", () => {
    const comparison = compare(dump());
    const zones = updateZones(comparison, 1);
    expect(zones.zones.map((zone) => [zone.id, zone.start, zone.end])).toEqual([
      ["update.0", BASE, BASE + 0x1000],
      ["update.1", BASE + 0x1000, BASE + 0x2000],
      ["update.2", BASE + 0x2000, BASE + 0x2800],
      ["update.3", BASE + 0x2800, BASE + 0x5000],
    ]);
    expect(zones.focus).toBe("update.1");
    expect(updateZones(comparison, undefined).focus).toBeUndefined();
  });

  // @upstream Modules/UEFITool/Sources/UEFITool/UEFIPresenter.swift#UEFIPresenter.isBIOSRegion
  it("offers the comparison on the descriptor's BIOS region of the file only", () => {
    expect(isBIOSRegion({ kind: "region", subtype: 0x01, space: [] })).toBe(true);
    expect(isBIOSRegion({ kind: "region", subtype: 0x02, space: [] })).toBe(false);
    expect(isBIOSRegion({ kind: "region", subtype: 0x01, space: [0x100] })).toBe(false);
    expect(isBIOSRegion({ kind: "volume", subtype: 0x01, space: [] })).toBe(false);
  });
});
