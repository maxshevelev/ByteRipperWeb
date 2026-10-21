import { describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import { ImageReader } from "@/firmware/imageReader";
import {
  ACER_MOTHERBOARD_SERIAL,
  ACER_SERIAL,
  acerBlock,
  putText,
} from "@/firmware/testing/testAcerDMI";
import { dmiFieldTextOf } from "@/firmware/uefi/dmiField";
import { parseUefiImage } from "@/firmware/uefi/uefiImage";
import { nodeRange, type UEFINode } from "@/firmware/uefi/uefiNode";
import type { NodeDetail } from "@/tools/toolDetail";
import { acerDMIRowText } from "@/tools/uefi/uefiAcerDMIDetail";
import { uefiHelpTerm } from "@/tools/uefi/uefiHelpTerms";
import { buildNodeDetail } from "@/tools/uefi/uefiNodeDetail";
import { typeText } from "@/tools/uefi/uefiTreeDisplay";

/**
 * A DMI area's row and details: the row says the serial, the detail lists the identity
 * fields and what the integrity checks found in them, and `?` opens the entry. The format
 * is `acerDmiStore.ts`'s and tested there.
 *
 * @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIAcerDMIDetailTests.swift#UEFIAcerDMIDetailTests
 */

/** Padding, the block at `0x4000`, and padding. */
function parsed(block: Uint8Array = acerBlock()) {
  const bytes = Uint8Array.from([
    ...new Array<number>(0x4000).fill(0xff),
    ...block,
    ...new Array<number>(0x4000).fill(0xff),
  ]);
  const source = sourceOver(bytes);
  const image = parseUefiImage(source);
  const reader = new ImageReader(source);
  const node = image.allNodes.find((one) => one.kind === "acerDMIStore") as UEFINode;
  return { image, reader, node, detail: buildNodeDetail(node, image, reader) };
}

/** A field of the detail, or a row of its Entries table, where the area's values are. */
const value = (detail: NodeDetail, label: string) => {
  const one = detail.fields.find((field) => field.label === label);
  if (one !== undefined) return one.value;
  const entries = detail.tables.find((table) => table.title === "Entries");
  return entries?.rows.find((row) => row[0]?.text === label)?.[1]?.text;
};
const fieldsLabelled = (detail: NodeDetail, label: string) =>
  detail.fields.filter((one) => one.label === label);
const problems = (detail: NodeDetail) => detail.fields.filter((one) => one.tone === "bad");

describe("Acer's DMI area in the detail", () => {
  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIAcerDMIDetailTests.swift#UEFIAcerDMIDetailTests.testTheAreaSaysWhatItHolds
  it("says what it holds, with no problems and no notes on a factory block", () => {
    const { detail } = parsed();
    expect(value(detail, "Kind")).toBe("Acer DMI");
    expect(value(detail, "System serial")).toBe(ACER_SERIAL);
    expect(value(detail, "MB Serial")).toBe(ACER_MOTHERBOARD_SERIAL);
    expect(value(detail, "UUID")).toBe("78563412-AB90-1788-89CD-EF0102030405");
    expect(value(detail, "Model")).toBe("TEST-1050");
    expect(value(detail, "Product name")).toBe("Test Model");
    expect(value(detail, "Asset tag")).toBeUndefined();
    expect(value(detail, "Manufacturing code")).toBeUndefined();
    expect(problems(detail)).toHaveLength(0);
    const entries = detail.tables.find((table) => table.title === "Entries");
    expect(entries?.rows.map((row) => row[0]?.text)).toEqual([
      "System serial",
      "MB Serial",
      "UUID",
      "Model",
      "Product name",
    ]);
    const { node } = parsed();
    expect(entries?.rowTargets, "each value is a way to its row under the block's").toEqual(
      node.children.map((one) => ({ kind: "node", path: one.id }))
    );
    expect(entries?.linkColumn).toBe(0);
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIAcerDMIDetailTests.swift#UEFIAcerDMIDetailTests.testTheFieldsAreRowsUnderTheBlock
  it("has the block's fields as rows of their own, each saying what it holds", () => {
    const { image, reader, node } = parsed();
    const rows = node.children;
    expect(rows.map((one) => one.kind)).toEqual(Array(5).fill("dmiField"));
    expect(nodeRange(rows[0] as UEFINode)).toEqual({
      start: node.body.start,
      end: node.body.start + 0x16,
    });
    expect(dmiFieldTextOf(rows[0] as UEFINode, reader)).toBe(ACER_SERIAL);
    expect(dmiFieldTextOf(rows[2] as UEFINode, reader)).toBe(
      "78563412-AB90-1788-89CD-EF0102030405"
    );
    expect(value(buildNodeDetail(rows[3] as UEFINode, image, reader), "Value")).toBe("TEST-1050");
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIAcerDMIDetailTests.swift#UEFIAcerDMIDetailTests.testTheOptionalFieldsAreRowsWhereWritten
  it("shows the optional fields where written", () => {
    const block = acerBlock();
    putText(block, "Asset0001", 0xa0);
    putText(block, "12345678", 0x6a0);
    const { detail } = parsed(block);
    expect(value(detail, "Asset tag")).toBe("Asset0001");
    expect(value(detail, "Manufacturing code")).toBe("12345678");
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIAcerDMIDetailTests.swift#UEFIAcerDMIDetailTests.testTheRowSaysWhatItHolds
  it("has a row that says the serial, is padding to UEFITool, and opens its help entry", () => {
    const { node, reader } = parsed();
    expect(acerDMIRowText(node, reader)).toBe(`Acer DMI · ${ACER_SERIAL}`);
    expect(typeText(node)).toBe("Padding");
    expect(uefiHelpTerm(node)).toBe("acer-dmi");
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIAcerDMIDetailTests.swift#UEFIAcerDMIDetailTests.testATamperedAreaSaysWhatReadsWrong
  it("says what reads wrong in a tampered area", () => {
    const block = acerBlock();
    block[0x70 + 8] = 0x09; // the variant bit is not set
    block[0xf3] = 0x00; // the constant is not 02
    block.fill(0xaa, 0x130, 0x136); // the copy went stale
    const { detail } = parsed(block);
    const found = fieldsLabelled(detail, "Problem");
    expect(found).toHaveLength(3);
    expect(found.every((one) => one.tone === "bad")).toBe(true);
    expect(fieldsLabelled(detail, "Note")).toHaveLength(0);
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIAcerDMIDetailTests.swift#UEFIAcerDMIDetailTests.testAnErasedTailCopyIsANote
  it("calls an erased tail copy a note, not a fault", () => {
    const block = acerBlock();
    block.fill(0xff, 0x130, 0x136);
    const { detail } = parsed(block);
    const notes = fieldsLabelled(detail, "Note");
    expect(notes).toHaveLength(1);
    expect(notes.every((one) => one.tone !== "bad")).toBe(true);
    expect(problems(detail)).toHaveLength(0);
  });
});
