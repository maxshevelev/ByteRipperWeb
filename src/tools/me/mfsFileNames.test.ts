import { describe, expect, it } from "vitest";
import { FileTable } from "@/firmware/me/data/fileTable";
import type { EFSVolume, MFSIntegrityTable, MFSVolume } from "@/firmware/me/models/fileSystemFacts";
import { analysisWith } from "@/tools/me/meaTesting";
import { type MEANode, presentMEA } from "@/tools/me/meaTree";
import { fileTableWanted, MFSFileNames } from "@/tools/me/mfsFileNames";

/**
 * `MFSFileNames` + the file rows it names — the panel's half of upstream's
 * `mfs_home13_anl`: an FTBL-mode MFS volume's low-level files have no name in
 * their bytes, so the names come out of `FileTable.dat` on the way to the rows,
 * and never out of the analysis.
 */

/**
 * The shape of the real table, cut down: platform `04` / dictionary `0A` is the
 * one the CSME 15 oracle dump's volume header names. File `7` is claimed by two
 * records — the collision upstream's `break` settles.
 */
const tableJson = `{
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
}`;

const table = (): FileTable => FileTable.parse(tableJson);

/**
 * An FTBL-mode volume with the files the table can speak about. `split` indices
 * carry an Integrity table the engine took off the end, the way an FTBL volume's
 * flagged files arrive.
 */
function volume(
  platform = 4,
  dictionary = 0x0a,
  indices: readonly number[] = [6, 7, 63, 99],
  split: ReadonlySet<number> = new Set()
): MFSVolume {
  return {
    offset: 0x1f_f000,
    pageSize: 0x2000,
    pageCount: 49,
    systemPageCount: 1,
    dataPageCount: 48,
    signatureValid: true,
    volumeSize: 0x6_4000,
    computedVolumeSize: 0x6_2000,
    fileRecordCount: 1024,
    usedFileCount: indices.length,
    ftblDictionary: dictionary,
    ftblPlatform: platform,
    ftblReserved: 0,
    usesFTBL: true,
    presentFileCount: indices.length,
    fileBytes: 0x100 * indices.length,
    files: indices.map((index) =>
      split.has(index)
        ? { index, size: 0x100, contentSize: 0x100 - 0x28, integrity: integrityFixture() }
        : { index, size: 0x100 }
    ),
    configurations: [],
    homeDirectory: undefined,
    reservedIntegrity: [],
    pchInit: undefined,
  };
}

const analysis = (vol: MFSVolume) => analysisWith({ mfsVolume: vol });

/** The least an EFS volume can be and still be one — only its presence matters here. */
const efsVolumeFixture = (): EFSVolume => ({
  offset: 0x46_3000,
  pageSize: 0x1000,
  systemPageCount: 1,
  dataPageCount: 14,
  scratchPageCount: 1,
  scratchPagesEmpty: true,
  dataPageCountMatchesSystem: true,
  dictionary: 0x0b,
  revision: 1,
  unknown1: 2,
  dictionaryRevision: 1,
  dataPagesCommitted: 10,
  dataPagesReserved: 4,
  systemHeaderCRCValid: true,
  indexesCRCValid: true,
  firstIndexPaddingEmpty: true,
  dataPageOrder: [],
  dataPageHeaderCRCsValid: true,
  dataPageFooterCRCsValid: true,
  matchesMFSDictionary: undefined,
  files: [],
});

/** The tail an FTBL volume's flagged files end with, as the engine reads it. */
const integrityFixture = (): MFSIntegrityTable => ({
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
});

const field = (label: string, node: MEANode): string | undefined =>
  node.fields.find((one) => one.label === label)?.value;

function files(roots: readonly MEANode[]): MEANode {
  const mfs = roots.find((one) => one.title === "File System (MFS)");
  const branch = mfs?.children.find((one) => one.title === "Files");
  if (branch === undefined) throw new Error("no Files branch");
  return branch;
}

describe("MFSFileNames lookup", () => {
  // @upstream Modules/MEATool/Tests/MEAToolTests/MFSFileNamesTests.swift#MFSFileNamesTests.testItNamesThePresentFilesAndNothingElse
  it("names the present files and nothing else", () => {
    const names = MFSFileNames.forVolume(table(), volume());
    expect(names.path(63)).toBe("/home/mca/manuf_ver");
    expect(names.path(6)).toBe("/home/chipsetinit/mphytbl");
    expect(names.path(99)).toBeUndefined();
    expect(new Set(names.entries.keys())).toEqual(new Set([6, 7, 63]));
  });

  // @upstream Modules/MEATool/Tests/MEAToolTests/MFSFileNamesTests.swift#MFSFileNamesTests.testAFileClaimedTwiceTakesTheFirstRecord
  it("takes the first record when a file is claimed twice", () => {
    const names = MFSFileNames.forVolume(table(), volume());
    expect(names.path(7)).toBe("/home/ish_srv/bios2ish");
    expect(names.record(7)?.fileID).toBe("10002000");
  });

  // @upstream Modules/MEATool/Tests/MEAToolTests/MFSFileNamesTests.swift#MFSFileNamesTests.testTheLabelNamesTheTableTheVolumeAskedFor
  it("labels the table the volume asked for", () => {
    expect(MFSFileNames.forVolume(table(), volume()).tableLabel).toBe("04 / 0A");
  });

  // @upstream Modules/MEATool/Tests/MEAToolTests/MFSFileNamesTests.swift#MFSFileNamesTests.testAnAssumedPlatformIsSaidSo
  it("says so when the platform was assumed", () => {
    const names = MFSFileNames.forVolume(table(), volume(0x7f));
    expect(names.tableLabel).toBe("01 / 0A (assumed platform)");
    expect(names.path(6)).toBe("/home/icc/default");
  });

  // @upstream Modules/MEATool/Tests/MEAToolTests/MFSFileNamesTests.swift#MFSFileNamesTests.testBothHalvesAssumedAreSaidSo
  it("says so when both halves were assumed", () => {
    const names = MFSFileNames.forVolume(table(), volume(-1, -1));
    expect(names.tableLabel).toBe("01 / 0A (assumed platform and dictionary)");
  });

  // @upstream Modules/MEATool/Tests/MEAToolTests/MFSFileNamesTests.swift#MFSFileNamesTests.testAnEmptyTableNamesNothing
  it("names nothing from an empty table", () => {
    const names = MFSFileNames.forVolume(FileTable.empty, volume());
    expect(names.isEmpty).toBe(true);
    expect(names.tableLabel).toBeUndefined();
  });

  // @upstream Modules/MEATool/Tests/MEAToolTests/MFSFileNamesTests.swift#MFSFileNamesTests.testAMissingTableIsReported
  it("reports a table that has no FTBL for this volume", () => {
    const only = FileTable.parse(
      `{ "02": { "0B": { "EFST": { "01": { "00000000": "0,0,1,0,0,X" } } } } }`
    );
    const names = MFSFileNames.forVolume(only, volume(2, 0x0b));
    expect(names.isEmpty).toBe(true);
    expect(names.tableLabel).toBe("02 / 0B — not in FileTable.dat");
  });
});

describe("MFSFileNames rows", () => {
  // @upstream Modules/MEATool/Tests/MEAToolTests/MFSFileNamesTests.swift#MFSFileNamesTests.testTheRowsKeepTheirNumbersWithoutATable
  it("keeps the rows' numbers without a table", () => {
    const roots = presentMEA(analysis(volume()), undefined);
    const branch = files(roots);
    expect(branch.children.map((one) => one.title)).toEqual([
      "File 6",
      "File 7",
      "File 63",
      "File 99",
    ]);
    const first = branch.children[0];
    expect(first === undefined ? undefined : field("Path", first)).toBeUndefined();
    const mfs = roots.find((one) => one.title === "File System (MFS)");
    expect(mfs === undefined ? undefined : field("File Table", mfs)).toBeUndefined();
  });

  // @upstream Modules/MEATool/Tests/MEAToolTests/MFSFileNamesTests.swift#MFSFileNamesTests.testANamedRowCarriesThePathAndTheRecordsFlags
  it("carries the path and the record's flags on a named row", () => {
    const vol = volume();
    const names = MFSFileNames.forVolume(table(), vol);
    const branch = files(presentMEA(analysis(vol), undefined, names));

    const named = branch.children.find((one) => one.title === "/home/mca/manuf_ver");
    expect(named?.subtitle).toBe("#63 · 0x100 (256 bytes)");
    expect(named === undefined ? undefined : field("Index", named)).toBe("63");
    expect(named === undefined ? undefined : field("File ID", named)).toBe("0x10003500");
    expect(named === undefined ? undefined : field("Integrity", named)).toBe("Yes");
    expect(named === undefined ? undefined : field("Encryption", named)).toBe("No");
    expect(named === undefined ? undefined : field("Anti-Replay", named)).toBe("No");
    expect(named === undefined ? undefined : field("User ID", named)).toBe("0x46");

    // The flags are the record's own, not the volume's: file 6 is the one the
    // table says carries no integrity tail.
    const plain = branch.children.find((one) => one.title === "/home/chipsetinit/mphytbl");
    expect(plain === undefined ? undefined : field("Integrity", plain)).toBe("No");
  });

  // @upstream Modules/MEATool/Tests/MEAToolTests/MFSFileNamesTests.swift#MFSFileNamesTests.testARowNamesOneRecordAndSaysWhichOne
  it("names one record and says which one", () => {
    const vol = volume();
    const names = MFSFileNames.forVolume(table(), vol);
    const branch = files(presentMEA(analysis(vol), undefined, names));
    const row = branch.children.find((one) => one.title === "/home/ish_srv/bios2ish");
    expect(row === undefined ? undefined : field("File ID", row)).toBe("0x10002000");
    expect(
      branch.children.find((one) => one.title === "/home/upid/features_state")
    ).toBeUndefined();
  });

  // @upstream Modules/MEATool/Tests/MEAToolTests/MFSFileNamesTests.swift#MFSFileNamesTests.testAnUnnamedFileKeepsItsNumberBesideTheNamedOnes
  it("keeps an unnamed file's number beside the named ones", () => {
    const vol = volume();
    const names = MFSFileNames.forVolume(table(), vol);
    const branch = files(presentMEA(analysis(vol), undefined, names));
    const row = branch.children.find((one) => one.title === "File 99");
    expect(row?.subtitle).toBe("0x100 (256 bytes)");
    expect(row === undefined ? undefined : field("Path", row)).toBeUndefined();
  });

  // @upstream Modules/MEATool/Tests/MEAToolTests/MFSFileNamesTests.swift#MFSFileNamesTests.testASplitFileShowsItsContentSizeAndItsTable
  it("shows a split file's content size and its table", () => {
    const vol = volume(4, 0x0a, undefined, new Set([63]));
    const names = MFSFileNames.forVolume(table(), vol);
    const branch = files(presentMEA(analysis(vol), undefined, names));
    const row = branch.children.find((one) => one.title === "/home/mca/manuf_ver");

    expect(row === undefined ? undefined : field("Size", row)).toBe("0xD8 (216 bytes)");
    expect(row === undefined ? undefined : field("Chain Size", row)).toBe("0x100 (256 bytes)");
    expect(row?.subtitle).toBe("#63 · 0xD8 (216 bytes)");
    const integrity = row?.children.find((one) => one.title === "Integrity");
    expect(integrity?.subtitle).toBe("0x28 (40 bytes)");
    expect(integrity?.fields.length).toBeGreaterThan(0);
  });

  // @upstream Modules/MEATool/Tests/MEAToolTests/MFSFileNamesTests.swift#MFSFileNamesTests.testAFileWithNoTableShowsOneSize
  it("shows one size for a file with no table", () => {
    const vol = volume();
    const names = MFSFileNames.forVolume(table(), vol);
    const branch = files(presentMEA(analysis(vol), undefined, names));
    const row = branch.children.find((one) => one.title === "/home/mca/manuf_ver");
    expect(row === undefined ? undefined : field("Size", row)).toBe("0x100 (256 bytes)");
    expect(row === undefined ? undefined : field("Chain Size", row)).toBeUndefined();
    expect(row?.children).toEqual([]);
  });

  // @upstream Modules/MEATool/Sources/MEAToolUI/MEAToolModule.swift#MEAParkedState.loadFileNames
  it("is asked for exactly the analyses that need it", () => {
    // An FTBL volume with files cannot name them.
    expect(fileTableWanted(analysis(volume()), [])).toBe(true);
    // A legacy volume names its own through the home directory.
    const legacy = analysisWith({ mfsVolume: { ...volume(), usesFTBL: false } });
    expect(fileTableWanted(legacy, [])).toBe(false);
    // An FTBL volume with no present files has nothing to name.
    expect(fileTableWanted(analysis(volume(4, 0x0a, [])), [])).toBe(false);
    // An EFS volume is the sharper case: without the table it lists nothing at
    // all, so this is not about a name.
    const withEfs = analysisWith({ efsVolume: efsVolumeFixture() });
    expect(fileTableWanted(withEfs, [])).toBe(true);
    // And an ID-keyed Configuration record needs it for a path.
    expect(fileTableWanted(analysisWith(), [0x1008_0a00])).toBe(true);
    // Nothing at all in the image: no reason to spend 5 MB.
    expect(fileTableWanted(analysisWith(), [])).toBe(false);
  });

  // @upstream Modules/MEATool/Tests/MEAToolTests/MFSFileNamesTests.swift#MFSFileNamesTests.testTheVolumeSaysWhichTableNamedItsFiles
  it("says on the volume which table named its files", () => {
    const vol = volume();
    const names = MFSFileNames.forVolume(table(), vol);
    const roots = presentMEA(analysis(vol), undefined, names);
    const mfs = roots.find((one) => one.title === "File System (MFS)");
    expect(mfs === undefined ? undefined : field("Uses FileTable.dat", mfs)).toBe("Yes");
    expect(mfs === undefined ? undefined : field("File Table", mfs)).toBe("04 / 0A");
  });
});
