import { describe, expect, it } from "vitest";
import type { MFSConfigDecode, MFSRawConfigRecord } from "@/firmware/me/fileSystem/mfs";
import {
  aggregatePchInit,
  decodePchInit,
  decodePchTable,
  type PCHIdentity,
} from "@/firmware/me/fileSystem/pchInit";

/**
 * The chipset initialisation tables. Ported from upstream's `PCHInitTests`:
 * synthetic tables in both layouts and every stepping branch the identity and
 * the manifest's date select.
 */

/** New layout: FF FF at 4, revision at 6, chipset at 7, stepping in 8's high half. */
function newTable(chipset: number, stepping: number, revision = 0): Uint8Array {
  const table = new Uint8Array(9).fill(0x5a);
  table[4] = 0xff;
  table[5] = 0xff;
  table[6] = revision & 0xff;
  table[7] = chipset & 0xff;
  table[8] = (stepping & 0xf) << 4;
  return table;
}

/** Old layout: revision at 2, chipset and stepping as byte 3's two halves. */
function oldTable(chipset: number, stepping: number, revision = 0): Uint8Array {
  const table = new Uint8Array(4).fill(0x5a);
  table[2] = revision & 0xff;
  table[3] = ((chipset & 0xf) << 4) | (stepping & 0xf);
  return table;
}

const step = (table: Uint8Array, identity: Partial<PCHIdentity> = {}) =>
  decodePchTable(table, {
    variant: "CSME",
    major: 15,
    minor: 40,
    build: 2500,
    year: 2020,
    month: 6,
    day: 1,
    ...identity,
  });

describe("the layouts", () => {
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/PCHInitTests.swift#PCHInitTests.testNewLayoutReadsChipsetByteHighNibbleStepAndRevision
  it("reads the new layout's chipset, stepping and revision", () => {
    expect(step(newTable(0x0, 0xf, 3), { variant: "CSSPS", major: 4, minor: 4 })).toEqual({
      chipset: "WTL",
      stepping: "P",
      revision: 3,
    });
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/PCHInitTests.swift#PCHInitTests.testOldLayoutReadsChipsetNibbleLowNibbleStepAndRevision
  it("reads the old layout's nibbles", () => {
    expect(step(oldTable(0xd, 0x3, 7), { major: 14, minor: 0 })).toEqual({
      chipset: "CNP/CMP-H",
      stepping: "BA",
      revision: 7,
    });
  });
});

describe("the stepping branches", () => {
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/PCHInitTests.swift#PCHInitTests.testCSME15_40BuildRangeSelectsLetter
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/PCHInitTests.swift#PCHInitTests.testCSME15_40BuildRangeBoundariesAndFallback
  it("take CSME 15.40's letter from the build", () => {
    expect(step(newTable(0xd, 0x2, 1))).toEqual({
      chipset: "CNP/CMP-H",
      stepping: "B",
      revision: 1,
    });
    expect(step(newTable(0x9, 0x2), { build: 1000 })?.stepping).toBe("A");
    expect(step(newTable(0x9, 0x2), { build: 6999 })?.stepping).toBe("F");
    expect(step(newTable(0x9, 0x2), { build: 999 })?.stepping).toBe("C");
    expect(step(newTable(0x9, 0x2), { build: 7000 })?.stepping).toBe("C");
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/PCHInitTests.swift#PCHInitTests.testCSME12GateBitfieldAfter2018AbsoluteBefore
  it("split CSME 12 on 2018-01-25", () => {
    const table = oldTable(0xc, 0x5, 4);
    const after = step(table, { major: 12, minor: 0, year: 2018, month: 1, day: 25 });
    expect(after).toEqual({ chipset: "CNP/CMP-LP", stepping: "CA", revision: 4 });
    expect(step(table, { major: 12, minor: 0, year: 2018, month: 1, day: 24 })?.stepping).toBe("F");
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/PCHInitTests.swift#PCHInitTests.testCSME11GateAbsoluteAfter2015EmptyBefore
  it("leave CSME 11 unsaid before 2015-05-19", () => {
    const table = newTable(0x8, 0x3, 2);
    const after = step(table, { major: 11, minor: 8, year: 2015, month: 5, day: 19 });
    expect(after).toMatchObject({ chipset: "SPT/KBP-LP", stepping: "D" });
    expect(step(table, { major: 11, minor: 8, year: 2015, month: 5, day: 18 })?.stepping).toBe("");
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/PCHInitTests.swift#PCHInitTests.testCSSPS4NonFourSharesCSME11DateGate
  it("give CSSPS 4 CSME 11's date rule", () => {
    const table = oldTable(0x8, 0x1);
    expect(
      step(table, { variant: "CSSPS", major: 4, minor: 0, year: 2016, month: 1, day: 1 })?.stepping
    ).toBe("B");
    expect(
      step(table, { variant: "CSSPS", major: 4, minor: 0, year: 2014, month: 12, day: 31 })
        ?.stepping
    ).toBe("");
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/PCHInitTests.swift#PCHInitTests.testCSSPS5SharesCSME12DateGate
  it("give CSSPS 5 CSME 12's date rule", () => {
    const table = newTable(0x6, 0xf);
    expect(
      step(table, { variant: "CSSPS", major: 5, minor: 0, year: 2019, month: 3, day: 3 })?.stepping
    ).toBe("DCBA");
    expect(
      step(table, { variant: "CSSPS", major: 5, minor: 0, year: 2017, month: 1, day: 1 })?.stepping
    ).toBe("P");
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/PCHInitTests.swift#PCHInitTests.testLayoutBranchAbsoluteOnNewBitfieldOnOldAcrossFamilies
  it("read the new layout absolutely and the old as a bitfield on CSME 13/15/16 and CSSPS 6", () => {
    for (const [variant, major] of [
      ["CSME", 13],
      ["CSME", 15],
      ["CSME", 16],
      ["CSSPS", 6],
    ] as const) {
      const minor = variant === "CSME" && major === 15 ? 10 : 0;
      const fresh = step(newTable(0x3, 0x1), { variant, major, minor });
      expect(fresh?.chipset).toBe("ICP-LP");
      expect(fresh?.stepping).toBe("B");
      expect(step(oldTable(0x3, 0x1), { variant, major, minor })?.stepping).toBe("A");
    }
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/PCHInitTests.swift#PCHInitTests.testCSME14_5OverridesChipsetToCMP_V
  it("rename CSME 14.5's chipset to CMP-V", () => {
    expect(step(oldTable(0xb, 0x4, 6), { major: 14, minor: 5 })).toEqual({
      chipset: "CMP-V",
      stepping: "E",
      revision: 6,
    });
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/PCHInitTests.swift#PCHInitTests.testCSME14NonFiveUsesBitfield
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/PCHInitTests.swift#PCHInitTests.testBitfieldEmptyNibbleYieldsA
  it("read CSME 14 as a bitfield", () => {
    expect(step(newTable(0xe, 0x6, 9), { major: 14, minor: 0 })).toEqual({
      chipset: "LKF-LP",
      stepping: "CB",
      revision: 9,
    });
    expect(step(newTable(0x9, 0x0), { major: 14, minor: 0 })?.stepping).toBe("A");
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/PCHInitTests.swift#PCHInitTests.testNoMatchingBranchLeavesSteppingEmpty
  it("say no stepping for a branch upstream never reaches", () => {
    expect(step(oldTable(0xc, 0x2, 1), { major: 9, minor: 0 })).toEqual({
      chipset: "CNP/CMP-LP",
      stepping: "",
      revision: 1,
    });
  });
});

describe("the chipset labels", () => {
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/PCHInitTests.swift#PCHInitTests.testUnknownChipsetLabelWhenIDNotInPchDict
  it("say Unknown for an id outside the table", () => {
    expect(step(oldTable(0xa, 0x1), { major: 14, minor: 0 })?.chipset).toBe("Unknown");
    expect(step(newTable(0x20, 0x1), { major: 14, minor: 0 })?.chipset).toBe("Unknown");
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/PCHInitTests.swift#PCHInitTests.testShortTablesReturnNil
  it("need enough bytes for the layout", () => {
    expect(step(Uint8Array.of(0, 1, 2))).toBeUndefined();
    expect(step(newTable(0x9, 0x1).subarray(0, 8))).toBeUndefined();
  });
});

describe("aggregatePchInit", () => {
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/PCHInitTests.swift#PCHInitTests.testAggregateConcatenatesDedupesAndSortsDescending
  it("unions each chipset's letters, highest first", () => {
    const out = aggregatePchInit([
      { chipset: "CNP/CMP-LP", stepping: "CA", revision: 1 },
      { chipset: "SPT-H", stepping: "B", revision: 1 },
      { chipset: "CNP/CMP-LP", stepping: "D", revision: 1 },
      { chipset: "CNP/CMP-LP", stepping: "A", revision: 1 },
    ]);
    expect(out).toEqual([
      { chipset: "CNP/CMP-LP", steppings: "DCA" },
      { chipset: "SPT-H", steppings: "B" },
    ]);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/PCHInitTests.swift#PCHInitTests.testAggregateEarlyReturnsOnEmptyFirstStepping
  it("returns early when the first table decoded no stepping", () => {
    expect(
      aggregatePchInit([
        { chipset: "CNP/CMP-LP", stepping: "", revision: 1 },
        { chipset: "CNP/CMP-LP", stepping: "D", revision: 1 },
      ])
    ).toEqual([]);
    expect(aggregatePchInit([])).toEqual([]);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/PCHInitTests.swift#PCHInitTests.testAggregateSingleRecord
  it("keeps a single record", () => {
    expect(aggregatePchInit([{ chipset: "SPT-H", stepping: "BA", revision: 2 }])).toEqual([
      { chipset: "SPT-H", steppings: "BA" },
    ]);
  });
});

const record = (
  name: string,
  offset: number,
  size: number,
  isFolder = false
): MFSRawConfigRecord => ({
  name,
  isFolder,
  size,
  offset,
  unixRights: 0,
  integrity: false,
  encryption: false,
  antiReplay: false,
  oemConfigurable: false,
  mcaConfigurable: false,
  reserved: 0,
  ownerUserID: 0,
  ownerGroupID: 0,
});

const config = (owningFile: number, records: readonly MFSRawConfigRecord[]): MFSConfigDecode[] => [
  { owningFile, records },
];

const csme12Early2018: PCHIdentity = {
  variant: "CSME",
  major: 12,
  minor: 0,
  build: 0,
  year: 2018,
  month: 1,
  day: 25,
};

describe("decodePchInit", () => {
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/PCHInitTests.swift#PCHInitTests.testDecodeSlicesAndAggregatesMphytblRecordsFromFileSix
  it("slices the mphytbl records out of file 6", () => {
    const content = new Uint8Array(0x40 + 9).fill(0xaa);
    content.set(oldTable(0xc, 0x5, 4), 0);
    content.set(newTable(0xd, 0x2, 6), 0x40);
    const out = decodePchInit(
      [{ index: 6, content }],
      config(6, [record("mphytbl0", 0, 4), record("mphytbl1", 0x40, 9)]),
      csme12Early2018
    );
    expect(out?.records).toEqual([
      { chipset: "CNP/CMP-LP", stepping: "CA", revision: 4 },
      { chipset: "CNP/CMP-H", stepping: "B", revision: 6 },
    ]);
    expect(out?.chipsets).toEqual([
      { chipset: "CNP/CMP-LP", steppings: "CA" },
      { chipset: "CNP/CMP-H", steppings: "B" },
    ]);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/PCHInitTests.swift#PCHInitTests.testDecodeSkipsFoldersNonMphytblAndInvalidRanges
  it("skips folders, other names and ranges that do not fit", () => {
    const content = new Uint8Array(0x20 + 9).fill(0xaa);
    content.set(newTable(0xe, 0xf, 1), 0x20);
    const out = decodePchInit(
      [{ index: 6, content }],
      config(6, [
        record("mphytblF", 0, 4, true),
        record("other", 0x10, 4),
        record("mphytblOOB", 0x2c, 0x40),
        record("mphytbl0", 0x20, 9),
        record("mphytblEmpty", 0x30, 0),
      ]),
      { ...csme12Early2018, major: 14, year: 2020, month: 1, day: 1 }
    );
    expect(out?.records.map((one) => one.chipset)).toEqual(["LKF-LP"]);
    expect(out?.records.map((one) => one.stepping)).toEqual(["DCBA"]);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/PCHInitTests.swift#PCHInitTests.testDecodeReturnsNilWithoutMphytblRecords
  it("is nothing without mphytbl records", () => {
    const content = new Uint8Array(0x40).fill(0xab);
    expect(
      decodePchInit([{ index: 6, content }], config(6, [record("other", 0, 4)]), csme12Early2018)
    ).toBeUndefined();
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/PCHInitTests.swift#PCHInitTests.testDecodeReturnsNilWithoutFileSixOrItsConfig
  it("is nothing without file 6 or its configuration", () => {
    const own7 = config(7, [record("mphytbl0", 0, 4)]);
    expect(
      decodePchInit([{ index: 3, content: new Uint8Array(8) }], own7, csme12Early2018)
    ).toBeUndefined();
    expect(
      decodePchInit([{ index: 6, content: new Uint8Array(8) }], own7, csme12Early2018)
    ).toBeUndefined();
  });
});
