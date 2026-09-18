import { describe, expect, it } from "vitest";
import { FileTable } from "@/firmware/me/data/fileTable";
import type {
  EFSFile,
  EFSVolume,
  MFSIntegrityTable,
  MFSVolume,
} from "@/firmware/me/models/fileSystemFacts";
import {
  efsFileNames,
  efsNameFor,
  efsNamesNothing,
  efsRecordFor,
  efsTableLabel,
  NO_EFS_NAMES,
} from "@/tools/me/efsFileNames";
import { analysisWith, mfsVolumeFixture } from "@/tools/me/meaTesting";
import type { MEANode } from "@/tools/me/meaTree";
import { presentMEA } from "@/tools/me/meaTree";

/**
 * `EFSFileNames` and the file rows it names. An EFS volume needs two tables:
 * `EFST` says where each file sits in the data area and what it is called, and
 * the `FTBL` rows beside it — keyed by the same file ID — hold the path and the
 * flags.
 */

/**
 * The shape of the real table, cut down to the platform/dictionary the CSME 15
 * oracle dump's MFS volume header names and the files that dump's EFS volume
 * carries.
 */
const json = `
{
  "04": {
    "0B": {
      "EFST": {
        "01": {
          "00000000": "0,0,12288,6,0,ICC_MPHYTBL",
          "00003004": "3,76,548,5,0,BUP_MBP",
          "0000322C": "3,628,80,4,0,POLICY_CPU_SID"
        },
        "02": {
          "00000000": "0,0,12288,6,0,RENAMED_LATER"
        }
      },
      "FTBL": {
        "10038900": "/home/chipsetinit/mphytbl,0,0,0,8,206,0,6,384",
        "10008D00": "/home/bup/mbp,1,0,0,0,0,3,5,384",
        "10008000": "/home/policy/skumgr/cpu_sid,1,0,1,40,346,85,4,448"
      }
    },
    "0A": { "FTBL": { "10009900": "/home/icc/default,0,0,0,0,0,0,6,0" } }
  },
  "01": {
    "0A": { "FTBL": { "10009900": "/home/icc/default,0,0,0,0,0,0,6,0" } }
  }
}
`;

const table = () => FileTable.parse(json);

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

/**
 * An EFS volume carrying `files`, the way one arrives once the engine has cut
 * its data area at the table's offsets. `split` file IDs end with an Integrity
 * table the engine took off.
 */
function volume(
  options: {
    readonly dictionaryRevision?: number;
    readonly files?: readonly (readonly [number, number])[];
    readonly split?: ReadonlySet<number>;
  } = {}
): EFSVolume {
  const files =
    options.files ??
    ([
      [6, 0],
      [5, 0x3004],
      [4, 0x322c],
    ] as const);
  const split = options.split ?? new Set([5]);
  return {
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
    dictionaryRevision: options.dictionaryRevision ?? 1,
    dataPagesCommitted: 10,
    dataPagesReserved: 4,
    systemHeaderCRCValid: true,
    indexesCRCValid: true,
    firstIndexPaddingEmpty: true,
    dataPageOrder: [],
    dataPageHeaderCRCsValid: true,
    dataPageFooterCRCsValid: true,
    matchesMFSDictionary: true,
    files: files.map(
      ([fileId, dataOffset]): EFSFile =>
        split.has(fileId)
          ? {
              fileId,
              dataOffset,
              storedSize: 0x100,
              metadataUnknown: 0xab12,
              contentSize: 0x100 - 0x28,
              integrity: integrityFixture,
            }
          : {
              fileId,
              dataOffset,
              storedSize: 0x100,
              metadataUnknown: 0xab12,
              contentSize: 0x100,
            }
    ),
  };
}

/** The MFS volume beside it, which is what names the platform and dictionary. */
const mfsBeside = (platform = 4, dictionary = 0x0b): MFSVolume => ({
  ...mfsVolumeFixture(),
  ftblPlatform: platform,
  ftblDictionary: dictionary,
  usesFTBL: true,
  presentFileCount: 0,
  usedFileCount: 0,
  fileBytes: 0,
  files: [],
});

const names = (one: EFSVolume, platform = 4, dictionary = 0x0b) =>
  efsFileNames(table(), one, platform, dictionary);

const fieldValue = (node: MEANode | undefined, label: string): string | undefined =>
  node?.fields.find((one) => one.label === label)?.value;

const rootsOf = (efs: EFSVolume, efsNames = NO_EFS_NAMES) =>
  presentMEA(
    analysisWith({ efsVolume: efs, mfsVolume: mfsBeside() }),
    undefined,
    undefined,
    efsNames
  );

function fileRows(roots: readonly MEANode[]): MEANode | undefined {
  const efs = roots.find((one) => one.title === "EFS Volume");
  return efs?.children.find((one) => one.title === "Files");
}

describe("the lookup", () => {
  // @upstream Modules/MEATool/Tests/MEAToolTests/EFSFileNamesTests.swift#EFSFileNamesTests.testAFileIsNamedByEFSTAndDescribedByFTBL
  it("names a file by EFST and describes it by FTBL", () => {
    const found = names(volume());

    expect(efsNameFor(found, 5)).toBe("BUP_MBP");
    expect(efsRecordFor(found, 5)?.path).toBe("/home/bup/mbp");
    expect(efsRecordFor(found, 5)?.integrity).toBe(true);
    expect(efsNameFor(found, 6)).toBe("ICC_MPHYTBL");
    expect(efsRecordFor(found, 6)?.integrity).toBe(false);
  });

  /**
   * The revision is the EFS System page's own, and it selects the table: the
   * same dictionary carries another revision's entries, and they are not the
   * ones this volume's files are named by.
   *
   * @upstream Modules/MEATool/Tests/MEAToolTests/EFSFileNamesTests.swift#EFSFileNamesTests.testTheSystemPagesRevisionSelectsTheTable
   */
  it("selects the table by the System page's revision", () => {
    expect(efsNameFor(names(volume({ dictionaryRevision: 1 })), 6)).toBe("ICC_MPHYTBL");
    expect(efsNameFor(names(volume({ dictionaryRevision: 2 })), 6)).toBe("RENAMED_LATER");
    expect(names(volume({ dictionaryRevision: 2 })).revision).toBe(2);
  });

  // @upstream Modules/MEATool/Tests/MEAToolTests/EFSFileNamesTests.swift#EFSFileNamesTests.testARevisionTheTableDoesNotCarryNamesNothing
  it("names nothing for a revision the table does not carry", () => {
    const found = names(volume({ dictionaryRevision: 9 }));

    expect(efsNamesNothing(found)).toBe(true);
    expect(found.hasTable).toBe(true);
    expect(efsTableLabel(found)).toBe("04 / 0B rev 09 — no EFST at that revision");
  });

  /**
   * The platform and dictionary are the *MFS* volume's, not the EFS page's own
   * Dictionary field — upstream hands `efs_anl` the values it read out of the
   * MFS volume header.
   *
   * @upstream Modules/MEATool/Tests/MEAToolTests/EFSFileNamesTests.swift#EFSFileNamesTests.testTheLookupUsesTheMFSVolumesPlatformAndDictionary
   */
  it("looks up under the MFS volume's platform and dictionary", () => {
    const found = names(volume(), 4, 0x0a);

    // 04 / 0A exists — it just carries no EFST, so nothing is named.
    expect(efsNamesNothing(found)).toBe(true);
    expect(efsTableLabel(found)).toBe("04 / 0A rev 01 — no EFST in FileTable.dat");
  });

  // @upstream Modules/MEATool/Tests/MEAToolTests/EFSFileNamesTests.swift#EFSFileNamesTests.testWithNoMFSVolumeBothHalvesAreAssumed
  it("falls back for both halves with no MFS volume beside it", () => {
    const found = names(volume(), -1, -1);

    expect(found.resolution?.platform).toBe(0x01);
    expect(found.resolution?.dictionary).toBe(0x0a);
    expect(efsTableLabel(found)).toBe("01 / 0A rev 01 — no EFST in FileTable.dat");
  });

  // @upstream Modules/MEATool/Tests/MEAToolTests/EFSFileNamesTests.swift#EFSFileNamesTests.testAnEmptyTableIsNone
  it("looks nothing up from an empty table", () => {
    const found = efsFileNames(new FileTable(), volume(), 4, 0x0b);

    expect(found).toEqual(NO_EFS_NAMES);
    expect(efsTableLabel(found)).toBeUndefined();
    expect(found.resolution).toBeUndefined();
  });
});

describe("the rows", () => {
  // @upstream Modules/MEATool/Tests/MEAToolTests/EFSFileNamesTests.swift#EFSFileNamesTests.testANamedRowCarriesBothTablesFacts
  it("carries both tables' facts", () => {
    const one = volume();
    const rows = fileRows(rootsOf(one, names(one)));

    expect(rows?.children.map((row) => row.title)).toEqual([
      "ICC_MPHYTBL",
      "BUP_MBP",
      "POLICY_CPU_SID",
    ]);
    const mbp = rows?.children.find((row) => row.title === "BUP_MBP");
    expect(fieldValue(mbp, "VFS ID")).toBe("5");
    expect(fieldValue(mbp, "Path")).toBe("/home/bup/mbp");
    expect(fieldValue(mbp, "File ID")).toBe("0x10008D00");
    expect(fieldValue(mbp, "Integrity")).toBe("Yes");
    expect(fieldValue(mbp, "Data Offset")).toBe("0x3004");
    expect(mbp?.subtitle).toBe("#5 · 0xD8 (216 bytes)");
  });

  // @upstream Modules/MEATool/Tests/MEAToolTests/EFSFileNamesTests.swift#EFSFileNamesTests.testASplitRowShowsBothSizesAndTheTable
  it("shows both sizes and the table on a split row", () => {
    const one = volume();
    const mbp = fileRows(rootsOf(one, names(one)))?.children.find((row) => row.title === "BUP_MBP");

    expect(fieldValue(mbp, "Size")).toBe("0xD8 (216 bytes)");
    expect(fieldValue(mbp, "Stored Size")).toBe("0x100 (256 bytes)");
    expect(mbp?.children[0]?.title).toBe("Integrity");
    expect(mbp?.children[0]?.subtitle).toBe("0x28 (40 bytes)");
  });

  // @upstream Modules/MEATool/Tests/MEAToolTests/EFSFileNamesTests.swift#EFSFileNamesTests.testAnUnsplitRowSaysOneSize
  it("says one size on an unsplit row", () => {
    const one = volume();
    const icc = fileRows(rootsOf(one, names(one)))?.children.find(
      (row) => row.title === "ICC_MPHYTBL"
    );

    expect(fieldValue(icc, "Size")).toBe("0x100 (256 bytes)");
    expect(fieldValue(icc, "Stored Size")).toBeUndefined();
    expect(icc?.children).toEqual([]);
  });

  /**
   * Before the names arrive the rows are the files the engine found, under the
   * number both tables key them by — the volume's own answer, not a gap.
   *
   * @upstream Modules/MEATool/Tests/MEAToolTests/EFSFileNamesTests.swift#EFSFileNamesTests.testWithoutNamesTheRowsAreNumbered
   */
  it("numbers the rows before the names arrive", () => {
    const rows = fileRows(rootsOf(volume()));

    expect(rows?.children.map((row) => row.title)).toEqual(["File 6", "File 5", "File 4"]);
    expect(rows?.subtitle).toBe("3 files");
    expect(fieldValue(rows?.children[0], "Path")).toBeUndefined();
  });

  // @upstream Modules/MEATool/Tests/MEAToolTests/EFSFileNamesTests.swift#EFSFileNamesTests.testTheVolumeRowNamesTheTableAndDropsTheReflectedList
  it("names the table on the volume's row and drops the reflected list", () => {
    const one = volume();
    const efs = rootsOf(one, names(one)).find((root) => root.title === "EFS Volume");

    expect(fieldValue(efs, "File Table")).toBe("04 / 0B rev 01");
    // The list is children, not a field.
    expect(efs?.fields.some((each) => each.label.startsWith("files"))).toBe(false);
    // And the volume's own reflected facts are still there.
    expect(fieldValue(efs, "dictionary")).toBe("11");
  });

  /**
   * A file no `FTBL` row claims keeps its name and its sizes: upstream prints
   * an error and stores the file anyway, and the row is the file.
   *
   * @upstream Modules/MEATool/Tests/MEAToolTests/EFSFileNamesTests.swift#EFSFileNamesTests.testAFileNoFTBLRowClaimsKeepsItsName
   */
  it("keeps a file no FTBL row claims", () => {
    const one = volume({
      files: [
        [6, 0],
        [70, 0x4000],
      ],
      split: new Set(),
    });
    const rows = fileRows(rootsOf(one, names(one)));
    const orphan = rows?.children.at(-1);

    // No EFST entry either, so no name.
    expect(orphan?.title).toBe("File 70");
    expect(fieldValue(orphan, "Path")).toBeUndefined();
    expect(fieldValue(orphan, "VFS ID")).toBe("70");
  });
});
