import { describe, expect, it } from "vitest";
import { FileTable } from "@/firmware/me/data/fileTable";
import {
  decodeConfigIDRecords,
  type MFSConfigDecode,
  type MFSConfigIDDecode,
  type MFSRawConfigRecord,
} from "@/firmware/me/fileSystem/mfs";
import {
  aggregatePchInit,
  decodePchInit,
  decodePchInitByID,
  decodePchInitStream,
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

/**
 * The `FTBL` half of a real table, cut to the two rows these tests join on: the
 * chipset table's File ID and one that is not it. Copied from `FileTable.dat`
 * platform `10` / dictionary `0A` — what a CSME 16.1 volume header points at.
 */
const FTBL_JSON = JSON.stringify({
  "10": {
    "0A": {
      FTBL: {
        "10038900": "/home/chipsetinit/mphytbl,1,0,0,1576,316,55,6,33554848",
        "1003A200": "/home/bup/bup_sku/hw_binding,0,0,0,0,0,0,7,0",
      },
    },
  },
});

const le32 = (value: number): readonly number[] => [
  value & 0xff,
  (value >> 8) & 0xff,
  (value >> 16) & 0xff,
  (value >> 24) & 0xff,
];
const le16 = (value: number): readonly number[] => [value & 0xff, (value >> 8) & 0xff];

/**
 * One ID-keyed (0xC) Configuration stream: the record count, that many
 * `MFS_Config_Record_0xC` entries, then the bytes they point at — with offsets
 * into the whole stream, the way a real one's are.
 */
function idStream(entries: readonly { id: number; body: Uint8Array }[]): Uint8Array {
  const head: number[] = [...le32(entries.length)];
  const body: number[] = [];
  const base = 4 + entries.length * 0xc;
  for (const entry of entries) {
    head.push(
      ...le32(entry.id),
      ...le32(base + body.length),
      ...le16(entry.body.length),
      ...le16(0)
    );
    body.push(...entry.body);
  }
  return Uint8Array.from([...head, ...body]);
}

/**
 * The same stream in the named (0x1C) layout, for the FTPR copy of a legacy
 * image's file 6.
 */
function namedStream(entries: readonly { name: string; body: Uint8Array }[]): Uint8Array {
  const head: number[] = [...le32(entries.length)];
  const body: number[] = [];
  const base = 4 + entries.length * 0x1c;
  for (const entry of entries) {
    const name = [...entry.name].map((one) => one.charCodeAt(0)).slice(0, 0xc);
    head.push(
      ...name,
      ...new Array(0xc - name.length).fill(0), // @0x00 FileName
      ...le16(0), // @0x0C Reserved
      ...le16(0), // @0x0E AccessMode (RecordType 0 = file)
      ...le16(0), // @0x10 DeployOptions
      ...le16(entry.body.length), // @0x12 FileSize
      ...le16(0), // @0x14 OwnerUserID
      ...le16(0), // @0x16 OwnerGroupID
      ...le32(base + body.length) // @0x18 FileOffset
    );
    body.push(...entry.body);
  }
  return Uint8Array.from([...head, ...body]);
}

const idConfig = (stream: Uint8Array): MFSConfigIDDecode[] => [
  { owningFile: 6, records: decodeConfigIDRecords(stream) ?? [] },
];

const csme16: PCHIdentity = {
  variant: "CSME",
  major: 16,
  minor: 1,
  build: 1991,
  year: 2022,
  month: 8,
  day: 29,
};

const adpNaming = (fileTable: FileTable | undefined) => ({
  fileTable,
  platform: 0x10,
  dictionary: 0x0a,
});

describe("the ID-keyed Intel Configuration", () => {
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/PCHInitTests.swift#PCHInitTests.testIDKeyedFileSixIsNamedThroughTheFileTable
  it("names file 6's records through FileTable.dat", () => {
    const stream = idStream([
      { id: 0x1003_a200, body: Uint8Array.of(0, 0, 0, 0) },
      { id: 0x1003_8900, body: newTable(0x12, 0, 8) },
    ]);
    const out = decodePchInitByID(
      [{ index: 6, content: stream }],
      idConfig(stream),
      adpNaming(FileTable.parse(FTBL_JSON)),
      csme16
    );
    expect(out?.chipsets.map((one) => one.chipset)).toEqual(["ADP-LP"]);
    expect(out?.chipsets.map((one) => one.steppings)).toEqual(["A"]);
  });

  // Without the table no record can be recognised as a chipset table: the ID is
  // all the stream says, and upstream's own fallback name for an unkeyed row
  // (`/Unknown/<ID>.bin`) is not one.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/PCHInitTests.swift#PCHInitTests.testIDKeyedFileSixWithoutATableNamesNothing
  it("names nothing without the table", () => {
    const stream = idStream([{ id: 0x1003_8900, body: newTable(0x12, 0, 8) }]);
    expect(
      decodePchInitByID(
        [{ index: 6, content: stream }],
        idConfig(stream),
        adpNaming(undefined),
        csme16
      )
    ).toBeUndefined();
  });
});

describe("the FTPR intl.cfg stream", () => {
  // The CSME 15/16 case: the volume carries no file 6 at all and the FTPR
  // module is the only Intel Configuration there is.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/PCHInitTests.swift#PCHInitTests.testIntelConfigurationStreamReadsTheIDKeyedLayout
  it("reads the ID-keyed layout", () => {
    const stream = idStream([
      { id: 0x1003_a200, body: Uint8Array.of(0) },
      { id: 0x1003_8900, body: newTable(0x12, 0, 8) },
    ]);
    const out = decodePchInitStream(stream, 0xc, adpNaming(FileTable.parse(FTBL_JSON)), csme16);
    expect(out?.chipsets.map((one) => one.chipset)).toEqual(["ADP-LP"]);
    expect(out?.chipsets.map((one) => one.steppings)).toEqual(["A"]);
  });

  // A record with no bytes behind it is not a table: upstream's `and rec_data`
  // drops it, which is why the CSME 16 oracle reads no chipset although its
  // `intl.cfg` does list an `mphytbl` row.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/PCHInitTests.swift#PCHInitTests.testAZeroLengthChipsetRecordIsSkipped
  it("skips a zero-length chipset record", () => {
    const stream = idStream([{ id: 0x1003_8900, body: new Uint8Array(0) }]);
    expect(
      decodePchInitStream(stream, 0xc, adpNaming(FileTable.parse(FTBL_JSON)), csme16)
    ).toBeUndefined();
  });

  // The same module in the named layout — a legacy image whose FTPR keeps a
  // copy of file 6 needs no table to read it.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/PCHInitTests.swift#PCHInitTests.testIntelConfigurationStreamReadsTheNamedLayout
  it("reads the named layout", () => {
    const stream = namedStream([
      { name: "other", body: Uint8Array.of(0, 0, 0, 0) },
      { name: "mphytbl0", body: oldTable(0xc, 0x5, 4) },
    ]);
    const out = decodePchInitStream(
      stream,
      0x1c,
      { fileTable: undefined, platform: -1, dictionary: -1 },
      { variant: "CSME", major: 12, minor: 0, build: 1091, year: 2018, month: 1, day: 25 }
    );
    expect(out?.chipsets.map((one) => one.chipset)).toEqual(["CNP/CMP-LP"]);
    expect(out?.chipsets.map((one) => one.steppings)).toEqual(["CA"]);
  });
});
