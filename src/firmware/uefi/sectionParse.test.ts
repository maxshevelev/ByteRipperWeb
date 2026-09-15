import { describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import * as Test from "@/firmware/testing/testImage";
import type { DiagnosticKind } from "@/firmware/uefi/diagnostic";
import { severityOf } from "@/firmware/uefi/diagnostic";
import { type EFIGUID, guid } from "@/firmware/uefi/efiGuid";
import { FFS_V2, FFS_V3 } from "@/firmware/uefi/knownGuids";
import type { Limits } from "@/firmware/uefi/parserState";
import { Section } from "@/firmware/uefi/sectionParser";
import { parseUefiImage } from "@/firmware/uefi/uefiImage";
import { nodeRange, type UEFINode } from "@/firmware/uefi/uefiNode";

/**
 * Ported from `SectionParseTests.swift`: a file's body read as sections, and
 * the encapsulating ones where the tree stops being a list.
 */

const bytes = (...values: number[]) => new Uint8Array(values);
const filled = (count: number, byte: number) => new Uint8Array(count).fill(byte);

const parseSections = (sections: readonly Uint8Array[], fileSystem: EFIGUID = FFS_V2) =>
  parseUefiImage(
    sourceOver(Test.volume({ fileSystem, files: [Test.sectionedFile({ sections })] }))
  );
const fileOf = (sections: readonly Uint8Array[], fileSystem: EFIGUID = FFS_V2) =>
  parseSections(sections, fileSystem).roots[0]?.children[0];
const diagnosticsOf = (sections: readonly Uint8Array[]): DiagnosticKind[] =>
  parseSections(sections).diagnostics.map((one) => one.detail);

const kinds = (nodes: readonly UEFINode[]) => nodes.map((node) => node.kind);
const names = (nodes: readonly UEFINode[]) => nodes.map((node) => node.name);
const ranges = (nodes: readonly UEFINode[]) =>
  nodes.map((node) => [nodeRange(node).start, nodeRange(node).end]);

describe("the section walk", () => {
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/SectionParseTests.swift#SectionParseTests.testSectionsAreReadInOrder
  it("reads sections in order", () => {
    const node = fileOf([
      Test.section({ type: 0x10, body: filled(8, 0xab) }),
      Test.section({ type: 0x13, body: bytes(0x08) }),
    ]);

    expect(kinds(node?.children ?? [])).toEqual(["section", "section"]);
    expect(names(node?.children ?? [])).toEqual(["PE32 image", "DXE dependency"]);
    expect(ranges(node?.children ?? [])).toEqual([
      [0x60, 0x6c],
      [0x6c, 0x71],
    ]);
    expect(node?.children[0]?.header).toEqual({ start: 0x60, end: 0x64 });
    expect(node?.children[0]?.body).toEqual({ start: 0x64, end: 0x6c });
  });

  // Sections sit on four-byte boundaries where files sit on eight, and the
  // bytes in between are still bytes.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/SectionParseTests.swift#SectionParseTests.testTheAlignmentGapBetweenSectionsIsKept
  it("keeps the alignment gap between sections", () => {
    const node = fileOf([
      Test.section({ type: 0x10, body: bytes(1, 2, 3) }),
      Test.section({ type: 0x10, body: bytes(4, 5, 6, 7) }),
    ]);

    expect(kinds(node?.children ?? [])).toEqual(["section", "padding", "section"]);
    expect(ranges(node?.children ?? [])).toEqual([
      [0x60, 0x67],
      [0x67, 0x68],
      [0x68, 0x70],
    ]);
  });
});

describe("naming a file from its sections", () => {
  // Without this a volume is three hundred rows of GUIDs.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/SectionParseTests.swift#SectionParseTests.testANameSectionNamesTheFile
  it("takes the name from a name section", () => {
    const node = fileOf([
      Test.section({ type: 0x10, body: bytes(1, 2, 3, 4) }),
      Test.nameSection("PciBusDxe"),
    ]);

    expect(node?.name).toBe("PciBusDxe");
    expect(node?.children.at(-1)?.name).toBe("PciBusDxe");
  });

  // A name section is often wrapped along with the image it names.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/SectionParseTests.swift#SectionParseTests.testANameSectionInsideAnEncapsulationStillNamesTheFile
  it("looks one level down for it", () => {
    const node = fileOf([
      Test.section({ type: Section.disposable, body: Test.nameSection("SetupUtility") }),
    ]);

    expect(node?.name).toBe("SetupUtility");
  });
});

describe("the encapsulating sections", () => {
  // A volume inside a section inside a file inside a volume — the point at
  // which this format starts over one level down.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/SectionParseTests.swift#SectionParseTests.testAVolumeImageSectionHoldsAVolume
  it("finds a volume inside a volume-image section", () => {
    const inner = Test.volume({
      length: 0x200,
      files: [Test.file({ body: bytes(1, 2, 3, 4, 5, 6, 7, 8) })],
    });
    const node = fileOf([Test.section({ type: Section.firmwareVolumeImage, body: inner })]);
    const volume = node?.children[0]?.children[0];

    expect(volume?.kind).toBe("volume");
    expect(nodeRange(volume as UEFINode)).toEqual({ start: 0x64, end: 0x264 });
    expect(kinds(volume?.children ?? [])).toEqual(["file", "freeSpace"]);
    expect(nodeRange(volume?.children[0] as UEFINode)).toEqual({ start: 0xac, end: 0xcc });
  });

  // A compression section that is not actually compressed still holds sections,
  // and reading it as opaque would hide half an image.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/SectionParseTests.swift#SectionParseTests.testAnUncompressedCompressionSectionIsWalkedThrough
  it("walks through an uncompressed compression section", () => {
    const inner = Test.section({ type: 0x10, body: bytes(1, 2, 3, 4) });
    const node = fileOf([Test.compressionSection(0x00, inner)]);
    const outer = node?.children[0];

    expect(outer?.name).toBe("Uncompressed section");
    expect(outer?.header).toEqual({ start: 0x60, end: 0x69 }); // common header plus five
    expect(names(outer?.children ?? [])).toEqual(["PE32 image"]);
  });

  // What this parser will not do is decompress. The section says which
  // algorithm it is and keeps its body whole — no dependency, and no pretending
  // the contents are readable.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/SectionParseTests.swift#SectionParseTests.testACompressedSectionThatDoesNotDecodeIsALeafThatNamesItsAlgorithm
  it("leaves a compressed section a leaf that names its algorithm", () => {
    const node = fileOf([Test.compressionSection(0x86, filled(32, 0x5a))]);

    expect(node?.children[0]?.name).toBe("LZMA with x86 filter section");
    expect(node?.children[0]?.children).toEqual([]);
    expect(node?.children[0]?.body).toEqual({ start: 0x69, end: 0x89 });
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/SectionParseTests.swift#SectionParseTests.testAGuidDefinedSectionIsNamedByItsGuid
  it("names a GUID-defined section by its GUID", () => {
    const lzma = guid("EE4E5898-3914-4259-9D6E-DC7BD79403CF");
    const node = fileOf([Test.guidedSectionBytes({ guid: lzma, body: filled(16, 0x11) })]);

    expect(node?.children[0]?.name).toBe("LZMA section");
    expect(node?.children[0]?.guid).toEqual(lzma);
    expect(node?.children[0]?.children).toEqual([]);
  });

  // CRC32 only checks the data, so what is inside is still there to read — the
  // one GUID-defined section whose body is a run of sections.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/SectionParseTests.swift#SectionParseTests.testACrc32SectionIsWalkedThrough
  it("walks through a CRC32 section", () => {
    const crc32 = guid("FC1BCDB0-7D31-49AA-936A-A4600D9DD083");
    const inner = Test.section({ type: 0x10, body: bytes(1, 2, 3, 4) });
    const node = fileOf([Test.guidedSectionBytes({ guid: crc32, body: inner })]);

    expect(node?.children[0]?.name).toBe("CRC32 section");
    expect(names(node?.children[0]?.children ?? [])).toEqual(["PE32 image"]);
  });

  // The body starts where `DataOffset` says, not where the structure ends:
  // vendors put certificates and their own headers in between.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/SectionParseTests.swift#SectionParseTests.testTheDataOffsetDecidesWhereTheBodyStarts
  it("lets DataOffset decide where the body starts", () => {
    const crc32 = guid("FC1BCDB0-7D31-49AA-936A-A4600D9DD083");
    const inner = Test.section({ type: 0x10, body: bytes(1, 2, 3, 4) });
    const node = fileOf([
      Test.guidedSectionBytes({ guid: crc32, body: inner, vendorHeader: filled(8, 0xee) }),
    ]);
    const section = node?.children[0];

    expect(section?.header).toEqual({ start: 0x60, end: 0x80 }); // 4 + 20 + 8
    expect(ranges(section?.children ?? [])).toEqual([[0x80, 0x88]]);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/SectionParseTests.swift#SectionParseTests.testADisposableSectionIsWalkedThrough
  it("walks through a disposable section", () => {
    const inner = Test.section({ type: 0x10, body: bytes(1, 2, 3, 4) });
    const node = fileOf([Test.section({ type: Section.disposable, body: inner })]);

    expect(names(node?.children[0]?.children ?? [])).toEqual(["PE32 image"]);
  });
});

describe("a section that cannot be believed", () => {
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/SectionParseTests.swift#SectionParseTests.testAnUnknownSectionTypeIsReportedAndKept
  it("keeps an unknown type, and reports it", () => {
    const node = fileOf([Test.section({ type: 0x77, body: bytes(1, 2, 3, 4) })]);

    expect(names(node?.children ?? [])).toEqual(["Section type 0x77"]);
    expect(diagnosticsOf([Test.section({ type: 0x77, body: bytes(1, 2, 3, 4) })])).toEqual([
      { kind: "unknownType", structure: "sectionHeader", code: 0x77 },
    ]);
  });

  // The gap at `0x1A` is the specification's, and a range that papered over it
  // would wave through a value that means something is wrong.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/SectionParseTests.swift#SectionParseTests.testTheGapInTheSectionTypesIsNotAType
  it("does not treat the gap in the section types as a type", () => {
    expect(diagnosticsOf([Test.section({ type: 0x1a, body: bytes(1, 2, 3, 4) })])).toEqual([
      { kind: "unknownType", structure: "sectionHeader", code: 0x1a },
    ]);
    expect(diagnosticsOf([Test.section({ type: 0x1b, body: bytes(1, 2, 3, 4) })])).toEqual([]);
  });

  // Zero would put the walk back on the same offset for ever.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/SectionParseTests.swift#SectionParseTests.testASectionOfZeroSizeStopsTheWalk
  it("stops the walk at a size of zero", () => {
    const sections = [
      Test.section({ type: 0x10, body: bytes(1, 2, 3, 4), size: 0 }),
      Test.section({ type: 0x13, body: bytes(8) }),
    ];

    expect(fileOf(sections)?.children).toEqual([]);
    expect(diagnosticsOf(sections)).toEqual([{ kind: "zeroSize", structure: "sectionHeader" }]);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/SectionParseTests.swift#SectionParseTests.testASectionRunningPastTheFileIsReported
  it("reports a section running past the file", () => {
    expect(
      diagnosticsOf([Test.section({ type: 0x10, body: bytes(1, 2, 3, 4), size: 0x400 })])
    ).toEqual([{ kind: "truncated", structure: "sectionBody" }]);
  });
});

describe("the extended size", () => {
  // The marker means an extended size only in an FFSv3 volume. Anywhere else it
  // is a size of `0xFFFFFF`, and reading four extra bytes of header would eat
  // the start of the body.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/SectionParseTests.swift#SectionParseTests.testTheExtendedSizeMarkerIsOnlyExtendedInFfsV3
  it("is only extended in FFSv3", () => {
    const sections = [Test.section({ type: 0x10, body: bytes(1, 2, 3, 4), extendedSize: true })];
    const node = fileOf(sections);

    expect(node?.children[0]?.header).toEqual({ start: 0x60, end: 0x64 });
    expect(diagnosticsOf(sections)).toEqual([{ kind: "truncated", structure: "sectionBody" }]);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/SectionParseTests.swift#SectionParseTests.testAnExtendedSizeSectionHasALongerHeader
  it("makes the header four bytes longer in FFSv3", () => {
    const node = fileOf(
      [Test.section({ type: 0x10, body: bytes(1, 2, 3, 4), extendedSize: true })],
      FFS_V3
    );

    expect(node?.children[0]?.header).toEqual({ start: 0x60, end: 0x68 });
    expect(node?.children[0]?.body).toEqual({ start: 0x68, end: 0x6c });
  });
});

/**
 * Volume, file, section, volume again: a real image nests eight or ten deep and
 * a corrupt one nests for ever, so every level that can recurse counts the
 * depth.
 */
describe("the depth limit", () => {
  const nestedImage = () => {
    const inner = Test.volume({ length: 0x200, files: [Test.file({ body: bytes(1, 2, 3, 4) })] });
    return Test.volume({
      length: 0x800,
      files: [
        Test.sectionedFile({
          sections: [Test.section({ type: Section.firmwareVolumeImage, body: inner })],
        }),
      ],
    });
  };
  const parseAt = (maxDepth: number) => {
    const limits: Limits = { maxDepth };
    return parseUefiImage(sourceOver(nestedImage()), { limits });
  };

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/SectionParseTests.swift#SectionParseTests.testSectionsStopAtTheDepthLimit
  it("stops the sections", () => {
    const parsed = parseAt(2);
    const file = parsed.roots[0]?.children[0];

    expect(file?.kind).toBe("file");
    expect(file?.children).toEqual([]);
    const hit = parsed.diagnostics.find((one) => one.detail.kind === "recursionLimit");
    expect(hit).toBeDefined();
    expect(severityOf(hit?.detail as DiagnosticKind)).toBe("error");
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/SectionParseTests.swift#SectionParseTests.testANestedVolumeStopsAtTheDepthLimit
  it("stops a nested volume", () => {
    const parsed = parseAt(3);
    const volume = parsed.roots[0]?.children[0]?.children[0]?.children[0];

    expect(volume?.kind).toBe("volume");
    expect(volume?.children).toEqual([]);
    expect(parsed.diagnostics.some((one) => one.detail.kind === "recursionLimit")).toBe(true);
  });
});
