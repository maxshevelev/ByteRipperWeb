import { describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import { ImageReader } from "@/firmware/imageReader";
import {
  APPLE_BOARD,
  appleImage,
  appleVariables,
  HP_SERIAL,
  hpImage,
  hpVariables,
} from "@/firmware/testing/testVendorDMI";
import { allDMIStores } from "@/firmware/uefi/dmiStore";
import { GuidsCatalogue } from "@/firmware/uefi/guidsCatalogue";
import { parseUefiImage } from "@/firmware/uefi/uefiImage";
import { nodeRange, type UEFINode } from "@/firmware/uefi/uefiNode";
import type { NodeDetail } from "@/tools/toolDetail";
import { appleDMIRowText } from "@/tools/uefi/uefiAppleDMIDetail";
import { uefiHelpTerm } from "@/tools/uefi/uefiHelpTerms";
import { hpDMIRowText, hpStoreOf } from "@/tools/uefi/uefiHPDMIDetail";
import { buildNodeDetail } from "@/tools/uefi/uefiNodeDetail";
import { dmiStoreTitle, nodeName } from "@/tools/uefi/uefiTreeDisplay";

/**
 * HP's DMI on the `HP_MUD` entry and Apple's on the SysF store: the row says the serial, the
 * detail lists what the vendor's tools report, the DMI menu names it, and `?` opens its entry.
 * The formats are `hpDmiArea.ts`'s and `appleDmiArea.ts`'s and tested there.
 *
 * @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIHPDMIDetailTests.swift#UEFIHPDMIDetailTests
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

const value = (detail: NodeDetail, label: string) =>
  detail.fields.find((one) => one.label === label)?.value;
const notes = (detail: NodeDetail) => detail.fields.filter((one) => one.label === "Note");

describe("HP's DMI in the detail", () => {
  /**
   * The detail lists what BCU reports, in its order; a current copy whose asset tag is the
   * serial has nothing to note.
   *
   * @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIHPDMIDetailTests.swift#UEFIHPDMIDetailTests.testTheEntrySaysWhoTheMachineIs
   */
  it("says who the machine is", () => {
    const { detail } = parsed(hpImage());
    expect(value(detail, "Serial number")).toBe(HP_SERIAL);
    expect(value(detail, "SKU")).toBe("TEST123#ABD");
    expect(value(detail, "Product family")).toBe("103C_5336AN HP EliteBook");
    expect(value(detail, "CT number")).toBe("PTXTEST01JK100B");
    expect(value(detail, "Product name")).toBe("HP EliteBook 645 14 inch G11 Notebook PC");
    expect(value(detail, "UUID")).toBe("78563412-AB90-4788-89CD-EF0102030405");
    expect(value(detail, "Build ID")).toBe("24WWTEST602#SABD#DABD");
    expect(value(detail, "Feature byte")).toBe("476J6S6b7B7H.TR");
    expect(value(detail, "Asset tracking number")).toBe(HP_SERIAL);
    expect(notes(detail)).toEqual([]);
  });

  /**
   * A copy the store marks deleted is read all the same, and says so.
   *
   * @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIHPDMIDetailTests.swift#UEFIHPDMIDetailTests.testADeletedCopyIsReadAndNoted
   */
  it("reads a deleted copy, and notes it", () => {
    const { node, detail } = parsed(hpImage(hpVariables(0x3c)));
    expect(node.name).toBe("Invalid");
    expect(value(detail, "Serial number")).toBe(HP_SERIAL);
    expect(notes(detail)).toHaveLength(1);
    expect(detail.fields.filter((one) => one.tone === "bad")).toHaveLength(0);
  });

  /**
   * The row answers what a bench opens it for, on a marked copy too; the menu calls it HP DMI;
   * `?` opens HP's entry.
   *
   * @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIHPDMIDetailTests.swift#UEFIHPDMIDetailTests.testTheRowTheMenuAndTheTerm
   */
  it("has a row that says the serial, a menu title and a help entry of its own", () => {
    for (const state of [0x3f, 0x3c]) {
      const { node, image, reader } = parsed(hpImage(hpVariables(state)));
      const row = hpDMIRowText(node, hpStoreOf(node, image), reader);
      expect(row).toBe(`HP_MUD · ${HP_SERIAL}`);
      const wire = { ...node, guid: undefined, valueRow: row, dmiArea: "hp" as const };
      expect(nodeName(wire, GuidsCatalogue.empty)).toBe(`HP_MUD · ${HP_SERIAL}`);
      expect(uefiHelpTerm(wire)).toBe("hp-dmi");
      // Without the bytes, a VSS entry.
      expect(uefiHelpTerm(node)).toBe("vss");
    }
    expect(dmiStoreTitle({ kind: "vssEntry", range: { start: 0x1000, end: 0x1200 } })).toBe(
      "HP DMI at 0x00001000"
    );
  });

  /**
   * Another variable of HP's factory GUID is an ordinary VSS entry.
   *
   * @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIHPDMIDetailTests.swift#UEFIHPDMIDetailTests.testTheOtherEntriesAreOrdinary
   */
  it("leaves the other entries ordinary", () => {
    const { image, reader } = parsed(hpImage());
    const buildID = image.allNodes.find(
      (one) => one.kind === "vssEntry" && one.name === "BuildId"
    ) as UEFINode;
    expect(value(buildNodeDetail(buildID, image, reader), "Serial number")).toBeUndefined();
    expect(hpDMIRowText(buildID, hpStoreOf(buildID, image), reader)).toBeUndefined();
  });
});

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
    expect(uefiHelpTerm({ ...node, dmiArea: "apple" })).toBe("apple-dmi");
    // Without the bytes, a store.
    expect(uefiHelpTerm(node)).not.toBe("apple-dmi");
    expect(dmiStoreTitle({ kind: "sysFStore", range: { start: 0x1000, end: 0x1200 } })).toBe(
      "Apple DMI at 0x00001000"
    );
  });
});
