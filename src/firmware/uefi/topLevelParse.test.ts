import { describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import { ImageReader } from "@/firmware/imageReader";
import * as Test from "@/firmware/testing/testImage";
import { Descriptor, type FlashRegionType } from "@/firmware/uefi/descriptorParser";
import { guid, guidBytes } from "@/firmware/uefi/efiGuid";
import { itemType } from "@/firmware/uefi/itemClassification";
import {
  microcodeDate,
  microcodeRange,
  readMicrocodeHeader,
} from "@/firmware/uefi/microcodeParser";
import { parseUefiImage } from "@/firmware/uefi/uefiImage";
import { nodeRange, type UEFINode } from "@/firmware/uefi/uefiNode";
import { ItemType, Sub } from "@/firmware/uefi/uefiTypes";

/**
 * Ported from `TopLevelParseTests.swift`: what kind of thing the file is — a
 * capsule, an Intel flash dump, or bytes to be searched.
 */

const parse = (bytes: Uint8Array) => parseUefiImage(sourceOver(bytes));
const kinds = (nodes: readonly UEFINode[]) => nodes.map((node) => node.kind);
const ranges = (nodes: readonly UEFINode[]) =>
  nodes.map((node) => [nodeRange(node).start, nodeRange(node).end]);
const bytes = (...values: number[]) => new Uint8Array(values);

const volume = Test.volume({
  length: 0x1000,
  files: [Test.file({ body: bytes(1, 2, 3, 4, 5, 6, 7, 8) })],
});
const region = (type: FlashRegionType, start: number, end: number) => ({ type, start, end });

describe("an Intel image", () => {
  // The whole image is one node whose body is the file; the descriptor, regions
  // and the padding between them sit under it.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/TopLevelParseTests.swift#TopLevelParseTests.testAnIntelImageIsOneNodeOverTheWholeDump
  it("is one node over the whole dump", () => {
    const parsed = parse(
      Test.intelImage({
        size: 0x8000,
        regions: [
          region("descriptor", 0, 0x1000),
          region("me", 0x1000, 0x3000),
          region("bios", 0x4000, 0x8000),
        ],
        contents: new Map([["bios" as FlashRegionType, volume]]),
      })
    );

    expect(kinds(parsed.roots)).toEqual(["intelImage"]);
    const root = parsed.roots[0] as UEFINode;
    expect(root.name).toBe("Intel image");
    expect(root.subtype).toBe(Sub.intelImage);
    expect(itemType(root)).toBe(ItemType.image);
    expect(root.header).toEqual({ start: 0, end: 0 });
    expect(root.body).toEqual({ start: 0, end: 0x8000 });
    expect(root.isFixed).toBe(true);
    expect(kinds(root.children)).toEqual(["flashDescriptor", "region", "padding", "region"]);
    expect(ranges(root.children)).toEqual([
      [0, 0x1000],
      [0x1000, 0x3000],
      [0x3000, 0x4000],
      [0x4000, 0x8000],
    ]);
    expect(root.children[1]?.name).toBe("ME region");
    expect(parsed.diagnostics).toEqual([]);
  });

  // A BIOS region is volumes and padding; an ME region is a format of its own
  // and is kept whole.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/TopLevelParseTests.swift#TopLevelParseTests.testOnlySomeRegionsAreReadFurther
  it("reads only some regions further", () => {
    const parsed = parse(
      Test.intelImage({
        size: 0x8000,
        regions: [
          region("descriptor", 0, 0x1000),
          region("me", 0x1000, 0x2000),
          region("bios", 0x4000, 0x8000),
        ],
        contents: new Map<FlashRegionType, Uint8Array>([
          ["bios", volume],
          ["me", volume],
        ]),
      })
    );
    const children = parsed.roots[0]?.children ?? [];
    const me = children.find((one) => one.name === "ME region");
    const bios = children.find((one) => one.name === "BIOS region");

    expect(me?.children).toHaveLength(0);
    expect(kinds(bios?.children ?? [])).toEqual(["volume", "padding"]);
    expect(nodeRange(bios?.children[0] as UEFINode)).toEqual({ start: 0x4000, end: 0x5000 });
  });

  // A version 1 descriptor describes five regions, and the bytes of a sixth
  // pair are something else entirely.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/TopLevelParseTests.swift#TopLevelParseTests.testAVersionOneDescriptorReadsFiveRegions
  it("reads five regions from a version one descriptor", () => {
    const parsed = parse(
      Test.intelImage({
        size: 0x8000,
        regions: [
          region("descriptor", 0, 0x1000),
          region("bios", 0x1000, 0x4000),
          region("microcode", 0x4000, 0x8000),
        ],
        version1: true,
      })
    );

    const children = parsed.roots[0]?.children ?? [];
    expect(kinds(children)).toEqual(["flashDescriptor", "region", "padding"]);
    expect(children.find((one) => one.name === "Microcode region")).toBeUndefined();
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/TopLevelParseTests.swift#TopLevelParseTests.testOverlappingRegionsAreReported
  it("reports overlapping regions", () => {
    const parsed = parse(
      Test.intelImage({
        size: 0x8000,
        regions: [
          region("descriptor", 0, 0x1000),
          region("me", 0x1000, 0x5000),
          region("bios", 0x4000, 0x8000),
        ],
      })
    );

    expect(parsed.diagnostics.map((one) => one.detail)).toEqual([{ kind: "overlappingRegions" }]);
    expect(ranges(parsed.roots[0]?.children ?? [])).toEqual([
      [0, 0x1000],
      [0x1000, 0x5000],
      [0x5000, 0x8000],
    ]);
  });

  // A dump that stops short of what the descriptor describes — half of a chip
  // read over a bad connection is exactly this.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/TopLevelParseTests.swift#TopLevelParseTests.testARegionRunningPastTheEndIsCutAndReported
  it("cuts a region running past the end, and reports it", () => {
    const image = Test.intelImage({
      size: 0x8000,
      regions: [region("descriptor", 0, 0x1000), region("bios", 0x1000, 0x8000)],
    }).subarray(0, 0x4000);

    const parsed = parse(image);

    expect(ranges(parsed.roots[0]?.children ?? [])).toEqual([
      [0, 0x1000],
      [0x1000, 0x4000],
    ]);
    expect(parsed.diagnostics.map((one) => one.detail)).toEqual([
      { kind: "truncated", structure: "flashDescriptor" },
    ]);
  });

  // A descriptor whose own map is out of range is still a descriptor, and still
  // an Intel image. The rest of the image gets searched rather than given up on.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/TopLevelParseTests.swift#TopLevelParseTests.testABrokenRegionMapFallsBackToASearch
  it("falls back to a search when the region map is broken", () => {
    const image = Test.intelImage({
      size: 0x8000,
      regions: [region("descriptor", 0, 0x1000), region("bios", 0x1000, 0x8000)],
    });
    image.set(volume, 0x1000);
    image[Descriptor.mapOffset + 2] = 0xff; // RegionBase above 0xE0

    const parsed = parse(image);

    expect(parsed.diagnostics.map((one) => one.detail)).toEqual([
      { kind: "truncated", structure: "flashDescriptor" },
    ]);
    const children = parsed.roots[0]?.children ?? [];
    expect(kinds(children)).toEqual(["flashDescriptor", "volume", "padding"]);
    expect(nodeRange(children[1] as UEFINode)).toEqual({ start: 0x1000, end: 0x2000 });
  });
});

describe("a capsule", () => {
  // The envelope a vendor shipped the image in: the image starts where
  // `HeaderSize` says, and reading from byte zero finds nothing.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/TopLevelParseTests.swift#TopLevelParseTests.testACapsuleIsUnwrappedAndItsImageParsed
  it("is unwrapped and its image parsed", () => {
    const parsed = parse(Test.capsule({ body: volume }));

    expect(kinds(parsed.roots)).toEqual(["capsule"]);
    expect(parsed.roots[0]?.name).toBe("EFI capsule");
    expect(parsed.roots[0]?.header).toEqual({ start: 0, end: 0x20 });
    expect(kinds(parsed.roots[0]?.children ?? [])).toEqual(["volume"]);
    expect(nodeRange(parsed.roots[0]?.children[0] as UEFINode)).toEqual({
      start: 0x20,
      end: 0x1020,
    });
  });

  // A capsule claiming less than the file holds has something after it, and
  // dropping it silently would lose bytes.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/TopLevelParseTests.swift#TopLevelParseTests.testWhatFollowsACapsuleIsKept
  it("keeps what follows it", () => {
    const parsed = parse(Test.capsule({ body: volume, trailing: 0x100 }));

    expect(kinds(parsed.roots)).toEqual(["uefiImage"]);
    const children = parsed.roots[0]?.children ?? [];
    expect(kinds(children)).toEqual(["capsule", "padding"]);
    expect(ranges(children)).toEqual([
      [0, 0x1020],
      [0x1020, 0x1120],
    ]);
  });

  // Aptio signed capsules put a certificate between the header and the image,
  // and only `RomImageOffset` knows how long it is.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/TopLevelParseTests.swift#TopLevelParseTests.testAnAptioCapsuleTakesItsBodyOffsetFromRomImageOffset
  it("takes an Aptio body offset from RomImageOffset", () => {
    const parsed = parse(
      Test.capsule({
        guid: guid("4A3CA68B-7723-48FB-803D-578CC1FEC44D"),
        headerSize: 0x20,
        romImageOffset: 0x100,
        body: volume,
      })
    );

    // The certificate and trailing bytes leave padding after the capsule, so
    // the file is capsule + padding at the top and is grouped under the image
    // root; the capsule itself is its first child.
    expect(kinds(parsed.roots)).toEqual(["uefiImage"]);
    const capsule = parsed.roots[0]?.children[0];
    expect(capsule?.name).toBe("AMI Aptio signed capsule");
    expect(capsule?.header).toEqual({ start: 0, end: 0x100 });
    expect(kinds(capsule?.children ?? [])).toEqual(["volume"]);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/TopLevelParseTests.swift#TopLevelParseTests.testAGuidThatIsNotACapsuleIsJustBytes
  it("is not made out of any GUID that happens to be there", () => {
    const image = new Uint8Array(0x200).fill(0xff);
    image.set(guidBytes(Test.DRIVER_GUID), 0);

    expect(kinds(parse(image).roots)).toEqual(["padding"]);
  });
});

describe("microcode", () => {
  // What a FIT table mostly points at, so the tree has to know one when it sees
  // one.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/TopLevelParseTests.swift#TopLevelParseTests.testMicrocodeIsFoundInARawArea
  it("is found in a raw area", () => {
    const parsed = parse(Test.image({ before: 0x100, volume: Test.microcode(), after: 0x100 }));
    // Padding, microcode, padding — several things at the top, so they sit
    // under the image root; the microcode is the middle child.
    const microcode = parsed.roots[0]?.children[1];

    expect(microcode?.kind).toBe("microcode");
    expect(microcode?.name).toBe("Microcode 306A9, revision 1F");
    expect(microcode?.header).toEqual({ start: 0x100, end: 0x130 });
    expect(microcode?.body).toEqual({ start: 0x130, end: 0x170 });
    expect(microcode?.isFixed).toBe(true);
    expect(parsed.diagnostics).toEqual([]);
  });

  // The header read back as values, which is what a FIT entry pointing here has
  // to be shown as.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/TopLevelParseTests.swift#TopLevelParseTests.testAMicrocodeHeaderReadsBackAsValues
  it("reads back as values", () => {
    const image = Test.microcode({ signature: 0x000a_0655, revision: 0x1c });
    const header = readMicrocodeHeader(0, new ImageReader(sourceOver(image)));

    expect(header?.processorSignature).toBe(0x000a_0655);
    expect(header?.updateRevision).toBe(0x1c);
    expect(header === undefined ? undefined : microcodeDate(header)).toBe("2019-07-15");
    expect(header?.dataSize).toBe(0x40);
    expect(header === undefined ? undefined : microcodeRange(header)).toEqual({
      start: 0,
      end: 0x70,
    });
  });

  // The header carries whether the image's dwords sum to zero, so a panel can
  // say the checksum counts without re-reading the image.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/TopLevelParseTests.swift#TopLevelParseTests.testTheHeaderSaysWhetherItsImageSumsToZero
  it("says whether its image sums to zero", () => {
    const good = readMicrocodeHeader(0, new ImageReader(sourceOver(Test.microcode())));
    expect(good?.checksumIsCorrect).toBe(true);

    const bad = readMicrocodeHeader(
      0,
      new ImageReader(sourceOver(Test.microcode({ checksum: 0xdead_beef })))
    );
    expect(bad?.checksumIsCorrect).toBe(false);
  });

  // The header also says what the field would have to be for the sum to come
  // out zero — the value a fix writes.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/TopLevelParseTests.swift#TopLevelParseTests.testTheHeaderSaysWhatTheChecksumShouldBe
  it("says what the checksum should be", () => {
    const good = readMicrocodeHeader(0, new ImageReader(sourceOver(Test.microcode())));
    const bad = readMicrocodeHeader(
      0,
      new ImageReader(sourceOver(Test.microcode({ checksum: 0xdead_beef })))
    );
    expect(bad?.computedChecksum).toBe(good?.checksum);
    // The stored value of a correct image is the value it should be.
    expect(good?.computedChecksum).toBe(good?.checksum);
    expect(bad?.computedChecksum).not.toBe(bad?.checksum);

    // A header whose declared total runs past the image cannot be summed, so
    // there is nothing to say it should be — not a fabricated answer.
    const truncated = Test.microcode({ totalSize: 0x2000 }).subarray(0, 0x100);
    const ragged = readMicrocodeHeader(0, new ImageReader(sourceOver(truncated)));
    expect(ragged?.checksumIsCorrect).toBe(false);
    expect(ragged?.computedChecksum).toBeUndefined();
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/TopLevelParseTests.swift#TopLevelParseTests.testBytesThatAreNotMicrocodeReadBackAsNothing
  it("is nothing when the bytes are not microcode", () => {
    expect(
      readMicrocodeHeader(0, new ImageReader(sourceOver(new Uint8Array(0x100).fill(0xff))))
    ).toBeUndefined();
    expect(readMicrocodeHeader(0, new ImageReader(sourceOver(bytes(1, 0, 0, 0))))).toBeUndefined();
  });

  // The dword `0x00000001` is everywhere. Only the whole header — the loader
  // revision, the sizes and the BCD date — decides.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/TopLevelParseTests.swift#TopLevelParseTests.testADwordOfOneIsNotMicrocode
  it("is not made out of a dword of one", () => {
    const image = new Uint8Array(0x200);
    image[0x40] = 0x01;

    const parsed = parse(image);

    expect(kinds(parsed.roots)).toEqual(["padding"]);
    expect(parsed.diagnostics).toEqual([]);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/TopLevelParseTests.swift#TopLevelParseTests.testAnImpossibleDateIsNotMicrocode
  it("is not made out of an impossible date", () => {
    const image = Test.microcode({ year: 0x2019, month: 0x13, day: 0x15 });
    expect(kinds(parse(image).roots)).toEqual(["padding"]);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/TopLevelParseTests.swift#TopLevelParseTests.testMicrocodeWithABrokenChecksumIsReported
  it("reports a broken checksum", () => {
    const parsed = parse(Test.microcode({ checksum: 0x1234 }));

    expect(kinds(parsed.roots)).toEqual(["microcode"]);
    expect(parsed.diagnostics).toHaveLength(1);
    expect(parsed.diagnostics[0]?.detail).toMatchObject({
      kind: "checksumMismatch",
      structure: "microcodeHeader",
      stored: 0x1234,
    });
  });

  // An empty microcode slot is `FF FF FF FF` and is perfectly legal — the FIT
  // specification allows entries pointing at one.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/TopLevelParseTests.swift#TopLevelParseTests.testAnEmptySlotStaysPadding
  it("leaves an empty slot as padding", () => {
    const parsed = parse(new Uint8Array(0x200).fill(0xff));

    expect(kinds(parsed.roots)).toEqual(["padding"]);
    expect(parsed.roots[0]?.isErased).toBe(true);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/TopLevelParseTests.swift#TopLevelParseTests.testAMicrocodeRegionIsReadAsMicrocode
  it("reads a microcode region as a run of microcode", () => {
    const both = new Uint8Array(0x70 * 2);
    both.set(Test.microcode(), 0);
    both.set(Test.microcode({ revision: 0x20 }), 0x70);
    const parsed = parse(
      Test.intelImage({
        size: 0x8000,
        regions: [region("descriptor", 0, 0x1000), region("microcode", 0x1000, 0x2000)],
        contents: new Map([["microcode" as FlashRegionType, both]]),
      })
    );
    const found = parsed.roots[0]?.children.find((one) => one.name === "Microcode region");

    expect(kinds(found?.children ?? [])).toEqual(["microcode", "microcode", "padding"]);
    expect(nodeRange(found?.children[0] as UEFINode)).toEqual({ start: 0x1000, end: 0x1070 });
  });
});

describe("the root of the tree", () => {
  // A lone volume off a chip already is that root — it is not wrapped in an
  // invented image it is not.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/TopLevelParseTests.swift#TopLevelParseTests.testALoneVolumeIsItsOwnRoot
  it("is a lone volume itself", () => {
    const parsed = parse(volume);

    expect(parsed.roots).toHaveLength(1);
    const root = parsed.roots[0] as UEFINode;
    expect(root.kind).toBe("volume");
    expect(root.header).toEqual({ start: 0, end: 0x48 });
    expect(root.body).toEqual({ start: 0x48, end: 0x1000 });
    expect(root.children[0]?.kind).toBe("file");
    expect(parsed.diagnostics).toEqual([]);
  });

  // Several things at the top are a file that is more than one image, and are
  // grouped under the UEFI image node UEFITool always shows as its root.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/TopLevelParseTests.swift#TopLevelParseTests.testSeveralThingsAtTheTopAreGroupedUnderAUefiImage
  it("groups several things under a UEFI image", () => {
    const parsed = parse(Test.image({ before: 0x100, volume: Test.microcode(), after: 0x100 }));

    expect(parsed.roots).toHaveLength(1);
    const root = parsed.roots[0] as UEFINode;
    expect(root.kind).toBe("uefiImage");
    expect(root.name).toBe("UEFI image");
    expect(root.subtype).toBe(Sub.uefiImage);
    expect(itemType(root)).toBe(ItemType.image);
    expect(root.header).toEqual({ start: 0, end: 0 });
    expect(root.body).toEqual({ start: 0, end: 0x270 });
    expect(root.isFixed).toBe(true);
    expect(kinds(root.children)).toEqual(["padding", "microcode", "padding"]);
    expect(parsed.diagnostics).toEqual([]);
  });

  // The wrapper is not invented a second time around a file that is already an
  // Intel image.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/TopLevelParseTests.swift#TopLevelParseTests.testAnIntelImageIsNotWrappedInAUefiImage
  it("does not wrap an Intel image in a UEFI image", () => {
    const parsed = parse(
      Test.intelImage({
        size: 0x8000,
        regions: [region("descriptor", 0, 0x1000), region("bios", 0x1000, 0x8000)],
        contents: new Map([["bios" as FlashRegionType, volume]]),
      })
    );

    expect(parsed.roots).toHaveLength(1);
    expect(kinds(parsed.roots)).toEqual(["intelImage"]);
  });
});
