import { describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import * as Test from "@/firmware/testing/testImage";
import { guidEquals } from "@/firmware/uefi/efiGuid";
import { VOLUME_TOP_FILE } from "@/firmware/uefi/knownGuids";
import { isFilledIn } from "@/firmware/uefi/secondPass";
import { Section } from "@/firmware/uefi/sectionParser";
import { parseUefiImage, UEFIImage } from "@/firmware/uefi/uefiImage";
import { makeNode, makeSpan, nodeIdText, nodeRange, type UEFINode } from "@/firmware/uefi/uefiNode";

/**
 * Ported from `SecondPassTests.swift` and `UEFIImageTests.swift`: the pass that
 * needs an address rather than an offset, and the three questions everything
 * downstream asks of the tree.
 */

const bytes = (...values: number[]) => new Uint8Array(values);
const parse = (image: Uint8Array) => parseUefiImage(sourceOver(image));

/** A 16 KB image whose last bytes are a Volume Top File. */
const anchoredImage = () =>
  Test.volume({
    length: 0x4000,
    files: [Test.file({ body: bytes(1, 2, 3, 4, 5, 6, 7, 8) })],
    lastFile: Test.volumeTopFile({ size: 0x100 }),
  });

describe("the Volume Top File", () => {
  /**
   * `addressDiff = 0x100000000 - (base + size)` of the last VTF. For an image
   * mapped right up against the top of the address space this is the same as
   * `0x100000000 - image size`, which is the identity the FIT document leans on.
   */
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/SecondPassTests.swift#SecondPassTests.testTheVolumeTopFileFixesEveryAddress
  it("fixes every address", () => {
    const parsed = parse(anchoredImage());

    expect(parsed.addressDiff).toBe(0x1_0000_0000 - 0x4000);
    expect(parsed.addressForOffset(0x3fc0)).toBe(0xffff_ffc0);
    expect(parsed.offsetForAddress(0xffff_ffc0)).toBe(0x3fc0);
  });

  // A dump of one BIOS region, or of an EC, has no VTF and is not defective for
  // it. Addresses are simply unknown, without a diagnostic anyone has to
  // dismiss.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/SecondPassTests.swift#SecondPassTests.testNoVolumeTopFileMeansNoAddressesAndNoComplaint
  it("is not required, and its absence is no complaint", () => {
    const parsed = parse(Test.volume({ length: 0x1000 }));

    expect(parsed.addressDiff).toBeUndefined();
    expect(parsed.resetVector).toBeUndefined();
    expect(parsed.diagnostics).toEqual([]);
  });

  // Moving it moves every address in the image.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/SecondPassTests.swift#SecondPassTests.testTheVolumeTopFileIsMarkedFixed
  it("is marked fixed", () => {
    const parsed = parse(anchoredImage());
    const vtf = parsed.allNodes.find(
      (node) => node.guid !== undefined && guidEquals(node.guid, VOLUME_TOP_FILE)
    );

    expect(vtf?.name).toBe("Volume Top File");
    expect(vtf?.isFixed).toBe(true);
  });

  // Several VTFs in one image, and only the last is at the top of the space.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/SecondPassTests.swift#SecondPassTests.testTheLastVolumeTopFileWins
  it("is the last one when there are several", () => {
    const image = Test.volume({
      length: 0x4000,
      files: [Test.volumeTopFile({ size: 0x100 })],
      lastFile: Test.volumeTopFile({ size: 0x100 }),
    });

    const parsed = parse(image);
    const fixed = parsed.allNodes.filter(
      (node) => node.guid !== undefined && guidEquals(node.guid, VOLUME_TOP_FILE) && node.isFixed
    );

    expect(parsed.addressDiff).toBe(0x1_0000_0000 - 0x4000);
    expect(fixed.map((node) => nodeRange(node))).toEqual([{ start: 0x3f00, end: 0x4000 }]);
  });

  // A VTF inside a volume that is itself inside a section is still the anchor,
  // and the tree it has to be marked in is three levels deep.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/SecondPassTests.swift#SecondPassTests.testAVolumeTopFileNestedInASectionIsStillFound
  it("is found nested inside a section", () => {
    const inner = Test.volume({ length: 0x400, lastFile: Test.volumeTopFile({ size: 0x100 }) });
    const image = Test.volume({
      length: 0x1000,
      files: [
        Test.sectionedFile({
          sections: [Test.section({ type: Section.firmwareVolumeImage, body: inner })],
        }),
      ],
    });

    const parsed = parse(image);
    const vtf = parsed.allNodes.find(
      (node) => node.guid !== undefined && guidEquals(node.guid, VOLUME_TOP_FILE)
    );

    expect(vtf?.isFixed).toBe(true);
    expect(parsed.addressDiff).toBe(0x1_0000_0000 - nodeRange(vtf as UEFINode).end);
  });
});

describe("the reset vector", () => {
  // The image's own statement of where it is loaded, at the last forty-eight
  // bytes of the address space.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/SecondPassTests.swift#SecondPassTests.testTheResetVectorIsReadFromInsideTheVolumeTopFile
  it("is read from inside the Volume Top File", () => {
    const parsed = parse(anchoredImage());

    expect(parsed.resetVector?.offset).toBe(0x3fd0);
    expect(parsed.resetVector?.peiCoreEntryPoint).toBe(0xfff8_0000);
    expect(parsed.resetVector?.bootFvBaseAddress).toBe(0xfff0_0000);
    expect(parsed.resetVector?.apStartupSegment).toBe(0xffff_0000);
    expect([...(parsed.resetVector?.resetVector ?? [])]).toEqual(Array(8).fill(0x90));
    expect([...(parsed.resetVector?.apEntryVector ?? [])]).toEqual(Array(8).fill(0xea));
  });

  // EDK2 leaves a placeholder in the fields it did not fill in, and a consumer
  // reading one as an address would follow it into nothing.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/SecondPassTests.swift#SecondPassTests.testAPlaceholderFieldIsNotAnAddress
  it("says which of its fields are addresses at all", () => {
    const image = Test.volume({
      length: 0x4000,
      lastFile: Test.volumeTopFile({ size: 0x100, peiCoreEntryPoint: 0x1234_5678 }),
    });
    const vector = parse(image).resetVector;

    expect(isFilledIn(vector?.peiCoreEntryPoint ?? 0)).toBe(false);
    expect(isFilledIn(vector?.bootFvBaseAddress ?? 0)).toBe(true);
  });

  /**
   * A file with the right GUID but no room for a reset vector in it. The image
   * is still anchored — that comes from where the file ends — but there is no
   * vector to read, and inventing one from the bytes before the file would be
   * worse than saying so.
   */
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/SecondPassTests.swift#SecondPassTests.testAVolumeTopFileTooSmallForAResetVectorIsReported
  it("is reported when the file is too small to hold one", () => {
    const image = Test.volume({
      length: 0x4000,
      lastFile: Test.file({ guid: VOLUME_TOP_FILE, body: bytes(1, 2, 3, 4, 5, 6, 7, 8) }),
    });

    const parsed = parse(image);

    expect(parsed.addressDiff).toBe(0x1_0000_0000 - 0x4000);
    expect(parsed.resetVector).toBeUndefined();
    expect(
      parsed.diagnostics.some(
        (one) => one.detail.kind === "truncated" && one.detail.structure === "resetVector"
      )
    ).toBe(true);
  });
});

describe("the tree a parse produces", () => {
  const node = (name: string, start: number, end: number, children: UEFINode[] = []) =>
    makeNode({
      kind: "volume",
      name,
      header: { start, end: start + 8 },
      body: { start: start + 8, end },
      children,
    });

  const image = () =>
    new UEFIImage({
      size: 0x1000,
      roots: [
        node("volume", 0, 0x800, [
          node("file", 0x100, 0x200, [node("section", 0x118, 0x180)]),
          node("free", 0x200, 0x800),
        ]),
        node("padding", 0x900, 0x1000),
      ],
    });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/UEFIImageTests.swift#UEFIImageTests.testANodeSpansItsHeaderAndBody
  it("spans a node's header and body", () => {
    const file = makeNode({
      kind: "file",
      name: "f",
      header: { start: 0x10, end: 0x28 },
      body: { start: 0x28, end: 0x100 },
    });
    expect(nodeRange(file)).toEqual({ start: 0x10, end: 0x100 });
  });

  // Padding and free space have no header of their own, and a node that
  // reported one would put a byte of the file inside a structure that is not
  // there.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/UEFIImageTests.swift#UEFIImageTests.testAHeaderlessNodeIsAllBody
  it("makes a headerless node all body", () => {
    const padding = makeSpan({ kind: "padding", name: "p", range: { start: 0x40, end: 0x80 } });

    expect(padding.header).toEqual({ start: 0x40, end: 0x40 });
    expect(padding.body).toEqual({ start: 0x40, end: 0x80 });
    expect(nodeRange(padding)).toEqual({ start: 0x40, end: 0x80 });
  });

  // FFSv1 files with a tail are the only ones that have one, and the node still
  // has to cover it.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/UEFIImageTests.swift#UEFIImageTests.testATailIsPartOfTheNode
  it("covers a tail", () => {
    const file = makeNode({
      kind: "file",
      name: "f",
      header: { start: 0, end: 0x18 },
      body: { start: 0x18, end: 0x30 },
      tail: { start: 0x30, end: 0x32 },
    });
    expect(nodeRange(file)).toEqual({ start: 0, end: 0x32 });
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/UEFIImageTests.swift#UEFIImageTests.testFlatteningIsOutermostFirst
  it("flattens outermost first", () => {
    expect(image().allNodes.map((one) => one.name)).toEqual([
      "volume",
      "file",
      "section",
      "free",
      "padding",
    ]);
  });

  // A node's place in the tree is its identity, and it is stamped once the tree
  // is finished rather than carried through the parse.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/UEFIImageTests.swift#UEFIImageTests.testIdsAreTheRouteFromTheRoot
  it("makes an id the route from the root", () => {
    const parsed = image();
    expect(parsed.allNodes.map((one) => nodeIdText(one.id))).toEqual([
      "0",
      "0.0",
      "0.0.0",
      "0.1",
      "1",
    ]);
    expect(parsed.node([0, 0, 0])?.name).toBe("section");
    expect(parsed.node([1])?.name).toBe("padding");
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/UEFIImageTests.swift#UEFIImageTests.testAnIdThatIsNotInTheTreeFindsNothing
  it("finds nothing for an id that is not in the tree", () => {
    const parsed = image();
    expect(parsed.node([0, 5])).toBeUndefined();
    expect(parsed.node([2])).toBeUndefined();
    expect(parsed.node([-1])).toBeUndefined();
  });

  // What a click in the dump means: the volume, then the file in it, then the
  // section in that.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/UEFIImageTests.swift#UEFIImageTests.testTheChainAtAnOffsetIsOutermostFirst
  it("gives the chain at an offset outermost first", () => {
    const parsed = image();
    expect(parsed.nodesContaining(0x120).map((one) => one.name)).toEqual([
      "volume",
      "file",
      "section",
    ]);
    expect(parsed.innermostNodeContaining(0x120)?.name).toBe("section");
    expect(parsed.innermostNodeContaining(0x108)?.name).toBe("file");
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/UEFIImageTests.swift#UEFIImageTests.testAnOffsetNothingClaimsHasNoChain
  it("has no chain for an offset nothing claims", () => {
    const parsed = image();
    expect(parsed.nodesContaining(0x850)).toEqual([]);
    expect(parsed.innermostNodeContaining(0x2000)).toBeUndefined();
  });
});

describe("addresses", () => {
  const mapped = (addressDiff: number) => new UEFIImage({ size: 0x1000, roots: [], addressDiff });

  // Without a Volume Top File there are no addresses at all — not zero, not a
  // guess.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/UEFIImageTests.swift#UEFIImageTests.testAddressesAreUnknownWithoutTheAddressDiff
  it("are unknown without the address diff", () => {
    const image = new UEFIImage({ size: 0x1000, roots: [] });
    expect(image.addressForOffset(0x100)).toBeUndefined();
    expect(image.offsetForAddress(0xffff_f100)).toBeUndefined();
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/UEFIImageTests.swift#UEFIImageTests.testAddressesMapBothWays
  it("map both ways", () => {
    expect(mapped(0xffff_f000).addressForOffset(0x100)).toBe(0xffff_f100);
    expect(mapped(0xffff_f000).offsetForAddress(0xffff_f100)).toBe(0x100);
  });

  // A FIT entry pointing outside the image is a real post-mortem, and the
  // answer has to be "nowhere", not a wrapped-around offset.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/UEFIImageTests.swift#UEFIImageTests.testAnAddressOutsideTheImageLandsNowhere
  it("land nowhere when the address is outside the image", () => {
    const one = mapped(0xffff_f000);
    expect(one.offsetForAddress(0xffff_e000)).toBeUndefined();
    expect(one.offsetForAddress(0x1_0000_0000)).toBeUndefined();
    expect(one.addressForOffset(0x1000)).toBeUndefined();
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/UEFIImageTests.swift#UEFIImageTests.testAnAddressThatWouldOverflowIsNil
  it("are nothing when the sum would stop being exact", () => {
    expect(mapped(Number.MAX_SAFE_INTEGER).addressForOffset(0x100)).toBeUndefined();
  });
});
