import { describe, expect, it } from "vitest";
import { FileTable, fileTableEFSEntry, fileTableEntry } from "@/firmware/me/data/fileTable";

/**
 * `FileTable.dat` — the table that names an FTBL-mode MFS volume's low-level
 * files and an EFS volume's (upstream `mfs_home13_anl` + `efs_anl` +
 * `check_ftbl_pl` / `check_ftbl_id`, MEA.py 7405–7445, 8303, 8801).
 *
 * The records here are copied from the real file (platform `04`, dictionary
 * `0A` — the table the CSME 15 oracle dump's volume header points at), so the
 * field order is asserted against what upstream actually ships rather than
 * against a shape invented for a test.
 */

const json = `{
  "04": {
    "0A": {
      "FTBL": {
        "10003500": "/home/mca/manuf_ver,1,0,0,40,0,70,63,448",
        "10038900": "/home/chipsetinit/mphytbl,0,0,0,8,206,0,6,384",
        "10002000": "/home/ish_srv/bios2ish,1,0,0,3592,0,61,256,384",
        "10040000": "/home/upid/features_state,1,1,1,0,0,7,256,0"
      },
      "EFST": {
        "01": {
          "00003004": "3,76,548,5,0,BUP_MBP",
          "00000000": "0,0,12288,6,0,ICC_MPHYTBL"
        }
      }
    },
    "0B": {
      "FTBL": {
        "10003500": "/home/mca/other,1,0,0,40,0,70,63,448"
      }
    }
  },
  "01": {
    "0A": {
      "FTBL": {
        "10009900": "/home/icc/default,0,0,0,0,0,0,9,0"
      }
    }
  }
}`;

const table = (): FileTable => FileTable.parse(json);

describe("FileTable records", () => {
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FileTableTests.swift#FileTableTests.testARecordIsReadInUpstreamsFieldOrder
  it("reads a record in upstream's field order", () => {
    const entry = table().recordForFileIndex(63, 4, 0x0a);
    expect(entry).toBeDefined();
    expect(entry?.fileID).toBe("10003500");
    expect(entry?.path).toBe("/home/mca/manuf_ver");
    expect(entry?.integrity).toBe(true);
    expect(entry?.encryption).toBe(false);
    expect(entry?.antiReplay).toBe(false);
    expect(entry?.accessUnknown).toBe(40);
    expect(entry?.groupID).toBe(0);
    expect(entry?.userID).toBe(70);
    expect(entry?.vfsID).toBe(63);
    expect(entry?.unknown).toBe(448);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FileTableTests.swift#FileTableTests.testTheIntegrityFlagIsPerRecord
  it("reads the integrity flag per record", () => {
    const entry = table().recordForFileIndex(6, 4, 0x0a);
    expect(entry?.path).toBe("/home/chipsetinit/mphytbl");
    expect(entry?.integrity).toBe(false);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FileTableTests.swift#FileTableTests.testAFileClaimedTwiceTakesTheFirstRecordOnly
  it("takes the first record when a file is claimed twice", () => {
    const entry = table().recordForFileIndex(256, 4, 0x0a);
    expect(entry?.path).toBe("/home/ish_srv/bios2ish");
    expect(entry?.fileID).toBe("10002000");
    expect(entry?.encryption).toBe(false);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FileTableTests.swift#FileTableTests.testAnIndexTheTableDoesNotNameComesBackEmpty
  it("comes back empty for an index the table does not name", () => {
    expect(table().recordForFileIndex(1000, 4, 0x0a)).toBeUndefined();
  });
});

describe("FileTable records by their own key", () => {
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FileTableTests.swift#FileTableTests.testARecordIsAlsoFoundByItsOwnKey
  it("finds a record by its own key", () => {
    const entry = table().recordForFileID(0x1000_3500, 4, 0x0a);
    expect(entry?.path).toBe("/home/mca/manuf_ver");
    expect(entry?.fileID).toBe("10003500");
    expect(entry?.vfsID).toBe(63);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FileTableTests.swift#FileTableTests.testTheKeyIsTheEightDigitFormOfTheID
  it("keys by the eight-digit form of the ID", () => {
    expect(table().recordForFileID(0x1004_0000, 4, 0x0a)).toBeDefined();
    expect(table().recordForFileID(0x40000, 4, 0x0a)).toBeUndefined();
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FileTableTests.swift#FileTableTests.testAnIDTheTableDoesNotCarryIsNil
  it("is nil for an ID the table does not carry", () => {
    expect(table().recordForFileID(0xdead_beef, 4, 0x0a)).toBeUndefined();
  });
});

describe("FileTable fallbacks", () => {
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FileTableTests.swift#FileTableTests.testAKnownPlatformAndDictionaryAreUsedAsGiven
  it("uses a known platform and dictionary as given", () => {
    const resolution = table().resolve(4, 0x0a);
    expect(resolution.platform).toBe(4);
    expect(resolution.dictionary).toBe(0x0a);
    expect(resolution.assumedPlatform).toBe(false);
    expect(resolution.assumedDictionary).toBe(false);
    expect(resolution.missing).toBe(false);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FileTableTests.swift#FileTableTests.testAMissingPlatformFallsBackToICP
  it("falls back to ICP when the platform is missing", () => {
    const resolution = table().resolve(-1, 0x0a);
    expect(resolution.platform).toBe(FileTable.defaultPlatform);
    expect(resolution.assumedPlatform).toBe(true);
    expect(resolution.missing).toBe(false);

    const entry = table().recordForFileIndex(9, -1, 0x0a);
    expect(entry?.path).toBe("/home/icc/default");
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FileTableTests.swift#FileTableTests.testAnUnknownPlatformFallsBackToICP
  it("falls back to ICP when the platform is unknown", () => {
    const resolution = table().resolve(0x7f, 0x0a);
    expect(resolution.platform).toBe(FileTable.defaultPlatform);
    expect(resolution.assumedPlatform).toBe(true);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FileTableTests.swift#FileTableTests.testAnUnknownDictionaryFallsBackToCON
  it("falls back to CON when the dictionary is unknown", () => {
    const resolution = table().resolve(4, 0x0c);
    expect(resolution.platform).toBe(4);
    expect(resolution.dictionary).toBe(FileTable.defaultDictionary);
    expect(resolution.assumedDictionary).toBe(true);
    expect(resolution.assumedPlatform).toBe(false);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FileTableTests.swift#FileTableTests.testAPlatformWithNoFTBLTableReportsMissing
  it("reports missing when the platform has no FTBL table", () => {
    const only = FileTable.parse(
      `{ "02": { "0B": { "EFST": { "01": { "00000000": "0,0,1,0,0,X" } } } } }`
    );
    expect(only.resolve(2, 0x0b).missing).toBe(true);
    expect(only.recordForFileIndex(0, 2, 0x0b)).toBeUndefined();
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FileTableTests.swift#FileTableTests.testTheDefaultDictionaryIsNotReportedAsAssumedWhenItWasAskedFor
  it("does not report the default dictionary as assumed when it was asked for", () => {
    expect(table().resolve(4, 0x0a).assumedDictionary).toBe(false);
  });
});

describe("FileTable EFS tables", () => {
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FileTableTests.swift#FileTableTests.testAnEFSRecordIsReadInUpstreamsFieldOrder
  it("reads an EFS record in upstream's field order", () => {
    const entries = table().efsEntries(4, 0x0a, 1);
    const entry = entries?.find((one) => one.name === "BUP_MBP");
    expect(entry?.dataOffset).toBe(0x3004);
    expect(entry?.page).toBe(3);
    expect(entry?.pageOffset).toBe(76);
    expect(entry?.size).toBe(548);
    expect(entry?.fileID).toBe(5);
    expect(entry?.reserved).toBe(0);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FileTableTests.swift#FileTableTests.testTheEFSEntriesComeBackInDataAreaOrder
  it("returns the EFS entries in data-area order", () => {
    const entries = table().efsEntries(4, 0x0a, 1);
    expect(entries?.map((one) => one.name)).toEqual(["ICC_MPHYTBL", "BUP_MBP"]);
    expect(entries?.map((one) => one.dataOffset)).toEqual([0, 0x3004]);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FileTableTests.swift#FileTableTests.testAnEFSRevisionTheTableDoesNotCarryIsNil
  it("is nil for an EFS revision the table does not carry", () => {
    expect(table().efsEntries(4, 0x0a, 2)).toBeUndefined();
    expect(table().hasEFST(4, 0x0a)).toBe(true);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FileTableTests.swift#FileTableTests.testADictionaryWithNoEFSTSaysSo
  it("says so for a dictionary with no EFST", () => {
    expect(table().hasEFST(4, 0x0b)).toBe(false);
    expect(table().efsEntries(4, 0x0b, 1)).toBeUndefined();
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FileTableTests.swift#FileTableTests.testAnEFSTOnlyFileParses
  it("parses a file whose only table is EFST", () => {
    const only = FileTable.parse(
      `{ "02": { "0B": { "EFST": { "01": { "00000000": "0,0,4,1,0,ONLY" } } } } }`
    );
    expect(only.isEmpty).toBe(false);
    expect(only.efsEntries(2, 0x0b, 1)?.map((one) => one.name)).toEqual(["ONLY"]);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FileTableTests.swift#FileTableTests.testAMalformedEFSRecordIsNoEntry
  it("makes no entry of a malformed EFS record", () => {
    expect(fileTableEFSEntry("0", "0,0,4,1,0")).toBeUndefined();
    expect(fileTableEFSEntry("zz", "0,0,4,1,0,X")).toBeUndefined();
    expect(fileTableEFSEntry("0", "0,0,x,1,0,X")).toBeUndefined();
    expect(fileTableEFSEntry("0", "0,0,4,1,0,")).toBeUndefined();
    expect(fileTableEFSEntry("3004", "3,76,548,5,0,X")).toBeDefined();
  });
});

describe("FileTable.parse", () => {
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FileTableTests.swift#FileTableTests.testMalformedJSONIsAnError
  it("treats malformed JSON as an error", () => {
    expect(() => FileTable.parse("not json")).toThrow();
    expect(() => FileTable.parse("{}")).toThrow();
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FileTableTests.swift#FileTableTests.testAnUnexpectedShapeIsSkippedNotFatal
  it("skips an unexpected shape rather than failing", () => {
    const one = FileTable.parse(
      `{ "04": { "0A": { "FTBL": { "10003500": "/home/mca/manuf_ver,1,0,0,40,0,70,63,448" },
                         "NEW": [1, 2, 3] } } }`
    );
    expect(one.recordForFileIndex(63, 4, 0x0a)?.path).toBe("/home/mca/manuf_ver");
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FileTableTests.swift#FileTableTests.testAShortRecordIsNoEntry
  it("makes no entry of a short record", () => {
    expect(fileTableEntry("1", "/home/x,1,0,0")).toBeUndefined();
    expect(fileTableEntry("1", "/home/x,1,0,0,0,0,0,x,0")).toBeUndefined();
    expect(fileTableEntry("1", "/home/x,1,0,0,0,0,0,7,0")).toBeDefined();
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FileTableTests.swift#FileTableTests.testAnEmptyTableIsEmpty
  it("reports an empty table as empty", () => {
    expect(FileTable.empty.isEmpty).toBe(true);
    expect(FileTable.empty.recordForFileIndex(0, 4, 0x0a)).toBeUndefined();
    expect(FileTable.empty.efsEntries(4, 0x0a, 1)).toBeUndefined();
    expect(FileTable.empty.recordForFileID(0x1000_3500, 4, 0x0a)).toBeUndefined();
    expect(FileTable.empty.hasEFST(4, 0x0a)).toBe(false);
  });
});
