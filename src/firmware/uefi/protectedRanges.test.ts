import { describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import type { ImageRange } from "@/firmware/imageReader";
import { sha256, sha384 } from "@/firmware/me/crypto/digest";
import {
  amiFile,
  BootGuardImage,
  bootPolicyV1,
  bootPolicyV2,
  flashDeviceMapBytes,
  mapImage,
  phoenixFile,
  vendorEntryBytes,
  ZERO32,
} from "@/firmware/testing/testBootGuard";
import * as Test from "@/firmware/testing/testImage";
import { BinaryWriter } from "@/firmware/testing/testImage";
import { severityOf, type UEFIDiagnostic } from "@/firmware/uefi/diagnostic";
import { guidEquals } from "@/firmware/uefi/efiGuid";
import { DXE_CORE } from "@/firmware/uefi/knownGuids";
import {
  BootPolicy,
  noProtection,
  type ProtectedRange,
  type ProtectedRangeKind,
  type ProtectedRanges,
  protectedRangeKindName,
  protectionOfNode,
  protectionOfRange,
} from "@/firmware/uefi/protectedRanges";
import { TCGHash } from "@/firmware/uefi/tcgHash";
import { parseUefiImage } from "@/firmware/uefi/uefiImage";
import { flattened, isNodeCompressed, type UEFINode } from "@/firmware/uefi/uefiNode";

/**
 * The Boot Guard and vendor lists an image carries, and what hashing them says.
 * Ported from upstream's `ProtectedRangesTests`.
 */

const range = (start: number, end: number): ImageRange => ({ start, end });
const kinds = (ranges: ProtectedRanges) => ranges.ranges.map((one) => one.kind);
const placed = (ranges: ProtectedRanges) => ranges.ranges.map((one) => one.range);
const verdicts = (ranges: ProtectedRanges) => ranges.ranges.map((one) => one.verdict.kind);
const parse = (bytes: Uint8Array) => parseUefiImage(sourceOver(bytes));
const rangesOf = (bytes: Uint8Array): ProtectedRanges => {
  const found = parse(bytes).protectedRanges;
  if (found === undefined) throw new Error("the parse read no ranges");
  return found;
};

/**
 * Upstream writes each of these as one 64-bit literal; JavaScript has no exact
 * 64-bit integer, so the port keeps each as the two dwords a little-endian
 * reader compares against — and a pair of hand-split dwords is a pair nothing
 * else proves. A manifest is found by these bytes or it is not found at all,
 * and a wrong split reads as "no Boot Guard here" on an image that has it: the
 * test fixtures write the same constants, so they cannot tell the difference.
 * This says what the bytes must spell.
 *
 * @web-only the split is the port's, so the check of it is too
 */
describe("the signatures", () => {
  const spells = (id: { readonly low: number; readonly high: number }): string => {
    const bytes = new BinaryWriter().u32(id.low).u32(id.high).bytes;
    return String.fromCharCode(...bytes);
  };

  it("spell what a manifest holds", () => {
    expect(spells({ low: BootPolicy.fitSignatureLow, high: BootPolicy.fitSignatureHigh })).toBe(
      "_FIT_   "
    );
    expect(spells({ low: BootPolicy.structureIdLow, high: BootPolicy.structureIdHigh })).toBe(
      "__ACBP__"
    );
    expect(spells({ low: BootPolicy.ibbsLow, high: BootPolicy.ibbsHigh })).toBe("__IBBS__");
    expect(spells({ low: BootPolicy.pmdaLow, high: BootPolicy.pmdaHigh })).toBe("__PMDA__");
    expect(spells({ low: BootPolicy.pmsgLow, high: BootPolicy.pmsgHigh })).toBe("__PMSG__");
    expect(
      spells({ low: BootPolicy.phoenixSignatureLow, high: BootPolicy.phoenixSignatureHigh })
    ).toBe("$HASHTBL");
  });
});

describe("the Boot Policy", () => {
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/ProtectedRangesTests.swift#ProtectedRangesTests.testAV1ManifestNamesItsIBBThePostIBBRangeAndPMDA
  it("names its IBB, the post-IBB range and PMDA, from a v1 manifest", () => {
    const image = new BootGuardImage();
    const first = range(image.ibb.start, image.ibb.start + 0x300);
    const second = range(first.end, first.end + 0x200);
    const pmda = range(image.ibb.start, image.ibb.start + 0x100);
    image.install(
      bootPolicyV1({
        segments: [
          { base: image.address(first.start), size: 0x300 },
          // Non-IBB: names nothing.
          { base: image.address(second.end), size: 0x100, flags: 1 },
          { base: image.address(second.start), size: 0x200 },
        ],
        ibbHash: image.sha256Of(first, second),
        postIbbHash: image.sha256Of(BootGuardImage.dxeVolume),
        pmda: [{ base: image.address(pmda.start), size: 0x100, hash: image.sha256Of(pmda) }],
      })
    );

    const ranges = image.ranges;
    expect(kinds(ranges)).toEqual(["ibb", "ibb", "postIbb", "pmda"]);
    expect(placed(ranges)).toEqual([first, second, BootGuardImage.dxeVolume, pmda]);
    expect(verdicts(ranges)).toEqual(["matches", "matches", "matches", "matches"]);
    expect(ranges.diagnostics).toEqual([]);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/ProtectedRangesTests.swift#ProtectedRangesTests.testAV2ManifestStepsOverAnElementItDoesNotKnowAndChecksEveryDigest
  it("steps over an element it does not know, and checks every digest", () => {
    const image = new BootGuardImage();
    const segment = range(image.ibb.start, image.ibb.start + 0x400);
    const pmda = range(image.ibb.start + 0x400, image.ibb.start + 0x480);
    const obb = new Uint8Array(32).fill(0x11);
    image.install(
      bootPolicyV2({
        segments: [{ base: image.address(segment.start), size: 0x400 }],
        ibbDigests: [
          { algorithm: TCGHash.sha256, bytes: image.sha256Of(segment) },
          { algorithm: TCGHash.sha384, bytes: sha384(image.slice(segment)) },
        ],
        postIbb: image.sha256Of(BootGuardImage.dxeVolume),
        obb,
        pmda: [{ base: image.address(pmda.start), size: 0x80, hash: image.sha256Of(pmda) }],
      })
    );

    const ranges = image.ranges;
    expect(kinds(ranges)).toEqual(["ibb", "postIbb", "pmda"]);
    expect(placed(ranges)).toEqual([segment, BootGuardImage.dxeVolume, pmda]);
    expect(verdicts(ranges)).toEqual(["matches", "matches", "matches"]);
    expect(ranges.ranges[0]?.digests.map((one) => one.algorithm)).toEqual([
      TCGHash.sha256,
      TCGHash.sha384,
    ]);
    // Noted, not placed.
    expect(ranges.obbDigests.map((one) => [...one.bytes])).toEqual([[...obb]]);
    expect(ranges.diagnostics).toEqual([]);
  });

  /**
   * A v1 element has no size: past one the reading does not know, nothing more
   * can be read.
   *
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/ProtectedRangesTests.swift#ProtectedRangesTests.testAV1ManifestStopsAtAnElementItCannotStepOver
   */
  it("stops a v1 manifest at an element it cannot step over", () => {
    const image = new BootGuardImage();
    image.install(
      bootPolicyV1({
        segments: [{ base: image.address(image.ibb.start), size: 0x100 }],
        ibbHash: ZERO32,
        unknownElementFirst: true,
      })
    );

    expect(image.ranges.ranges).toEqual([]);
  });

  /**
   * The reference prints the IBB digests and compares them with nothing; this
   * compares, and says what it found as a warning.
   *
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/ProtectedRangesTests.swift#ProtectedRangesTests.testAnIBBThatDoesNotHashToItsDigestIsAWarning
   */
  it("makes an IBB that does not hash to its digest a warning", () => {
    const image = new BootGuardImage();
    const segment = range(image.ibb.start, image.ibb.start + 0x100);
    image.install(
      bootPolicyV1({
        segments: [{ base: image.address(segment.start), size: 0x100 }],
        ibbHash: new Uint8Array(32).fill(0xab),
      })
    );

    const ranges = image.ranges;
    expect(verdicts(ranges)).toEqual(["mismatch"]);
    const diagnostic = ranges.diagnostics[0] as UEFIDiagnostic;
    expect(diagnostic.detail).toEqual({
      kind: "protectedRangeHashMismatch",
      name: protectedRangeKindName("ibb"),
    });
    expect(diagnostic.offset).toBe(segment.start);
    expect(severityOf(diagnostic.detail)).toBe("warning");
    // The image carries it.
    expect(parse(image.bytes).diagnostics).toContainEqual(diagnostic);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/ProtectedRangesTests.swift#ProtectedRangesTests.testAnSM3DigestIsNotComputedAndTheRangeIsStillPlaced
  it("does not compute an SM3 digest, and places the range all the same", () => {
    const image = new BootGuardImage();
    const segment = range(image.ibb.start, image.ibb.start + 0x100);
    image.install(
      bootPolicyV2({
        segments: [{ base: image.address(segment.start), size: 0x100 }],
        ibbDigests: [{ algorithm: TCGHash.sm3, bytes: new Uint8Array(32).fill(1) }],
      })
    );

    const ranges = image.ranges;
    expect(placed(ranges)).toEqual([segment]);
    expect(ranges.ranges.map((one) => one.verdict)).toEqual([
      { kind: "unsupported", algorithm: TCGHash.sm3 },
    ]);
    expect(ranges.diagnostics.map((one) => one.detail)).toContainEqual({
      kind: "unsupportedHashAlgorithm",
      algorithm: TCGHash.sm3,
    });
  });

  /**
   * A segment below the image's mapping, or running past its end, is not in this
   * image: reported and dropped, and the digest over all of them is not checked
   * against what is left.
   *
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/ProtectedRangesTests.swift#ProtectedRangesTests.testASegmentOutsideTheImageIsDroppedAndReported
   */
  it("drops a segment outside the image, and reports it", () => {
    const image = new BootGuardImage();
    const inside = range(image.ibb.start, image.ibb.start + 0x100);
    image.install(
      bootPolicyV1({
        segments: [
          { base: image.address(inside.start), size: 0x100 },
          { base: 0x1000, size: 0x100 },
          { base: image.address(BootGuardImage.size - 0x10), size: 0x100 },
        ],
        ibbHash: image.sha256Of(inside),
      })
    );

    const ranges = image.ranges;
    expect(placed(ranges)).toEqual([inside]);
    expect(verdicts(ranges)).toEqual(["unchecked"]);
    const outside = ranges.diagnostics.filter(
      (one) =>
        one.detail.kind === "protectedRangeOutsideImage" &&
        one.detail.name === protectedRangeKindName("ibb")
    );
    expect(outside.length).toBe(2);
  });

  /**
   * The DXE Core inside an LZMA section still names the volume outside the
   * section — and a node inside takes the marking of what holds it.
   *
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/ProtectedRangesTests.swift#ProtectedRangesTests.testThePostIBBRangeIsTheOutermostVolumeThroughACompressedSection
   */
  it("places the post-IBB range at the outermost volume, through a compressed section", () => {
    const image = new BootGuardImage({ dxeCoreCompressed: true });
    image.install(
      bootPolicyV1({
        segments: [],
        ibbHash: ZERO32,
        postIbbHash: image.sha256Of(BootGuardImage.dxeVolume),
      })
    );

    const parsed = parse(image.bytes);
    const ranges = parsed.protectedRanges as ProtectedRanges;
    expect(kinds(ranges)).toEqual(["postIbb"]);
    expect(placed(ranges)).toEqual([BootGuardImage.dxeVolume]);
    expect(verdicts(ranges)).toEqual(["matches"]);

    const core = parsed.roots
      .flatMap((root) => flattened(root))
      .find((node) => node.guid !== undefined && guidEquals(node.guid, DXE_CORE)) as UEFINode;
    expect(isNodeCompressed(core)).toBe(true);
    expect(protectionOfNode(ranges, core, parsed)).toBe("protected");
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/ProtectedRangesTests.swift#ProtectedRangesTests.testAnImageThatNamesNothingHasNoRanges
  it("finds no ranges in an image that names none", () => {
    const bytes = Test.volume({ length: 0x4000, lastFile: Test.volumeTopFile({ size: 0x100 }) });
    const parsed = parse(bytes);

    expect(noProtection(parsed.protectedRanges as ProtectedRanges)).toBe(true);
    expect(parsed.diagnostics).toEqual([]);
  });
});

describe("the vendor hash files", () => {
  /**
   * With no descriptor, Phoenix entries are relative to the image's start.
   *
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/ProtectedRangesTests.swift#ProtectedRangesTests.testAPhoenixTableNamesItsRangesRelativeToTheImage
   */
  it("names a Phoenix table's ranges relative to the image", () => {
    const covered = range(0x800, 0x900);
    const blank = Test.volume({
      length: 0x1000,
      files: [phoenixFile([{ base: 0x800, size: 0x100, hash: ZERO32 }])],
    });
    const hash = sha256(blank.subarray(covered.start, covered.end));
    const bytes = Test.volume({
      length: 0x1000,
      files: [phoenixFile([{ base: 0x800, size: 0x100, hash }])],
    });

    const ranges = rangesOf(bytes);
    expect(kinds(ranges)).toEqual(["phoenix"]);
    expect(placed(ranges)).toEqual([covered]);
    expect(verdicts(ranges)).toEqual(["matches"]);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/ProtectedRangesTests.swift#ProtectedRangesTests.testAnAMIv1TableStartsAtTheDXERootVolume
  it("starts an AMI v1 table at the DXE root volume", () => {
    const image = new BootGuardImage({ extraFiles: [amiFile(new Uint8Array(0x24))] });
    const covered = range(0, 0x2000);
    const table = new BinaryWriter().raw(image.sha256Of(covered)).u32(0x2000).bytes;
    image.write(table, (image.amiTable as ImageRange).start);

    const ranges = image.ranges;
    expect(kinds(ranges)).toEqual(["amiV1"]);
    expect(placed(ranges)).toEqual([covered]);
    expect(verdicts(ranges)).toEqual(["matches"]);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/ProtectedRangesTests.swift#ProtectedRangesTests.testAnAMIv2TableHasTwoRangesEachWithItsOwnHash
  it("gives an AMI v2 table two ranges, each with its own hash", () => {
    const image = new BootGuardImage({ extraFiles: [amiFile(new Uint8Array(0x50))] });
    const first = range(image.ibb.start, image.ibb.start + 0x100);
    const second = range(image.ibb.start + 0x200, image.ibb.start + 0x280);
    const table = new BinaryWriter()
      .raw(
        vendorEntryBytes({
          hash: image.sha256Of(first),
          base: image.address(first.start),
          size: 0x100,
        })
      )
      .raw(
        vendorEntryBytes({
          hash: new Uint8Array(32).fill(9),
          base: image.address(second.start),
          size: 0x80,
        })
      ).bytes;
    image.write(table, (image.amiTable as ImageRange).start);

    const ranges = image.ranges;
    expect(kinds(ranges)).toEqual(["amiV2", "amiV2"]);
    expect(placed(ranges)).toEqual([first, second]);
    expect(verdicts(ranges)).toEqual(["matches", "mismatch"]);
  });

  /**
   * Up to four ranges and one hash over them, taken in file order whatever the
   * table's order.
   *
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/ProtectedRangesTests.swift#ProtectedRangesTests.testAnAMIv3TableHashesItsRangesTogetherInFileOrder
   */
  it("hashes an AMI v3 table's ranges together, in file order", () => {
    const image = new BootGuardImage({ extraFiles: [amiFile(new Uint8Array(0x70))] });
    const early = range(image.ibb.start, image.ibb.start + 0x100);
    const late = range(image.ibb.start + 0x400, image.ibb.start + 0x500);
    const table = new BinaryWriter()
      .raw(image.sha256Of(early, late))
      .u32(image.address(late.start)) // FvMainSegmentBase
      .u32(image.address(early.start))
      .u32(0xffff_ffff)
      .u32(0x100) // FvMainSegmentSize
      .u32(0x100)
      .u32(0)
      .u32(0xffff_ffff) // NestedFvBase
      .u32(0)
      .fill(48, 0).bytes;
    image.write(table, (image.amiTable as ImageRange).start);

    const ranges = image.ranges;
    expect(kinds(ranges)).toEqual(["amiV3", "amiV3"]);
    expect(placed(ranges)).toEqual([late, early]);
    expect(verdicts(ranges)).toEqual(["matches", "matches"]);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/ProtectedRangesTests.swift#ProtectedRangesTests.testAnAMITableOfAnotherSizeIsReported
  it("reports an AMI table of another size", () => {
    const bytes = Test.volume({ length: 0x1000, files: [amiFile(new Uint8Array(0x30))] });

    const ranges = rangesOf(bytes);
    expect(ranges.ranges).toEqual([]);
    expect(ranges.diagnostics.map((one) => one.detail)).toContainEqual({
      kind: "unknownVendorHashFileSize",
      size: 0x30,
    });
  });

  /**
   * With no Volume Top File there is no address to convert: the range is named,
   * and not placed.
   *
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/ProtectedRangesTests.swift#ProtectedRangesTests.testWithoutAVolumeTopFileAPhysicalRangeIsNotPlaced
   */
  it("does not place a physical range without a volume top file", () => {
    const table = new BinaryWriter()
      .raw(vendorEntryBytes({ hash: ZERO32, base: 0xffff_1000, size: 0x100 }))
      .raw(vendorEntryBytes({ hash: ZERO32, base: 0xffff_ffff, size: 0 })).bytes;
    const bytes = Test.volume({ length: 0x1000, files: [amiFile(table)] });

    const ranges = rangesOf(bytes);
    // The erased slot is not a range.
    expect(kinds(ranges)).toEqual(["amiV2"]);
    expect(placed(ranges)).toEqual([undefined]);
    expect(verdicts(ranges)).toEqual(["unchecked"]);
    expect(ranges.diagnostics.map((one) => one.detail)).toContainEqual({
      kind: "protectedRangeNotPlaced",
      name: protectedRangeKindName("amiV2"),
    });
  });
});

describe("the Insyde flash device map's ranges", () => {
  /**
   * An entry names a range unless it is modifiable — and one marked ignored but
   * not modifiable still does, as in UEFITool.
   *
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/ProtectedRangesTests.swift#ProtectedRangesTests.testEveryEntryThatIsNotModifiableIsARange
   */
  it("makes every entry that is not modifiable a range", () => {
    const erased = sha256(new Uint8Array(0x100).fill(0xff));
    const store = flashDeviceMapBytes({
      base: 0xffff_0000,
      entries: [
        { offset: 0x3000, size: 0x100, attributes: 0, hash: erased },
        { offset: 0x4000, size: 0x100, attributes: 1, hash: erased },
        { offset: 0x5000, size: 0x100, attributes: 2, hash: new Uint8Array(32).fill(7) },
      ],
    });

    const ranges = rangesOf(mapImage(store));
    expect(kinds(ranges)).toEqual(["insyde", "insyde"]);
    expect(placed(ranges)).toEqual([range(0x3000, 0x3100), range(0x5000, 0x5100)]);
    expect(verdicts(ranges)).toEqual(["matches", "mismatch"]);
  });
});

describe("the marking rule", () => {
  const list = (
    entries: readonly (readonly [ProtectedRangeKind, ImageRange])[]
  ): ProtectedRanges => ({
    ranges: entries.map(
      ([kind, one]): ProtectedRange => ({
        kind,
        range: one,
        digests: [],
        source: range(0, 0),
        verdict: { kind: "unchecked" },
      })
    ),
    obbDigests: [],
    diagnostics: [],
  });

  /**
   * Two adjacent IBB segments are one IBB: a node spanning both lies inside it,
   * which UEFITool marks as partial.
   *
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/ProtectedRangesTests.swift#ProtectedRangesTests.testANodeAcrossTwoAdjacentSegmentsIsInsideTheIBB
   */
  it("puts a node across two adjacent segments inside the IBB", () => {
    const ranges = list([
      ["ibb", range(0x100, 0x200)],
      ["ibb", range(0x200, 0x300)],
      ["amiV2", range(0x300, 0x400)],
    ]);

    expect(protectionOfRange(ranges, range(0x180, 0x280))).toBe("ibb");
    expect(protectionOfRange(ranges, range(0x100, 0x400))).toBe("protected");
    expect(protectionOfRange(ranges, range(0x380, 0x480))).toBe("partial");
    expect(protectionOfRange(ranges, range(0x400, 0x500))).toBeUndefined();
  });

  /**
   * The last range does not win: the answer depends on the set alone.
   *
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/ProtectedRangesTests.swift#ProtectedRangesTests.testTheOrderOfTheListChangesNothing
   */
  it("does not depend on the order of the list", () => {
    const entries: readonly (readonly [ProtectedRangeKind, ImageRange])[] = [
      ["amiV2", range(0x0, 0x1000)],
      ["ibb", range(0x100, 0x200)],
      ["pmda", range(0x180, 0x300)],
    ];
    const forward = list(entries);
    const backward = list([...entries].reverse());

    for (const probe of [
      range(0x100, 0x200),
      range(0x150, 0x250),
      range(0x0, 0x1000),
      range(0xf00, 0x1100),
    ]) {
      expect(protectionOfRange(forward, probe)).toBe(protectionOfRange(backward, probe));
    }
    // A later range around it does not repaint it.
    expect(protectionOfRange(forward, range(0x100, 0x200))).toBe("ibb");
  });
});
