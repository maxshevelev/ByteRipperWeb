import { describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import { ImageReader } from "@/firmware/imageReader";
import * as Test from "@/firmware/testing/testImage";
import { repairsForFile } from "@/firmware/uefi/checksumRepair";
import { DecompressedBuffers } from "@/firmware/uefi/decompressedBuffers";
import { VOLUME_TOP_FILE } from "@/firmware/uefi/knownGuids";
import { SpaceReaders } from "@/firmware/uefi/spaceReaders";
import { FILE_LZMA, fileBody, streamBytes } from "@/firmware/uefi/testing/compressedNodeFixtures";
import { UEFIImage } from "@/firmware/uefi/uefiImage";
import { makeNode, type UEFINode } from "@/firmware/uefi/uefiNode";
import type { NodeDetail } from "@/tools/toolDetail";
import { buildNodeDetail } from "@/tools/uefi/uefiNodeDetail";
import { uefiZones, type ZonedNode } from "@/tools/uefi/uefiPresenter";

/**
 * A node inside a compressed section, as the panel shows it: drawn as the
 * section that holds it, read from the buffer, checked there, and never written.
 * Ported from upstream's `CompressedNodeTests`.
 *
 * Export and Open in a New Tab are upstream's too and are not here: taking a
 * decompressed part out as a document of its own is G4, and a second tab is not
 * something a web workspace has (D11).
 */

/**
 * The smallest image with a node inside a compressed section: an LZMA
 * compression section at offset 0, holding one FFS file header.
 *
 * @upstream Modules/UEFITool/Tests/UEFIToolTests/CompressedNodeTests.swift#CompressedNodeTests.built
 */
function built(): {
  bytes: Uint8Array;
  image: UEFIImage;
  section: UEFINode;
  inner: UEFINode;
  readers: SpaceReaders;
} {
  const stream = streamBytes(FILE_LZMA);
  const bytes = Test.compressionSection(0x02, stream, fileBody().length);

  const inner = makeNode({
    kind: "file",
    subtype: 0x07,
    name: "Inner",
    guid: VOLUME_TOP_FILE,
    header: { start: 0, end: 0x18 },
    body: { start: 0x18, end: fileBody().length },
    space: [0],
  });
  const section = makeNode({
    kind: "section",
    subtype: 0x01,
    name: "LZMA compressed section",
    header: { start: 0, end: 9 },
    body: { start: 9, end: bytes.length },
    children: [inner],
  });
  const image = new UEFIImage({
    size: bytes.length,
    roots: [section],
    addressDiff: 0xffff_0000,
  });
  return {
    bytes,
    image,
    section,
    inner,
    readers: new SpaceReaders(new ImageReader(sourceOver(bytes)), {
      buffers: new DecompressedBuffers(),
    }),
  };
}

const wire = (node: UEFINode): ZonedNode => ({
  id: node.id,
  name: node.name,
  header: [node.header.start, node.header.end] as const,
  body: [node.body.start, node.body.end] as const,
  tail: [node.tail.start, node.tail.end] as const,
  space: node.space,
  children: node.children.map(wire),
});

const value = (detail: NodeDetail, label: string) =>
  detail.fields.find((one) => one.label === label)?.value;

describe("zones", () => {
  // @upstream Modules/UEFITool/Tests/UEFIToolTests/CompressedNodeTests.swift#CompressedNodeTests.testANodeInsideIsDrawnAsTheSectionThatHoldsIt
  it("draws a node inside as the section that holds it", () => {
    const image = built();
    const zones = uefiZones(wire(image.inner), [wire(image.section)]);

    // Picking it in the dump brings back the section.
    expect(zones.zones.map((one) => one.id)).toEqual(["0", "0#body"]);
    expect(zones.zones.map((one) => [one.start, one.end])).toEqual([
      [image.section.header.start, image.section.body.end],
      [image.section.body.start, image.section.body.end],
    ]);
    expect(zones.zones[0]?.name).toBe("Inner (in LZMA compressed section)");
    expect(zones.focus).toBe("0#body");
  });

  /**
   * Without the tree there is no way to find the section, and buffer offsets are
   * never drawn over the file instead.
   *
   * @upstream Modules/UEFITool/Tests/UEFIToolTests/CompressedNodeTests.swift#CompressedNodeTests.testANodeInsideWithNoImagePublishesNothing
   */
  it("publishes nothing for a node inside with no tree to place it", () => {
    expect(uefiZones(wire(built().inner))).toEqual({ zones: [], focus: undefined });
  });
});

describe("the detail", () => {
  // @upstream Modules/UEFITool/Tests/UEFIToolTests/CompressedNodeTests.swift#CompressedNodeTests.testTheDetailReadsTheHeaderFromTheBufferAndSaysWhereFrom
  it("reads the header from the buffer and says where from", () => {
    const image = built();
    const reader = image.readers.readerFor(image.inner.space);
    expect(reader).toBeDefined();
    const detail = buildNodeDetail(image.inner, image.image, reader as ImageReader, []);

    expect(value(detail, "Decompressed from")).toBe("LZMA compressed section at 0x0");
    // Read from the buffer, not the file.
    expect(value(detail, "Size")).toBe(
      `0x${fileBody().length.toString(16).toUpperCase()} (${fileBody().length})`
    );
    // A compressed node's address means nothing.
    expect(value(detail, "Address")).toBeUndefined();
  });
});

describe("the checksums", () => {
  /**
   * A wrong checksum inside is found in the buffer, and its repair is an offset
   * into the buffer — which is what putting it back proves.
   *
   * @upstream Modules/UEFITool/Tests/UEFIToolTests/CompressedNodeTests.swift#CompressedNodeTests.testAWrongChecksumInsideIsFoundInTheBuffer
   */
  it("finds a wrong checksum inside in the buffer", () => {
    const image = built();
    const reader = image.readers.readerFor(image.inner.space) as ImageReader;
    const repairs = repairsForFile(image.inner, 2, reader);
    const fix = repairs[0];

    expect(fix).toBeDefined();
    // The header checksum's offset in the buffer.
    expect(fix?.offset).toBe(0x10);

    // Put back, the sum is right and nothing is left to repair.
    const fixed = Uint8Array.from(reader.bytes(reader.all) ?? []);
    fixed.set(fix?.bytes ?? new Uint8Array(0), fix?.offset ?? 0);
    expect(repairsForFile(image.inner, 2, new ImageReader(sourceOver(fixed)))).toEqual([]);
  });
});
