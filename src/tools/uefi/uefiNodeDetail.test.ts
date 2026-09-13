import { describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import { ImageReader } from "@/firmware/imageReader";
import * as Test from "@/firmware/testing/testImage";
import { guid, guidText } from "@/firmware/uefi/efiGuid";
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

  // The repair is the row's word on a wrong field, and its bytes are what the
  // field should read.
  it("marks a wrong checksum and says what it should be", () => {
    const detail = detailOf(volumeNode(), bytes, {
      repairs: [{ offset: 0x32, bytes: Uint8Array.of(0x78, 0x56) }],
    });

    expect(value(detail, "Checksum")).toBe("0x1234 (Invalid), should be 0x5678");
    expect(problem(detail, "Checksum")).toBe(true);
    expect(problem(detail, "Length")).toBe(false);
  });

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

  // A large file leaves the three-byte size at zero; the detail follows the
  // 64-bit one rather than showing nothing.
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

  it("keeps an unknown type's number", () => {
    const bytes = Test.file({ type: 0x7f, body: new Uint8Array(0xe8) });
    expect(value(detailOf(fileNode(0x7f), bytes), "Type")).toBe("File type 0x7F");
  });

  it("has no address inside a compressed section", () => {
    const bytes = Test.file({ body: new Uint8Array(0xe8) });
    const node = { ...fileNode(), isCompressed: true };
    expect(value(detailOf(node, bytes, { addressDiff: MAPPED }), "Address")).toBeUndefined();
  });

  it("has no address in an image with no address map", () => {
    const bytes = Test.file({ body: new Uint8Array(0xe8) });
    expect(value(detailOf(fileNode(), bytes), "Address")).toBeUndefined();
  });
});

describe("a section", () => {
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

  it("comes back validated", () => {
    const bytes = Test.microcode({ revision: 0xf0, signature: 0x0008_06ea, totalSize: 0x100 });
    const detail = detailOf(node, bytes);

    expect(value(detail, "Kind")).toBe("Microcode");
    expect(value(detail, "Header type")).toBe("0x1");
    expect(value(detail, "Update revision")).toBe("0xF0");
    expect(value(detail, "Date")).toBe("2019-07-15");
    expect(value(detail, "Processor signature")).toBe("0x806EA");
    expect(value(detail, "Loader revision")).toBe("0x1");
    expect(value(detail, "Platform IDs")).toBe("0x1");
    expect(value(detail, "Data size")).toBe("0x40 (64)");
    expect(value(detail, "Total size")).toBe("0x100 (256)");
  });

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

  it("shows the reserved vector as bytes", () => {
    expect(value(detail, "Reserved vector")).toBe(
      "11 00 00 9C 90 02 00 D6 00 00 00 05 FF FF FF FF"
    );
  });

  it("gives each declared region's offset a row, its own excluded", () => {
    expect(value(detail, "ME region offset")).toBe("0x1000");
    expect(value(detail, "BIOS region offset")).toBe("0x600000");
    expect(value(detail, "Descriptor region offset")).toBeUndefined();
    expect(value(detail, "GbE region offset")).toBeUndefined();
  });

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
  it("draws the BIOS access table as a grid of coloured permissions", () => {
    const access = table(detail, "BIOS access table");
    expect(access?.symbol).toBe("lock.shield");
    expect(access?.columns).toEqual(["Region", "Read", "Write"]);
    expect(access?.rows.map((row) => row[0]?.text)).toEqual(["Desc", "BIOS", "ME", "GbE", "PDR"]);
    expect(access?.rows.map((row) => row[1]?.text)).toEqual(["No", "Yes", "No", "No", "No"]);
    expect(access?.rows.map((row) => row[1]?.tone)).toEqual(["no", "yes", "no", "no", "no"]);
  });

  it("draws the VSCC table as a grid of chips", () => {
    const vscc = table(detail, "Flash chips in VSCC table");
    expect(vscc?.symbol).toBe("cpu");
    expect(vscc?.columns).toEqual(["JEDEC ID", "Chip"]);
    expect(vscc?.rows.map((row) => row[0]?.text)).toEqual(["1F4700", "C22019"]);
    expect(vscc?.rows.map((row) => row[1]?.text)).toEqual(
      chips.map((id) => jedecName(id) ?? "Unknown")
    );
  });

  it("is the only node that carries the descriptor block", () => {
    const volume = detailOf(volumeNode(), Test.volume({ length: 0x1000 }));
    expect(volume.tables).toEqual([]);
    expect(value(volume, "Reserved vector")).toBeUndefined();
  });
});
