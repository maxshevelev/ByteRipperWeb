import { describe, expect, it } from "vitest";
import { termId } from "@/core/help/helpIds";
import { sourceOver } from "@/firmware/byteSource";
import { ImageReader } from "@/firmware/imageReader";
import { gifPicture } from "@/firmware/testing/testPicture";
import { PICTURE_FORMATS } from "@/firmware/uefi/picture";
import { UEFIImage } from "@/firmware/uefi/uefiImage";
import { makeNode, type UEFINode } from "@/firmware/uefi/uefiNode";
import { isProblemField } from "@/tools/toolDetail";
import { uefiHelpTerm } from "@/tools/uefi/uefiHelpTerms";
import { buildNodeDetail } from "@/tools/uefi/uefiNodeDetail";
import { nodeOpen } from "@/tools/uefi/uefiPresenter";

/**
 * Ported from `PictureDisplayTests.swift`: a picture row — its details read it
 * again, `?` opens the picture entry, and saving it offers a file a viewer opens,
 * by its format's extension.
 */

const r = (start: number, end: number) => ({ start, end });

/** The smallest JPEG the reader takes: a 2×1 frame, an empty scan. */
const JPEG: readonly number[] = [
  0xff,
  0xd8,
  0xff,
  0xe1,
  0x00,
  0x08,
  ...new TextEncoder().encode("Exif"),
  0,
  0,
  0xff,
  0xc0,
  0x00,
  0x0b,
  0x08,
  0x00,
  0x01,
  0x00,
  0x02,
  0x01,
  0x01,
  0x11,
  0x00,
  0xff,
  0xda,
  0x00,
  0x08,
  0x01,
  0x01,
  0x00,
  0x00,
  0x3f,
  0x00,
  0xff,
  0xd9,
];

function built(): { image: UEFIImage; reader: ImageReader } {
  const bytes = new Uint8Array(0x1000).fill(0xff);
  bytes.set(JPEG, 0x100);
  const picture = makeNode({
    kind: "picture",
    subtype: PICTURE_FORMATS.jpeg,
    name: "JPEG 2×1",
    header: r(0x100, 0x100),
    body: r(0x100, 0x100 + JPEG.length),
  });
  const root = makeNode({
    kind: "uefiImage",
    name: "UEFI image",
    header: r(0, 0),
    body: r(0, 0x1000),
    children: [picture],
  });
  return {
    image: new UEFIImage({ size: 0x1000, roots: [root] }),
    reader: new ImageReader(sourceOver(bytes)),
  };
}

const asZoned = (node: UEFINode) => ({
  id: node.id,
  name: node.name,
  kind: node.kind,
  subtype: node.subtype,
  header: [node.header.start, node.header.end] as const,
  body: [node.body.start, node.body.end] as const,
  tail: [node.tail.start, node.tail.end] as const,
});

describe("a picture row", () => {
  // @upstream Modules/UEFITool/Tests/UEFIToolTests/PictureDisplayTests.swift#PictureDisplayTests.testTheDetailsSayWhatThePictureIs
  it("says in its details what the picture is", () => {
    const { image, reader } = built();
    const detail = buildNodeDetail(
      (image.roots[0] as UEFINode).children[0] as UEFINode,
      image,
      reader,
      []
    );
    const value = (label: string) => detail.fields.find((one) => one.label === label)?.value;
    expect(value("Kind")).toBe("Picture");
    expect(value("Format")).toBe("JPEG (Exif)");
    expect(value("Picture size")).toBe("2 × 1");
  });

  // The panel is handed the picture's bytes to draw, and only a picture's.
  // @upstream Modules/UEFITool/Tests/UEFIToolTests/PictureDisplayTests.swift#PictureDisplayTests.testThePictureIsHandedToThePanel
  it("hands the picture's bytes to the panel, and only a picture's", () => {
    const { image, reader } = built();
    const picture = (image.roots[0] as UEFINode).children[0] as UEFINode;
    const detail = buildNodeDetail(picture, image, reader, []);
    expect(detail.picture).toEqual({ bytes: Uint8Array.from(JPEG), mime: "image/jpeg" });
    expect(buildNodeDetail(image.roots[0] as UEFINode, image, reader, []).picture).toBeUndefined();
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/PictureDisplayTests.swift#PictureDisplayTests.testItOpensItsEntryAndSavesAsAJPEG
  it("opens its own entry and saves as a JPEG", () => {
    const { image } = built();
    const node = (image.roots[0] as UEFINode).children[0] as UEFINode;
    expect(uefiHelpTerm(node)).toBe(termId("picture"));
    expect(nodeOpen(asZoned(node), false)?.suggestedName).toBe("JPEG 2×1.jpg");
  });

  // A BMP whose header asks for more than its section holds says so, and a BMP
  // saves as one.
  // @upstream Modules/UEFITool/Tests/UEFIToolTests/PictureDisplayTests.swift#PictureDisplayTests.testABMPCutShortSaysSo
  it("says so when a BMP is cut short, and saves a BMP as one", () => {
    const bmp = Uint8Array.from([
      0x42,
      0x4d,
      0x4e,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0x36,
      0,
      0,
      0,
      0x28,
      0,
      0,
      0,
      3,
      0,
      0,
      0,
      2,
      0,
      0,
      0,
      1,
      0,
      24,
      0,
      ...new Array<number>(24).fill(0),
      ...new Array<number>(20).fill(0x7f), // 24 bytes of rows declared
    ]);
    const picture = makeNode({
      kind: "picture",
      subtype: PICTURE_FORMATS.bmp,
      name: "BMP 3×2",
      header: r(0, 0),
      body: r(0, bmp.length),
    });
    const section = makeNode({
      kind: "section",
      subtype: 0x19,
      name: "Raw section",
      header: r(0, 0),
      body: r(0, bmp.length),
      children: [picture],
    });
    const image = new UEFIImage({ size: bmp.length, roots: [section] });
    const node = (image.roots[0] as UEFINode).children[0] as UEFINode;
    const detail = buildNodeDetail(node, image, new ImageReader(sourceOver(bmp)), []);
    const field = (label: string) => detail.fields.find((one) => one.label === label);
    expect(field("Format")?.value).toBe("BMP (24-bit)");
    expect(field("Declared size")?.value).toBe("0x4E (78) — the section ends earlier");
    expect(isProblemField(field("Declared size") as NonNullable<ReturnType<typeof field>>)).toBe(
      true
    );
    expect(nodeOpen(asZoned(node), false)?.suggestedName).toBe("BMP 3×2.bmp");
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/PictureDisplayTests.swift#PictureDisplayTests.testAnAnimationSaysHowManyFramesItHas
  it("says how many frames an animation has", () => {
    const gif = gifPicture({ width: 2, height: 1, frames: 3 });
    const node = makeNode({
      kind: "picture",
      subtype: PICTURE_FORMATS.gif,
      name: "GIF 2×1",
      header: r(0, 0),
      body: r(0, gif.length),
    });
    const image = new UEFIImage({ size: gif.length, roots: [node] });
    const frames = (bytes: Uint8Array, target: UEFINode) =>
      buildNodeDetail(
        target,
        new UEFIImage({ size: bytes.length, roots: [target] }),
        new ImageReader(sourceOver(bytes)),
        []
      ).fields.find((one) => one.label === "Frames")?.value;
    expect(image.roots).toHaveLength(1);
    expect(frames(gif, node)).toBe("3");
    const still = gifPicture({ width: 2, height: 1 });
    const stillNode = makeNode({
      kind: "picture",
      subtype: PICTURE_FORMATS.gif,
      name: "GIF 2×1",
      header: r(0, 0),
      body: r(0, still.length),
    });
    expect(frames(still, stillNode)).toBeUndefined();
  });
});
