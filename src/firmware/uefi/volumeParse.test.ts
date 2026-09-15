import { describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import * as Test from "@/firmware/testing/testImage";
import { guid } from "@/firmware/uefi/efiGuid";
import { FFS_V2 } from "@/firmware/uefi/knownGuids";
import { parseUefiImage } from "@/firmware/uefi/uefiImage";
import { nodeRange, type UEFINode } from "@/firmware/uefi/uefiNode";

/** Ported from `VolumeParseTests.swift`: finding volumes and reading headers. */

const parse = (bytes: Uint8Array) => parseUefiImage(sourceOver(bytes));
const kinds = (nodes: readonly UEFINode[]) => nodes.map((node) => node.kind);
const ranges = (nodes: readonly UEFINode[]) =>
  nodes.map((node) => [nodeRange(node).start, nodeRange(node).end]);

describe("finding a volume", () => {
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/VolumeParseTests.swift#VolumeParseTests.testAVolumeIsFoundBetweenPadding
  it("finds one between padding", () => {
    const parsed = parse(
      Test.image({ before: 0x100, volume: Test.volume({ length: 0x400 }), after: 0x100 })
    );

    // Padding, a volume and padding — several things at the top — are the
    // "UEFI image" root's children, not roots of their own.
    const children = parsed.roots[0]?.children ?? [];
    expect(kinds(children)).toEqual(["padding", "volume", "padding"]);
    expect(ranges(children)).toEqual([
      [0, 0x100],
      [0x100, 0x500],
      [0x500, 0x600],
    ]);
  });

  // Erased padding and padding with something in it are not the same thing to
  // anyone rebuilding an image.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/VolumeParseTests.swift#VolumeParseTests.testPaddingKnowsWhetherItIsErased
  it("says whether padding is erased", () => {
    const bytes = Test.image({ before: 0x100, volume: Test.volume({ length: 0x400 }) });
    bytes[0x40] = 0x5a;

    const first = parse(bytes).roots[0]?.children[0];
    expect(first?.isErased).toBe(false);
    expect(first?.name).toBe("Padding");
  });

  // Four bytes reading `_FVH` turn up inside compressed data all the time. A
  // candidate that fails its header checks is not a volume and — just as
  // important — not a complaint about the image either.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/VolumeParseTests.swift#VolumeParseTests.testASignatureWithoutAValidHeaderIsNotAVolume
  it("does not make a volume out of a bare signature", () => {
    const bytes = new Uint8Array(0x200).fill(0xff);
    bytes.set([0x5f, 0x46, 0x56, 0x48], 0x128);

    const parsed = parse(bytes);

    expect(kinds(parsed.roots)).toEqual(["padding"]);
    expect(parsed.diagnostics).toEqual([]);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/VolumeParseTests.swift#VolumeParseTests.testASignatureTooCloseToTheStartIsNotAVolume
  it("does not make a volume out of a signature too close to the start", () => {
    const bytes = new Uint8Array(0x100).fill(0xff);
    bytes.set([0x5f, 0x46, 0x56, 0x48], 0x10);

    expect(kinds(parse(bytes).roots)).toEqual(["padding"]);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/VolumeParseTests.swift#VolumeParseTests.testARevisionOutsideOneAndTwoIsNotAVolume
  it("is not a volume at a revision outside one and two", () => {
    expect(kinds(parse(Test.volume({ revision: 3, length: 0x400 })).roots)).toEqual(["padding"]);
  });
});

describe("a volume's header", () => {
  // The body starts after the header, and the header is where the file walk
  // must not begin — off by `HeaderLength` and every file in the volume is
  // misread.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/VolumeParseTests.swift#VolumeParseTests.testTheHeaderAndBodyAreSplitAtTheHeaderLength
  it("is split from the body at the header length", () => {
    const volume = parse(Test.volume({ length: 0x400 })).roots[0];

    expect(volume?.header).toEqual({ start: 0, end: 0x48 });
    expect(volume?.body).toEqual({ start: 0x48, end: 0x400 });
    expect(volume?.guid).toEqual(FFS_V2);
    expect(volume?.name).toBe("FFSv2");
    expect(volume?.subtype).toBe(2);
  });

  // A checksum that no longer matches is the ordinary trace of an image edited
  // by a tool that did not put it back.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/VolumeParseTests.swift#VolumeParseTests.testAStaleHeaderChecksumIsReported
  it("reports a stale checksum", () => {
    const parsed = parse(Test.volume({ length: 0x400, checksum: 0x1234 }));

    expect(kinds(parsed.roots)).toEqual(["volume"]);
    expect(parsed.diagnostics.map((one) => one.detail)).toEqual([
      { kind: "checksumMismatch", structure: "volumeHeader", stored: 0x1234, computed: 0xe5d1 },
    ]);
    expect(parsed.diagnostics.map((one) => one.offset)).toEqual([0x32]);
  });

  // The block map is a second opinion about the size. When the two disagree the
  // volume is damaged, but it is still the volume.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/VolumeParseTests.swift#VolumeParseTests.testABlockMapThatDisagreesWithTheLengthIsReported
  it("reports a block map that disagrees with the length", () => {
    const parsed = parse(Test.volume({ length: 0x400, blockMapLength: 0x200 }));

    expect(ranges(parsed.roots)).toEqual([[0, 0x400]]);
    expect(parsed.diagnostics.map((one) => one.detail)).toEqual([
      { kind: "sizeMismatch", structure: "volumeHeader", stored: 0x400, computed: 0x200 },
    ]);
  });

  // A volume claiming more bytes than the image has: keep what is there, and
  // say so.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/VolumeParseTests.swift#VolumeParseTests.testAVolumeRunningPastTheEndIsCutAndReported
  it("cuts a volume running past the end, and reports it", () => {
    const parsed = parse(Test.volume({ length: 0x400 }).subarray(0, 0x300));

    expect(ranges(parsed.roots)).toEqual([[0, 0x300]]);
    expect(parsed.diagnostics.map((one) => one.detail)).toEqual([
      { kind: "truncated", structure: "volumeBody" },
    ]);
  });

  // The extended header moves the body but stays outside the checksum. Summing
  // over it instead of over `HeaderLength` makes every Revision 2 volume in
  // existence look corrupt.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/VolumeParseTests.swift#VolumeParseTests.testAnExtendedHeaderMovesTheBodyAndStaysOutOfTheChecksum
  it("moves the body for an extended header, and keeps it out of the checksum", () => {
    const name = guid("AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE");
    const parsed = parse(Test.volume({ length: 0x400, extendedHeader: name }));
    const volume = parsed.roots[0];

    expect(volume?.header).toEqual({ start: 0, end: 0x60 }); // 0x48 + 0x14, up to eight
    expect(volume?.body).toEqual({ start: 0x60, end: 0x400 });
    expect(parsed.diagnostics).toEqual([]);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/VolumeParseTests.swift#VolumeParseTests.testAnExtendedHeaderOffTheEndIsReported
  it("reports an extended header off the end", () => {
    const bytes = Test.volume({ length: 0x400, extendedHeader: FFS_V2 });
    bytes[0x34] = 0x00;
    bytes[0x35] = 0xf0; // ExtHeaderOffset far past the end

    const parsed = parse(bytes);

    expect(kinds(parsed.roots)).toEqual(["volume"]);
    expect(
      parsed.diagnostics.some(
        (one) => one.detail.kind === "truncated" && one.detail.structure === "volumeExtendedHeader"
      )
    ).toBe(true);
  });
});

describe("a volume's body", () => {
  // An NVRAM store volume is read as a run of stores, not as files. An
  // all-erased one has no stores, so its body is one run of free space — and it
  // is not an unknown file system.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/VolumeParseTests.swift#VolumeParseTests.testAnErasedNvramVolumeReadsAsFreeSpace
  it("reads an erased NVRAM volume as free space", () => {
    const nvram = guid("FFF12B8D-7696-4C8B-A985-2747075B4F50");
    const parsed = parse(Test.volume({ fileSystem: nvram, length: 0x400 }));

    expect(parsed.roots.map((one) => one.name)).toEqual(["NVRAM store"]);
    expect(kinds(parsed.roots[0]?.children ?? [])).toEqual(["freeSpace"]);
    expect(ranges(parsed.roots[0]?.children ?? [])).toEqual([[0x48, 0x400]]);
    expect(parsed.diagnostics).toEqual([]);
  });

  // A volume whose file system is not one we parse keeps its body whole and
  // says so — the NVRAM store GUIDs no longer land here.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/VolumeParseTests.swift#VolumeParseTests.testAGenuinelyUnknownFileSystemKeepsItsBodyWhole
  it("keeps a genuinely unknown file system's body whole", () => {
    const unknown = guid("11111111-2222-3333-4444-555555555555");
    const parsed = parse(Test.volume({ fileSystem: unknown, length: 0x400 }));

    expect(parsed.roots[0]?.children).toEqual([]);
    expect(parsed.diagnostics.map((one) => one.detail)).toEqual([
      { kind: "unknownFileSystem", guid: unknown },
    ]);
  });

  // Erase polarity decides what free space looks like, and it is the volume's
  // attribute that says.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/VolumeParseTests.swift#VolumeParseTests.testAVolumeErasedWithZeroesReadsItsFreeSpaceAsFree
  it("reads a zero-erased volume's free space as free", () => {
    const parsed = parse(Test.volume({ length: 0x400, emptyByte: 0x00 }));
    const volume = parsed.roots[0];

    expect(kinds(volume?.children ?? [])).toEqual(["freeSpace"]);
    expect(ranges(volume?.children ?? [])).toEqual([[0x48, 0x400]]);
    expect(parsed.diagnostics).toEqual([]);
  });
});
