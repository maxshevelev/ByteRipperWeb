import { describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import { ImageReader } from "@/firmware/imageReader";
import { section } from "@/firmware/testing/testImage";
import { nvarSectionVolume } from "@/firmware/testing/testNvar";
import { bmpPicture, gifPicture, jpegPicture, pngPicture } from "@/firmware/testing/testPicture";
import { itemType } from "@/firmware/uefi/itemClassification";
import { pictureName, readPicture } from "@/firmware/uefi/picture";
import { Section } from "@/firmware/uefi/sectionParser";
import { parseUefiImage } from "@/firmware/uefi/uefiImage";
import { nodeRange, type UEFINode } from "@/firmware/uefi/uefiNode";
import { ItemType } from "@/firmware/uefi/uefiTypes";

/**
 * Ported from `PictureTests.swift`: a picture in a firmware image
 * (`UEFI_IMAGE_FORMAT.md` §9) — JPEG, PNG, GIF or BMP: found by its start, measured
 * by reading it through to its end, in padding and as the body of a raw section.
 */

const reader = (bytes: Uint8Array) => new ImageReader(sourceOver(bytes));
const join = (...parts: readonly Uint8Array[]) =>
  Uint8Array.from(parts.flatMap((part) => [...part]));
const filled = (count: number, byte: number) => new Uint8Array(count).fill(byte);
const read = (bytes: Uint8Array, at = 0, options?: { truncated?: boolean }) =>
  readPicture(at, bytes.length, reader(bytes), options?.truncated === true);

describe("a JPEG", () => {
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/PictureTests.swift#PictureTests.testAPictureIsReadToItsEndMarker
  it("is read to its end marker", () => {
    const bytes = join(Uint8Array.of(0x00), jpegPicture(), filled(32, 0xff));
    const picture = read(bytes, 1);
    expect(picture).toEqual({
      format: "jpeg",
      range: { start: 1, end: 1 + jpegPicture().length },
      variant: "JFIF",
      width: 800,
      height: 480,
    });
    expect(picture === undefined ? "" : pictureName(picture)).toBe("JPEG 800×480");
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/PictureTests.swift#PictureTests.testAnExifPictureIsOneToo
  it("is one when it opens with Exif", () => {
    const picture = readPicture(
      0,
      0x100,
      reader(join(jpegPicture({ exif: true, width: 64, height: 32 }), filled(0x80, 0xff)))
    );
    expect(picture?.variant).toBe("Exif");
    expect(picture === undefined ? "" : pictureName(picture)).toBe("JPEG 64×32");
  });

  // Without its end marker, or without the segment that names the format, what is
  // there is not taken for a picture.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/PictureTests.swift#PictureTests.testAnythingLessIsNoPicture
  it("is none without its end marker or the segment that names the format", () => {
    expect(read(jpegPicture({ end: false }))).toBeUndefined();
    const bare = jpegPicture();
    bare.set(new TextEncoder().encode("JFXX"), 6);
    expect(read(bare)).toBeUndefined();
  });

  // In a raw area the picture is a row of its own, and the padding around it stays.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/PictureTests.swift#PictureTests.testTheScanFindsAPictureInPadding
  it("is found by the scan in padding", () => {
    const bytes = filled(0x4000, 0xff);
    const picture = jpegPicture();
    bytes.set(picture, 0x1000);
    const parsed = parseUefiImage(sourceOver(bytes), { readsProtectedRanges: false });
    const nodes = (parsed.roots[0] as UEFINode).children;

    expect(nodes.map((node) => node.kind)).toEqual(["padding", "picture", "padding"]);
    expect(nodes[1]?.name).toBe("JPEG 800×480");
    expect(nodeRange(nodes[1] as UEFINode)).toEqual({
      start: 0x1000,
      end: 0x1000 + picture.length,
    });
    expect(itemType(nodes[1] as UEFINode)).toBe(ItemType.padding);
    expect(parsed.diagnostics).toEqual([]);
  });
});

describe("a PNG, a GIF and a BMP", () => {
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/PictureTests.swift#PictureTests.testEachFormatIsReadThroughToItsEnd
  it("is each read through to its end", () => {
    const cases: readonly (readonly [Uint8Array, string, string | undefined])[] = [
      [pngPicture(), "PNG 16×8", undefined],
      [gifPicture(), "GIF 10×4", "89a"],
      [bmpPicture(), "BMP 3×2", "24-bit"],
      [bmpPicture({ height: -2 }), "BMP 3×2", "24-bit"],
    ];
    for (const [bytes, name, variant] of cases) {
      const picture = read(join(bytes, filled(0x40, 0xab)));
      expect(picture === undefined ? "" : pictureName(picture), name).toBe(name);
      expect(picture?.variant, name).toBe(variant);
      expect(picture?.range, name).toEqual({ start: 0, end: bytes.length });
      expect(picture?.declaredLength).toBeUndefined();
    }
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/PictureTests.swift#PictureTests.testAPictureThatDoesNotReadToItsEndIsNone
  it("is none when it does not read to its end", () => {
    for (const bytes of [
      pngPicture({ end: false }),
      gifPicture({ end: false }),
      bmpPicture({ dib: 41 }),
      bmpPicture({ declared: 60 }),
    ]) {
      expect(read(join(bytes, filled(0x40, 0xff))), `${[...bytes.subarray(0, 4)]}`).toBeUndefined();
    }
  });

  // A BMP that declares more than its section holds is the section's picture as
  // far as it goes — and only there.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/PictureTests.swift#PictureTests.testABMPCutShortIsTakenOnlyWhenAskedTo
  it("takes a BMP cut short only when asked to", () => {
    const bytes = bmpPicture().subarray(0, bmpPicture().length - 4);
    expect(read(bytes)).toBeUndefined();
    const cut = read(bytes, 0, { truncated: true });
    expect(cut?.range).toEqual({ start: 0, end: bytes.length });
    expect(cut?.declaredLength).toBe(bytes.length + 4);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/PictureTests.swift#PictureTests.testTheScanFindsEveryFormatInPadding
  it("is found by the scan in padding, every format", () => {
    const bytes = filled(0x4000, 0xff);
    for (const [at, picture] of [
      [0x1000, pngPicture()],
      [0x2000, gifPicture()],
      [0x3000, bmpPicture()],
    ] as const) {
      bytes.set(picture, at);
    }
    const parsed = parseUefiImage(sourceOver(bytes), { readsProtectedRanges: false });
    const pictures = (parsed.roots[0] as UEFINode).children.filter(
      (node) => node.kind === "picture"
    );
    expect(pictures.map((node) => node.name)).toEqual(["PNG 16×8", "GIF 10×4", "BMP 3×2"]);
    expect(pictures.map((node) => node.subtype)).toEqual([2, 3, 4]);
    expect(parsed.diagnostics).toEqual([]);
  });

  // Where nearly every logo is: a raw section's body. The picture is the section's
  // child, and bytes after it stay padding.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/PictureTests.swift#PictureTests.testARawSectionsBodyIsReadAsItsPicture
  it("is read as the picture a raw section's body is", () => {
    const body = join(bmpPicture(), filled(6, 0xff));
    const volume = nvarSectionVolume({ sections: [section({ type: Section.raw, body })] });
    const parsed = parseUefiImage(sourceOver(volume), { readsProtectedRanges: false });
    const holder = parsed.allNodes.find(
      (node) => node.kind === "section" && node.subtype === Section.raw
    ) as UEFINode;
    expect(holder.children.map((node) => node.kind)).toEqual(["picture", "padding"]);
    expect(holder.children[0]?.name).toBe("BMP 3×2");
    expect(nodeRange(holder.children[0] as UEFINode).start).toBe(holder.body.start);
    expect(nodeRange(holder.children[1] as UEFINode).end).toBe(holder.body.end);
    expect(parsed.diagnostics).toEqual([]);
  });
});
