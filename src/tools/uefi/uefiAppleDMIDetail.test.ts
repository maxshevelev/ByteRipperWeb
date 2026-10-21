import { describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import { ImageReader } from "@/firmware/imageReader";
import { APPLE_BOARD, appleImage, appleVariables } from "@/firmware/testing/testAppleDMI";
import { appleEntryText } from "@/firmware/uefi/appleDmiArea";
import { allDMIStores } from "@/firmware/uefi/dmiStore";
import { parseUefiImage } from "@/firmware/uefi/uefiImage";
import { nodeRange, type UEFINode } from "@/firmware/uefi/uefiNode";
import type { NodeDetail } from "@/tools/toolDetail";
import { appleDMIRowText } from "@/tools/uefi/uefiAppleDMIDetail";
import { uefiHelpTerm } from "@/tools/uefi/uefiHelpTerms";
import { buildNodeDetail } from "@/tools/uefi/uefiNodeDetail";
import { dmiStoreTitle } from "@/tools/uefi/uefiTreeDisplay";

/**
 * Apple's DMI on the SysF store: the row says the serial, the detail lists the identity, the DMI
 * menu names it, and `?` opens its entry. The format is `appleDmiArea.ts`'s and tested there.
 *
 * @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIAppleDMIDetailTests.swift#UEFIAppleDMIDetailTests
 */

function parsed(bytes: Uint8Array) {
  const source = sourceOver(bytes);
  const image = parseUefiImage(source);
  const reader = new ImageReader(source);
  const store = allDMIStores(image.roots, reader)[0];
  const node = image.allNodes.find(
    (one) =>
      store !== undefined &&
      one.kind === store.kind &&
      nodeRange(one).start === store.range.start &&
      nodeRange(one).end === store.range.end
  ) as UEFINode;
  return { image, reader, node, detail: buildNodeDetail(node, image, reader) };
}

/** A field of the detail, or a row of its Entries table, where the area's values are. */
const value = (detail: NodeDetail, label: string) => {
  const one = detail.fields.find((field) => field.label === label);
  if (one !== undefined) return one.value;
  const entries = detail.tables.find((table) => table.title === "Entries");
  return entries?.rows.find((row) => row[0]?.text === label)?.[1]?.text;
};
const notes = (detail: NodeDetail) => detail.fields.filter((one) => one.label === "Note");

describe("Apple's DMI in the detail", () => {
  /** @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIAppleDMIDetailTests.swift#UEFIAppleDMIDetailTests.testTheStoreSaysWhoseTheMacIs */
  it("says whose the Mac is", () => {
    const { detail } = parsed(appleImage(appleVariables("C02TEST00G94", "0G94")));
    expect(value(detail, "Serial number")).toBe("C02TEST00G94");
    expect(value(detail, "Configuration code")).toBe("0G94");
    expect(value(detail, "Sales order number")).toBe("MJVE2D/");
    expect(value(detail, "MLB (board serial)")).toBe(APPLE_BOARD);
    expect(notes(detail)).toEqual([]);
  });

  /** @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIAppleDMIDetailTests.swift#UEFIAppleDMIDetailTests.testTheTableLeadsToTheVariables */
  it("leads each value to the variable it is read from", () => {
    const { node, detail, reader } = parsed(appleImage());
    const entries = detail.tables.find((table) => table.title === "Entries");
    const entry = (named: (name: string) => boolean) => {
      const found = node.children.find((one) => named(one.name));
      return found === undefined ? undefined : { kind: "node", path: found.id };
    };
    expect(entries?.rowTargets).toEqual([
      entry((name) => name === "ssn"),
      entry((name) => name === "hwc"),
      entry((name) => name === "son"),
      entry((name) => name.startsWith(APPLE_BOARD)),
    ]);
    expect(entries?.rowTargets?.every((one) => one !== undefined)).toBe(true);
    const serial = node.children.find((one) => one.name === "ssn") as UEFINode;
    expect(appleEntryText(serial, reader)).toBe("C02TEST00G94");
  });

  /** @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIAppleDMIDetailTests.swift#UEFIAppleDMIDetailTests.testAPlaceholderSerialIsNoted */
  it("notes a placeholder serial", () => {
    const { detail } = parsed(appleImage(appleVariables("123456789012", "HV2H")));
    expect(notes(detail)).toHaveLength(2);
  });

  /** @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIAppleDMIDetailTests.swift#UEFIAppleDMIDetailTests.testTheRowTheMenuAndTheTerm */
  it("has a row that says the serial, a menu title and a help entry of its own", () => {
    const { node, reader } = parsed(appleImage());
    const row = appleDMIRowText(node, reader);
    expect(row).toBe("Apple SysF store · C02TEST00G94");
    expect(uefiHelpTerm({ ...node, isAppleDMIArea: true })).toBe("apple-dmi");
    // Without the bytes, a store.
    expect(uefiHelpTerm(node)).not.toBe("apple-dmi");
    expect(dmiStoreTitle({ kind: "sysFStore", range: { start: 0x1000, end: 0x1200 } })).toBe(
      "Apple DMI at 0x00001000"
    );
  });
});
