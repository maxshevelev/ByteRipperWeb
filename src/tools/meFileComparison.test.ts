import { describe, expect, it } from "vitest";
import { hex, sha256 } from "@/firmware/me/crypto/digest";
import { FileTable } from "@/firmware/me/data/fileTable";
import type { EFSVolume, MFSFile } from "@/firmware/me/models/fileSystemFacts";
import type { FirmwareAnalysis } from "@/firmware/me/models/firmwareAnalysis";
import { EFSFileNames } from "@/tools/efsFileNames";
import { analysisWith, efsVolumeFixture, mfsVolumeFixture } from "@/tools/meaTesting";
import { compareMEFiles, type MEFileReader, NO_ME_FILE_NAMES } from "@/tools/meFileComparison";
import { MFSFileNames } from "@/tools/mfsFileNames";

/**
 * Two dumps' ME files compared by what they hold, wherever each volume put them.
 *
 * Ported from `Packages/MEPresentation/Tests/MEPresentationTests/MEFileComparisonTests.swift`.
 */

type Range = readonly [number, number];

/** A dump of `size` bytes with `bytes` written at each offset. */
function image(writes: Record<number, readonly number[]>, size = 0x200): Uint8Array {
  const data = new Uint8Array(size).fill(0xff);
  for (const [offset, bytes] of Object.entries(writes)) data.set(bytes, Number(offset));
  return data;
}

const digest = (bytes: readonly number[]): string => hex(sha256(Uint8Array.from(bytes)));

const integrity = (counter: number) => ({
  size: 0x28,
  hmacHex: "AABB",
  flagsRaw: 2,
  antiReplayProtection: true,
  encryptionProtection: false,
  antiReplayIndex: 3,
  securityVersion: 0,
  arRandom: 0x99,
  arCounter: counter,
  nonceHex: "CCDD",
});

/** One MFS file stored at `extents`, whose content is `content`. */
function mfsFile(
  index: number,
  extents: readonly Range[],
  content: readonly number[],
  options: { contentSize?: number; counter?: number; intact?: boolean } = {}
): MFSFile {
  return {
    index,
    size: extents.reduce((sum, [start, end]) => sum + (end - start), 0),
    extents: extents.map(([start, end]) => ({ start, end })),
    contentDigest: digest(content.slice(0, options.contentSize ?? content.length)),
    chainIntact: options.intact ?? true,
    contentSize: options.contentSize,
    integrity: options.counter === undefined ? undefined : integrity(options.counter),
  };
}

type EFSFiles = ReturnType<typeof efsVolumeFixture>["files"];

function analysis(options: {
  mfs: readonly MFSFile[];
  /** undefined: no EFS volume; null: a volume not cut into files. */
  efs?: EFSFiles | null;
  regions?: readonly string[];
}): FirmwareAnalysis {
  const files = options.mfs;
  const efs = options.efs;
  return analysisWith({
    sizeBytes: 0x200,
    regions: (options.regions ?? []).map((name, id) => ({
      id,
      name,
      offset: 0,
      size: 0x1000,
      flags: 0,
    })) as unknown as FirmwareAnalysis["regions"],
    mfsVolume: {
      ...mfsVolumeFixture(),
      offset: 0,
      pageSize: 0x2000,
      pageCount: 1,
      systemPageCount: 1,
      dataPageCount: 0,
      signatureValid: true,
      volumeSize: 0,
      computedVolumeSize: 0,
      fileRecordCount: 1024,
      usedFileCount: files.length,
      ftblDictionary: 0x0a,
      ftblPlatform: 4,
      usesFTBL: true,
      presentFileCount: files.length,
      fileBytes: 0,
      files: [...files],
    },
    efsVolume:
      efs === undefined
        ? undefined
        : ({
            ...efsVolumeFixture(),
            offset: 0x100,
            files: efs === null ? undefined : efs,
          } as unknown as EFSVolume),
  });
}

const reader =
  (data: Uint8Array): MEFileReader =>
  (start, end) =>
    end <= data.length ? data.slice(start, end) : undefined;

describe("MEFileComparison", () => {
  // MARK: - Matching by content

  /**
   * The volume moved the file: other addresses, another order of its stretches,
   * the same bytes. It is the same file, and it says it moved.
   *
   * @upstream Packages/MEPresentation/Tests/MEPresentationTests/MEFileComparisonTests.swift#MEFileComparisonTests.testAFileStoredElsewhereIsTheSameAndMoved
   */
  it("a file stored elsewhere is the same and moved", () => {
    const content = Array.from({ length: 0x20 }, (_, i) => i);
    const a = image({ 16: content.slice(0, 0x10), 64: content.slice(0x10, 0x20) });
    const b = image({ 128: content.slice(0, 0x10), 8: content.slice(0x10, 0x20) });
    const result = compareMEFiles(
      analysis({
        mfs: [
          mfsFile(
            7,
            [
              [0x10, 0x20],
              [0x40, 0x50],
            ],
            content
          ),
        ],
      }),
      analysis({
        mfs: [
          mfsFile(
            7,
            [
              [0x80, 0x90],
              [0x08, 0x18],
            ],
            content
          ),
        ],
      }),
      undefined,
      reader(a),
      reader(b)
    );
    expect(result.gaps).toEqual([]);
    const row = result.rows[0];
    expect(row?.status).toBe("same");
    expect(row?.moved).toBe(true);
    expect(row?.differingBytes).toBeUndefined();
  });

  /**
   * Bytes that differ are counted over the content; the Integrity table is
   * compared apart, and a table that changed alone leaves the file the same.
   *
   * @upstream Packages/MEPresentation/Tests/MEPresentationTests/MEFileComparisonTests.swift#MEFileComparisonTests.testContentAndIntegrityAreComparedApart
   */
  it("content and integrity are compared apart", () => {
    const left = [1, 2, 3, 4, 5, 6, 7, 8];
    const right = [1, 2, 9, 4, 5, 6, 9, 8];
    const a = image({ 16: [...left, 0xaa, 0xaa], 48: [...left, 0xaa, 0xaa] });
    const b = image({ 16: [...right, 0xbb, 0xbb], 48: [...left, 0xbb, 0xbb] });
    const result = compareMEFiles(
      analysis({
        mfs: [
          mfsFile(1, [[0x10, 0x1a]], [...left, 0xaa, 0xaa], { contentSize: 8, counter: 1 }),
          mfsFile(2, [[0x30, 0x3a]], [...left, 0xaa, 0xaa], { contentSize: 8, counter: 1 }),
        ],
      }),
      analysis({
        mfs: [
          mfsFile(1, [[0x10, 0x1a]], [...right, 0xbb, 0xbb], { contentSize: 8, counter: 2 }),
          mfsFile(2, [[0x30, 0x3a]], [...left, 0xbb, 0xbb], { contentSize: 8, counter: 2 }),
        ],
      }),
      undefined,
      reader(a),
      reader(b)
    );
    expect(result.rows.map((one) => one.status)).toEqual(["different", "same"]);
    expect(result.rows[0]?.differingBytes, "the table's bytes are not counted").toBe(2);
    expect(result.rows[0]?.integrityDiffers).toBe(true);
    expect(result.rows[1]?.integrityDiffers, "rewritten, holding the same").toBe(true);
    expect(result.rows[1]?.moved).toBe(false);
  });

  /**
   * Without the bytes the digests decide; a file of another length differs and
   * no count is given.
   *
   * @upstream Packages/MEPresentation/Tests/MEPresentationTests/MEFileComparisonTests.swift#MEFileComparisonTests.testWithoutTheBytesTheDigestsDecide
   */
  it("without the bytes the digests decide", () => {
    const result = compareMEFiles(
      analysis({
        mfs: [
          mfsFile(1, [[0, 4]], [1, 2, 3, 4]),
          mfsFile(2, [[8, 12]], [1, 1, 1, 1]),
          mfsFile(3, [[16, 20]], [5, 5, 5, 5]),
        ],
      }),
      analysis({
        mfs: [
          mfsFile(1, [[0, 4]], [1, 2, 3, 4]),
          mfsFile(2, [[8, 12]], [1, 1, 1, 2]),
          mfsFile(3, [[16, 22]], [5, 5, 5, 5, 5, 5]),
        ],
      })
    );
    expect(result.rows.map((one) => one.status)).toEqual(["same", "different", "different"]);
    expect(result.rows.map((one) => one.differingBytes)).toEqual([undefined, undefined, undefined]);
  });

  /**
   * Bytes that are no longer what the analysis read there — the dump was edited
   * since — are not trusted over the digest the analysis made.
   *
   * @upstream Packages/MEPresentation/Tests/MEPresentationTests/MEFileComparisonTests.swift#MEFileComparisonTests.testBytesChangedSinceTheAnalysisLeaveItToTheDigests
   */
  it("bytes changed since the analysis leave it to the digests", () => {
    const result = compareMEFiles(
      analysis({ mfs: [mfsFile(1, [[0, 4]], [1, 2, 3, 4])] }),
      analysis({ mfs: [mfsFile(1, [[0, 4]], [1, 2, 3, 4])] }),
      undefined,
      reader(image({ 0: [9, 9, 9, 9] })),
      reader(image({ 0: [1, 2, 3, 4] }))
    );
    expect(result.rows[0]?.status).toBe("same");
    expect(result.rows[0]?.differingBytes).toBeUndefined();
  });

  /** @upstream Packages/MEPresentation/Tests/MEPresentationTests/MEFileComparisonTests.swift#MEFileComparisonTests.testAFileInOneDumpOnlyIsSaidToBe */
  it("a file in one dump only is said to be", () => {
    const result = compareMEFiles(
      analysis({ mfs: [mfsFile(1, [[0, 4]], [1, 2, 3, 4]), mfsFile(5, [[8, 12]], [0, 0, 0, 0])] }),
      analysis({ mfs: [mfsFile(1, [[0, 4]], [1, 2, 3, 4]), mfsFile(9, [[8, 12]], [0, 0, 0, 0])] })
    );
    expect(result.rows.map((one) => one.key)).toEqual([1, 5, 9]);
    expect(result.rows.map((one) => one.status)).toEqual(["same", "onlyInA", "onlyInB"]);
  });

  /**
   * A chain that broke off holds only part of the file: no verdict.
   *
   * @upstream Packages/MEPresentation/Tests/MEPresentationTests/MEFileComparisonTests.swift#MEFileComparisonTests.testABrokenChainGivesNoVerdict
   */
  it("a broken chain gives no verdict", () => {
    const result = compareMEFiles(
      analysis({ mfs: [mfsFile(1, [[0, 4]], [1, 2, 3, 4], { intact: false })] }),
      analysis({ mfs: [mfsFile(1, [[0, 4]], [1, 2, 3, 4])] })
    );
    expect(result.rows[0]?.status).toBe("incomplete");
  });

  // MARK: - Volumes that cannot be compared

  /**
   * The EFS of one dump cannot be read — its System page erased. Its files are
   * not listed as missing from that dump; the volume is named as not compared,
   * and the MFS still is.
   *
   * @upstream Packages/MEPresentation/Tests/MEPresentationTests/MEFileComparisonTests.swift#MEFileComparisonTests.testAnUnreadableVolumeIsAGapAndNotFilesOnlyInOneDump
   */
  it("an unreadable volume is a gap and not files only in one dump", () => {
    const efsFiles = [
      {
        fileID: 4,
        dataOffset: 0,
        storedSize: 4,
        metadataUnknown: 0,
        contentSize: 4,
        integrity: undefined,
        extents: [{ start: 0x110, end: 0x114 }],
        contentDigest: digest([1, 2, 3, 4]),
      },
    ];
    const a = analysis({
      mfs: [mfsFile(1, [[0, 4]], [1, 2, 3, 4])],
      efs: efsFiles,
      regions: ["MFS", "EFS"],
    });
    const b = analysis({ mfs: [mfsFile(1, [[0, 4]], [1, 2, 3, 4])], regions: ["MFS", "EFS"] });
    const result = compareMEFiles(a, b);
    expect(result.gaps).toEqual([{ volume: "efs", inA: false, reason: "unreadable" }]);
    expect(result.rows.map((one) => one.volume)).toEqual(["mfs"]);
  });

  /** @upstream Packages/MEPresentation/Tests/MEPresentationTests/MEFileComparisonTests.swift#MEFileComparisonTests.testAVolumeNeitherDumpHasIsNoGap */
  it("a volume neither dump has is no gap", () => {
    const result = compareMEFiles(analysis({ mfs: [] }), analysis({ mfs: [] }));
    expect(result.gaps).toEqual([]);
    expect(result.rows).toEqual([]);
  });

  /** @upstream Packages/MEPresentation/Tests/MEPresentationTests/MEFileComparisonTests.swift#MEFileComparisonTests.testAnEFSNotCutIntoFilesIsAGap */
  it("an EFS not cut into files is a gap", () => {
    const result = compareMEFiles(analysis({ mfs: [], efs: null }), analysis({ mfs: [], efs: [] }));
    expect(result.gaps).toEqual([{ volume: "efs", inA: true, reason: "filesNotNamed" }]);
  });

  // MARK: - Names

  /** @upstream Packages/MEPresentation/Tests/MEPresentationTests/MEFileComparisonTests.swift#MEFileComparisonTests.testTheRowsAreNamedByTheFileTableOfEitherDump */
  it("the rows are named by the file table of either dump", () => {
    const table = FileTable.parse(
      '{"04": {"0A": {"FTBL": {"10003500": "/home/mca/manuf_ver,1,0,0,40,0,70,7,448"}}}}'
    );
    const a = analysis({ mfs: [mfsFile(7, [[0, 4]], [1, 2, 3, 4])] });
    const b = analysis({ mfs: [mfsFile(7, [[0, 4]], [1, 2, 3, 4])] });
    if (b.mfsVolume === undefined) throw new Error("fixture has an MFS volume");
    const names = {
      mfs: MFSFileNames.forVolume(table, b.mfsVolume),
      efs: EFSFileNames.none,
    };
    const result = compareMEFiles(a, b, { a: NO_ME_FILE_NAMES, b: names });
    expect(result.rows[0]?.name).toBe("/home/mca/manuf_ver");
    expect(result.rows[0]?.encrypted, "the table's flag, read as it is").toBe(false);
  });
});
