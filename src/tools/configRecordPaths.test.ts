import { describe, expect, it } from "vitest";
import { FileTable } from "@/firmware/me/data/fileTable";
import type { MFSConfigIDRecord, OEMConfiguration } from "@/firmware/me/models/fileSystemFacts";
import { ConfigRecordPaths } from "@/tools/configRecordPaths";
import { analysisWith } from "@/tools/meaTesting";
import { type MEANode, presentMEA } from "@/tools/meaTree";

/**
 * `ConfigRecordPaths` + the record rows it names — the panel's half of the 0xC
 * branch of upstream's `mfs_cfg_anl`. An ID-keyed Configuration record carries
 * no name: the path is the `FTBL` row stored under the record's own File ID as
 * its key, which is DB text and so never a field of the analysis.
 */

/**
 * Real rows of the file, at the platform/dictionary the CSME 15 dump's MFS
 * volume header names, for File IDs its FITC payload actually carries.
 */
const tableJson = `{
  "04": {
    "0B": {
      "FTBL": {
        "10080A00": "/home/amt/rtfd/PrivacyLvl,1,0,0,0,0,85,394,384",
        "10080700": "/home/amt/rtfd/UC.Config,1,0,0,0,0,85,391,384",
        "10004A00": "/home/mca/deploy,1,0,0,40,206,69,0,420"
      }
    }
  },
  "01": {
    "0A": { "FTBL": { "10009900": "/home/icc/default,0,0,0,0,0,0,6,0" } }
  }
}`;

const table = (): FileTable => FileTable.parse(tableJson);

/** The three records of the fixture payload: two the table names and one it does not. */
const records: readonly MFSConfigIDRecord[] = [
  { fileID: 0x1008_0a00, offset: 0, size: 1, oemConfigurable: true, unknownFlags: 0 },
  { fileID: 0x1008_0700, offset: 1, size: 0x10, oemConfigurable: false, unknownFlags: 0 },
  { fileID: 0xdead_beef, offset: 0x11, size: 4, oemConfigurable: false, unknownFlags: 3 },
];

const paths = (platform = 4, dictionary = 0x0b): ConfigRecordPaths =>
  ConfigRecordPaths.forFileIDs({
    table: table(),
    fileIDs: records.map((one) => one.fileID),
    platform,
    dictionary,
  });

/**
 * An analysis with a FITC partition whose payload carries `records`, the way one
 * arrives once the identity-gated decode has run.
 */
function analysis(
  options: { payloadOffset?: number | null; streamOnVolume?: boolean } = {}
): ReturnType<typeof analysisWith> {
  // `null` rather than `undefined` for "no payload offset": a destructuring
  // default fires on `undefined`, and the case under test is exactly the one
  // where the field is absent.
  const { payloadOffset = 0x31_5010, streamOnVolume = false } = options;
  const oem: OEMConfiguration = {
    offset: 0x31_5000,
    headerRevision: 1,
    dataLength: 0x3061,
    headerCRCStored: undefined,
    headerCRCValid: true,
    dataCRCStored: undefined,
    dataCRCValid: true,
    configLength: undefined,
    paddingAllFF: undefined,
    payloadOffset: payloadOffset ?? undefined,
    recordsByID: records,
  };
  return analysisWith({
    oemConfiguration: oem,
    mfsVolume: {
      offset: 0x32_2000,
      pageSize: 0x2000,
      pageCount: 49,
      systemPageCount: 1,
      dataPageCount: 48,
      signatureValid: true,
      volumeSize: 0x6_4000,
      computedVolumeSize: 0x6_4000,
      fileRecordCount: 1024,
      usedFileCount: 0,
      ftblDictionary: 0x0b,
      ftblPlatform: 4,
      ftblReserved: 0,
      usesFTBL: true,
      presentFileCount: 0,
      fileBytes: 0,
      files: [],
      configurations: [],
      ...(streamOnVolume ? { configurationsByID: [{ owningFile: 7, records }] } : {}),
      homeDirectory: undefined,
      reservedIntegrity: [],
      pchInit: undefined,
    },
  });
}

const field = (label: string, node: MEANode): string | undefined =>
  node.fields.find((one) => one.label === label)?.value;

function recordRows(roots: readonly MEANode[], group = "OEM Configuration"): MEANode {
  const oem = roots.find((one) => one.title === group);
  const branch = oem?.children.find((one) => one.title === "Configuration Records");
  if (branch === undefined) throw new Error("no Configuration Records branch");
  return branch;
}

describe("ConfigRecordPaths lookup", () => {
  // @upstream Packages/MEPresentation/Tests/MEPresentationTests/ConfigRecordPathsTests.swift#ConfigRecordPathsTests.testARecordIsNamedByTheRowAtItsOwnKey
  it("names a record by the row at its own key", () => {
    const found = paths();
    expect(found.path(0x1008_0a00)).toBe("/home/amt/rtfd/PrivacyLvl");
    expect(found.isNamed(0x1008_0a00)).toBe(true);
    expect(found.path(0x1008_0700)).toBe("/home/amt/rtfd/UC.Config");
  });

  // @upstream Packages/MEPresentation/Tests/MEPresentationTests/ConfigRecordPathsTests.swift#ConfigRecordPathsTests.testAnUnknownIDReadsAsUpstreamsFallback
  it("reads an unknown ID as upstream's fallback", () => {
    const found = paths();
    expect(found.path(0xdead_beef)).toBe("/Unknown/DEADBEEF.bin");
    expect(found.isNamed(0xdead_beef)).toBe(false);
  });

  // @upstream Packages/MEPresentation/Tests/MEPresentationTests/ConfigRecordPathsTests.swift#ConfigRecordPathsTests.testWithNothingLookedUpThereIsNoPathAtAll
  it("has no path at all with nothing looked up", () => {
    expect(ConfigRecordPaths.none.path(0x1008_0a00)).toBeUndefined();
    expect(ConfigRecordPaths.none.tableLabel).toBeUndefined();
    expect(ConfigRecordPaths.none.isEmpty).toBe(true);
  });

  // @upstream Packages/MEPresentation/Tests/MEPresentationTests/ConfigRecordPathsTests.swift#ConfigRecordPathsTests.testAnEmptyTableIsNone
  it("is none for an empty table", () => {
    const found = ConfigRecordPaths.forFileIDs({
      table: FileTable.empty,
      fileIDs: [1, 2],
      platform: 4,
      dictionary: 0x0b,
    });
    expect(found.isEmpty).toBe(true);
    expect(found.resolution).toBeUndefined();
  });

  // @upstream Packages/MEPresentation/Tests/MEPresentationTests/ConfigRecordPathsTests.swift#ConfigRecordPathsTests.testTheFallbacksAreReportedOnTheLabel
  it("reports the fallbacks on the label", () => {
    expect(paths().tableLabel).toBe("04 / 0B");
    const assumed = paths(-1, -1);
    expect(assumed.resolution?.platform).toBe(0x01);
    expect(assumed.tableLabel).toBe("01 / 0A (assumed platform and dictionary)");
    expect(assumed.isNamed(0x1008_0a00)).toBe(false);
    expect(assumed.path(0x1008_0a00)).toBe("/Unknown/10080A00.bin");
  });
});

describe("ConfigRecordPaths rows", () => {
  // @upstream Packages/MEPresentation/Tests/MEPresentationTests/ConfigRecordPathsTests.swift#ConfigRecordPathsTests.testANamedRowCarriesTheRecordsFactsAndItsBytes
  it("carries the record's facts and its bytes on a named row", () => {
    const rows = recordRows(presentMEA(analysis(), undefined, undefined, undefined, paths()));
    expect(rows.subtitle).toBe("3 records");
    const first = rows.children[0];
    expect(first?.title).toBe("/home/amt/rtfd/PrivacyLvl");
    expect(first === undefined ? undefined : field("File ID", first)).toBe("0x10080A00");
    expect(first === undefined ? undefined : field("Size", first)).toBe("0x1 (1 bytes)");
    expect(first === undefined ? undefined : field("Offset", first)).toBe("0x0");
    expect(first === undefined ? undefined : field("OEM Configurable", first)).toBe("Yes");
    expect(first === undefined ? undefined : field("Reserved Flags", first)).toBe("0x0");
    expect(first?.range).toEqual({ start: 0x31_5010, end: 0x31_5011 });

    const second = rows.children[1];
    expect(second?.range).toEqual({ start: 0x31_5011, end: 0x31_5021 });
    expect(second === undefined ? undefined : field("OEM Configurable", second)).toBe("No");
  });

  // @upstream Packages/MEPresentation/Tests/MEPresentationTests/ConfigRecordPathsTests.swift#ConfigRecordPathsTests.testAnUnnamedRowKeepsItsFallbackName
  it("keeps the fallback name on an unnamed row", () => {
    const rows = recordRows(presentMEA(analysis(), undefined, undefined, undefined, paths()));
    const last = rows.children.at(-1);
    expect(last?.title).toBe("/Unknown/DEADBEEF.bin");
    expect(last === undefined ? undefined : field("Path", last)).toBe("/Unknown/DEADBEEF.bin");
    expect(last === undefined ? undefined : field("Reserved Flags", last)).toBe("0x3");
  });

  // @upstream Packages/MEPresentation/Tests/MEPresentationTests/ConfigRecordPathsTests.swift#ConfigRecordPathsTests.testWithoutTheTableTheRowsAreTheirFileIDs
  it("reads the rows as their File IDs without the table", () => {
    const rows = recordRows(presentMEA(analysis(), undefined));
    expect(rows.children.map((one) => one.title)).toEqual([
      "Record 0x10080A00",
      "Record 0x10080700",
      "Record 0xDEADBEEF",
    ]);
    const first = rows.children[0];
    expect(first === undefined ? undefined : field("Path", first)).toBeUndefined();
    expect(first?.range).toEqual({ start: 0x31_5010, end: 0x31_5011 });
  });

  // @upstream Packages/MEPresentation/Tests/MEPresentationTests/ConfigRecordPathsTests.swift#ConfigRecordPathsTests.testWithoutAPayloadOffsetTheRowsPointAtNothing
  it("points the rows at nothing without a payload offset", () => {
    const roots = presentMEA(
      analysis({ payloadOffset: null }),
      undefined,
      undefined,
      undefined,
      paths()
    );
    for (const row of recordRows(roots).children) expect(row.range).toBeUndefined();
  });

  // @upstream Packages/MEPresentation/Tests/MEPresentationTests/ConfigRecordPathsTests.swift#ConfigRecordPathsTests.testTheGroupNamesTheTableAndDropsTheReflectedList
  it("names the table on the group and drops the reflected list", () => {
    const roots = presentMEA(analysis(), undefined, undefined, undefined, paths());
    const oem = roots.find((one) => one.title === "OEM Configuration");
    expect(oem === undefined ? undefined : field("File Table", oem)).toBe("04 / 0B");
    expect(oem === undefined ? undefined : field("recordsByID", oem)).toBeUndefined();
    expect(oem === undefined ? undefined : field("records", oem)).toBeUndefined();
    expect(oem === undefined ? undefined : field("headerRevision", oem)).toBe("1");
  });

  // @upstream Packages/MEPresentation/Tests/MEPresentationTests/ConfigRecordPathsTests.swift#ConfigRecordPathsTests.testAVolumesOwnStreamIsARowUnderTheVolume
  it("shows a volume's own stream as a row under the volume", () => {
    const roots = presentMEA(
      analysis({ streamOnVolume: true }),
      undefined,
      undefined,
      undefined,
      paths()
    );
    const mfs = roots.find((one) => one.title === "File System (MFS)");
    const stream = mfs?.children.find((one) => one.title === "OEM Configuration");
    expect(stream?.subtitle).toBe("3 records");
    expect(stream?.children[0]?.title).toBe("/home/amt/rtfd/PrivacyLvl");
    expect(stream?.children[0]?.range).toBeUndefined();
  });
});
