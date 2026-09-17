import { describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import { ImageReader } from "@/firmware/imageReader";
import * as Test from "@/firmware/testing/testImage";
import { insideSection } from "@/firmware/uefi/byteSpace";
import { chooseTiano } from "@/firmware/uefi/compressedSection";
import { DecompressedBuffers } from "@/firmware/uefi/decompressedBuffers";
import { diagnosticMessage, type UEFIDiagnostic } from "@/firmware/uefi/diagnostic";
import { guid } from "@/firmware/uefi/efiGuid";
import { DEFAULT_LIMITS, type Limits } from "@/firmware/uefi/parserState";
import {
  DRIVER_EFI11,
  DRIVER_LZMA,
  DRIVER_LZMA_X86,
  DRIVER_TIANO,
  driverBody,
  NESTED_OUTER_LZMA,
  sectionsBody,
  streamBytes,
  UNKNOWN_LZMA,
  unknownTypeBody,
} from "@/firmware/uefi/testing/compressedFixtures";
import { parseUefiImage, type UEFIImage } from "@/firmware/uefi/uefiImage";
import type { UEFINode } from "@/firmware/uefi/uefiNode";

/**
 * Compressed sections opened: decoded, walked as sections, every node inside in
 * a space of its own. Ported from upstream's `CompressedSectionTests`, over
 * streams encoded once rather than in the test.
 */

const LZMA_GUID = guid("EE4E5898-3914-4259-9D6E-DC7BD79403CF");
const LZMA_X86_GUID = guid("D42AE6BD-1352-4BFB-909A-CA72A6EAE889");
const TIANO_GUID = guid("A31280AD-481E-41B6-95E8-127F4C984779");

const driver = () => driverBody();

/** An LZMA compression section over the driver, as EDK2 lays one out. */
const lzmaSection = (): Uint8Array =>
  Test.compressionSection(0x02, streamBytes(DRIVER_LZMA), driver().length);

function parsed(sections: readonly Uint8Array[], limits: Limits = DEFAULT_LIMITS): UEFIImage {
  const bytes = Test.volume({
    length: 0x2000,
    files: [Test.sectionedFile({ sections: [...sections] })],
  });
  return parseUefiImage(sourceOver(bytes), { limits });
}

/** The first section of the volume's first file. */
const sectionIn = (image: UEFIImage): UEFINode =>
  image.roots[0]?.children[0]?.children[0] as UEFINode;

const names = (nodes: readonly UEFINode[]) => nodes.map((node) => node.name);

describe("opening a compressed section", () => {
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/CompressedSectionTests.swift#CompressedSectionTests.testAnLZMACompressionSectionOpensIntoTheSectionsItHolds
  it("opens an LZMA compression section into the sections it holds", () => {
    const image = parsed([lzmaSection()]);
    const section = sectionIn(image);
    const inside = insideSection([], section.header.start);

    expect(section.name).toBe("LZMA compressed section");
    // The section's own bytes are the file's.
    expect(section.space).toEqual([]);
    // A full parse opened it.
    expect(section.isExpandable).toBe(false);
    expect(names(section.children)).toEqual(["InnerDriver", "PE32 image"]);
    expect(section.children.map((node) => node.space)).toEqual([inside, inside]);
    // Offsets start again at the beginning of the buffer.
    expect(section.children[0]?.header.start).toBe(0);
    expect(image.diagnostics.map(diagnosticMessage)).toEqual([]);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/CompressedSectionTests.swift#CompressedSectionTests.testAnLZMAGuidDefinedSectionOpensLikeACompressionSection
  it("opens an LZMA GUID-defined section like a compression section", () => {
    const image = parsed([
      Test.guidedSectionBytes({
        guid: LZMA_GUID,
        body: streamBytes(DRIVER_LZMA),
        attributes: 0x01,
      }),
    ]);

    expect(names(sectionIn(image).children)).toEqual(["InnerDriver", "PE32 image"]);
    expect(image.diagnostics.map(diagnosticMessage)).toEqual([]);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/CompressedSectionTests.swift#CompressedSectionTests.testAnLZMAWithX86FilterSectionOpens
  it("opens an LZMA section with the x86 filter", () => {
    const image = parsed([
      Test.guidedSectionBytes({
        guid: LZMA_X86_GUID,
        body: streamBytes(DRIVER_LZMA_X86),
        attributes: 0x01,
      }),
    ]);

    expect(names(sectionIn(image).children)).toEqual(["InnerDriver", "PE32 image"]);
    expect(image.diagnostics.map(diagnosticMessage)).toEqual([]);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/CompressedSectionTests.swift#CompressedSectionTests.testATianoCompressionSectionOpens
  it("opens a Tiano compression section", () => {
    const image = parsed([
      Test.compressionSection(0x01, streamBytes(DRIVER_TIANO), driver().length),
    ]);

    expect(sectionIn(image).name).toBe("Tiano compressed section");
    expect(names(sectionIn(image).children)).toEqual(["InnerDriver", "PE32 image"]);
    expect(image.diagnostics.map(diagnosticMessage)).toEqual([]);
  });

  /**
   * The same compression type holds EFI 1.1, which only decoding tells.
   *
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/CompressedSectionTests.swift#CompressedSectionTests.testAnEFI11CompressionSectionOpens
   */
  it("opens an EFI 1.1 compression section", () => {
    const image = parsed([
      Test.compressionSection(0x01, streamBytes(DRIVER_EFI11), driver().length),
    ]);

    expect(names(sectionIn(image).children)).toEqual(["InnerDriver", "PE32 image"]);
    expect(image.diagnostics.map(diagnosticMessage)).toEqual([]);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/CompressedSectionTests.swift#CompressedSectionTests.testATianoGuidDefinedSectionOpens
  it("opens a Tiano GUID-defined section", () => {
    const image = parsed([
      Test.guidedSectionBytes({
        guid: TIANO_GUID,
        body: streamBytes(DRIVER_TIANO),
        attributes: 0x01,
      }),
    ]);

    expect(names(sectionIn(image).children)).toEqual(["InnerDriver", "PE32 image"]);
    expect(image.diagnostics.map(diagnosticMessage)).toEqual([]);
  });

  /**
   * A compressed section inside a volume inside a compressed section: the inner
   * one's children name both sections on the way in.
   *
   * The nesting is built from a stream encoded over the outer body, so the fixture
   * here is the whole outer buffer rather than the driver's.
   *
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/CompressedSectionTests.swift#CompressedSectionTests.testANestedCompressedSectionNamesBothSectionsInItsSpace
   */
  it("names both sections in a nested section's space", () => {
    const innerVolume = Test.volume({
      length: 0x800,
      files: [Test.sectionedFile({ sections: [lzmaSection()] })],
    });
    const volumeImage = Test.section({ type: 0x17, body: innerVolume });
    const outerBody = sectionsBody([volumeImage]);
    const image = parsed([
      Test.compressionSection(0x02, streamBytes(NESTED_OUTER_LZMA), outerBody.length),
    ]);

    const outer = sectionIn(image);
    const outerSpace = insideSection([], outer.header.start);
    const volume = outer.children[0]?.children[0] as UEFINode;
    expect(volume.kind).toBe("volume");
    expect(volume.space).toEqual(outerSpace);

    const inner = volume.children[0]?.children[0] as UEFINode;
    expect(inner.space).toEqual(outerSpace);
    expect(names(inner.children)).toEqual(["InnerDriver", "PE32 image"]);
    expect(inner.children[0]?.space).toEqual(insideSection(outerSpace, inner.header.start));
    expect(image.diagnostics.map(diagnosticMessage)).toEqual([]);
  });
});

/**
 * Both readings decoding is the case only the bytes settle: the one that walks
 * as sections wins, and Tiano when both — or neither — do.
 */
describe("choosing between Tiano and EFI 1.1", () => {
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/CompressedSectionTests.swift#CompressedSectionTests.testWhenBothReadingsDecodeTheOneThatReadsAsSectionsIsKept
  it("keeps the reading that reads as sections", () => {
    const noise = new Uint8Array(40).fill(0xab);
    const body = driver();

    const efi11Wins = chooseTiano({ tiano: noise, efi11: body });
    expect(efi11Wins.variant).toBe("EFI 1.1");
    expect([...efi11Wins.bytes]).toEqual([...body]);

    expect(chooseTiano({ tiano: body, efi11: body }).variant).toBe("Tiano");
    expect(chooseTiano({ tiano: noise, efi11: noise }).variant).toBe("Tiano");
    expect(chooseTiano({ tiano: undefined, efi11: noise }).variant).toBe("EFI 1.1");
  });
});

/**
 * A compressed section says what it is compressed with, and whether it opens
 * here — what a panel marks it by — decoded or not.
 */
describe("what a compressed section says about itself", () => {
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/CompressedSectionTests.swift#CompressedSectionTests.testACompressedSectionSaysItsAlgorithmAndWhetherItOpens
  it("says its algorithm and whether it opens", () => {
    const lzma = sectionIn(parsed([lzmaSection()]));
    expect(lzma.compression).toEqual({ algorithm: "LZMA", decodes: true });

    const brotli = sectionIn(
      parsed([
        Test.guidedSectionBytes({
          guid: guid("3D532050-5CDA-4FD0-879E-0F7F630D5AFB"),
          body: new Uint8Array(16).fill(0x11),
        }),
      ])
    );
    expect(brotli.compression).toEqual({ algorithm: "Brotli", decodes: false });

    const crc32 = sectionIn(
      parsed([
        Test.guidedSectionBytes({
          guid: guid("FC1BCDB0-7D31-49AA-936A-A4600D9DD083"),
          body: driver(),
        }),
      ])
    );
    // A CRC32 section checks its body and does not compress it.
    expect(crc32.compression).toBeUndefined();
  });
});

describe("what goes wrong", () => {
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/CompressedSectionTests.swift#CompressedSectionTests.testADataThatDoesNotDecodeStaysALeafAndSaysWhy
  it("keeps data that does not decode a leaf, and says why", () => {
    const garbage = new Uint8Array([
      0x5d,
      0x00,
      0x00,
      0x01,
      0x00,
      0x28,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      ...new Uint8Array(40).fill(0xa5),
    ]);
    const image = parsed([Test.compressionSection(0x02, garbage, 0x28)]);
    const section = sectionIn(image);

    expect(section.children).toEqual([]);
    expect(section.isExpandable).toBe(false);
    expect(image.diagnostics.map((one) => one.offset)).toEqual([section.header.start]);
    const detail = image.diagnostics[0]?.detail;
    expect(detail?.kind).toBe("decompressionFailed");
    expect(detail?.kind === "decompressionFailed" ? detail.algorithm : undefined).toBe("LZMA");
  });

  /**
   * The size is a number in an untrusted header: over the limit, the section is
   * reported and nothing is allocated for it.
   *
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/CompressedSectionTests.swift#CompressedSectionTests.testASectionClaimingMoreThanTheLimitStaysALeaf
   */
  it("keeps a section claiming more than the limit a leaf", () => {
    const image = parsed([lzmaSection()], { ...DEFAULT_LIMITS, maxDecompressedSize: 16 });

    expect(sectionIn(image).children).toEqual([]);
    expect(image.diagnostics.map((one) => one.detail)).toEqual([
      { kind: "decompressedTooLarge", algorithm: "LZMA", declared: driver().length },
    ]);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/CompressedSectionTests.swift#CompressedSectionTests.testAnUncompressedLengthThatIsNotWhatCameOutIsReported
  it("reports an uncompressed length that is not what came out", () => {
    const image = parsed([
      Test.compressionSection(0x02, streamBytes(DRIVER_LZMA), driver().length + 4),
    ]);

    // It still opens.
    expect(sectionIn(image).children.length).toBe(2);
    expect(image.diagnostics.map((one) => one.detail)).toEqual([
      {
        kind: "decompressedSizeMismatch",
        stored: driver().length + 4,
        computed: driver().length,
      },
    ]);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/CompressedSectionTests.swift#CompressedSectionTests.testACompressedGuidDefinedSectionWithoutProcessingRequiredIsReported
  it("reports a compressed GUID-defined section without PROCESSING_REQUIRED", () => {
    const image = parsed([
      Test.guidedSectionBytes({ guid: LZMA_GUID, body: streamBytes(DRIVER_LZMA), attributes: 0 }),
    ]);
    const section = sectionIn(image);

    // And it is decoded all the same.
    expect(section.children.length).toBe(2);
    expect(image.diagnostics).toEqual([
      { detail: { kind: "processingRequiredNotSet" }, offset: section.header.start },
    ]);
  });

  /**
   * Trouble inside a buffer is located at bytes of the file — the section that
   * holds it — with the offset inside kept.
   *
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/CompressedSectionTests.swift#CompressedSectionTests.testADiagnosticInsideIsLocatedAtTheCompressedSection
   */
  it("locates a diagnostic inside at the compressed section", () => {
    const inner = unknownTypeBody();
    const image = parsed([Test.compressionSection(0x02, streamBytes(UNKNOWN_LZMA), inner.length)]);
    const section = sectionIn(image);
    const diagnostic = image.diagnostics[0] as UEFIDiagnostic;

    expect(diagnostic.detail).toEqual({
      kind: "unknownType",
      structure: "sectionHeader",
      code: 0x1a,
    });
    expect(diagnostic.offset).toBe(section.header.start);
    expect(diagnostic.inside).toEqual({ space: [section.header.start], offset: 3 });
    expect(diagnosticMessage(diagnostic)).toContain("decompresses to");
  });
});

describe("lookups by file offset", () => {
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/CompressedSectionTests.swift#CompressedSectionTests.testALookupByFileOffsetEndsAtAnOpenedSection
  it("ends at an opened section", () => {
    const image = parsed([lzmaSection()]);
    const section = sectionIn(image);

    expect(image.innermostNodeContaining(section.body.start + 2)).toBe(section);
  });
});

describe("the buffers", () => {
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/CompressedSectionTests.swift#CompressedSectionTests.testABufferIsDecodedOnceAndDroppedOnlyByAnEditOverItsSection
  it("decodes once, and drops only for an edit over its section", () => {
    const compressed = lzmaSection();
    const bytes = new Uint8Array(0x20 + compressed.length);
    bytes.fill(0xff, 0, 0x20);
    bytes.set(compressed, 0x20);
    const file = new ImageReader(sourceOver(bytes));
    const buffers = new DecompressedBuffers();

    const read = buffers.readerFor([0x20], file, 1 << 20);
    expect(read.ok).toBe(true);
    if (read.ok) expect([...(read.reader.bytes(read.reader.all) ?? [])]).toEqual([...driver()]);
    expect(buffers.count).toBe(1);

    buffers.dropOverlapping({ start: 0, end: 0x10 });
    // An edit before the section leaves it.
    expect(buffers.count).toBe(1);
    buffers.dropOverlapping({ start: 0x30, end: 0x31 });
    // An edit inside it does not.
    expect(buffers.count).toBe(0);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/CompressedSectionTests.swift#CompressedSectionTests.testAnEvictedBufferIsDecodedAgainFromTheFile
  it("decodes an evicted buffer again from the file", () => {
    const one = lzmaSection();
    const bytes = new Uint8Array(one.length * 2 + 4);
    bytes.set(one);
    bytes.fill(0xff, one.length, one.length + 4);
    bytes.set(one, one.length + 4);
    const file = new ImageReader(sourceOver(bytes));
    const second = one.length + 4;
    const buffers = new DecompressedBuffers(driver().length);

    expect(buffers.readerFor([0], file, 1 << 20).ok).toBe(true);
    expect(buffers.readerFor([second], file, 1 << 20).ok).toBe(true);
    // The budget holds one.
    expect(buffers.count).toBe(1);

    const again = buffers.readerFor([0], file, 1 << 20);
    expect(again.ok).toBe(true);
    if (again.ok) expect([...(again.reader.bytes(again.reader.all) ?? [])]).toEqual([...driver()]);
  });
});
