import { describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import * as Test from "@/firmware/testing/testImage";
import * as TestNVRAM from "@/firmware/testing/testNvram";
import {
  DECOMPRESSED_BODY_LAYOUT,
  IMAGE_LAYOUT,
  knownNode,
  layoutForFileRange,
  layoutOf,
  layoutOfBody,
} from "@/firmware/uefi/rootLayout";
import { parseUefiImage, type UEFIImage } from "@/firmware/uefi/uefiImage";
import {
  makeNode,
  makeSpan,
  nodeFileRange,
  nodeRange,
  type UEFINode,
} from "@/firmware/uefi/uefiNode";

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
   * A VSS store opened on its own: a signature scan sees padding, and read as the stores it is it
   * has its variables.
   *
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/RootLayoutTests.swift#RootLayoutTests.testAStoreReadsAsAStoreWithItsVariables
   */
  it("reads a store as a store with its variables", () => {
    const store = TestNVRAM.vssStore({ variables: [TestNVRAM.vssVariable({ name: "Setup" })] });
    expect(parse(store).allNodes.some((node) => node.kind === "vssStore")).toBe(false);

    const image = parse(store, { kind: "nvramStores" });
    const root = image.roots[0];
    expect(root?.kind).toBe("vssStore");
    expect(root?.children[0]?.name).toBe("Setup");
    // Bytes with no store fall back to the image.
    expect(kindsOf(parse(sections, { kind: "nvramStores" }).roots)).toEqual(
      kindsOf(parse(sections).roots)
    );
  });

  /**
   * A range only the flash device map names — `SMBIOS Update` — opened on its own is that range,
   * not padding: the parent's tree said what it was.
   *
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/RootLayoutTests.swift#RootLayoutTests.testANamedRangeReadsAsTheNodeTheParentKnew
   */
  it("reads a named range as the node the parent knew", () => {
    const known = makeNode({
      kind: "flashDeviceMapRegion",
      name: "SMBIOS Update",
      guid: Test.DRIVER_GUID,
      header: { start: 0, end: 0 },
      body: { start: 0, end: 0x40 },
      isFixed: true,
    });
    const bytes = new Uint8Array(0x40).fill(0x5a);
    expect(kindsOf(parse(bytes).roots)).toEqual(["padding"]);

    const image = parse(bytes, { kind: "node", node: knownNode(known) });
    expect(image.roots.length).toBe(1);
    const root = image.roots[0];
    expect(root?.kind).toBe("flashDeviceMapRegion");
    expect(root?.name).toBe("SMBIOS Update");
    expect(root?.guid).toEqual(Test.DRIVER_GUID);
    expect(root && nodeRange(root)).toEqual({ start: 0, end: 0x40 });
    expect(root?.children).toEqual([]);
  });

  /**
   * A region that holds volumes stands over them, as it did in the image.
   *
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/RootLayoutTests.swift#RootLayoutTests.testARegionReadsAsTheRegionOverItsVolumes
   */
  it("reads a region as the region over its volumes", () => {
    const volume = Test.volume({ files: [Test.file({ body: new Uint8Array([1, 2, 3]) })] });
    const known = makeNode({
      kind: "region",
      subtype: 1,
      name: "BIOS region",
      header: { start: 0, end: 0 },
      body: { start: 0, end: volume.length },
      isFixed: true,
      isExpandable: true,
    });
    const image = parse(volume, { kind: "node", node: knownNode(known) });
    const root = image.roots[0];
    expect(root?.kind).toBe("region");
    expect(kindsOf(root?.children ?? [])).toEqual(["volume"]);
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

  /** @upstream Packages/UEFIImage/Tests/UEFIImageTests/RootLayoutTests.swift#RootLayoutTests.testAStoreNodeSaysItIsAStore */
  it("says a store is stores", () => {
    const store = TestNVRAM.vssStore({ variables: [TestNVRAM.vssVariable({ name: "Setup" })] });
    const image = parse(TestNVRAM.nvramVolume({ stores: [store] }));
    expect(layoutOf(firstOf(image, "vssStore"), image)).toEqual({ kind: "nvramStores" });
  });

  /** @upstream Packages/UEFIImage/Tests/UEFIImageTests/RootLayoutTests.swift#RootLayoutTests.testANodeTheBytesDoNotAnnounceSaysItIsItself */
  it("says a node the bytes do not announce is itself, and padding is what it announces", () => {
    const known = makeNode({
      kind: "fitComponent",
      subtype: 2,
      name: "Boot Guard key manifest",
      header: { start: 0, end: 0 },
      body: { start: 0, end: 16 },
    });
    expect(layoutOf(known, parent())).toEqual({ kind: "node", node: knownNode(known) });
    const padding = makeSpan({ kind: "padding", name: "Padding", range: { start: 0, end: 16 } });
    expect(layoutOf(padding, parent())).toEqual(IMAGE_LAYOUT);
  });

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
