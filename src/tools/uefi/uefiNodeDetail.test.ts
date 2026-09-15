import { describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import { ImageReader } from "@/firmware/imageReader";
import * as Test from "@/firmware/testing/testImage";
import { checksumText, crc32, sum8 } from "@/firmware/uefi/checksums";
import { guid, guidBytes as guidBytesOf, guidFromBytes, guidText } from "@/firmware/uefi/efiGuid";
import { jedecName } from "@/firmware/uefi/jedecIds";
import { FFS_V2, VOLUME_TOP_FILE } from "@/firmware/uefi/knownGuids";
import { UEFIImage } from "@/firmware/uefi/uefiImage";
import { makeNode, makeSpan, type UEFINode } from "@/firmware/uefi/uefiNode";
import { Sub } from "@/firmware/uefi/uefiTypes";
import type { NodeDetail } from "@/tools/toolDetail";
import { buildNodeDetail } from "@/tools/uefi/uefiNodeDetail";

/**
 * Ported from upstream's `UEFIDetailTests` and `DescriptorDetailTests`: what the
 * panel says about a node, by its type. The fixtures are this repository's own
 * builders, so the offsets follow them — a volume header here is 0x48 bytes,
 * where upstream's fixture is 0x38.
 */

const r = (start: number, end: number) => ({ start, end });
const readerOver = (bytes: Uint8Array) => new ImageReader(sourceOver(bytes));
const MAPPED = 0xffff_0000;

function detailOf(
  node: UEFINode,
  bytes: Uint8Array,
  options: {
    readonly addressDiff?: number;
    readonly repairs?: { offset: number; bytes: Uint8Array }[];
  } = {}
): NodeDetail {
  const image = new UEFIImage({
    size: bytes.length,
    roots: [node],
    ...(options.addressDiff === undefined ? {} : { addressDiff: options.addressDiff }),
  });
  return buildNodeDetail(node, image, readerOver(bytes), options.repairs ?? []);
}

const value = (detail: NodeDetail, label: string) =>
  detail.fields.find((one) => one.label === label)?.value;
const problem = (detail: NodeDetail, label: string) =>
  detail.fields.find((one) => one.label === label)?.isProblem;
const table = (detail: NodeDetail, title: string) =>
  detail.tables.find((one) => one.title === title);

const volumeNode = (options: { readonly guid?: typeof FFS_V2; readonly name?: string } = {}) =>
  makeNode({
    kind: "volume",
    subtype: 2,
    name: options.name ?? "FFSv2",
    guid: options.guid ?? FFS_V2,
    header: r(0, 0x48),
    body: r(0x48, 0x1000),
  });

describe("a volume", () => {
  const bytes = Test.volume({ length: 0x1000, checksum: 0x1234 });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIToolTests.swift#UEFIDetailTests.testAVolumeSaysWhatItsHeaderSays
  it("says what its header says", () => {
    const detail = detailOf(volumeNode(), bytes, { addressDiff: MAPPED });

    expect(detail.title).toBe("FFSv2");
    expect(value(detail, "Kind")).toBe("Volume");
    expect(value(detail, "Type")).toBe("Revision 2");
    expect(value(detail, "GUID")).toBe(`${guidText(FFS_V2)} (FFSv2)`);
    expect(value(detail, "Header")).toBe("0x0 · 0x48 (72) bytes");
    expect(value(detail, "Body")).toBe("0x48 · 0xFB8 (4024) bytes");
    expect(value(detail, "Total")).toBe("0x0 · 0x1000 (4096) bytes");
    expect(value(detail, "Address")).toBe("0xFFFF0000");
    expect(value(detail, "Length")).toBe("0x1000 (4096)");
    expect(value(detail, "Signature")).toBe("0x4856465F");
    expect(value(detail, "Attributes")).toBe("0x800 (Erase polarity)");
    expect(value(detail, "Header length")).toBe("0x48 (72)");
    expect(value(detail, "Checksum")).toBe("0x1234 (Valid)");
    expect(value(detail, "Ext. header")).toBe("0x0");
    expect(value(detail, "Revision")).toBe("2");
  });

  // With nothing to fix the checksum reads valid and is no problem. The repairs
  // are the parse's word, and the detail renders it rather than re-reading the
  // body to second-guess it.
  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIToolTests.swift#UEFIDetailTests.testACleanVolumeChecksumIsValidAndNoProblem
  it("reads a clean checksum as valid and no problem", () => {
    const detail = detailOf(volumeNode(), bytes, { repairs: [] });

    expect(value(detail, "Checksum")).toBe("0x1234 (Valid)");
    expect(problem(detail, "Checksum")).toBeFalsy();
  });

  // The repair is the row's word on a wrong field, and its bytes are what the
  // field should read.
  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIToolTests.swift#UEFIDetailTests.testAWrongVolumeChecksumSaysWhatItShouldBe
  it("marks a wrong checksum and says what it should be", () => {
    const detail = detailOf(volumeNode(), bytes, {
      repairs: [{ offset: 0x32, bytes: Uint8Array.of(0x78, 0x56) }],
    });

    expect(value(detail, "Checksum")).toBe("0x1234 (Invalid), should be 0x5678");
    expect(problem(detail, "Checksum")).toBe(true);
    expect(problem(detail, "Length")).toBe(false);
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIToolTests.swift#UEFIDetailTests.testAnUnknownVolumeGuidShowsRaw
  it("shows an unknown file system's GUID raw, and is titled by its kind", () => {
    const unknown = guid("00000011-0000-0000-0000-000000000022");
    const detail = detailOf(volumeNode({ guid: unknown, name: "" }), bytes);

    expect(value(detail, "GUID")).toBe(guidText(unknown));
    expect(detail.title).toBe("Volume");
  });
});

describe("a file", () => {
  const fileNode = (type = 0x07) =>
    makeNode({
      kind: "file",
      subtype: type,
      name: "Volume Top File",
      guid: VOLUME_TOP_FILE,
      header: r(0, 0x18),
      body: r(0x18, 0x100),
    });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIToolTests.swift#UEFIDetailTests.testAFileNamesItsTypeAndReadsBackItsHeader
  it("names its type and reads back its header", () => {
    const bytes = Test.file({
      type: 0x07,
      attributes: 0x04,
      state: 0x80,
      headerChecksum: 0xaa,
      bodyChecksum: 0xbb,
      body: new Uint8Array(0xe8),
    });
    const detail = detailOf(fileNode(), bytes);

    expect(detail.title).toBe("Volume Top File");
    expect(value(detail, "Kind")).toBe("FFS file");
    expect(value(detail, "Type")).toBe("Driver");
    expect(value(detail, "Attributes")).toBe("0x4 (Fixed)");
    expect(value(detail, "Size")).toBe("0x100 (256)");
    expect(value(detail, "State")).toBe("0x80 (Erase polarity)");
    expect(value(detail, "Header checksum")).toBe("0xAA (Valid)");
    expect(value(detail, "Body checksum")).toBe("0xBB (Valid)");
    expect(value(detail, "Header")).toBe("0x0 · 0x18 (24) bytes");
  });

  // A repair on one of the two checksums reads only that one as wrong.
  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIToolTests.swift#UEFIDetailTests.testAFileHeaderAndBodyChecksumsAreMarkedIndependently
  it("marks its header and body checksums independently", () => {
    const bytes = Test.file({
      headerChecksum: 0xaa,
      bodyChecksum: 0xbb,
      body: new Uint8Array(0xe8),
    });

    const headerWrong = detailOf(fileNode(), bytes, {
      repairs: [{ offset: 0x10, bytes: Uint8Array.of(0xff) }],
    });
    expect(value(headerWrong, "Header checksum")).toBe("0xAA (Invalid), should be 0xFF");
    expect(problem(headerWrong, "Header checksum")).toBe(true);
    expect(value(headerWrong, "Body checksum")).toBe("0xBB (Valid)");
    expect(problem(headerWrong, "Body checksum")).toBeFalsy();

    const bodyWrong = detailOf(fileNode(), bytes, {
      repairs: [{ offset: 0x11, bytes: Uint8Array.of(0xaa) }],
    });
    expect(value(bodyWrong, "Header checksum")).toBe("0xAA (Valid)");
    expect(value(bodyWrong, "Body checksum")).toBe("0xBB (Invalid), should be 0xAA");
    expect(problem(bodyWrong, "Body checksum")).toBe(true);
  });

  // A large file leaves the three-byte size at zero; the detail follows the
  // 64-bit one rather than showing nothing.
  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIToolTests.swift#UEFIDetailTests.testALargeFileReadsItsSizeFromTheLargeField
  it("reads a large file's size from the large field", () => {
    const bytes = Test.largeFile({ body: new Uint8Array(0x10) });
    const node = makeNode({
      kind: "file",
      subtype: 0x07,
      name: "",
      header: r(0, 0x20),
      body: r(0x20, 0x30),
    });

    expect(value(detailOf(node, bytes), "Size")).toBe("0x30 (48)");
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIToolTests.swift#UEFIDetailTests.testAnUnknownFileTypeKeepsItsNumber
  it("keeps an unknown type's number", () => {
    const bytes = Test.file({ type: 0x7f, body: new Uint8Array(0xe8) });
    expect(value(detailOf(fileNode(0x7f), bytes), "Type")).toBe("File type 0x7F");
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIToolTests.swift#UEFIDetailTests.testACompressedNodeHasNoAddress
  it("has no address inside a compressed section", () => {
    const bytes = Test.file({ body: new Uint8Array(0xe8) });
    const node = { ...fileNode(), isCompressed: true };
    expect(value(detailOf(node, bytes, { addressDiff: MAPPED }), "Address")).toBeUndefined();
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIToolTests.swift#UEFIDetailTests.testAnImageWithNoAddressMapHasNoAddress
  it("has no address in an image with no address map", () => {
    const bytes = Test.file({ body: new Uint8Array(0xe8) });
    expect(value(detailOf(fileNode(), bytes), "Address")).toBeUndefined();
  });
});

describe("a section", () => {
  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIToolTests.swift#UEFIDetailTests.testASectionNamesItsTypeAndSize
  it("names its type and size", () => {
    const bytes = Test.section({ type: 0x19, body: new Uint8Array(0x3c) });
    const node = makeNode({
      kind: "section",
      subtype: 0x19,
      name: "Raw",
      header: r(0, 4),
      body: r(4, 0x40),
    });
    const detail = detailOf(node, bytes);

    expect(value(detail, "Kind")).toBe("Section");
    expect(value(detail, "Type")).toBe("Raw");
    expect(value(detail, "Size")).toBe("0x40 (64)");
    expect(value(detail, "Header")).toBe("0x0 · 0x4 (4) bytes");
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIToolTests.swift#UEFIDetailTests.testAnExtendedSectionReadsItsSizeInThirtyTwoBits
  it("reads an extended section's size in thirty-two bits", () => {
    const bytes = Test.section({
      type: 0x19,
      body: new Uint8Array(0x10),
      extendedSize: true,
      size: 0x10_0000,
    });
    const node = makeNode({
      kind: "section",
      subtype: 0x19,
      name: "Raw",
      header: r(0, 8),
      body: r(8, 0x18),
    });
    const detail = detailOf(node, bytes);

    expect(value(detail, "Size")).toBe("0x100000 (1048576)");
    expect(value(detail, "Header")).toBe("0x0 · 0x8 (8) bytes");
  });
});

describe("a microcode", () => {
  const node = makeNode({
    kind: "microcode",
    name: "Microcode",
    header: r(0, 0x30),
    body: r(0x30, 0x100),
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIToolTests.swift#UEFIDetailTests.testAMicrocodeHeaderComesBackValidated
  it("comes back validated", () => {
    const bytes = Test.microcode({ revision: 0xf0, signature: 0x0008_06ea, totalSize: 0x100 });
    // Upstream's fixture pads past the data with zeros, as an update for one
    // processor does: nothing there reads as an extended signature table.
    bytes.fill(0, 0x70);
    const detail = detailOf(node, bytes);

    expect(value(detail, "Kind")).toBe("Microcode");
    expect(value(detail, "Header type")).toBe("0x1");
    expect(value(detail, "Update revision")).toBe("0xF0");
    expect(value(detail, "Date")).toBe("2019-07-15");
    expect(value(detail, "CPUID")).toBe("806EA");
    expect(value(detail, "Loader revision")).toBe("0x1");
    expect(value(detail, "Platform IDs")).toBe("0x1");
    expect(value(detail, "Data size")).toBe("0x40 (64)");
    expect(value(detail, "Total size")).toBe("0x100 (256)");
    expect(value(detail, "Processor")).toBe("Family 0x6, model 0x8E, stepping 0xA");
    expect(value(detail, "Platforms")).toBe("0");
    // An update for one processor has no table.
    expect(value(detail, "Extended signatures")).toBeUndefined();
    expect(detail.tables).toEqual([]);
  });

  // One checksum dword; a repair on it makes the row the problem and quotes the
  // dword a fix would write, its four bytes read little-endian.
  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIToolTests.swift#UEFIDetailTests.testAMicrocodeChecksumRowSaysWhatItShouldBe
  it("says what a wrong image checksum should be", () => {
    const bytes = Test.microcode({ checksum: 0 });
    bytes.fill(0, 0x70);

    const clean = detailOf(node, bytes, { repairs: [] });
    expect(value(clean, "Image checksum")).toBe("0x00000000 (Valid)");
    expect(problem(clean, "Image checksum")).toBeFalsy();

    const corrupt = detailOf(node, bytes, {
      repairs: [{ offset: 0x10, bytes: Uint8Array.of(0xca, 0xd6, 0xe2, 0xf8) }],
    });
    expect(value(corrupt, "Image checksum")).toBe("0x00000000 (Invalid), should be 0xF8E2D6CA");
    expect(problem(corrupt, "Image checksum")).toBe(true);
  });

  // A byte length reads with its decimal; codes on the same node stay bare hex.
  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIToolTests.swift#UEFIDetailTests.testByteLengthSizesReadInDecimalAndCodesStayHex
  it("reads byte lengths in decimal and leaves codes in hex", () => {
    const bytes = Test.microcode({
      revision: 0xf0,
      signature: 0x0008_06ea,
      dataSize: 0x800,
      totalSize: 0x1000,
    });
    bytes.fill(0, 0x830);
    const large = makeNode({
      kind: "microcode",
      name: "Microcode",
      header: r(0, 0x30),
      body: r(0x30, 0x1000),
    });
    const detail = detailOf(large, bytes);

    expect(value(detail, "Data size")).toBe("0x800 (2048)");
    expect(value(detail, "Total size")).toBe("0x1000 (4096)");
    expect(value(detail, "CPUID")).toBe("806EA");
    expect(value(detail, "Update revision")).toBe("0xF0");
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIToolTests.swift#UEFIDetailTests.testBytesThatAreNotMicrocodeShowNoMicrocodeFields
  it("shows no microcode fields over bytes that are not microcode", () => {
    const bytes = Test.microcode({ headerType: 0 });
    const detail = detailOf(node, bytes);

    expect(value(detail, "Kind")).toBe("Microcode");
    expect(value(detail, "Header type")).toBe("0x0");
    expect(value(detail, "Update revision")).toBeUndefined();
    expect(value(detail, "Date")).toBeUndefined();
  });
});

describe("a node with no header of its own", () => {
  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIToolTests.swift#UEFIDetailTests.testPaddingShowsOnlyTheCommonFields
  it("shows only the common fields, titled by its kind", () => {
    const node = makeSpan({ kind: "padding", name: "", range: r(0, 0x100) });
    const detail = detailOf(node, new Uint8Array(0x100));

    expect(detail.title).toBe("Padding");
    expect(value(detail, "Kind")).toBe("Padding");
    expect(value(detail, "Total")).toBe("0x0 · 0x100 (256) bytes");
    expect(value(detail, "Length")).toBeUndefined();
    expect(value(detail, "Signature")).toBeUndefined();
  });
});

describe("the image roots", () => {
  // The first three counters are stored minus one and the two strap counts are
  // not.
  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIToolTests.swift#UEFIDetailTests.testAnIntelImageReadsItsDescriptorCounters
  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIToolTests.swift#UEFIDetailTests.testAnIntelImageReadsZeroBasedCountersBackPlusOne
  it("reads an Intel image's counters off the descriptor map", () => {
    const bytes = new Uint8Array(0x1000);
    const view = new DataView(bytes.buffer);
    view.setUint32(0x14, 0x0204_0003, true); // chips 0 → 1, regions 2 → 3
    view.setUint32(0x18, 0x0700_0108, true); // masters 1 → 2, PCH straps 7
    view.setUint32(0x1c, 0x8000, true); // PROC straps 0x80
    const node = makeNode({
      kind: "intelImage",
      subtype: Sub.intelImage,
      name: "Intel image",
      header: r(0, 0),
      body: r(0, 0x1000),
    });
    const detail = detailOf(node, bytes, { addressDiff: MAPPED });

    expect(detail.title).toBe("Intel image");
    expect(value(detail, "Kind")).toBe("Intel image");
    expect(value(detail, "Type")).toBe("Intel");
    expect(value(detail, "Header")).toBe("Empty");
    expect(value(detail, "Body")).toBe("0x0 · 0x1000 (4096) bytes");
    expect(value(detail, "Address")).toBe("0xFFFF0000");
    expect(value(detail, "Flash chips")).toBe("1");
    expect(value(detail, "Regions")).toBe("3");
    expect(value(detail, "Masters")).toBe("2");
    expect(value(detail, "PCH straps")).toBe("7");
    expect(value(detail, "PROC straps")).toBe("128");
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIToolTests.swift#UEFIDetailTests.testAUefiImageWrapperShowsOnlyItsCommonFields
  it("shows only the common fields for the UEFI image wrapper", () => {
    const node = makeNode({
      kind: "uefiImage",
      subtype: Sub.uefiImage,
      name: "UEFI image",
      header: r(0, 0),
      body: r(0, 0x1000),
      isFixed: true,
    });
    const detail = detailOf(node, new Uint8Array(0x1000));

    expect(detail.title).toBe("UEFI image");
    expect(value(detail, "Type")).toBe("UEFI");
    expect(value(detail, "Header")).toBe("Empty");
    expect(value(detail, "Total")).toBe("0x0 · 0x1000 (4096) bytes");
    expect(value(detail, "Flags")).toBe("fixed");
    expect(value(detail, "Flash chips")).toBeUndefined();
    expect(value(detail, "Length")).toBeUndefined();
  });
});

describe("a flash descriptor", () => {
  const vector = Uint8Array.of(
    0x11,
    0x00,
    0x00,
    0x9c,
    0x90,
    0x02,
    0x00,
    0xd6,
    0x00,
    0x00,
    0x00,
    0x05,
    0xff,
    0xff,
    0xff,
    0xff
  );
  const chips = [0x1f_4700, 0xc2_2019];
  const bytes = Test.descriptor({
    regions: [
      { type: "me", start: 0x1000, end: 0x60_0000 },
      { type: "bios", start: 0x60_0000, end: 0x100_0000 },
    ],
    version1: true,
    reservedVector: vector,
    masters: [
      { read: 0xa0, write: 0x00 },
      { read: 0x40, write: 0x00 },
      { read: 0x80, write: 0x00 },
    ],
    chips,
  });
  const node = makeNode({
    kind: "flashDescriptor",
    subtype: 0,
    name: "Descriptor region",
    header: r(0, 0x14),
    body: r(0x14, 0x1000),
  });
  const detail = detailOf(node, bytes);

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/DescriptorDetailTests.swift#DescriptorDetailTests.testTheReservedVectorIsShownAsBytes
  it("shows the reserved vector as bytes", () => {
    expect(value(detail, "Reserved vector")).toBe(
      "11 00 00 9C 90 02 00 D6 00 00 00 05 FF FF FF FF"
    );
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/DescriptorDetailTests.swift#DescriptorDetailTests.testEachRegionsOffsetIsARow
  it("gives each declared region's offset a row, its own excluded", () => {
    expect(value(detail, "ME region offset")).toBe("0x1000");
    expect(value(detail, "BIOS region offset")).toBe("0x600000");
    expect(value(detail, "Descriptor region offset")).toBeUndefined();
    expect(value(detail, "GbE region offset")).toBeUndefined();
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/DescriptorDetailTests.swift#DescriptorDetailTests.testTheMastersMasksAreAGrid
  it("draws the masters' masks as a grid", () => {
    const masters = table(detail, "Region access settings");
    expect(masters?.symbol).toBe("key");
    expect(masters?.columns).toEqual(["Master", "Read", "Write"]);
    expect(masters?.rows.map((row) => row[0]?.text)).toEqual(["BIOS", "ME", "GbE"]);
    expect(masters?.rows.map((row) => row[1]?.text)).toEqual(["0xA0", "0x40", "0x80"]);
    expect(masters?.rows.map((row) => row[2]?.text)).toEqual(["0x00", "0x00", "0x00"]);
  });

  // A0h carries none of the region bits, so the BIOS master may touch only its
  // own region — the locked-down board of the reference parser's example.
  // @upstream Modules/UEFITool/Tests/UEFIToolTests/DescriptorDetailTests.swift#DescriptorDetailTests.testTheBiosAccessTableIsAGridOfPermissions
  it("draws the BIOS access table as a grid of coloured permissions", () => {
    const access = table(detail, "BIOS access table");
    expect(access?.symbol).toBe("lock.shield");
    expect(access?.columns).toEqual(["Region", "Read", "Write"]);
    expect(access?.rows.map((row) => row[0]?.text)).toEqual(["Desc", "BIOS", "ME", "GbE", "PDR"]);
    expect(access?.rows.map((row) => row[1]?.text)).toEqual(["No", "Yes", "No", "No", "No"]);
    expect(access?.rows.map((row) => row[1]?.tone)).toEqual(["no", "yes", "no", "no", "no"]);
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/DescriptorDetailTests.swift#DescriptorDetailTests.testTheVsccTableIsAGridOfChips
  it("draws the VSCC table as a grid of chips", () => {
    const vscc = table(detail, "Flash chips in VSCC table");
    expect(vscc?.symbol).toBe("cpu");
    expect(vscc?.columns).toEqual(["JEDEC ID", "Chip"]);
    expect(vscc?.rows.map((row) => row[0]?.text)).toEqual(["1F4700", "C22019"]);
    expect(vscc?.rows.map((row) => row[1]?.text)).toEqual(
      chips.map((id) => jedecName(id) ?? "Unknown")
    );
  });

  // A version 2 descriptor writes twelve bits, so its masks are three digits
  // wide, and it has an EC master the older one does not.
  // @upstream Modules/UEFITool/Tests/UEFIToolTests/DescriptorDetailTests.swift#DescriptorDetailTests.testAVersion2DescriptorWritesThreeDigitMasksAndAnEC
  it("writes a version 2 descriptor's masks in three digits, with an EC master", () => {
    const shown = detailOf(
      node,
      Test.descriptor({
        regions: [{ type: "me", start: 0x1000, end: 0x60_0000 }],
        version1: false,
        masters: [
          { read: 0xfff, write: 0xfff },
          { read: 0x0d8, write: 0x0d8 },
          { read: 0x008, write: 0x008 },
          { read: 0x100, write: 0x100 },
        ],
      })
    );
    const masters = table(shown, "Region access settings");

    expect(masters?.rows.map((row) => row[0]?.text)).toEqual(["BIOS", "ME", "GbE", "EC"]);
    expect(masters?.rows[0]?.[1]?.text).toBe("0xFFF");
    expect(masters?.rows.at(-1)?.[2]?.text).toBe("0x100");
  });

  // A board that lets its BIOS master into every region reads the other way
  // round — which is the whole reason the table is drawn in colour.
  // @upstream Modules/UEFITool/Tests/UEFIToolTests/DescriptorDetailTests.swift#DescriptorDetailTests.testAnOpenBoardsAccessTableReadsGreen
  it("reads an open board's access table green", () => {
    const shown = detailOf(
      node,
      Test.descriptor({
        regions: [{ type: "me", start: 0x1000, end: 0x60_0000 }],
        version1: true,
        masters: [
          { read: 0x1f, write: 0x1f },
          { read: 0, write: 0 },
          { read: 0, write: 0 },
        ],
      })
    );
    const access = table(shown, "BIOS access table");

    expect(access?.rows.map((row) => row[1]?.text)).toEqual(["Yes", "Yes", "Yes", "Yes", "Yes"]);
    expect(access?.rows.map((row) => row[2]?.tone)).toEqual(["yes", "yes", "yes", "yes", "yes"]);
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/DescriptorDetailTests.swift#DescriptorDetailTests.testOnlyADescriptorCarriesTheDescriptorBlock
  it("is the only node that carries the descriptor block", () => {
    const volume = detailOf(volumeNode(), Test.volume({ length: 0x1000 }));
    expect(volume.tables).toEqual([]);
    expect(value(volume, "Reserved vector")).toBeUndefined();
  });
});

/** Upstream's `TestUEFI.nvram…` fixtures, byte for byte. */
describe("the NVRAM stores and entries", () => {
  const le16 = (value: number) => [value & 0xff, (value >>> 8) & 0xff];
  const le32 = (value: number) => [0, 8, 16, 24].map((shift) => (value >>> shift) & 0xff);
  const ascii = (text: string) => [...text].map((character) => character.charCodeAt(0));
  const padded = (bytes: number[], size: number, fill = 0) =>
    Uint8Array.from([...bytes, ...new Array(Math.max(0, size - bytes.length)).fill(fill)]);
  /** Upstream's `EFIGUID(low: 0x11111111, high: 0x22222222)`: two little-endian words. */
  const vendor = guidFromBytes(
    Uint8Array.from([...le32(0x1111_1111), 0, 0, 0, 0, ...le32(0x2222_2222), 0, 0, 0, 0])
  );

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIToolTests.swift#UEFIDetailTests.testAVssStoreReadsItsFormatAndState
  it("reads a VSS store's format and state", () => {
    const bytes = padded([...le32(0x5353_5624), ...le32(0x50), 0x5a, 0x01, 0, 0, 0, 0, 0, 0], 0x50);
    const node = makeNode({
      kind: "vssStore",
      name: "VSS store",
      header: r(0, 16),
      body: r(16, 0x50),
    });
    const detail = detailOf(node, bytes);

    expect(value(detail, "Kind")).toBe("VSS store");
    expect(value(detail, "Format")).toBe("0x5A");
    expect(value(detail, "State")).toBe("0x1");
    expect(value(detail, "Reserved")).toBe("0x0");
    expect(value(detail, "Reserved1")).toBe("0x0");
  });

  // The same four fields, after the 16-byte store GUID.
  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIToolTests.swift#UEFIDetailTests.testAVss2StoreReadsItsFormatAndState
  it("reads a VSS2 store's fields past its GUID", () => {
    const bytes = padded(
      [...new Array(16).fill(0), ...le32(0x40), 0x5a, 0x01, 0, 0, 0, 0, 0, 0],
      0x40
    );
    const node = makeNode({
      kind: "vss2Store",
      name: "VSS2 store",
      header: r(0, 28),
      body: r(28, 0x40),
    });
    const detail = detailOf(node, bytes);

    expect(value(detail, "Kind")).toBe("VSS2 store");
    expect(value(detail, "Format")).toBe("0x5A");
    expect(value(detail, "State")).toBe("0x1");
    expect(value(detail, "Reserved")).toBe("0x0");
    expect(value(detail, "Reserved1")).toBe("0x0");
  });

  // The vendor GUID is the common GUID row, and the attributes read as words.
  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIToolTests.swift#UEFIDetailTests.testAVssVariableShowsItsVendorGuidAndAttributeWords
  it("shows a VSS variable's vendor GUID and attribute words", () => {
    const bytes = Uint8Array.from([
      0xaa,
      0x55,
      0x7f,
      0,
      ...le32(7),
      ...le32(0),
      ...le32(0),
      ...guidBytesOf(vendor),
    ]);
    const node = makeNode({
      kind: "vssEntry",
      subtype: Sub.standardVssEntry,
      name: "BootOrder",
      guid: vendor,
      header: r(0, 32),
      body: r(32, 32),
    });
    const detail = detailOf(node, bytes);

    expect(detail.title).toBe("BootOrder");
    expect(value(detail, "Kind")).toBe("VSS entry");
    expect(value(detail, "Type")).toBe("Standard");
    expect(value(detail, "GUID")).toBe(guidText(vendor));
    expect(value(detail, "State")).toBe("0x7F");
    expect(value(detail, "Reserved")).toBe("0x0");
    expect(value(detail, "Attributes")).toBe("0x7 (NonVolatile, BootService, Runtime)");
  });

  // The CRC is not re-verified here — the parser already reports a mismatch —
  // so the value is shown without a validity claim.
  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIToolTests.swift#UEFIDetailTests.testAFtwStoreShowsItsStateAndHeaderCrc
  it("shows an FTW store's state and header CRC", () => {
    const bytes = Uint8Array.from([
      ...new Array(16).fill(0),
      ...le32(0xdead_beef),
      0x01,
      0,
      0,
      0,
      ...le32(0x14),
    ]);
    const node = makeNode({
      kind: "ftwStore",
      name: "FTW store",
      header: r(0, 28),
      body: r(28, 28),
    });
    const detail = detailOf(node, bytes);

    expect(value(detail, "Kind")).toBe("FTW store");
    expect(value(detail, "State")).toBe("0x1");
    expect(value(detail, "Header CRC32")).toBe("0xDEADBEEF");
  });

  const sysfStore = (storedCrc?: number) => {
    const head = [...le32(0x7379_7346), 0, ...le32(0), 0x40, 0x00];
    const body = [...head, ...new Array(0x40 - 4 - head.length).fill(0)];
    const computed = crc32(body);
    const bytes = Uint8Array.from([...body, ...le32(storedCrc ?? computed)]);
    const node = makeNode({
      kind: "sysFStore",
      name: "Apple SysF store",
      header: r(0, 11),
      body: r(11, 0x40),
    });
    return { detail: detailOf(node, bytes), computed };
  };

  // A CRC32 over everything before the final four bytes.
  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIToolTests.swift#UEFIDetailTests.testASysfStoreChecksItsCrc
  it("checks a SysF store's CRC", () => {
    const { detail, computed } = sysfStore();
    expect(value(detail, "Kind")).toBe("SysF store");
    expect(value(detail, "CRC32")).toBe(
      checksumText({ value: computed, valid: true, expected: computed, digits: 8 })
    );
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIToolTests.swift#UEFIDetailTests.testASysfStoreFlagsABadCrc
  it("says what a wrong SysF CRC should be", () => {
    const { detail, computed } = sysfStore(0xdead_beef);
    expect(value(detail, "CRC32")).toBe(
      checksumText({ value: 0xdead_beef, valid: false, expected: computed, digits: 8 })
    );
  });

  // An entry of its own, whose checksum covers its 20-byte header.
  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIToolTests.swift#UEFIDetailTests.testAnEvsaStoreChecksItsHeaderChecksum
  it("checks an EVSA store's header checksum", () => {
    const header = [
      0xec,
      0,
      0x14,
      0x00,
      ...le32(0x4156_5345),
      ...le32(7),
      ...le32(0x30),
      0,
      0,
      0,
      0,
    ];
    header[1] = (0x100 - sum8(header.slice(2))) & 0xff;
    const bytes = padded(header, 0x30, 0xff);
    const node = makeNode({
      kind: "evsaStore",
      name: "Phoenix EVSA store",
      header: r(0, 20),
      body: r(20, 0x30),
    });
    const detail = detailOf(node, bytes);
    const stored = header[1] ?? 0;

    expect(value(detail, "Kind")).toBe("EVSA store");
    expect(value(detail, "Attributes")).toBe("0x7");
    expect(value(detail, "Reserved")).toBe("0x0");
    expect(value(detail, "Checksum")).toBe(
      checksumText({ value: stored, valid: true, expected: stored })
    );
  });

  // The two id words, and an attributes word whose extended-header bit has a word of its own.
  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIToolTests.swift#UEFIDetailTests.testAnEvsaDataVariableReadsItsIdsAttributesAndChecksum
  it("reads an EVSA data variable's ids, attributes and checksum", () => {
    const entry = [
      0xef,
      0,
      ...le16(17),
      ...le16(1),
      ...le16(2),
      ...le32(0x1000_0007),
      ...le32(1),
      0x01,
    ];
    entry[1] = (0x100 - sum8(entry.slice(2))) & 0xff;
    const node = makeNode({
      kind: "evsaEntry",
      subtype: Sub.dataEvsaEntry,
      name: "Lang",
      header: r(0, 16),
      body: r(16, 17),
    });
    const detail = detailOf(node, Uint8Array.from(entry));
    const stored = entry[1] ?? 0;

    expect(detail.title).toBe("Lang");
    expect(value(detail, "Kind")).toBe("EVSA entry");
    expect(value(detail, "VarId")).toBe("0x2");
    expect(value(detail, "GuidId")).toBe("0x1");
    expect(value(detail, "Attributes")).toBe(
      "0x10000007 (NonVolatile, BootService, Runtime, ExtendedHeader)"
    );
    expect(value(detail, "Checksum")).toBe(
      checksumText({ value: stored, valid: true, expected: stored })
    );
  });

  // The windows flag is shown as the word the parser accepts, never as byte soup.
  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIToolTests.swift#UEFIDetailTests.testAMarkerShowsItsOemAndWindowsFlag
  it("shows a SLIC marker's OEM ids and windows flag", () => {
    const bytes = Uint8Array.from([
      ...le32(1),
      ...le32(0xb6),
      ...le32(1),
      ...ascii("TESTCO"),
      ...ascii("TABLID01"),
      ...ascii("WINDOWS "),
      ...le32(1),
      ...new Array(16).fill(0),
      ...new Array(128).fill(0xee),
    ]);
    const node = makeNode({
      kind: "slicData",
      subtype: Sub.markerSlicData,
      name: "SLIC marker",
      header: r(0, bytes.length),
      body: r(bytes.length, bytes.length),
    });
    const detail = detailOf(node, bytes);

    expect(value(detail, "Kind")).toBe("SLIC data");
    expect(value(detail, "Version")).toBe("0x1");
    expect(value(detail, "OEM ID")).toBe("TESTCO");
    expect(value(detail, "OEM table ID")).toBe("TABLID01");
    expect(value(detail, "Windows flag")).toBe("WINDOWS");
    expect(value(detail, "SLIC version")).toBe("0x1");
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIToolTests.swift#UEFIDetailTests.testAFirehoseFlashMapReadsItsCountAndReserved
  it("reads a flash map's count and reserved word", () => {
    const bytes = Uint8Array.from([...ascii("_FLASH_MAP"), ...le16(3), ...le32(0)]);
    const node = makeNode({
      kind: "flashMapStore",
      name: "Phoenix SCT flash map",
      header: r(0, 16),
      body: r(16, 16),
    });
    const detail = detailOf(node, bytes);

    expect(value(detail, "Kind")).toBe("FlashMap store");
    expect(value(detail, "Entries")).toBe("3");
    expect(value(detail, "Reserved")).toBe("0x0");
  });

  // The data and entry types first, then where the region lies.
  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIToolTests.swift#UEFIDetailTests.testAFlashMapEntryReadsItsRegionLayout
  it("reads a flash map entry's region layout", () => {
    const bytes = Uint8Array.from([
      ...guidBytesOf(vendor),
      ...le16(0),
      ...le16(1),
      ...le32(0xfff0_0000),
      ...le32(0),
      ...le32(0x1000),
      ...le32(0x40),
    ]);
    const node = makeNode({
      kind: "flashMapEntry",
      subtype: Sub.volumeFlashMapEntry,
      name: guidText(vendor),
      guid: vendor,
      header: r(0, 36),
      body: r(36, 36),
    });
    const detail = detailOf(node, bytes);

    expect(value(detail, "Kind")).toBe("FlashMap entry");
    expect(value(detail, "Data type")).toBe("0x0");
    expect(value(detail, "Entry type")).toBe("0x1");
    expect(value(detail, "Size")).toBe("0x1000 (4096)");
    expect(value(detail, "Offset")).toBe("0x40");
    expect(value(detail, "Physical address")).toBe("0xFFF00000");
  });
});
