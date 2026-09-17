import { describe, expect, it } from "vitest";
import { FILE_SPACE, insideSection, outermostSection, sameSpace } from "@/firmware/uefi/byteSpace";
import { UEFIImage } from "@/firmware/uefi/uefiImage";
import {
  isNodeCompressed,
  makeNode,
  makeSpan,
  nodeFileRange,
  nodeRange,
} from "@/firmware/uefi/uefiNode";

/**
 * Which bytes a node's ranges are in, and the lookups by file offset that must
 * never reach into a decompressed buffer. Ported from upstream's
 * `ByteSpaceTests`.
 */

describe("a node's space", () => {
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/ByteSpaceTests.swift#ByteSpaceTests.testANodeIsInTheFileUnlessItSaysOtherwise
  it("is the file unless it says otherwise", () => {
    const node = makeSpan({ kind: "padding", name: "Padding", range: { start: 0x10, end: 0x20 } });

    expect(sameSpace(node.space, FILE_SPACE)).toBe(true);
    expect(nodeFileRange(node)).toEqual({ start: 0x10, end: 0x20 });
    expect(isNodeCompressed(node)).toBe(false);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/ByteSpaceTests.swift#ByteSpaceTests.testANodeInsideACompressedSectionHasNoFileRange
  it("has no file range inside a compressed section", () => {
    const node = makeSpan({ kind: "padding", name: "Padding", range: { start: 0x10, end: 0x20 } });
    node.space = [0x400];

    expect(nodeFileRange(node)).toBeUndefined();
    // Anything inside a compressed section is compressed.
    expect(isNodeCompressed(node)).toBe(true);
    // Its ranges stay, in its own space.
    expect(nodeRange(node)).toEqual({ start: 0x10, end: 0x20 });
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/ByteSpaceTests.swift#ByteSpaceTests.testASpaceNamesEveryCompressedSectionOnTheWayIn
  it("names every compressed section on the way in", () => {
    const outer = insideSection(FILE_SPACE, 0x400);
    const inner = insideSection(outer, 0x88);

    expect(outer).toEqual([0x400]);
    expect(inner).toEqual([0x400, 0x88]);
    expect(outermostSection(inner)).toBe(0x400);
    expect(outermostSection(FILE_SPACE)).toBeUndefined();
  });

  /**
   * The section's child starts at buffer offset 0 and runs far past the section
   * — numbers that cover the asked offset. The chain still stops at the
   * section, the last node whose bytes are the file's.
   *
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/ByteSpaceTests.swift#ByteSpaceTests.testALookupByFileOffsetStopsAtTheCompressedSection
   */
  it("stops a lookup by file offset at the compressed section", () => {
    const child = makeSpan({ kind: "file", name: "Driver", range: { start: 0, end: 0x10000 } });
    child.space = [0x100];
    const section = makeNode({
      kind: "section",
      name: "LZMA section",
      header: { start: 0x100, end: 0x118 },
      body: { start: 0x118, end: 0x200 },
      children: [child],
    });
    const image = new UEFIImage({ size: 0x1000, roots: [section] });

    expect(image.nodesContaining(0x150).map((node) => node.name)).toEqual(["LZMA section"]);
    expect(image.innermostNodeContaining(0x150)?.name).toBe("LZMA section");
    // Outside the section, a buffer offset is no reason to match.
    expect(image.nodesContaining(0x500)).toEqual([]);
  });
});
