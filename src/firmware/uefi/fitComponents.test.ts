import { describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import { ImageReader } from "@/firmware/imageReader";
import { BinaryWriter, file, volume, volumeTopFile } from "@/firmware/testing/testImage";
import { type EFIGUID, GUID_ZERO } from "@/firmware/uefi/efiGuid";
import { FFS } from "@/firmware/uefi/fileParser";
import {
  acmSubtypeName,
  type FITComponentKind,
  lengthOf,
  readFITComponentHeader,
} from "@/firmware/uefi/fitComponents";
import { itemType } from "@/firmware/uefi/itemClassification";
import { TCGHash } from "@/firmware/uefi/tcgHash";
import { parseUefiImage } from "@/firmware/uefi/uefiImage";
import { nodeRange, type UEFINode } from "@/firmware/uefi/uefiNode";
import { ItemType } from "@/firmware/uefi/uefiTypes";

/**
 * Ported from `FITComponentTests.swift`: the structures the FIT names, read out of
 * the padding a vendor keeps them in (`UEFI_IMAGE_FORMAT.md` §9): the table, the
 * Startup ACM, the Boot Guard manifests — each where the FIT says, as long as its
 * own header says.
 */

const SIZE = 0x1_0000;
const ascii = (text: string) => [...text].map((character) => character.charCodeAt(0));
const FIT_SIGNATURE_LOW = 0x5449_465f;
const FIT_SIGNATURE_HIGH = 0x2020_205f;

/** `KEY_AND_SIGNATURE` with an RSA-2048 key and signature. */
const keySignature = (): Uint8Array =>
  new BinaryWriter()
    .u8(0x10) // Version
    .u16(0x0001) // KeyAlg
    .u8(0x10) // Key: version
    .u16(2048) //      size in bits
    .u32(0x1_0001) //  exponent
    .fill(256, 0xa5) // modulus
    .u16(0x0014) // SigScheme
    .u8(0x10) // Signature: version
    .u16(2048) //            size in bits
    .u16(TCGHash.sha256) //  hash algorithm
    .fill(256, 0x5a).bytes; //  signature

const join = (...parts: readonly Uint8Array[]): Uint8Array =>
  Uint8Array.from(parts.flatMap((part) => [...part]));

const keyManifestV2 = (): Uint8Array =>
  join(
    new BinaryWriter()
      .raw(ascii("__KEYM__"))
      .u8(0x21) // StructVersion
      .u8(0) // HeaderSpecific
      .u16(0) // TotalSize
      .u16(0x44) // KeySignatureOffset
      .fill(3, 0) // Reserved
      .u8(1) // KmVersion
      .u8(2) // KmSvn
      .u8(3) // KmId
      .u16(TCGHash.sha256) // FpfHashAlgId
      .u16(1) // KeyCount
      .u32(1)
      .u32(0) //   Usage
      .u16(TCGHash.sha256) //   HashAlg
      .u16(32) //   Size
      .fill(32, 0x11).bytes, //   Hash
    keySignature()
  );

const keyManifestV1 = (): Uint8Array =>
  join(
    new BinaryWriter()
      .raw(ascii("__KEYM__"))
      .u8(0x10) // Version
      .u8(0x10) // KmVersion
      .u8(0) // KmSvn
      .u8(1) // KmId
      .u16(TCGHash.sha256)
      .u16(32)
      .fill(32, 0x22).bytes,
    keySignature()
  );

const bootPolicyV2 = (): Uint8Array =>
  join(
    new BinaryWriter()
      .raw(ascii("__ACBP__"))
      .u8(0x21) // StructVersion
      .u8(0x20) // HdrStructVersion
      .u16(0x14) // HdrSize
      .u16(0x14 + 0x10 + 0x0c) // KeySignatureOffset
      .u8(1) // BpmRevision
      .u8(4) // BpSvn
      .u8(5) // AcmSvn
      .u8(0)
      .u16(3) // NemDataSize
      .raw(ascii("__TXTS__")) // stepped over by its size
      .u8(0x21)
      .u8(0)
      .u16(0x10)
      .fill(4, 0)
      .raw(ascii("__PMSG__"))
      .u8(0x21)
      .u8(0)
      .u16(0).bytes,
    keySignature()
  );

const bootPolicyV1 = (): Uint8Array =>
  join(
    new BinaryWriter()
      .raw(ascii("__ACBP__"))
      .u8(0x10) // Version
      .u8(0x01)
      .u8(0x10) // BpmRevision
      .u8(0) // BpSvn
      .u8(2) // AcmSvn
      .u8(0)
      .u16(0x80) // NemDataSize
      .raw(ascii("__IBBS__")) // one segment
      .u8(0x10)
      .fill(0x7b, 0)
      .u8(1)
      .fill(4, 0)
      .u32(0xffff_f000)
      .u32(0x1000)
      .raw(ascii("__PMDA__")) // one version-1 entry
      .u8(0x10)
      .u16(0x32)
      .u32(1)
      .u32(1)
      .fill(0x28, 0)
      .raw(ascii("__PMSG__"))
      .u8(0x10).bytes,
    keySignature()
  );

const startupACM = (): Uint8Array =>
  new BinaryWriter()
    .u16(0x0002) // module type
    .u16(1) // ModuleSubType: Startup
    .u32(0xe0) // HeaderLen
    .u32(0x3_0000) // HeaderVersion
    .u16(0xb00c) // ChipsetID
    .u16(0)
    .u32(0x8086) // Intel
    .raw([0x27, 0x04, 0x23, 0x20]) // Date, BCD
    .u32(0x400) // Size, in dwords
    .u16(3) // AcmSvn
    .fill(0x1000 - 0x1e, 0x3c).bytes;

interface Placed {
  readonly type: number;
  readonly offset: number;
  readonly bytes: Uint8Array;
}

/**
 * A 64 KiB block for an image `imageSize` bytes long whose last block it is: the FIT
 * at `0x1000` and what it names in the padding after it, and a volume ending in the
 * Volume Top File, with the FIT pointer, in its last 4 KiB.
 */
function block(
  options: { readonly imageSize?: number; readonly placed?: readonly Placed[] } = {}
): Uint8Array {
  const imageSize = options.imageSize ?? SIZE;
  const placed = options.placed ?? [
    { type: 0x0b, offset: 0x2000, bytes: keyManifestV2() },
    { type: 0x0c, offset: 0x3000, bytes: bootPolicyV2() },
    { type: 0x02, offset: 0x4000, bytes: startupACM() },
  ];
  const addressDiff = 0x1_0000_0000 - imageSize;
  const blockStart = imageSize - SIZE;
  const bytes = new Uint8Array(SIZE).fill(0xff);
  const table = new BinaryWriter()
    .u32(FIT_SIGNATURE_LOW)
    .u32(FIT_SIGNATURE_HIGH)
    .u24(placed.length + 1)
    .u8(0)
    .u16(0x0100)
    .u8(0)
    .u8(0);
  for (const item of placed) {
    bytes.set(item.bytes, item.offset);
    table
      .u64(blockStart + item.offset + addressDiff)
      .u24(0)
      .u8(0)
      .u16(0x0100)
      .u8(item.type)
      .u8(0);
  }
  bytes.set(table.bytes, 0x1000);
  bytes.set(volume({ length: 0x1000, lastFile: volumeTopFile() }), 0xf000);
  bytes.set(new BinaryWriter().u32(blockStart + 0x1000 + addressDiff).bytes, SIZE - 0x40);
  return bytes;
}

const parse = (bytes: Uint8Array) =>
  parseUefiImage(sourceOver(bytes), { readsProtectedRanges: false });
const components = (nodes: readonly UEFINode[]) =>
  nodes.filter((node) => node.kind === "fitComponent");

describe("the structures the FIT names", () => {
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/FITComponentTests.swift#FITComponentTests.testWhatTheFITNamesIsCutOutOfThePadding
  it("cuts what the FIT names out of the padding", () => {
    const parsed = parse(block());
    const nodes = (parsed.roots[0] as UEFINode).children;
    const found = components(nodes);

    expect(found.map((node) => node.name)).toEqual([
      "FIT",
      "Boot Guard Key Manifest",
      "Boot Guard Boot Policy",
      "Startup ACM",
    ]);
    expect(found.map((node) => node.subtype)).toEqual([0x00, 0x0b, 0x0c, 0x02]);
    expect(found.map((node) => nodeRange(node))).toEqual([
      { start: 0x1000, end: 0x1040 },
      { start: 0x2000, end: 0x2000 + keyManifestV2().length },
      { start: 0x3000, end: 0x3000 + bootPolicyV2().length },
      { start: 0x4000, end: 0x5000 },
    ]);
    expect(found.every((node) => node.isFixed)).toBe(true);
    expect(itemType(found[0] as UEFINode)).toBe(ItemType.padding);

    const first = nodes.findIndex((node) => node.kind === "fitComponent");
    expect(nodeRange(nodes[first - 1] as UEFINode)).toEqual({ start: 0, end: 0x1000 });
    expect(nodeRange(nodes[first + 1] as UEFINode)).toEqual({ start: 0x1040, end: 0x2000 });
    expect(nodes[first + 1]?.kind).toBe("padding");
    expect(parsed.diagnostics).toEqual([]);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/FITComponentTests.swift#FITComponentTests.testAManifestIsAsLongAsItsHeaderSays
  it("makes a manifest as long as its header says", () => {
    const parts: readonly (readonly [FITComponentKind, Uint8Array])[] = [
      ["keyManifest", keyManifestV1()],
      ["bootPolicy", bootPolicyV1()],
      ["keyManifest", keyManifestV2()],
      ["bootPolicy", bootPolicyV2()],
    ];
    const reader = new ImageReader(sourceOver(join(...parts.map(([, manifest]) => manifest))));
    let at = 0;
    for (const [kind, manifest] of parts) {
      expect(lengthOf(kind, at, reader)).toBe(manifest.length);
      at += manifest.length;
    }
  });

  // The FIT is a pointer, not a promise: what it names has to be there.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/FITComponentTests.swift#FITComponentTests.testAnAddressHoldingSomethingElseStaysPadding
  it("leaves an address holding something else as padding", () => {
    const acm = startupACM();
    acm[0x10] = 0; // not Intel's
    const parsed = parse(
      block({
        placed: [
          { type: 0x0b, offset: 0x2000, bytes: keyManifestV2() },
          { type: 0x02, offset: 0x4000, bytes: acm },
        ],
      })
    );
    expect(components((parsed.roots[0] as UEFINode).children).map((node) => node.name)).toEqual([
      "FIT",
      "Boot Guard Key Manifest",
    ]);
  });

  // With bytes after the Volume Top File the parser cannot map the FIT's addresses
  // before its second pass, and leaves the padding alone.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/FITComponentTests.swift#FITComponentTests.testAnImageThatDoesNotEndWithItsVolumeTopFileKeepsItsPadding
  it("keeps the padding of an image that does not end with its Volume Top File", () => {
    const bytes = join(block(), new Uint8Array(0x110).fill(0xff));
    expect(components(parse(bytes).allNodes)).toEqual([]);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/FITComponentTests.swift#FITComponentTests.testTheTopSwapCopyHasItsOwnRows
  it("gives the Top Swap copy rows of its own", () => {
    const bytes = join(block({ imageSize: 2 * SIZE }), block({ imageSize: 2 * SIZE }));
    const found = components(parse(bytes).allNodes);
    expect(found.map((node) => nodeRange(node).start)).toEqual([
      0x1000, 0x2000, 0x3000, 0x4000, 0x1_1000, 0x1_2000, 0x1_3000, 0x1_4000,
    ]);
  });

  // A pad file whose body is a manifest keeps the row UEFITool shows, and its
  // warning; the manifest is a row inside it.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/FITComponentTests.swift#FITComponentTests.testAManifestInAPadFileIsARowOfItsNonUEFIData
  it("makes a manifest in a pad file a row of its non-UEFI data", () => {
    const pad = file({
      guid: GUID_ZERO as EFIGUID,
      type: FFS.padType,
      body: join(keyManifestV2(), new Uint8Array(0x100).fill(0xff)),
    });
    const bytes = block({ placed: [] });
    bytes.set(volume({ length: 0x1000, files: [pad], lastFile: volumeTopFile() }), 0xf000);
    const body = parse(bytes).allNodes.find(
      (node) => node.kind === "file" && node.subtype === FFS.padType
    )?.body.start as number;
    // The FIT, one row pointing at the pad file's body.
    const table = new BinaryWriter()
      .u32(FIT_SIGNATURE_LOW)
      .u32(FIT_SIGNATURE_HIGH)
      .u24(2)
      .u8(0)
      .u16(0x0100)
      .u8(0)
      .u8(0)
      .u64(body + 0xffff_0000)
      .u24(0)
      .u8(0)
      .u16(0x0100)
      .u8(0x0b)
      .u8(0).bytes;
    bytes.set(table, 0x1000);
    bytes.set(new BinaryWriter().u32(0xffff_1000).bytes, 0xffc0);

    const parsed = parse(bytes);
    const data = parsed.allNodes.find(
      (node) => node.kind === "padding" && node.name === "Non-UEFI data"
    ) as UEFINode;
    expect(data.children.map((node) => node.kind)).toEqual(["fitComponent", "padding"]);
    expect(nodeRange(data.children[0] as UEFINode)).toEqual({
      start: body,
      end: body + keyManifestV2().length,
    });
    expect(nodeRange(data.children[data.children.length - 1] as UEFINode).end).toBe(
      nodeRange(data).end
    );
    expect(parsed.diagnostics.some((one) => one.detail.kind === "nonUEFIDataInPadFile")).toBe(true);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/FITComponentTests.swift#FITComponentTests.testTheHeadersSayWhatUEFIToolShows
  it("reads the headers as UEFITool shows them", () => {
    const reader = new ImageReader(sourceOver(join(startupACM(), keyManifestV2(), bootPolicyV1())));
    expect(readFITComponentHeader("startupACM", 0, reader)).toEqual({
      kind: "acm",
      subtype: 1,
      headerVersion: 0x3_0000,
      chipsetID: 0xb00c,
      date: "2023-04-27",
      svn: 3,
    });
    expect(readFITComponentHeader("keyManifest", 0x1000, reader)).toEqual({
      kind: "keyManifest",
      version: 0x21,
      kmVersion: 1,
      svn: 2,
      id: 3,
    });
    expect(readFITComponentHeader("bootPolicy", 0x1000 + keyManifestV2().length, reader)).toEqual({
      kind: "bootPolicy",
      version: 0x10,
      revision: 0x10,
      svn: 0,
      acmSVN: 2,
    });
    expect(acmSubtypeName(1)).toBe("Startup");
  });
});
