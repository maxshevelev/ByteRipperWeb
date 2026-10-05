import { describe, expect, it } from "vitest";
import { termId } from "@/core/help/helpIds";
import { sourceOver } from "@/firmware/byteSource";
import { ImageReader } from "@/firmware/imageReader";
import { EC_COPY_SUBTYPE } from "@/firmware/uefi/ecFirmware";
import { GuidsCatalogue } from "@/firmware/uefi/guidsCatalogue";
import { UEFIImage } from "@/firmware/uefi/uefiImage";
import { makeNode, makeSpan, nodeRange, type UEFINode } from "@/firmware/uefi/uefiNode";
import { uefiHelpTerm } from "@/tools/uefi/uefiHelpTerms";
import { buildNodeDetail } from "@/tools/uefi/uefiNodeDetail";
import { nodeName } from "@/tools/uefi/uefiTreeDisplay";

/**
 * Ported from `ECImageDisplayTests.swift`: an EC image row — named by what it
 * carries, a copy saying so, and the details reading the image again from the
 * block it is in.
 */

const r = (start: number, end: number) => ({ start, end });

/** A 16 KiB EC region: an image with a `PHCM` header at its start and its copy at `0x2000`. */
function built(): { image: UEFIImage; reader: ImageReader } {
  const bytes = new Uint8Array(0x4000).fill(0xff);
  const picture = new Uint8Array(0x800).fill(0x5a);
  picture.set(new TextEncoder().encode("PHCM"), 0);
  bytes.set(picture, 0);
  bytes.set(picture, 0x2000);
  const rows: UEFINode[] = [
    makeNode({
      kind: "ecImage",
      name: "PHCM image",
      header: r(0, 0),
      body: r(0, 0x1000),
      isFixed: true,
    }),
    makeSpan({ kind: "padding", name: "Empty padding", range: r(0x1000, 0x2000), isErased: true }),
    makeNode({
      kind: "ecImage",
      subtype: EC_COPY_SUBTYPE,
      name: "PHCM image",
      header: r(0x2000, 0x2000),
      body: r(0x2000, 0x3000),
      isFixed: true,
    }),
    makeSpan({ kind: "padding", name: "Empty padding", range: r(0x3000, 0x4000), isErased: true }),
  ];
  const region = makeNode({
    kind: "region",
    subtype: 6,
    name: "EC region",
    header: r(0, 0),
    body: r(0, 0x4000),
    isFixed: true,
    children: rows,
  });
  return {
    image: new UEFIImage({ size: 0x4000, roots: [region] }),
    reader: new ImageReader(sourceOver(bytes)),
  };
}

describe("an EC image row", () => {
  // @upstream Modules/UEFITool/Tests/UEFIToolTests/ECImageDisplayTests.swift#ECImageDisplayTests.testACopySaysSo
  it("says so when it is a copy", () => {
    const { image } = built();
    const names = (image.roots[0] as UEFINode).children
      .filter((node) => node.kind === "ecImage")
      .map((node) =>
        nodeName(
          { ...node, length: nodeRange(node).end - nodeRange(node).start },
          GuidsCatalogue.empty
        )
      );
    expect(names).toEqual(["PHCM image, 4 KB", "PHCM image, 4 KB (copy)"]);
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/ECImageDisplayTests.swift#ECImageDisplayTests.testTheDetailsSayWhatTheImageIsAndWhatItCopies
  it("says in its details what the image is and what it copies", () => {
    const { image, reader } = built();
    const fields = (index: number) => {
      const node = (image.roots[0] as UEFINode).children[index] as UEFINode;
      const detail = buildNodeDetail(node, image, reader, []);
      return new Map(detail.fields.map((one) => [one.label, one.value] as const));
    };
    expect(fields(0).get("Kind")).toBe("EC firmware image");
    expect(fields(0).get("Format")).toBe("PHCM (Microchip MEC)");
    // The header does not say whose chip it is.
    expect(fields(0).get("Vendor")).toBeUndefined();
    expect(fields(0).get("Written")).toBe("0x800 (2048)");
    expect(fields(0).has("Copy of")).toBe(false);
    expect(fields(2).get("Copy of")).toBe("0x0");
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/ECImageDisplayTests.swift#ECImageDisplayTests.testAnImageOpensTheECPage
  it("opens the EC page", () => {
    const { image } = built();
    expect(uefiHelpTerm((image.roots[0] as UEFINode).children[0] as UEFINode)).toBe(
      termId("ec-firmware")
    );
  });
});
