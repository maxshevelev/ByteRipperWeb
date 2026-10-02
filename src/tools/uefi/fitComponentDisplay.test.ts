import { describe, expect, it } from "vitest";
import { termId } from "@/core/help/helpIds";
import { sourceOver } from "@/firmware/byteSource";
import { ImageReader } from "@/firmware/imageReader";
import {
  FIT_COMPONENT_KINDS,
  type FITComponentKind,
  fitComponentName,
} from "@/firmware/uefi/fitComponents";
import { GuidsCatalogue } from "@/firmware/uefi/guidsCatalogue";
import { UEFIImage } from "@/firmware/uefi/uefiImage";
import { makeNode, makeSpan, type UEFINode } from "@/firmware/uefi/uefiNode";
import { uefiHelpTerm } from "@/tools/uefi/uefiHelpTerms";
import { buildNodeDetail } from "@/tools/uefi/uefiNodeDetail";
import { nodeName } from "@/tools/uefi/uefiTreeDisplay";

/**
 * Ported from `FITComponentDisplayTests.swift`: a structure the FIT names, read out
 * of padding — named by what it is, its header's fields in the details, and the
 * glossary entry for it on `?`.
 */

const r = (start: number, end: number) => ({ start, end });

/** Padding holding a Startup ACM at `0x1000`, a v1 Key Manifest at `0x2000` and a two-row FIT at `0x3000`. */
function built(): { image: UEFIImage; reader: ImageReader } {
  const bytes = new Uint8Array(0x4000).fill(0xff);
  // Type 2, subtype 3; header length, version 0; chipset; Intel; BCD date; 0x400
  // dwords; SVN 2.
  const acm = [
    0x02, 0x00, 0x03, 0x00, 0xa1, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0c, 0xb0, 0x00, 0x00,
    0x86, 0x80, 0x00, 0x00, 0x24, 0x06, 0x15, 0x20, 0x00, 0x04, 0x00, 0x00, 0x02, 0x00,
  ];
  bytes.set(acm, 0x1000);
  bytes.set([...new TextEncoder().encode("__KEYM__"), 0x10, 0x10, 0x00, 0x01], 0x2000);
  bytes.set([...new TextEncoder().encode("_FIT_   "), 0x02, 0x00, 0x00], 0x3000);

  const row = (kind: FITComponentKind, range: { start: number; end: number }): UEFINode =>
    makeNode({
      kind: "fitComponent",
      subtype: FIT_COMPONENT_KINDS[kind],
      name: fitComponentName(kind),
      header: r(range.start, range.start),
      body: range,
      isFixed: true,
    });
  const rows = [
    makeSpan({ kind: "padding", name: "Empty padding", range: r(0, 0x1000), isErased: true }),
    row("startupACM", r(0x1000, 0x2000)),
    row("keyManifest", r(0x2000, 0x2241)),
    row("table", r(0x3000, 0x3020)),
  ];
  const region = makeNode({
    kind: "region",
    subtype: 1,
    name: "BIOS region",
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

const fields = (index: number) => {
  const { image, reader } = built();
  const node = (image.roots[0] as UEFINode).children[index] as UEFINode;
  const detail = buildNodeDetail(node, image, reader, []);
  return new Map(detail.fields.map((one) => [one.label, one.value] as const));
};

describe("a structure the FIT names", () => {
  // @upstream Modules/UEFITool/Tests/UEFIToolTests/FITComponentDisplayTests.swift#FITComponentDisplayTests.testARowIsNamedByWhatItIs
  it("is named by what it is", () => {
    const { image } = built();
    const names = (image.roots[0] as UEFINode).children
      .slice(1)
      .map((node) => nodeName(node, GuidsCatalogue.empty));
    expect(names).toEqual(["Startup ACM", "Boot Guard Key Manifest", "FIT"]);
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/FITComponentDisplayTests.swift#FITComponentDisplayTests.testTheDetailsReadTheHeader
  it("reads its header in the details", () => {
    expect(fields(1).get("Kind")).toBe("FIT component");
    expect(fields(1).get("Module subtype")).toBe("Boot Guard");
    expect(fields(1).get("Chipset ID")).toBe("0xB00C");
    expect(fields(1).get("Date")).toBe("2015-06-24");
    expect(fields(1).get("ACM SVN")).toBe("2");
    expect(fields(2).get("Version")).toBe("0x10");
    expect(fields(2).get("KM ID")).toBe("0x1");
    expect(fields(3).get("Entries")).toBe("2");
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/FITComponentDisplayTests.swift#FITComponentDisplayTests.testEachOpensItsOwnGlossaryEntry
  it("opens its own glossary entry", () => {
    const { image } = built();
    expect(
      (image.roots[0] as UEFINode).children.slice(1).map((node) => uefiHelpTerm(node))
    ).toEqual([termId("acm"), termId("key-manifest"), termId("fit")]);
  });
});
