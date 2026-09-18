import { describe, expect, it } from "vitest";
import { FileTable } from "@/firmware/me/data/fileTable";
import type {
  MFSConfigIDRecord,
  MFSVolume,
  OEMConfiguration,
} from "@/firmware/me/models/fileSystemFacts";
import {
  configRecordPaths,
  NO_RECORD_PATHS,
  namesNoRecord,
  recordIsNamed,
  recordPath,
  recordTableLabel,
} from "@/tools/me/configRecordPaths";
import { analysisWith, mfsVolumeFixture } from "@/tools/me/meaTesting";
import type { MEANode } from "@/tools/me/meaTree";
import { presentMEA } from "@/tools/me/meaTree";

/**
 * `ConfigRecordPaths` and the record rows it names: an ID-keyed Configuration
 * record identifies its file by File ID, and the path that ID stands for is the
 * `FTBL` row stored under it as its key — database text, and so never a field
 * of the analysis.
 */

/**
 * Real rows of the file, at the platform/dictionary the CSME 15 dump's MFS
 * volume header names, for File IDs its FITC payload actually carries.
 */
const json = `
{
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
}
`;

const table = () => FileTable.parse(json);

/** The three records of the fixture payload: two the table names and one it does not. */
const records: readonly MFSConfigIDRecord[] = [
  { fileId: 0x1008_0a00, offset: 0, size: 1, oemConfigurable: true, unknownFlags: 0 },
  { fileId: 0x1008_0700, offset: 1, size: 0x10, oemConfigurable: false, unknownFlags: 0 },
  { fileId: 0xdead_beef, offset: 0x11, size: 4, oemConfigurable: false, unknownFlags: 3 },
];

const paths = (platform = 4, dictionary = 0x0b) =>
  configRecordPaths(
    table(),
    records.map((one) => one.fileId),
    platform,
    dictionary
  );

/**
 * An analysis with a FITC partition whose payload carries `records`, the way
 * one arrives once the identity-gated decode has run.
 */
function analysis(
  options: { readonly payloadOffset?: number | undefined; readonly onVolume?: boolean } = {}
) {
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
    recordsByID: records,
    // Where the payload begins: the FITC partition plus its 0x10 header, which
    // is what turns a record's own offset into a position in the image.
    payloadOffset: "payloadOffset" in options ? options.payloadOffset : 0x31_5010,
  };
  const volume: MFSVolume = {
    ...mfsVolumeFixture(),
    usesFTBL: true,
    ...(options.onVolume === true ? { configurationsByID: [{ owningFile: 7, records }] } : {}),
  };
  return analysisWith({ oemConfiguration: oem, mfsVolume: volume });
}

const fieldValue = (node: MEANode | undefined, label: string): string | undefined =>
  node?.fields.find((one) => one.label === label)?.value;

const rootsOf = (
  one: ReturnType<typeof analysis>,
  configPaths = NO_RECORD_PATHS
): readonly MEANode[] => presentMEA(one, undefined, undefined, undefined, configPaths);

function recordRows(roots: readonly MEANode[]): MEANode | undefined {
  const oem = roots.find((one) => one.title === "OEM Configuration");
  return oem?.children.find((one) => one.title === "Configuration Records");
}

describe("the lookup", () => {
  // @upstream Modules/MEATool/Tests/MEAToolTests/ConfigRecordPathsTests.swift#ConfigRecordPathsTests.testARecordIsNamedByTheRowAtItsOwnKey
  it("names a record by the row at its own key", () => {
    const found = paths();

    expect(recordPath(found, 0x1008_0a00)).toBe("/home/amt/rtfd/PrivacyLvl");
    expect(recordIsNamed(found, 0x1008_0a00)).toBe(true);
    expect(recordPath(found, 0x1008_0700)).toBe("/home/amt/rtfd/UC.Config");
  });

  // @upstream Modules/MEATool/Tests/MEAToolTests/ConfigRecordPathsTests.swift#ConfigRecordPathsTests.testAnUnknownIDReadsAsUpstreamsFallback
  it("reads an unknown ID as upstream's fallback", () => {
    const found = paths();

    expect(recordPath(found, 0xdead_beef)).toBe("/Unknown/DEADBEEF.bin");
    expect(recordIsNamed(found, 0xdead_beef)).toBe(false);
  });

  /**
   * Before anything was looked up there is no fallback either: nothing has been
   * asked, so the row keeps its File ID rather than claiming the table had
   * nothing for it.
   *
   * @upstream Modules/MEATool/Tests/MEAToolTests/ConfigRecordPathsTests.swift#ConfigRecordPathsTests.testWithNothingLookedUpThereIsNoPathAtAll
   */
  it("has no path at all with nothing looked up", () => {
    expect(recordPath(NO_RECORD_PATHS, 0x1008_0a00)).toBeUndefined();
    expect(recordTableLabel(NO_RECORD_PATHS)).toBeUndefined();
    expect(namesNoRecord(NO_RECORD_PATHS)).toBe(true);
  });

  // @upstream Modules/MEATool/Tests/MEAToolTests/ConfigRecordPathsTests.swift#ConfigRecordPathsTests.testAnEmptyTableIsNone
  it("looks nothing up from an empty table", () => {
    expect(configRecordPaths(new FileTable(), [1, 2], 4, 0x0b)).toEqual(NO_RECORD_PATHS);
  });

  // @upstream Modules/MEATool/Tests/MEAToolTests/ConfigRecordPathsTests.swift#ConfigRecordPathsTests.testTheFallbacksAreReportedOnTheLabel
  it("reports the fallbacks on the label", () => {
    expect(recordTableLabel(paths())).toBe("04 / 0B");

    const assumed = paths(-1, -1);
    expect(assumed.resolution?.platform).toBe(0x01);
    expect(recordTableLabel(assumed)).toBe("01 / 0A (assumed platform and dictionary)");
    // Another platform's table, so the record reads as upstream writes it out.
    expect(recordIsNamed(assumed, 0x1008_0a00)).toBe(false);
    expect(recordPath(assumed, 0x1008_0a00)).toBe("/Unknown/10080A00.bin");
  });
});

describe("the rows", () => {
  /**
   * A named row reads as the path, carries what the record says about itself,
   * and stands for the bytes it points at — the payload's position plus the
   * record's own offset.
   *
   * @upstream Modules/MEATool/Tests/MEAToolTests/ConfigRecordPathsTests.swift#ConfigRecordPathsTests.testANamedRowCarriesTheRecordsFactsAndItsBytes
   */
  it("carry the record's facts and its bytes", () => {
    const rows = recordRows(rootsOf(analysis(), paths()));

    expect(rows?.subtitle).toBe("3 records");
    const first = rows?.children[0];
    expect(first?.title).toBe("/home/amt/rtfd/PrivacyLvl");
    expect(fieldValue(first, "File ID")).toBe("0x10080A00");
    expect(fieldValue(first, "Size")).toBe("0x1 (1 bytes)");
    expect(fieldValue(first, "Offset")).toBe("0x0");
    expect(fieldValue(first, "OEM Configurable")).toBe("Yes");
    expect(fieldValue(first, "Reserved Flags")).toBe("0x0");
    expect(first?.range).toEqual({ start: 0x31_5010, end: 0x31_5011 });

    // The payload's start plus the record's own offset.
    const second = rows?.children[1];
    expect(second?.range).toEqual({ start: 0x31_5011, end: 0x31_5021 });
    expect(fieldValue(second, "OEM Configurable")).toBe("No");
  });

  // @upstream Modules/MEATool/Tests/MEAToolTests/ConfigRecordPathsTests.swift#ConfigRecordPathsTests.testAnUnnamedRowKeepsItsFallbackName
  it("keep the fallback name on an unnamed row", () => {
    const last = recordRows(rootsOf(analysis(), paths()))?.children.at(-1);

    expect(last?.title).toBe("/Unknown/DEADBEEF.bin");
    expect(fieldValue(last, "Path")).toBe("/Unknown/DEADBEEF.bin");
    expect(fieldValue(last, "Reserved Flags")).toBe("0x3");
  });

  /**
   * Before the table arrives the rows are the records the engine decoded, under
   * the ID the stream keys them by — and they still point at bytes.
   *
   * @upstream Modules/MEATool/Tests/MEAToolTests/ConfigRecordPathsTests.swift#ConfigRecordPathsTests.testWithoutTheTableTheRowsAreTheirFileIDs
   */
  it("are their File IDs without the table", () => {
    const rows = recordRows(rootsOf(analysis()));

    expect(rows?.children.map((row) => row.title)).toEqual([
      "Record 0x10080A00",
      "Record 0x10080700",
      "Record 0xDEADBEEF",
    ]);
    expect(fieldValue(rows?.children[0], "Path")).toBeUndefined();
    expect(rows?.children[0]?.range).toEqual({ start: 0x31_5010, end: 0x31_5011 });
  });

  /**
   * A payload whose position is unknown leaves the rows without bytes rather
   * than pointing them at an offset that means nothing in the image.
   *
   * @upstream Modules/MEATool/Tests/MEAToolTests/ConfigRecordPathsTests.swift#ConfigRecordPathsTests.testWithoutAPayloadOffsetTheRowsPointAtNothing
   */
  it("point at nothing without a payload offset", () => {
    const rows = recordRows(rootsOf(analysis({ payloadOffset: undefined }), paths()));

    for (const row of rows?.children ?? []) expect(row.range).toBeUndefined();
  });

  // @upstream Modules/MEATool/Tests/MEAToolTests/ConfigRecordPathsTests.swift#ConfigRecordPathsTests.testTheGroupNamesTheTableAndDropsTheReflectedList
  it("name the table on the group and drop the reflected list", () => {
    const oem = rootsOf(analysis(), paths()).find((one) => one.title === "OEM Configuration");

    expect(fieldValue(oem, "File Table")).toBe("04 / 0B");
    expect(oem?.fields.some((one) => one.label.startsWith("records"))).toBe(false);
    expect(fieldValue(oem, "headerRevision")).toBe("1");
  });

  /**
   * A volume that carries its own ID-keyed stream shows it under the volume,
   * named after the low-level file it came from — and without byte ranges:
   * those records live in a FAT chain, not at one place in the image.
   *
   * @upstream Modules/MEATool/Tests/MEAToolTests/ConfigRecordPathsTests.swift#ConfigRecordPathsTests.testAVolumesOwnStreamIsARowUnderTheVolume
   */
  it("show a volume's own stream under the volume", () => {
    const roots = rootsOf(analysis({ onVolume: true }), paths());
    const mfs = roots.find((one) => one.title === "File System (MFS)");
    const stream = mfs?.children.find((one) => one.title === "OEM Configuration");

    expect(stream?.subtitle).toBe("3 records");
    expect(stream?.children[0]?.title).toBe("/home/amt/rtfd/PrivacyLvl");
    expect(stream?.children[0]?.range).toBeUndefined();
  });
});
