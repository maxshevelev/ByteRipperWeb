import { describe, expect, it } from "vitest";
import { encodeUtf8 } from "@/core/text/utf";
import { sourceOver } from "@/firmware/byteSource";
import { ImageReader } from "@/firmware/imageReader";
import { intelImage, volume, volumeTopFile } from "@/firmware/testing/testImage";
import { iteImage } from "@/firmware/testing/testInsyde";
import { allECImages, EC_COPY_SUBTYPE, isECFirmwarePadding } from "@/firmware/uefi/ecFirmware";
import { itemSubtype, itemType } from "@/firmware/uefi/itemClassification";
import { parseUefiImage } from "@/firmware/uefi/uefiImage";
import { nodeRange, type UEFINode } from "@/firmware/uefi/uefiNode";
import { ItemType, Sub } from "@/firmware/uefi/uefiTypes";

/**
 * Ported from `ECImageTests.swift`: a block of EC firmware holding more than one
 * image — a row per image, padding between them, and a copy told by its bytes
 * (`UEFI_IMAGE_FORMAT.md` §9).
 */

/** An image with the `PHCM` header and `length` bytes of something that is not the erase byte. */
const phcm = (length: number, fill = 0x5a): Uint8Array => {
  const bytes = new Uint8Array(length).fill(fill);
  bytes.set(encodeUtf8("PHCM"), 0);
  return bytes;
};

/** `parts` placed at their offsets in an erased block `size` long. */
function block(size: number, parts: readonly (readonly [number, Uint8Array])[]): Uint8Array {
  const bytes = new Uint8Array(size).fill(0xff);
  for (const [at, part] of parts) bytes.set(part, at);
  return bytes;
}

/** An image with a descriptor whose EC region is `ec`, and nothing else. */
function ecRegion(ec: Uint8Array): { region: UEFINode; whole: Uint8Array } {
  const start = 0x1000;
  const whole = intelImage({
    size: start + ec.length,
    regions: [{ type: "ec", start, end: start + ec.length }],
    contents: new Map([["ec", ec]]),
  });
  const region = (parseUefiImage(sourceOver(whole)).roots[0] as UEFINode).children.find(
    (node) => node.kind === "region"
  ) as UEFINode;
  return { region, whole };
}

const ranges = (nodes: readonly UEFINode[]) => nodes.map((node) => nodeRange(node));
const r = (start: number, end: number) => ({ start, end });

describe("EC images in a block", () => {
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/ECImageTests.swift#ECImageTests.testEveryImageFoundIsARowAndWhatLiesBetweenIsPadding
  it("gives every image found a row and leaves what lies between as padding", () => {
    const { region } = ecRegion(
      block(0x8000, [
        [0x0000, iteImage({ identification: "ITE5507-SB-V0.67", length: 0x1800 })],
        [0x3000, iteImage({ identification: "ITE8380-EC-V1.43", length: 0x2100 })],
      ])
    );
    // Each row names its chip; the block names none of them.
    expect(region.name).toBe("EC region");
    expect(region.children.map((node) => node.kind)).toEqual([
      "ecImage",
      "padding",
      "ecImage",
      "padding",
    ]);
    // An image runs to its last written byte, rounded up to 4 KiB.
    expect(ranges(region.children)).toEqual([
      r(0x1000, 0x3000),
      r(0x3000, 0x4000),
      r(0x4000, 0x7000),
      r(0x7000, 0x9000),
    ]);
    expect(
      region.children.filter((node) => node.kind === "ecImage").map((node) => node.name)
    ).toEqual(["ITE5507-SB-V0.67", "ITE8380-EC-V1.43"]);
    expect(region.children.every((node) => node.kind !== "ecImage" || node.isFixed)).toBe(true);
  });

  // A copy is as long as what it copies: what follows it — a log — stays padding
  // with data in it.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/ECImageTests.swift#ECImageTests.testACopyIsAsLongAsItsOriginal
  it("makes a copy as long as its original", () => {
    const image = phcm(0x1f00);
    const log = new Uint8Array(0x100).fill(0x01);
    const ec = block(0x8000, [
      [0x0000, image],
      [0x2000, image],
      [0x6000, log],
    ]);
    const { region, whole } = ecRegion(ec);
    const rows = region.children;

    expect(region.name).toBe("EC region");
    expect(rows.map((node) => node.kind)).toEqual(["ecImage", "ecImage", "padding"]);
    expect(ranges(rows)).toEqual([r(0x1000, 0x3000), r(0x3000, 0x5000), r(0x5000, 0x9000)]);
    expect(rows[0]?.name).toBe("PHCM image");
    expect(rows[0]?.subtype).toBeUndefined();
    expect(rows[1]?.subtype).toBe(EC_COPY_SUBTYPE);
    expect(rows[2]?.isErased).toBe(false);

    const found = allECImages(region.body, new ImageReader(sourceOver(whole)));
    expect(found.map((one) => one.written)).toEqual([0x1f00, 0x1f00]);
    expect(found.map((one) => one.copyOf)).toEqual([undefined, 0x1000]);
  });

  // Bytes that only resemble an earlier image are not a copy of it.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/ECImageTests.swift#ECImageTests.testAnImageThatDiffersIsNoCopy
  it("takes an image that differs for no copy", () => {
    const { region } = ecRegion(
      block(0x4000, [
        [0x0000, phcm(0x800)],
        [0x2000, phcm(0x800, 0x5b)],
      ])
    );
    expect(
      region.children.filter((node) => node.kind === "ecImage").map((node) => node.subtype)
    ).toEqual([undefined, undefined]);
  });

  // Padding holding two images is "EC firmware", and its rows say which.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/ECImageTests.swift#ECImageTests.testPaddingWithSeveralImagesNamesNoneOfThem
  it("names none of the images of padding that holds several", () => {
    const bytes = new Uint8Array(0x10000).fill(0xff);
    bytes.set(iteImage({ identification: "ITE5507-SB-V0.67" }), 0);
    bytes.set(iteImage({ identification: "ITE8380-EC-V0.00" }), 0x2000);
    bytes.set(volume({ length: 0x1000, lastFile: volumeTopFile() }), 0xf000);
    const padding = (parseUefiImage(sourceOver(bytes)).roots[0] as UEFINode)
      .children[0] as UEFINode;
    expect(padding.name).toBe("EC firmware");
    expect(isECFirmwarePadding(padding)).toBe(true);
    expect(
      padding.children.filter((node) => node.kind === "ecImage").map((node) => node.name)
    ).toEqual(["ITE5507-SB-V0.67", "ITE8380-EC-V0.00"]);
  });

  // One image at the block's start is the common case: the block is named by it,
  // keeps its length as a row would, and gets no rows.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/ECImageTests.swift#ECImageTests.testASingleImageAtTheStartAddsNoRows
  it("adds no rows for a single image at the start", () => {
    const { region } = ecRegion(block(0x4000, [[0x0000, phcm(0x1800)]]));
    expect(region.name).toBe("EC region (PHCM image)");
    expect(region.namedImageLength).toBe(0x2000);
    expect(region.children).toEqual([]);
  });

  // Blocks that name no single image carry no length for one.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/ECImageTests.swift#ECImageTests.testOnlyABlockNamedAfterOneImageKeepsItsLength
  it("keeps a length only for a block named after one image", () => {
    const { region: several } = ecRegion(
      block(0x4000, [
        [0x0000, phcm(0x800)],
        [0x2000, phcm(0x800)],
      ])
    );
    expect(several.namedImageLength).toBeUndefined();
    expect(several.children.every((node) => node.namedImageLength === undefined)).toBe(true);
  });

  // One image further in gets a row, so the bytes before it are seen.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/ECImageTests.swift#ECImageTests.testASingleImageFurtherInIsARow
  it("gives a single image further in a row", () => {
    const { region } = ecRegion(
      block(0x4000, [
        [0x0000, Uint8Array.of(0x12, 0x34)],
        [0x1000, phcm(0x800)],
      ])
    );
    expect(region.children.map((node) => node.kind)).toEqual(["padding", "ecImage", "padding"]);
    expect(region.children[0]?.isErased).toBe(false);
  });

  // An EC region with no image it knows stays as it was.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/ECImageTests.swift#ECImageTests.testAnEmptyECRegionStaysAsItWas
  it("leaves an empty EC region as it was", () => {
    const { region } = ecRegion(new Uint8Array(0x2000).fill(0xff));
    expect(region.name).toBe("EC region");
    expect(region.children).toEqual([]);
  });

  // An image classifies as UEFITool's padding.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/ECImageTests.swift#ECImageTests.testAnImageClassifiesAsPadding
  it("classifies an image as padding", () => {
    const { region } = ecRegion(block(0x4000, [[0x1000, phcm(0x800)]]));
    const image = region.children.find((node) => node.kind === "ecImage") as UEFINode;
    expect(itemType(image)).toBe(ItemType.padding);
    expect(itemSubtype(image)).toBe(Sub.dataPadding);
  });
});
