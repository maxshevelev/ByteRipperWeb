import { describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import { ImageReader } from "@/firmware/imageReader";
import { HP_SERIAL, hpImage, hpMud, hpVariables } from "@/firmware/testing/testHPDMI";
import { allDMIStores } from "@/firmware/uefi/dmiStore";
import { GuidsCatalogue } from "@/firmware/uefi/guidsCatalogue";
import { parseUefiImage } from "@/firmware/uefi/uefiImage";
import { displayName, nodeRange, type UEFINode } from "@/firmware/uefi/uefiNode";
import type { NodeDetail } from "@/tools/toolDetail";
import { uefiHelpTerm } from "@/tools/uefi/uefiHelpTerms";
import { hpDMIRowText, hpDMIStoreOf } from "@/tools/uefi/uefiHPDMIDetail";
import { buildNodeDetail } from "@/tools/uefi/uefiNodeDetail";
import { dmiStoreTitle, nodeName } from "@/tools/uefi/uefiTreeDisplay";

/**
 * HP's DMI on the `HP_MUD` entry: the row says the serial, the detail lists what BCU reports,
 * the DMI menu names it, and `?` opens its entry. The format is `hpDmiArea.ts`'s and tested
 * there.
 *
 * @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIHPDMIDetailTests.swift#UEFIHPDMIDetailTests
 */

/** The HP image, and the entry the DMI search goes to. */
function parsed(mudState = 0x3f) {
  const bytes = hpImage(
    hpVariables({
      mudState,
      mud: hpMud({ productName: "HP EliteBook Test" }),
      featureByte: "476J6S6b.TR",
    })
  );
  const source = sourceOver(bytes);
  const image = parseUefiImage(source);
  const reader = new ImageReader(source);
  const [store] = allDMIStores(image.roots, reader);
  if (store === undefined) throw new Error("no DMI store");
  const node = image.allNodes.find(
    (one) =>
      one.kind === "vssEntry" &&
      nodeRange(one).start === store.range.start &&
      nodeRange(one).end === store.range.end
  ) as UEFINode;
  return { image, reader, node };
}

/** A field of the detail, or a row of its Entries table, where the area's values are. */
const value = (detail: NodeDetail, label: string) => {
  const one = detail.fields.find((field) => field.label === label);
  if (one !== undefined) return one.value;
  const entries = detail.tables.find((table) => table.title === "Entries");
  return entries?.rows.find((row) => row[0]?.text === label)?.[1]?.text;
};

describe("HP's DMI in the detail", () => {
  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIHPDMIDetailTests.swift#UEFIHPDMIDetailTests.testTheEntrySaysWhoTheMachineIs
  it("lists what BCU reports, in its order, and notes nothing on a current copy", () => {
    const { image, reader, node } = parsed();
    const detail = buildNodeDetail(node, image, reader);
    expect(value(detail, "Serial number")).toBe(HP_SERIAL);
    expect(value(detail, "SKU")).toBe("TEST123#ABD");
    expect(value(detail, "Product family")).toBe("103C_5336AN HP EliteBook");
    expect(value(detail, "CT number")).toBe("PTXTEST01JK100B");
    expect(value(detail, "Product name")).toBe("HP EliteBook Test");
    expect(value(detail, "UUID")).toBe("78563412-AB90-4788-89CD-EF0102030405");
    expect(value(detail, "Build ID")).toBe("24WWTEST602#SABD#DABD");
    expect(value(detail, "Feature byte")).toBe("476J6S6b.TR");
    expect(value(detail, "Asset tracking number")).toBe(HP_SERIAL);
    expect(value(detail, "Note")).toBeUndefined();
    const entries = detail.tables.find((table) => table.title === "Entries");
    expect(entries?.rows.map((row) => row[0]?.text)).toEqual([
      "Serial number",
      "SKU",
      "Product family",
      "CT number",
      "Product name",
      "UUID",
      "Build ID",
      "Feature byte",
      "Asset tracking number",
    ]);
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIHPDMIDetailTests.swift#UEFIHPDMIDetailTests.testTheFieldsAreRowsAndTheTableLeadsToThem
  it("has the fields of HP_MUD as rows under its entry, which the table leads to", () => {
    const { image, reader, node } = parsed();
    const fields = node.children;
    expect(fields.map((one) => one.kind)).toEqual(Array(6).fill("dmiField"));
    expect(fields.map((one) => one.name)).toEqual([
      "Serial number",
      "SKU",
      "Product family",
      "CT number",
      "Product name",
      "UUID",
    ]);
    const detail = buildNodeDetail(node, image, reader);
    const entries = detail.tables.find((table) => table.title === "Entries");
    const store = hpDMIStoreOf(node, image);
    const entry = (name: string) => {
      const found = store?.children.find((one) => displayName(one) === name);
      return found === undefined ? undefined : { kind: "node", path: found.id };
    };
    expect(entries?.rowTargets).toEqual([
      ...fields.map((one) => ({ kind: "node", path: one.id })),
      entry("BuildId"),
      entry("FactoryConfig"),
      entry("HP_TAGS"),
    ]);
    expect(entries?.rowTargets?.every((one) => one !== undefined)).toBe(true);
    expect(entries?.linkColumn).toBe(0);
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIHPDMIDetailTests.swift#UEFIHPDMIDetailTests.testADeletedCopyIsReadAndNoted
  it("reads a copy the store marks deleted all the same, and notes it", () => {
    const { image, reader, node } = parsed(0x3c);
    expect(displayName(node)).toBe("Invalid"); // UEFITool's name for a marked entry
    const detail = buildNodeDetail(node, image, reader);
    expect(value(detail, "Serial number")).toBe(HP_SERIAL);
    expect(detail.fields.filter((one) => one.label === "Note")).toHaveLength(1);
    expect(detail.fields.filter((one) => one.tone === "bad")).toHaveLength(0);
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIHPDMIDetailTests.swift#UEFIHPDMIDetailTests.testTheRowTheMenuAndTheTerm
  it("has a row that says the serial, a menu entry that says HP DMI, and opens HP's entry", () => {
    for (const state of [0x3f, 0x3c]) {
      const { image, reader, node } = parsed(state);
      const row = hpDMIRowText(node, hpDMIStoreOf(node, image), reader);
      expect(row).toBe(`HP_MUD · ${HP_SERIAL}`);
      // The worker hands the row over with the node, and the tree shows it.
      expect(nodeName({ ...node, valueRow: row, isHPDMIArea: true }, GuidsCatalogue.empty)).toBe(
        `HP_MUD · ${HP_SERIAL}`
      );
      expect(uefiHelpTerm({ ...node, isHPDMIArea: true })).toBe("hp-dmi");
      expect(uefiHelpTerm(node)).toBe("vss"); // without the bytes, a VSS entry
    }
    expect(dmiStoreTitle({ kind: "vssEntry", range: { start: 0x1000, end: 0x1200 } })).toBe(
      "HP DMI at 0x00001000"
    );
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIHPDMIDetailTests.swift#UEFIHPDMIDetailTests.testTheOtherEntriesAreOrdinary
  it("leaves another variable of HP's factory GUID an ordinary VSS entry", () => {
    const { image, reader } = parsed();
    const buildID = image.allNodes.find(
      (one) => one.kind === "vssEntry" && one.name === "BuildId"
    ) as UEFINode;
    expect(value(buildNodeDetail(buildID, image, reader), "Serial number")).toBeUndefined();
    expect(hpDMIRowText(buildID, hpDMIStoreOf(buildID, image), reader)).toBeUndefined();
    expect(uefiHelpTerm(buildID)).toBe("vss");
  });
});
