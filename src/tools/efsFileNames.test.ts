import { describe, expect, it } from "vitest";
import { FileTable } from "@/firmware/me/data/fileTable";
import type { EFSVolume, MFSIntegrityTable, MFSVolume } from "@/firmware/me/models/fileSystemFacts";
import { EFSFileNames } from "@/tools/efsFileNames";
import { analysisWith } from "@/tools/meaTesting";
import { type MEANode, presentMEA } from "@/tools/meaTree";

/**
 * `EFSFileNames` + the file rows it names — the panel's half of upstream's
 * `efs_anl` file walk. An EFS volume's files have no name in their bytes at
 * all: the `EFST` records say where each one sits and what it is called, the
 * `FTBL` rows beside them give it a path and its flags, and both are text the
 * analysis never carries.
 */

/**
 * The shape of the real table, cut down to the platform/dictionary the CSME 15
 * oracle dump's MFS volume header names and the files that dump's EFS volume
 * carries.
 */
const tableJson = `{
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
}`;

const table = (): FileTable => FileTable.parse(tableJson);

/** The tail a flagged EFS file ends with, as the engine read it. */
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

/**
 * An EFS volume carrying `files`, the way one arrives once the engine has cut
 * its data area at the table's offsets. `split` file IDs end with an Integrity
 * table the engine took off.
 */
function volume(
  options: {
    dictionaryRevision?: number;
    files?: readonly { readonly id: number; readonly offset: number }[];
    split?: ReadonlySet<number>;
  } = {}
): EFSVolume {
  const {
    dictionaryRevision = 1,
    files = [
      { id: 6, offset: 0 },
      { id: 5, offset: 0x3004 },
      { id: 4, offset: 0x322c },
    ],
    split = new Set([5]),
  } = options;
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
    dictionaryRevision,
    dataPagesCommitted: 10,
    dataPagesReserved: 4,
    systemHeaderCRCValid: true,
    indexesCRCValid: true,
    firstIndexPaddingEmpty: true,
    dataPageOrder: [],
    dataPageHeaderCRCsValid: true,
    dataPageFooterCRCsValid: true,
    matchesMFSDictionary: undefined,
    files: files.map((file) =>
      split.has(file.id)
        ? {
            fileID: file.id,
            dataOffset: file.offset,
            storedSize: 0x100,
            metadataUnknown: 0xab12,
            contentSize: 0x100 - 0x28,
            integrity: integrityFixture(),
          }
        : {
            fileID: file.id,
            dataOffset: file.offset,
            storedSize: 0x100,
            metadataUnknown: 0xab12,
            contentSize: 0x100,
            integrity: undefined,
          }
    ),
  };
}

/** The MFS volume that names the platform and dictionary the EFS lookup reads. */
const mfsVolume = (platform = 4, dictionary = 0x0b): MFSVolume => ({
  offset: 0x1f_f000,
  pageSize: 0x2000,
  pageCount: 49,
  systemPageCount: 1,
  dataPageCount: 48,
  signatureValid: true,
  volumeSize: 0x6_4000,
  computedVolumeSize: 0x6_4000,
  fileRecordCount: 1024,
  usedFileCount: 0,
  ftblDictionary: dictionary,
  ftblPlatform: platform,
  ftblReserved: 0,
  usesFTBL: true,
  presentFileCount: 0,
  fileBytes: 0,
  files: [],
  configurations: [],
  homeDirectory: undefined,
  reservedIntegrity: [],
  pchInit: undefined,
});

/** The analysis as it arrives on a CSME 15 dump: the MFS volume and the EFS one. */
const analysis = (efs: EFSVolume, platform = 4, dictionary = 0x0b) =>
  analysisWith({ mfsVolume: mfsVolume(platform, dictionary), efsVolume: efs });

const names = (efs: EFSVolume, platform = 4, dictionary = 0x0b): EFSFileNames =>
  EFSFileNames.forVolume({ table: table(), volume: efs, platform, dictionary });

const field = (label: string, node: MEANode): string | undefined =>
  node.fields.find((one) => one.label === label)?.value;

function fileRows(roots: readonly MEANode[]): MEANode {
  const efs = roots.find((one) => one.title === "EFS Volume");
  const branch = efs?.children.find((one) => one.title === "Files");
  if (branch === undefined) throw new Error("no Files branch");
  return branch;
}

describe("EFSFileNames lookup", () => {
  // @upstream Packages/MEPresentation/Tests/MEPresentationTests/EFSFileNamesTests.swift#EFSFileNamesTests.testAFileIsNamedByEFSTAndDescribedByFTBL
  it("names a file by EFST and describes it by FTBL", () => {
    const found = names(volume());
    expect(found.name(5)).toBe("BUP_MBP");
    expect(found.record(5)?.path).toBe("/home/bup/mbp");
    expect(found.record(5)?.integrity).toBe(true);
    expect(found.name(6)).toBe("ICC_MPHYTBL");
    expect(found.record(6)?.integrity).toBe(false);
  });

  // @upstream Packages/MEPresentation/Tests/MEPresentationTests/EFSFileNamesTests.swift#EFSFileNamesTests.testTheSystemPagesRevisionSelectsTheTable
  it("selects the table by the System page's revision", () => {
    expect(names(volume({ dictionaryRevision: 1 })).name(6)).toBe("ICC_MPHYTBL");
    expect(names(volume({ dictionaryRevision: 2 })).name(6)).toBe("RENAMED_LATER");
    expect(names(volume({ dictionaryRevision: 2 })).revision).toBe(2);
  });

  // @upstream Packages/MEPresentation/Tests/MEPresentationTests/EFSFileNamesTests.swift#EFSFileNamesTests.testARevisionTheTableDoesNotCarryNamesNothing
  it("names nothing at a revision the table does not carry", () => {
    const found = names(volume({ dictionaryRevision: 9 }));
    expect(found.isEmpty).toBe(true);
    expect(found.hasTable).toBe(true);
    expect(found.tableLabel).toBe("04 / 0B rev 09 — no EFST at that revision");
  });

  // @upstream Packages/MEPresentation/Tests/MEPresentationTests/EFSFileNamesTests.swift#EFSFileNamesTests.testTheLookupUsesTheMFSVolumesPlatformAndDictionary
  it("uses the MFS volume's platform and dictionary", () => {
    const found = names(volume(), 4, 0x0a);
    expect(found.isEmpty).toBe(true);
    expect(found.tableLabel).toBe("04 / 0A rev 01 — no EFST in FileTable.dat");
  });

  // @upstream Packages/MEPresentation/Tests/MEPresentationTests/EFSFileNamesTests.swift#EFSFileNamesTests.testWithNoMFSVolumeBothHalvesAreAssumed
  it("assumes both halves with no MFS volume beside it", () => {
    const found = names(volume(), -1, -1);
    expect(found.resolution?.platform).toBe(0x01);
    expect(found.resolution?.dictionary).toBe(0x0a);
    expect(found.tableLabel).toBe("01 / 0A rev 01 — no EFST in FileTable.dat");
  });

  // @upstream Packages/MEPresentation/Tests/MEPresentationTests/EFSFileNamesTests.swift#EFSFileNamesTests.testAnEmptyTableIsNone
  it("is none for an empty table", () => {
    const found = EFSFileNames.forVolume({
      table: FileTable.empty,
      volume: volume(),
      platform: 4,
      dictionary: 0x0b,
    });
    expect(found.isEmpty).toBe(true);
    expect(found.resolution).toBeUndefined();
    expect(found.tableLabel).toBeUndefined();
  });
});

describe("EFSFileNames rows", () => {
  // @upstream Packages/MEPresentation/Tests/MEPresentationTests/EFSFileNamesTests.swift#EFSFileNamesTests.testANamedRowCarriesBothTablesFacts
  it("carries both tables' facts on a named row", () => {
    const efs = volume();
    const rows = fileRows(presentMEA(analysis(efs), undefined, undefined, names(efs)));
    expect(rows.children.map((one) => one.title)).toEqual([
      "ICC_MPHYTBL",
      "BUP_MBP",
      "POLICY_CPU_SID",
    ]);
    const mbp = rows.children.find((one) => one.title === "BUP_MBP");
    expect(mbp === undefined ? undefined : field("VFS ID", mbp)).toBe("5");
    expect(mbp === undefined ? undefined : field("Path", mbp)).toBe("/home/bup/mbp");
    expect(mbp === undefined ? undefined : field("File ID", mbp)).toBe("0x10008D00");
    expect(mbp === undefined ? undefined : field("Integrity", mbp)).toBe("Yes");
    expect(mbp === undefined ? undefined : field("Data Offset", mbp)).toBe("0x3004");
    expect(mbp?.subtitle).toBe("#5 · 0xD8 (216 bytes)");
  });

  // @upstream Packages/MEPresentation/Tests/MEPresentationTests/EFSFileNamesTests.swift#EFSFileNamesTests.testASplitRowShowsBothSizesAndTheTable
  it("shows both sizes and the table on a split row", () => {
    const efs = volume();
    const rows = fileRows(presentMEA(analysis(efs), undefined, undefined, names(efs)));
    const mbp = rows.children.find((one) => one.title === "BUP_MBP");
    expect(mbp === undefined ? undefined : field("Size", mbp)).toBe("0xD8 (216 bytes)");
    expect(mbp === undefined ? undefined : field("Stored Size", mbp)).toBe("0x100 (256 bytes)");
    const integrity = mbp?.children[0];
    expect(integrity?.title).toBe("Integrity");
    expect(integrity?.subtitle).toBe("0x28 (40 bytes)");
  });

  // @upstream Packages/MEPresentation/Tests/MEPresentationTests/EFSFileNamesTests.swift#EFSFileNamesTests.testAnUnsplitRowSaysOneSize
  it("says one size on an unsplit row", () => {
    const efs = volume();
    const rows = fileRows(presentMEA(analysis(efs), undefined, undefined, names(efs)));
    const icc = rows.children.find((one) => one.title === "ICC_MPHYTBL");
    expect(icc === undefined ? undefined : field("Size", icc)).toBe("0x100 (256 bytes)");
    expect(icc === undefined ? undefined : field("Stored Size", icc)).toBeUndefined();
    expect(icc?.children).toEqual([]);
  });

  // @upstream Packages/MEPresentation/Tests/MEPresentationTests/EFSFileNamesTests.swift#EFSFileNamesTests.testWithoutNamesTheRowsAreNumbered
  it("numbers the rows without names", () => {
    const rows = fileRows(presentMEA(analysis(volume()), undefined));
    expect(rows.children.map((one) => one.title)).toEqual(["File 6", "File 5", "File 4"]);
    expect(rows.subtitle).toBe("3 files");
    const first = rows.children[0];
    expect(first === undefined ? undefined : field("Path", first)).toBeUndefined();
  });

  // @upstream Packages/MEPresentation/Tests/MEPresentationTests/EFSFileNamesTests.swift#EFSFileNamesTests.testTheVolumeRowNamesTheTableAndDropsTheReflectedList
  it("names the table on the volume row and drops the reflected list", () => {
    const efs = volume();
    const roots = presentMEA(analysis(efs), undefined, undefined, names(efs));
    const node = roots.find((one) => one.title === "EFS Volume");
    expect(node === undefined ? undefined : field("File Table", node)).toBe("04 / 0B rev 01");
    expect(node === undefined ? undefined : field("files", node)).toBeUndefined();
    expect(node === undefined ? undefined : field("dictionary", node)).toBe("11");
  });

  // @upstream Packages/MEPresentation/Tests/MEPresentationTests/EFSFileNamesTests.swift#EFSFileNamesTests.testAFileNoFTBLRowClaimsKeepsItsName
  it("keeps the name of a file no FTBL row claims", () => {
    const efs = volume({
      files: [
        { id: 6, offset: 0 },
        { id: 70, offset: 0x4000 },
      ],
      split: new Set(),
    });
    const rows = fileRows(presentMEA(analysis(efs), undefined, undefined, names(efs)));
    const orphan = rows.children.at(-1);
    expect(orphan?.title).toBe("File 70");
    expect(orphan === undefined ? undefined : field("Path", orphan)).toBeUndefined();
    expect(orphan === undefined ? undefined : field("VFS ID", orphan)).toBe("70");
  });
});
