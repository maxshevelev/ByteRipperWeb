import { describe, expect, it } from "vitest";
import {
  DEFAULT_FTBL_DICTIONARY,
  DEFAULT_FTBL_PLATFORM,
  efsTableEntry,
  FileTable,
  FileTableError,
  fileTableEntry,
} from "@/firmware/me/data/fileTable";

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

const json = `
{
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
}
`;

const table = () => FileTable.parse(json);

describe("the record", () => {
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FileTableTests.swift#FileTableTests.testARecordIsReadInUpstreamsFieldOrder
  it("is read in upstream's field order", () => {
    const entry = table().recordNamingFileIndex(63, 4, 0x0a);

    expect(entry).toEqual({
      fileId: "10003500",
      path: "/home/mca/manuf_ver",
      integrity: true,
      encryption: false,
      antiReplay: false,
      accessUnknown: 40,
      groupId: 0,
      userId: 70,
      vfsId: 63,
      unknown: 448,
    });
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FileTableTests.swift#FileTableTests.testTheIntegrityFlagIsPerRecord
  it("carries its own integrity flag, not its neighbours'", () => {
    const entry = table().recordNamingFileIndex(6, 4, 0x0a);

    expect(entry?.path).toBe("/home/chipsetinit/mphytbl");
    expect(entry?.integrity).toBe(false);
  });

  /**
   * Two records claim the same file under different paths — 4836 `vfsId`s in
   * the real file do — and upstream stops at the first (`break # Stop searching
   * FTBL Dictionary at first VFS ID match`). The first is the one written
   * first, which on the data as shipped is the lowest file ID; the record
   * behind it is a name the file does not have.
   *
   * @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FileTableTests.swift#FileTableTests.testAFileClaimedTwiceTakesTheFirstRecordOnly
   */
  it("takes only the first of two records claiming one file", () => {
    const entry = table().recordNamingFileIndex(256, 4, 0x0a);

    expect(entry?.path).toBe("/home/ish_srv/bios2ish");
    expect(entry?.fileId).toBe("10002000");
    expect(entry?.encryption).toBe(false);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FileTableTests.swift#FileTableTests.testAnIndexTheTableDoesNotNameComesBackEmpty
  it("names nothing for an index the table does not carry", () => {
    expect(table().recordNamingFileIndex(1000, 4, 0x0a)).toBeUndefined();
  });
});

describe("the lookup by the record's own key", () => {
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FileTableTests.swift#FileTableTests.testARecordIsAlsoFoundByItsOwnKey
  it("finds a record by its own key", () => {
    const entry = table().recordWithFileId(0x1000_3500, 4, 0x0a);

    expect(entry?.path).toBe("/home/mca/manuf_ver");
    expect(entry?.fileId).toBe("10003500");
    // The row's own vfsId, whatever was asked.
    expect(entry?.vfsId).toBe(63);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FileTableTests.swift#FileTableTests.testTheKeyIsTheEightDigitFormOfTheID
  it("keys by the eight-digit form of the ID", () => {
    expect(table().recordWithFileId(0x1004_0000, 4, 0x0a)).toBeDefined();
    // A different ID, not the same one short of its leading digits.
    expect(table().recordWithFileId(0x40000, 4, 0x0a)).toBeUndefined();
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FileTableTests.swift#FileTableTests.testAnIDTheTableDoesNotCarryIsNil
  it("gives nothing for an ID the table does not carry", () => {
    expect(table().recordWithFileId(0xdead_beef, 4, 0x0a)).toBeUndefined();
  });
});

describe("the two fallbacks", () => {
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FileTableTests.swift#FileTableTests.testAKnownPlatformAndDictionaryAreUsedAsGiven
  it("uses a known platform and dictionary as given", () => {
    expect(table().resolve(4, 0x0a)).toEqual({
      platform: 4,
      dictionary: 0x0a,
      assumedPlatform: false,
      assumedDictionary: false,
      missing: false,
    });
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FileTableTests.swift#FileTableTests.testAMissingPlatformFallsBackToICP
  it("falls back to ICP where the volume names no platform", () => {
    const resolution = table().resolve(-1, 0x0a);

    expect(resolution.platform).toBe(DEFAULT_FTBL_PLATFORM);
    expect(resolution.assumedPlatform).toBe(true);
    expect(resolution.missing).toBe(false);
    // Read from platform 01.
    expect(table().recordNamingFileIndex(9, -1, 0x0a)?.path).toBe("/home/icc/default");
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FileTableTests.swift#FileTableTests.testAnUnknownPlatformFallsBackToICP
  it("falls back to ICP for a platform the file does not carry", () => {
    const resolution = table().resolve(0x7f, 0x0a);

    expect(resolution.platform).toBe(DEFAULT_FTBL_PLATFORM);
    expect(resolution.assumedPlatform).toBe(true);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FileTableTests.swift#FileTableTests.testAnUnknownDictionaryFallsBackToCON
  it("falls back to CON for a dictionary the platform does not have", () => {
    const resolution = table().resolve(4, 0x0c);

    expect(resolution.platform).toBe(4);
    expect(resolution.dictionary).toBe(DEFAULT_FTBL_DICTIONARY);
    expect(resolution.assumedDictionary).toBe(true);
    expect(resolution.assumedPlatform).toBe(false);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FileTableTests.swift#FileTableTests.testAPlatformWithNoFTBLTableReportsMissing
  it("reports a platform whose fallback dictionary has no FTBL table", () => {
    const only = FileTable.parse(
      '{ "02": { "0B": { "EFST": { "01": { "00000000": "0,0,1,0,0,X" } } } } }'
    );

    expect(only.resolve(2, 0x0b).missing).toBe(true);
    expect(only.recordNamingFileIndex(0, 2, 0x0b)).toBeUndefined();
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FileTableTests.swift#FileTableTests.testTheDefaultDictionaryIsNotReportedAsAssumedWhenItWasAskedFor
  it("does not call the default dictionary assumed when it was asked for", () => {
    expect(table().resolve(4, 0x0a).assumedDictionary).toBe(false);
  });
});

describe("the EFS table", () => {
  /**
   * An `EFST` record is `page,pageOffset,size,fileID,reserved,name`, keyed by
   * the file's offset into the volume's data area — and that key is the page
   * and the page offset the record itself states (3 × 0xFE8 + 76 = 0x3004).
   *
   * @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FileTableTests.swift#FileTableTests.testAnEFSRecordIsReadInUpstreamsFieldOrder
   */
  it("is read in upstream's field order", () => {
    const entries = table().efsEntries(4, 0x0a, 1);
    const entry = entries?.find((one) => one.name === "BUP_MBP");

    expect(entry).toEqual({
      dataOffset: 0x3004,
      page: 3,
      pageOffset: 76,
      size: 548,
      fileId: 5,
      reserved: 0,
      name: "BUP_MBP",
    });
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FileTableTests.swift#FileTableTests.testTheEFSEntriesComeBackInDataAreaOrder
  it("comes back in data-area order", () => {
    const entries = table().efsEntries(4, 0x0a, 1);

    expect(entries?.map((one) => one.name)).toEqual(["ICC_MPHYTBL", "BUP_MBP"]);
    expect(entries?.map((one) => one.dataOffset)).toEqual([0, 0x3004]);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FileTableTests.swift#FileTableTests.testAnEFSRevisionTheTableDoesNotCarryIsNil
  it("gives nothing for a revision the table does not carry", () => {
    expect(table().efsEntries(4, 0x0a, 2)).toBeUndefined();
    expect(table().hasEfst(4, 0x0a)).toBe(true);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FileTableTests.swift#FileTableTests.testADictionaryWithNoEFSTSaysSo
  it("says when a dictionary has no EFST at all", () => {
    expect(table().hasEfst(4, 0x0b)).toBe(false);
    expect(table().efsEntries(4, 0x0b, 1)).toBeUndefined();
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FileTableTests.swift#FileTableTests.testAnEFSTOnlyFileParses
  it("parses a file whose only table is EFST", () => {
    const only = FileTable.parse(
      '{ "02": { "0B": { "EFST": { "01": { "00000000": "0,0,4,1,0,ONLY" } } } } }'
    );

    expect(only.isEmpty).toBe(false);
    expect(only.efsEntries(2, 0x0b, 1)?.map((one) => one.name)).toEqual(["ONLY"]);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FileTableTests.swift#FileTableTests.testAMalformedEFSRecordIsNoEntry
  it("reads no entry from a malformed record", () => {
    expect(efsTableEntry("0", "0,0,4,1,0")).toBeUndefined();
    expect(efsTableEntry("zz", "0,0,4,1,0,X")).toBeUndefined();
    expect(efsTableEntry("0", "0,0,x,1,0,X")).toBeUndefined();
    expect(efsTableEntry("0", "0,0,4,1,0,")).toBeUndefined();
    expect(efsTableEntry("3004", "3,76,548,5,0,X")).toBeDefined();
  });
});

describe("the file itself", () => {
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FileTableTests.swift#FileTableTests.testMalformedJSONIsAnError
  it("reports malformed JSON", () => {
    expect(() => FileTable.parse("not json")).toThrow(FileTableError);
    expect(() => FileTable.parse("{}")).toThrow(FileTableError);
  });

  /**
   * A table of an unexpected shape is skipped rather than fatal: the file grows
   * tables (`EFST` arrived after `FTBL`), and a reader that threw on the next
   * one would stop naming anything the day it appears.
   *
   * @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FileTableTests.swift#FileTableTests.testAnUnexpectedShapeIsSkippedNotFatal
   */
  it("skips a table of an unexpected shape", () => {
    const grown = FileTable.parse(
      `{ "04": { "0A": { "FTBL": { "10003500": "/home/mca/manuf_ver,1,0,0,40,0,70,63,448" },
                        "NEW": [1, 2, 3] } } }`
    );

    expect(grown.recordNamingFileIndex(63, 4, 0x0a)?.path).toBe("/home/mca/manuf_ver");
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FileTableTests.swift#FileTableTests.testAShortRecordIsNoEntry
  it("reads no entry from a record short of its nine fields", () => {
    expect(fileTableEntry("1", "/home/x,1,0,0")).toBeUndefined();
    expect(fileTableEntry("1", "/home/x,1,0,0,0,0,0,x,0")).toBeUndefined();
    expect(fileTableEntry("1", "/home/x,1,0,0,0,0,0,7,0")).toBeDefined();
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FileTableTests.swift#FileTableTests.testAnEmptyTableIsEmpty
  it("says an empty table is empty", () => {
    const empty = new FileTable();

    expect(empty.isEmpty).toBe(true);
    expect(empty.recordNamingFileIndex(0, 4, 0x0a)).toBeUndefined();
    expect(empty.efsEntries(4, 0x0a, 1)).toBeUndefined();
    expect(empty.recordWithFileId(0x1000_3500, 4, 0x0a)).toBeUndefined();
    expect(empty.hasEfst(4, 0x0a)).toBe(false);
  });
});
