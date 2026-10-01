import { describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import {
  BinaryWriter,
  DRIVER_GUID,
  file,
  microcode,
  section,
  volume,
} from "@/firmware/testing/testImage";
import { type EFIGUID, guid } from "@/firmware/uefi/efiGuid";
import { FFS, isRomHole } from "@/firmware/uefi/fileParser";
import { Section } from "@/firmware/uefi/sectionParser";
import { parseUefiImage } from "@/firmware/uefi/uefiImage";
import type { UEFINode } from "@/firmware/uefi/uefiNode";

/**
 * Ported from `RawFileBodyTests.swift`: a raw file's body, read the way
 * UEFITool's `parseFileBody` reads it — sections when it reads as sections, a
 * raw area otherwise, and a leaf when that area holds nothing; an AMI ROM hole
 * stays whole and fixed.
 */

const bytes = (...values: number[]) => Uint8Array.from(values);
const join = (...parts: Uint8Array[]) => Uint8Array.from(parts.flatMap((part) => [...part]));

function rawFile(
  body: Uint8Array,
  options: { readonly guid?: EFIGUID; readonly type?: number } = {}
) {
  const parsed = parseUefiImage(
    sourceOver(
      volume({
        length: 0x1000,
        files: [
          file({ guid: options.guid ?? DRIVER_GUID, type: options.type ?? FFS.rawType, body }),
        ],
      })
    )
  );
  return { file: (parsed.roots[0] as UEFINode).children[0] as UEFINode, parsed };
}

const kinds = (nodes: readonly UEFINode[]) => nodes.map((node) => node.kind);

describe("a raw file's body", () => {
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/RawFileBodyTests.swift#RawFileBodyTests.testABodyThatIsSectionsReadsAsSections
  it("reads as sections when it is sections", () => {
    const body = join(
      section({ type: Section.raw, body: bytes(1, 2, 3, 4) }),
      section({ type: Section.raw, body: bytes(5, 6, 7, 8) })
    );
    const { file: raw, parsed } = rawFile(body);
    expect(kinds(raw.children)).toEqual(["section", "section"]);
    expect(parsed.diagnostics).toEqual([]);
  });

  // The `all` type is read the way a raw file is.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/RawFileBodyTests.swift#RawFileBodyTests.testAnAllTypeFileIsReadLikeARawOne
  it("reads an all-type file like a raw one", () => {
    const { file: all } = rawFile(section({ type: Section.raw, body: bytes(1, 2, 3, 4) }), {
      type: FFS.allType,
    });
    expect(kinds(all.children)).toEqual(["section"]);
  });

  // Data that is not sections and holds nothing a raw area can find leaves the
  // file a leaf, quietly.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/RawFileBodyTests.swift#RawFileBodyTests.testPlainDataLeavesTheFileALeaf
  it("leaves the file a leaf for plain data", () => {
    const { file: raw, parsed } = rawFile(new TextEncoder().encode("BM\u0001\u0002 a logo, say"));
    expect(raw.children).toEqual([]);
    expect(parsed.diagnostics).toEqual([]);
  });

  // A body that is not sections is searched as a raw area: a volume inside one
  // is found.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/RawFileBodyTests.swift#RawFileBodyTests.testAVolumeInsideARawFileIsFound
  it("finds a volume inside a raw file", () => {
    const inner = volume({ length: 0x200 });
    const { file: raw } = rawFile(
      join(bytes(0xab, 0xcd, 0xef, 0x01), new Uint8Array(0x0c).fill(0xff), inner)
    );
    expect(raw.children.some((node) => node.kind === "volume")).toBe(true);
  });

  // The store the FIT points into: a raw file of microcode reads as its images,
  // as it did when that was the one raw file opened.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/RawFileBodyTests.swift#RawFileBodyTests.testMicrocodeInARawFileIsFound
  it("finds microcode in a raw file", () => {
    const { file: raw } = rawFile(join(microcode(), microcode({ signature: 0x806ea })));
    expect(raw.children.filter((node) => node.kind === "microcode")).toHaveLength(2);
  });

  // A section whose size runs past the body, or a GUID-defined one whose data
  // offset does, is not a run of sections.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/RawFileBodyTests.swift#RawFileBodyTests.testABrokenSectionRunIsNotReadAsSections
  it("does not read a broken section run as sections", () => {
    const tooBig = section({ type: Section.raw, body: bytes(1, 2, 3, 4), size: 0x40 });
    expect(rawFile(tooBig).file.children.some((node) => node.kind === "section")).toBe(false);

    const guided = new BinaryWriter()
      .guid(DRIVER_GUID)
      .u16(0x400) // DataOffset, past the section
      .u16(0).bytes;
    const badOffset = section({
      type: Section.guidDefined,
      body: bytes(1, 2, 3, 4),
      extra: guided,
    });
    expect(rawFile(badOffset).file.children.some((node) => node.kind === "section")).toBe(false);
  });

  // An AMI ROM hole is the vendor's: kept whole, and fixed in place.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/RawFileBodyTests.swift#RawFileBodyTests.testAnAmiRomHoleStaysWholeAndFixed
  it("keeps an AMI ROM hole whole and fixed", () => {
    const hole = guid("05CA0203-0FC1-11DC-9011-00173153EBA8");
    const { file: raw } = rawFile(section({ type: Section.raw, body: bytes(1, 2, 3, 4) }), {
      guid: hole,
    });
    expect(raw.children).toEqual([]);
    expect(raw.isFixed).toBe(true);
    expect(isRomHole(guid("05CA020C-0FC1-11DC-9011-00173153EBA8"))).toBe(false);
  });
});
