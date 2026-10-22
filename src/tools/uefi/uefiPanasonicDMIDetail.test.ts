import { describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import { ImageReader } from "@/firmware/imageReader";
import {
  PANASONIC_KEY,
  PANASONIC_SERIAL,
  panasonicBlock,
} from "@/firmware/testing/testPanasonicDMI";
import { GuidsCatalogue } from "@/firmware/uefi/guidsCatalogue";
import { parseUefiImage } from "@/firmware/uefi/uefiImage";
import type { UEFINode } from "@/firmware/uefi/uefiNode";
import type { NodeDetail } from "@/tools/toolDetail";
import { uefiHelpTerm } from "@/tools/uefi/uefiHelpTerms";
import { buildNodeDetail } from "@/tools/uefi/uefiNodeDetail";
import { panasonicDMIRowText } from "@/tools/uefi/uefiPanasonicDMIDetail";
import { nodeName, typeText } from "@/tools/uefi/uefiTreeDisplay";

/**
 * Panasonic's DMI area's row and details: the row says the model and the serial, the detail lists
 * the identity fields and the records, a record says what its header holds, and `?` opens the
 * entry. The format is `panasonicDmiStore.ts`'s and tested there.
 *
 * @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIPanasonicDMIDetailTests.swift#UEFIPanasonicDMIDetailTests
 */

/**
 * Padding, at `0x4000` a block of three records — the asset tag and the serial behind short
 * headers, the key behind a long one — and padding. Every checksum holds unless `breaking`
 * changes a byte after them.
 */
function parsed(breaking?: (block: Uint8Array) => void) {
  const block = panasonicBlock({
    length: 0x200,
    records: [
      { id: 0x02, at: 0x100, length: 0x80, long: false },
      { id: 0x03, at: 0x180, length: 0x40, long: false },
      { id: 0x16, at: 0x1c0, length: 0x39, long: true },
    ],
    address: (at) => (0xff40_4000 + at) >>> 0,
  });
  breaking?.(block);
  const bytes = Uint8Array.from([
    ...new Array<number>(0x4000).fill(0xff),
    ...block,
    ...new Array<number>(0x3e00).fill(0xff),
  ]);
  const source = sourceOver(bytes);
  const image = parseUefiImage(source);
  const reader = new ImageReader(source);
  const node = image.allNodes.find((one) => one.kind === "panasonicDMIStore") as UEFINode;
  const detailOf = (one: UEFINode) => buildNodeDetail(one, image, reader);
  return { image, reader, node, detailOf };
}

/** A field of the detail, or a row of its Entries table, where the area's values are. */
const value = (detail: NodeDetail, label: string) => {
  const one = detail.fields.find((field) => field.label === label);
  if (one !== undefined) return one.value;
  const entries = detail.tables.find((table) => table.title === "Entries");
  return entries?.rows.find((row) => row[0]?.text === label)?.[1]?.text;
};

describe("Panasonic's DMI area in the detail", () => {
  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIPanasonicDMIDetailTests.swift#UEFIPanasonicDMIDetailTests.testTheAreaSaysWhatItHolds
  it("says what it holds, and lists the directory", () => {
    const { node, detailOf } = parsed();
    const detail = detailOf(node);
    expect(value(detail, "Kind")).toBe("Panasonic DMI");
    expect(value(detail, "Model")).toBe("FZ55-2");
    expect(value(detail, "Model code")).toBe("FZ55FZ-52M4");
    expect(value(detail, "Asset tag")).toBe("No Asset Tag");
    expect(value(detail, "Serial")).toBe(PANASONIC_SERIAL);
    expect(value(detail, "Windows product key")).toBe(PANASONIC_KEY);
    const entries = detail.tables.find((table) => table.title === "Entries");
    expect(
      entries?.rowTargets?.every((target) => target !== undefined),
      "each value is a way to its row"
    ).toBe(true);
    const records = detail.tables.find((table) => table.title === "Directory");
    expect(records?.rows.map((row) => row.map((one) => one.text))).toEqual([
      ["0x02", "0xFF404100", "0x80", "OK", "Asset tag"],
      ["0x03", "0xFF404180", "0x40", "OK", "Serial"],
      ["0x16", "0xFF4041C0", "0x39", "OK", "Windows product key"],
    ]);
    expect(
      detail.fields.filter((one) => one.tone === "bad"),
      "every sum holds"
    ).toEqual([]);
    expect(records?.rowTargets).toEqual(
      node.children
        .filter((child) => child.kind === "panasonicDMIRecord")
        .map((child) => ({ kind: "node", path: child.id }))
    );
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIPanasonicDMIDetailTests.swift#UEFIPanasonicDMIDetailTests.testARecordSaysWhatItsHeaderHolds
  it("says what a record's header holds", () => {
    const { node, detailOf } = parsed();
    const record = node.children.find(
      (child) => child.kind === "panasonicDMIRecord" && child.subtype === 0x02
    ) as UEFINode;
    const detail = detailOf(record);
    expect(value(detail, "ID")).toBe("0x02");
    expect(value(detail, "Length")).toBe("0x80");
    expect(value(detail, "Checksum")).toMatch(/\(Valid\)$/);
    expect(value(detail, "Holds")).toBe("Asset tag");
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIPanasonicDMIDetailTests.swift#UEFIPanasonicDMIDetailTests.testAFailingChecksumIsAProblem
  it("reads an area whose sums fail, and says what fails and what the byte should be", () => {
    const { node, detailOf } = parsed((block) => {
      block[0x183 + 1] = 0x58; // the serial's first character
      block[0x84] = 0x01; // the directory's reserved word
    });
    const detail = detailOf(node);
    expect(detail.fields.find((one) => one.label === "Directory checksum")?.tone).toBe("bad");
    expect(detail.fields.filter((one) => one.label === "Problem").map((one) => one.value)).toEqual([
      "1 of the records fail their checksum.",
    ]);
    const records = detail.tables.find((table) => table.title === "Directory");
    expect(records?.rows.map((row) => row[3]?.text)).toEqual(["OK", "Invalid", "OK"]);
    const serial = node.children.find((child) => child.subtype === 0x03) as UEFINode;
    const checksum = detailOf(serial).fields.find((one) => one.label === "Checksum");
    expect(checksum?.tone).toBe("bad");
    expect(checksum?.value).toContain("should be");
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIPanasonicDMIDetailTests.swift#UEFIPanasonicDMIDetailTests.testTheRowsSayWhatTheyHold
  it("has rows that say what they hold, padding to UEFITool, with their help entry", () => {
    const { node, reader } = parsed();
    expect(panasonicDMIRowText(node, reader)).toBe(`Panasonic DMI · FZ55-2 · ${PANASONIC_SERIAL}`);
    const key = node.children.find((child) => child.subtype === 0x16) as UEFINode;
    expect(nodeName(key, GuidsCatalogue.empty)).toBe("Record 0x16 · Windows product key");
    expect(typeText(node), "padding to UEFITool").toBe("Padding");
    expect(uefiHelpTerm(node)).toBe("panasonic-dmi");
    expect(uefiHelpTerm(key)).toBe("panasonic-dmi");
  });
});
