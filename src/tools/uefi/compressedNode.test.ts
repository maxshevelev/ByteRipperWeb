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
import {
  type CompressedSectionNode,
  decompressedExport,
  partName,
  uefiZones,
  type ZonedNode,
} from "@/tools/uefi/uefiPresenter";

/**
 * A node inside a compressed section, as the panel shows it: drawn as the
 * section that holds it, read from the buffer, checked there, never written —
 * and taken out, as a file or as a part of its own. Ported from upstream's
 * `CompressedNodeTests`.
 *
 * What a part is *linked* to is not here: the parent, the range it came out of
 * and Update in Parent are G4. Opening any node of the tree rather than only
 * what a section decompresses to is `nodeOpen`, whose own cases are in
 * `nodeOpen.test.ts`.
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

const wire = (node: UEFINode): ZonedNode & CompressedSectionNode => ({
  id: node.id,
  kind: node.kind,
  name: node.name,
  header: [node.header.start, node.header.end] as const,
  body: [node.body.start, node.body.end] as const,
  tail: [node.tail.start, node.tail.end] as const,
  space: node.space,
  compression: node.compression,
  isExpandable: node.isExpandable,
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

describe("what a node has decompressed", () => {
  /**
   * @upstream Modules/UEFITool/Tests/UEFIToolTests/CompressedNodeTests.swift#CompressedNodeTests.testAnOpenedSectionExportsItsWholeBufferAndANodeInsideItsOwnBytes
   */
  it("is the whole buffer for an opened section, and its own bytes for a node inside", () => {
    const image = built();

    const body = decompressedExport(wire(image.section));
    expect(body?.space).toEqual([0]);
    expect(body?.range).toBeUndefined();
    expect(body?.menuTitle).toBe("Export Decompressed Body…");
    expect(body?.openTitle).toBe("Open Decompressed Body");
    expect(body?.suggestedName).toBe("LZMA compressed section decompressed.bin");
    // And that space really is the decompressed body.
    const buffer = image.readers.readerFor(body?.space ?? []);
    expect(Array.from(buffer?.bytes(buffer.all) ?? [])).toEqual(Array.from(fileBody()));

    const bytes = decompressedExport(wire(image.inner));
    expect(bytes?.space).toEqual(image.inner.space);
    expect(bytes?.range).toEqual([0, fileBody().length]);
    expect(bytes?.menuTitle).toBe("Export Decompressed Bytes…");
    expect(bytes?.openTitle).toBe("Open Decompressed Bytes");
    expect(bytes?.suggestedName).toBe("Inner decompressed.bin");
    // Named after the dump it came out of, then what it is.
    expect(bytes === undefined ? undefined : partName(bytes.suggestedName, "bios.rom")).toBe(
      "bios_Inner decompressed.bin"
    );
    expect(bytes === undefined ? undefined : partName(bytes.suggestedName, "")).toBe(
      "Inner decompressed.bin"
    );
  });

  it("is nothing for a node of the file, whose bytes the dump already exports", () => {
    const plain = {
      kind: "file",
      name: "Driver",
      header: [0, 0x18] as const,
      body: [0x18, 0x40] as const,
      tail: [0x40, 0x40] as const,
      space: [],
      isExpandable: false,
      children: [],
    };

    expect(decompressedExport(plain)).toBeUndefined();
  });

  /**
   * The row says it is compressed before it is opened, so the export is offered
   * then — and reading it decodes the body.
   *
   * @upstream Modules/UEFITool/Tests/UEFIToolTests/CompressedNodeTests.swift#CompressedNodeTests.testAClosedCompressedSectionExportsItsBodyDecodedOnDemand
   */
  it("is offered by a section still closed, and by neither kind that cannot open", () => {
    const image = built();
    const closed = {
      ...wire(image.section),
      children: [],
      isExpandable: true,
      compression: { algorithm: "LZMA", decodes: true },
    };

    const body = decompressedExport(closed);
    expect(body?.space).toEqual([0]);
    expect(body?.range).toBeUndefined();
    expect(body?.openTitle).toBe("Open Decompressed Body");

    // A section the decoder cannot read has nothing to save.
    expect(
      decompressedExport({
        ...closed,
        compression: { algorithm: "Unknown", decodes: false },
        isExpandable: false,
      })
    ).toBeUndefined();
    // And one that was opened and did not decompress offers nothing either.
    expect(decompressedExport({ ...closed, isExpandable: false })).toBeUndefined();
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
