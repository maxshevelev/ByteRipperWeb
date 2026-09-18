import { describe, expect, it } from "vitest";
import { FileTable } from "@/firmware/me/data/fileTable";
import type { MFSIntegrityTable, MFSVolume } from "@/firmware/me/models/fileSystemFacts";
import { analysisWith, mfsVolumeFixture } from "@/tools/me/meaTesting";
import type { MEANode } from "@/tools/me/meaTree";
import { presentMEA } from "@/tools/me/meaTree";
import {
  fileTableLabel,
  mfsFileNames,
  NO_FILE_NAMES,
  namesNothing,
  pathForFile,
  recordForFile,
} from "@/tools/me/mfsFileNames";

/**
 * `MFSFileNames` and the file rows it names — the panel's half of upstream's
 * `mfs_home13_anl`: an FTBL-mode MFS volume's low-level files have no name in
 * their bytes, so the names come out of `FileTable.dat` on the way to the rows,
 * and never out of the analysis.
 */

/**
 * The shape of the real table, cut down: platform `04` / dictionary `0A` is the
 * one the CSME 15 oracle dump's volume header names.
 */
const json = `
{
  "04": {
    "0A": {
      "FTBL": {
        "10003500": "/home/mca/manuf_ver,1,0,0,40,0,70,63,448",
        "10038900": "/home/chipsetinit/mphytbl,0,0,0,8,206,0,6,384",
        "10002000": "/home/ish_srv/bios2ish,1,0,0,3592,0,61,7,384",
        "10040000": "/home/upid/features_state,0,1,1,0,0,7,7,0"
      }
    }
  },
  "01": {
    "0A": { "FTBL": { "10009900": "/home/icc/default,0,0,0,0,0,0,6,0" } }
  }
}
`;

const table = () => FileTable.parse(json);

/** An FTBL-mode volume with the files the table can speak about. */
function volume(
  options: {
    readonly platform?: number;
    readonly dictionary?: number;
    readonly indices?: readonly number[];
    /** Files whose Integrity table the engine took off the end. */
    readonly split?: ReadonlySet<number>;
  } = {}
): MFSVolume {
  const indices = options.indices ?? [6, 7, 63, 99];
  const split = options.split ?? new Set<number>();
  return {
    ...mfsVolumeFixture(),
    ftblPlatform: options.platform ?? 4,
    ftblDictionary: options.dictionary ?? 0x0a,
    usesFTBL: true,
    usedFileCount: indices.length,
    presentFileCount: indices.length,
    fileBytes: 0x100 * indices.length,
    files: indices.map((index) =>
      split.has(index)
        ? { index, size: 0x100, contentSize: 0x100 - 0x28, integrity: integrityFixture }
        : { index, size: 0x100 }
    ),
  };
}

/** The tail an FTBL volume's flagged files arrive with. */
const integrityFixture: MFSIntegrityTable = {
  size: 0x28,
  hmacHex: "AABB",
  flagsRaw: 2,
  antiReplayProtection: true,
  encryptionProtection: false,
  antiReplayIndex: 3,
  securityVersion: 0,
  arRandom: 0x99,
  arCounter: 7,
  nonceHex: "CCDD",
};

const fieldValue = (node: MEANode | undefined, label: string): string | undefined =>
  node?.fields.find((one) => one.label === label)?.value;

function filesNode(roots: readonly MEANode[]): MEANode | undefined {
  const mfs = roots.find((one) => one.title === "File System (MFS)");
  return mfs?.children.find((one) => one.title === "Files");
}

const rootsOf = (one: MFSVolume, names = NO_FILE_NAMES) =>
  presentMEA(analysisWith({ mfsVolume: one }), undefined, names);

describe("the lookup", () => {
  /**
   * Every present file is looked up once, and only those: a table of two
   * thousand records describes many volumes, and this volume's files are the
   * question.
   *
   * @upstream Modules/MEATool/Tests/MEAToolTests/MFSFileNamesTests.swift#MFSFileNamesTests.testItNamesThePresentFilesAndNothingElse
   */
  it("names the present files and nothing else", () => {
    const names = mfsFileNames(table(), volume());

    expect(pathForFile(names, 63)).toBe("/home/mca/manuf_ver");
    expect(pathForFile(names, 6)).toBe("/home/chipsetinit/mphytbl");
    expect(pathForFile(names, 99)).toBeUndefined();
    expect([...names.entries.keys()].sort((a, b) => a - b)).toEqual([6, 7, 63]);
  });

  // @upstream Modules/MEATool/Tests/MEAToolTests/MFSFileNamesTests.swift#MFSFileNamesTests.testAFileClaimedTwiceTakesTheFirstRecord
  it("takes the first record for a file two of them claim", () => {
    const names = mfsFileNames(table(), volume());

    expect(pathForFile(names, 7)).toBe("/home/ish_srv/bios2ish");
    expect(recordForFile(names, 7)?.fileId).toBe("10002000");
  });

  // @upstream Modules/MEATool/Tests/MEAToolTests/MFSFileNamesTests.swift#MFSFileNamesTests.testTheLabelNamesTheTableTheVolumeAskedFor
  it("labels the table the volume asked for", () => {
    expect(fileTableLabel(mfsFileNames(table(), volume()))).toBe("04 / 0A");
  });

  // @upstream Modules/MEATool/Tests/MEAToolTests/MFSFileNamesTests.swift#MFSFileNamesTests.testAnAssumedPlatformIsSaidSo
  it("says when the platform was assumed", () => {
    const names = mfsFileNames(table(), volume({ platform: 0x7f }));

    expect(fileTableLabel(names)).toBe("01 / 0A (assumed platform)");
    // Named out of the fallback platform's own table.
    expect(pathForFile(names, 6)).toBe("/home/icc/default");
  });

  // @upstream Modules/MEATool/Tests/MEAToolTests/MFSFileNamesTests.swift#MFSFileNamesTests.testBothHalvesAssumedAreSaidSo
  it("says when both halves were assumed", () => {
    const names = mfsFileNames(table(), volume({ platform: -1, dictionary: -1 }));

    expect(fileTableLabel(names)).toBe("01 / 0A (assumed platform and dictionary)");
  });

  // @upstream Modules/MEATool/Tests/MEAToolTests/MFSFileNamesTests.swift#MFSFileNamesTests.testAnEmptyTableNamesNothing
  it("names nothing from an empty table", () => {
    const names = mfsFileNames(new FileTable(), volume());

    expect(names).toEqual(NO_FILE_NAMES);
    expect(fileTableLabel(names)).toBeUndefined();
    expect(namesNothing(names)).toBe(true);
  });

  /**
   * A table that has no `FTBL` for this volume is reported rather than passed
   * off as a lookup that found nothing: the row's numbers stand, and the volume
   * says where the panel looked.
   *
   * @upstream Modules/MEATool/Tests/MEAToolTests/MFSFileNamesTests.swift#MFSFileNamesTests.testAMissingTableIsReported
   */
  it("reports a table with no FTBL for this volume", () => {
    const only = FileTable.parse(
      '{ "02": { "0B": { "EFST": { "01": { "00000000": "0,0,1,0,0,X" } } } } }'
    );
    const names = mfsFileNames(only, volume({ platform: 2, dictionary: 0x0b }));

    expect(namesNothing(names)).toBe(true);
    expect(fileTableLabel(names)).toBe("02 / 0B — not in FileTable.dat");
  });
});

describe("the rows", () => {
  /**
   * Before the table arrives the rows read as they always have: the number is
   * what the flash says about the file.
   *
   * @upstream Modules/MEATool/Tests/MEAToolTests/MFSFileNamesTests.swift#MFSFileNamesTests.testTheRowsKeepTheirNumbersWithoutATable
   */
  it("keeps their numbers without a table", () => {
    const roots = rootsOf(volume());
    const files = filesNode(roots);

    expect(files?.children.map((one) => one.title)).toEqual([
      "File 6",
      "File 7",
      "File 63",
      "File 99",
    ]);
    expect(fieldValue(files?.children[0], "Path")).toBeUndefined();
    // No lookup, nothing to say about one.
    expect(
      fieldValue(
        roots.find((one) => one.title === "File System (MFS)"),
        "File Table"
      )
    ).toBeUndefined();
  });

  /**
   * With the table in hand a row is called what the table calls it, keeps the
   * index in its subtitle — a reader compares the panel with the dump, and with
   * upstream's own `path (0063)` — and carries the record's flags.
   *
   * @upstream Modules/MEATool/Tests/MEAToolTests/MFSFileNamesTests.swift#MFSFileNamesTests.testANamedRowCarriesThePathAndTheRecordsFlags
   */
  it("carries the path and the record's flags", () => {
    const one = volume();
    const files = filesNode(rootsOf(one, mfsFileNames(table(), one)));
    const named = files?.children.find((row) => row.title === "/home/mca/manuf_ver");

    expect(named?.subtitle).toBe("#63 · 0x100 (256 bytes)");
    expect(fieldValue(named, "Index")).toBe("63");
    expect(fieldValue(named, "File ID")).toBe("0x10003500");
    expect(fieldValue(named, "Integrity")).toBe("Yes");
    expect(fieldValue(named, "Encryption")).toBe("No");
    expect(fieldValue(named, "Anti-Replay")).toBe("No");
    expect(fieldValue(named, "User ID")).toBe("0x46");

    // The flags are the record's own, not the volume's: file 6 is the one the
    // table says carries no integrity tail.
    const plain = files?.children.find((row) => row.title === "/home/chipsetinit/mphytbl");
    expect(fieldValue(plain, "Integrity")).toBe("No");
  });

  // @upstream Modules/MEATool/Tests/MEAToolTests/MFSFileNamesTests.swift#MFSFileNamesTests.testARowNamesOneRecordAndSaysWhichOne
  it("names one record, and says which one", () => {
    const one = volume();
    const files = filesNode(rootsOf(one, mfsFileNames(table(), one)));

    expect(
      fieldValue(
        files?.children.find((row) => row.title === "/home/ish_srv/bios2ish"),
        "File ID"
      )
    ).toBe("0x10002000");
    // The record upstream's break never reaches names nothing here either.
    expect(files?.children.some((row) => row.title === "/home/upid/features_state")).toBe(false);
  });

  // @upstream Modules/MEATool/Tests/MEAToolTests/MFSFileNamesTests.swift#MFSFileNamesTests.testAnUnnamedFileKeepsItsNumberBesideTheNamedOnes
  it("keeps an unnamed file's number beside the named ones", () => {
    const one = volume();
    const files = filesNode(rootsOf(one, mfsFileNames(table(), one)));
    const row = files?.children.find((each) => each.title === "File 99");

    // No index in the subtitle: the title is the index.
    expect(row?.subtitle).toBe("0x100 (256 bytes)");
    expect(fieldValue(row, "Path")).toBeUndefined();
  });

  /**
   * A file whose Integrity table the engine took off the end reads as upstream
   * prints it: `Size` is the content, the whole chain is beside it, and the
   * table is a row of its own under the file.
   *
   * @upstream Modules/MEATool/Tests/MEAToolTests/MFSFileNamesTests.swift#MFSFileNamesTests.testASplitFileShowsItsContentSizeAndItsTable
   */
  it("shows a split file's content size and its table", () => {
    const one = volume({ split: new Set([63]) });
    const files = filesNode(rootsOf(one, mfsFileNames(table(), one)));
    const row = files?.children.find((each) => each.title === "/home/mca/manuf_ver");

    // 0x100 less the 0x28 tail.
    expect(fieldValue(row, "Size")).toBe("0xD8 (216 bytes)");
    expect(fieldValue(row, "Chain Size")).toBe("0x100 (256 bytes)");
    expect(row?.subtitle).toBe("#63 · 0xD8 (216 bytes)");

    const integrity = row?.children.find((each) => each.title === "Integrity");
    expect(integrity?.subtitle).toBe("0x28 (40 bytes)");
    // The table's own fields are on its row.
    expect(integrity?.fields.length ?? 0).toBeGreaterThan(0);
  });

  /**
   * A file with no table is not given a chain-size row it does not need: the
   * two numbers are the same one.
   *
   * @upstream Modules/MEATool/Tests/MEAToolTests/MFSFileNamesTests.swift#MFSFileNamesTests.testAFileWithNoTableShowsOneSize
   */
  it("shows one size for a file with no table", () => {
    const one = volume();
    const files = filesNode(rootsOf(one, mfsFileNames(table(), one)));
    const row = files?.children.find((each) => each.title === "/home/mca/manuf_ver");

    expect(fieldValue(row, "Size")).toBe("0x100 (256 bytes)");
    expect(fieldValue(row, "Chain Size")).toBeUndefined();
    expect(row?.children).toEqual([]);
  });

  // @upstream Modules/MEATool/Tests/MEAToolTests/MFSFileNamesTests.swift#MFSFileNamesTests.testTheVolumeSaysWhichTableNamedItsFiles
  it("says on the volume which table named its files", () => {
    const one = volume();
    const mfs = rootsOf(one, mfsFileNames(table(), one)).find(
      (root) => root.title === "File System (MFS)"
    );

    expect(fieldValue(mfs, "Uses FileTable.dat")).toBe("Yes");
    expect(fieldValue(mfs, "File Table")).toBe("04 / 0A");
  });
});
