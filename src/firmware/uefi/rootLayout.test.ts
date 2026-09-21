import { describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import * as Test from "@/firmware/testing/testImage";
import {
  DECOMPRESSED_BODY_LAYOUT,
  IMAGE_LAYOUT,
  layoutForFileRange,
  layoutOf,
  layoutOfBody,
} from "@/firmware/uefi/rootLayout";
import { parseUefiImage, type UEFIImage } from "@/firmware/uefi/uefiImage";
import { nodeFileRange, type UEFINode } from "@/firmware/uefi/uefiNode";

/**
 * A part of an image opened on its own, read as what the parent's tree knew it
 * to be (`Design/UEFI/UPDATE_IN_PARENT.md` §2.1). Ported from upstream's
 * `RootLayoutTests`.
 */

/**
 * What a Tiano or LZMA section decompresses to: two sections, back to back —
 * twelve bytes each, so no alignment gap stands between them.
 */
const sections = new Uint8Array([...Test.nameSection("Drv"), ...Test.nameSection("Set")]);

const parse = (bytes: Uint8Array, layout = IMAGE_LAYOUT): UEFIImage =>
  parseUefiImage(sourceOver(bytes), { layout });

const kindsOf = (nodes: readonly UEFINode[]): string[] => nodes.map((node) => node.kind);

describe("a layout the caller knows", () => {
  /**
   * The report this exists for: a decompressed body read as an image is a scan
   * that finds nothing, and read as sections it is its sections.
   *
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/RootLayoutTests.swift#RootLayoutTests.testADecompressedBodyReadsAsItsSections
   */
  it("reads a decompressed body as its sections", () => {
    const scanned = parse(sections);
    expect(scanned.allNodes.some((node) => node.kind === "section")).toBe(false);

    const read = parse(sections, DECOMPRESSED_BODY_LAYOUT);
    expect(kindsOf(read.roots)).toEqual(["section", "section"]);
  });

  /**
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/RootLayoutTests.swift#RootLayoutTests.testAFileReadsAsAFileWithItsSections
   */
  it("reads a file as a file with its sections", () => {
    const file = Test.sectionedFile({ sections: [Test.nameSection("Driver")] });
    const image = parse(file, { kind: "file", ffsVersion: 2, volumeRevision: 2 });

    const root = image.roots[0];
    expect(root?.kind).toBe("file");
    expect(kindsOf(root?.children ?? [])).toEqual(["section"]);
  });

  /**
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/RootLayoutTests.swift#RootLayoutTests.testAVolumeReadsAsAVolume
   */
  it("reads a volume as a volume", () => {
    const volume = Test.volume({ files: [Test.file({ body: new Uint8Array([1, 2, 3]) })] });
    const image = parse(volume, { kind: "volume" });

    const root = image.roots[0];
    expect(root?.kind).toBe("volume");
    expect(root?.children[0]?.kind).toBe("file");
  });

  /**
   * A layout the bytes do not bear out is not forced on them: they are read as
   * an image, and the failed attempt says nothing.
   *
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/RootLayoutTests.swift#RootLayoutTests.testALayoutThatDoesNotFitFallsBackToTheImage
   */
  it("falls back to the image where the bytes do not bear the layout out", () => {
    const asImage = parse(sections);
    const asVolume = parse(sections, { kind: "volume" });

    expect(kindsOf(asVolume.roots)).toEqual(kindsOf(asImage.roots));
    expect(asVolume.diagnostics.length).toBe(asImage.diagnostics.length);
  });
});

describe("what the parent's tree says a part is", () => {
  const parent = (): UEFIImage =>
    parse(
      Test.image({
        volume: Test.volume({
          files: [Test.sectionedFile({ sections: [Test.nameSection("Driver")] })],
        }),
      })
    );
  const firstOf = (image: UEFIImage, kind: string): UEFINode => {
    const found = image.allNodes.find((node) => node.kind === kind);
    if (found === undefined) throw new Error(`the image should hold a ${kind}`);
    return found;
  };

  /**
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/RootLayoutTests.swift#RootLayoutTests.testANodeSaysWhatItIsAsARoot
   */
  it("says what a node is as a root", () => {
    const image = parent();

    expect(layoutOf(firstOf(image, "volume"), image)).toEqual({ kind: "volume" });
    expect(layoutOf(firstOf(image, "file"), image)).toEqual({
      kind: "file",
      ffsVersion: 2,
      volumeRevision: 2,
    });
    expect(layoutOf(firstOf(image, "section"), image)).toEqual({ kind: "sections", ffsVersion: 2 });
    expect(layoutOfBody(firstOf(image, "file"), image)).toEqual({
      kind: "sections",
      ffsVersion: 2,
    });
    // A volume's body is files with no header to say so.
    expect(layoutOfBody(firstOf(image, "volume"), image)).toEqual(IMAGE_LAYOUT);
  });

  /**
   * A zone is a range of the file; the innermost node covering it — or whose
   * body it is — says what it is.
   *
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/RootLayoutTests.swift#RootLayoutTests.testAFileRangeSaysWhatItIsFromTheNodeThatCoversIt
   */
  it("says what a range of the file is, from the node that covers it", () => {
    const image = parent();
    const file = firstOf(image, "file");
    const range = nodeFileRange(file);
    if (range === undefined) throw new Error("a file of the image has a range in it");

    expect(layoutForFileRange([range.start, range.end], image)).toEqual({
      kind: "file",
      ffsVersion: 2,
      volumeRevision: 2,
    });
    expect(layoutForFileRange([file.body.start, file.body.end], image)).toEqual({
      kind: "sections",
      ffsVersion: 2,
    });
    expect(layoutForFileRange([3, 9], image)).toEqual(IMAGE_LAYOUT);
  });
});
