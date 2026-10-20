import { describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import { ImageReader } from "@/firmware/imageReader";
import {
  HP_SERIAL,
  hpImage,
  hpMud,
  hpVariable,
  hpVariables,
} from "@/firmware/testing/testVendorDMI";
import { allDMIStores } from "@/firmware/uefi/dmiStore";
import {
  HP_DMI,
  type HPDMIArea,
  hpCTNumber,
  hpFindings,
  hpProductFamily,
  hpProductName,
  hpSerialNumber,
  hpSKU,
  hpUUIDText,
  isHPDMIAreaEntry,
  readHPDMIArea,
} from "@/firmware/uefi/hpDmiArea";
import { NVRAM } from "@/firmware/uefi/nvramParser";
import { parseUefiImage } from "@/firmware/uefi/uefiImage";
import { nodeRange, type UEFINode } from "@/firmware/uefi/uefiNode";

/**
 * HP's identity (`hpDmiArea.ts`): the `HP_MUD` variable and the three beside it in the main
 * VSS2 store. The layout is read off the dumps it was surveyed from, so the tests carry
 * synthetic variables in it.
 *
 * @upstream Packages/UEFIImage/Tests/UEFIImageTests/HPDMIAreaTests.swift#HPDMIAreaTests
 */

const parse = (bytes: Uint8Array) => parseUefiImage(sourceOver(bytes));
const readerOf = (bytes: Uint8Array) => new ImageReader(sourceOver(bytes));

function store(bytes: Uint8Array): UEFINode {
  const found = parse(bytes).allNodes.find((node) => node.kind === "vss2Store");
  if (found === undefined) throw new Error("no VSS2 store");
  return found;
}

function area(bytes: Uint8Array): HPDMIArea {
  const read = readHPDMIArea(store(bytes), readerOf(bytes));
  if (read === undefined) throw new Error("no HP DMI area");
  return read;
}

describe("HP's DMI area", () => {
  /**
   * The store says who the machine is: what BCU reports as the serial, the SKU, the family, the
   * CT number, the product name, the UUID, the build ID, the feature byte and the asset
   * tracking number.
   *
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/HPDMIAreaTests.swift#HPDMIAreaTests.testTheStoreSaysWhoTheMachineIs
   */
  it("says who the machine is", () => {
    const read = area(hpImage());
    expect(hpSerialNumber(read)).toBe(HP_SERIAL);
    expect(hpSKU(read)).toBe("TEST123#ABD");
    expect(hpProductFamily(read)).toBe("103C_5336AN HP EliteBook");
    expect(hpCTNumber(read)).toBe("PTXTEST01JK100B");
    expect(hpProductName(read)).toBe("HP EliteBook 645 14 inch G11 Notebook PC");
    expect(hpUUIDText(read)).toBe("78563412-AB90-4788-89CD-EF0102030405");
    expect(read.buildID).toBe("24WWTEST602#SABD#DABD");
    expect(read.featureByte).toBe("476J6S6b7B7H.TR");
    expect(read.assetTag).toBe(HP_SERIAL);
    expect(read.isDeleted).toBe(false);
    expect(hpFindings(read)).toEqual([]);
  });

  /**
   * The bench's "show the DMI area" goes to the `HP_MUD` entry — and only with the bytes, since
   * a marked entry's name is in them.
   *
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/HPDMIAreaTests.swift#HPDMIAreaTests.testTheDMIStoresSeeTheEntry
   */
  it("is seen by the DMI stores, with the bytes", () => {
    const bytes = hpImage();
    const parsed = parse(bytes);
    const entry = parsed.allNodes.find(
      (node) => node.kind === "vssEntry" && node.name === HP_DMI.mudName
    ) as UEFINode;
    expect(allDMIStores(parsed.roots, readerOf(bytes))).toEqual([
      { kind: "vssEntry", range: nodeRange(entry) },
    ]);
    expect(allDMIStores(parsed.roots)).toEqual([]);
    const held = store(bytes);
    expect(isHPDMIAreaEntry(entry, held, readerOf(bytes))).toBe(true);
    const tags = parsed.allNodes.find(
      (node) => node.kind === "vssEntry" && node.name === "HP_TAGS"
    ) as UEFINode;
    expect(isHPDMIAreaEntry(tags, held, readerOf(bytes))).toBe(false);
  });

  /**
   * On most boards read from the store marks `HP_MUD` deleted and keeps no current copy; the
   * copy is whole, is read, and says so.
   *
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/HPDMIAreaTests.swift#HPDMIAreaTests.testADeletedCopyIsReadAndSaysSo
   */
  it("reads a deleted copy, and says so", () => {
    const read = area(hpImage(hpVariables(0x3c)));
    expect(hpSerialNumber(read)).toBe(HP_SERIAL);
    expect(read.isDeleted).toBe(true);
    expect(hpFindings(read)).toEqual(["deletedCopy"]);
  });

  /**
   * Where the store keeps a current copy, it wins over an earlier one.
   *
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/HPDMIAreaTests.swift#HPDMIAreaTests.testTheCurrentCopyWinsOverAnEarlierOne
   */
  it("takes the current copy over an earlier one", () => {
    const earlier = hpVariable(HP_DMI.mudName, hpMud("5CDOLD0001"), HP_DMI.factoryGuid, 0x3c);
    const bytes = hpImage([earlier, ...hpVariables()]);
    const read = area(bytes);
    expect(hpSerialNumber(read)).toBe(HP_SERIAL);
    expect(read.isDeleted).toBe(false);
    const old = parse(bytes).allNodes.find(
      (node) => node.kind === "vssEntry" && node.name === "Invalid"
    ) as UEFINode;
    expect(isHPDMIAreaEntry(old, store(bytes), readerOf(bytes))).toBe(false);
  });

  /**
   * The asset tag is the serial by default; another value is worth knowing.
   *
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/HPDMIAreaTests.swift#HPDMIAreaTests.testAnAssetTagOtherThanTheSerialIsANote
   */
  it("notes an asset tag other than the serial", () => {
    expect(hpFindings(area(hpImage(hpVariables(NVRAM.vssVariableAdded, "5CGOTHER01"))))).toEqual([
      "assetTagIsNotTheSerial",
    ]);
  });

  /**
   * Only the layout read from: another size, another GUID, or a serial that is no text is not
   * read.
   *
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/HPDMIAreaTests.swift#HPDMIAreaTests.testWhatIsNotTheLayoutIsNotRead
   */
  it("does not read what is not the layout", () => {
    const readOf = (held: Uint8Array) => {
      const bytes = hpImage([held]);
      return readHPDMIArea(store(bytes), readerOf(bytes));
    };
    expect(readOf(hpVariable(HP_DMI.mudName, hpMud().subarray(0, 0x100)))).toBeUndefined();
    expect(readOf(hpVariable(HP_DMI.mudName, hpMud(), HP_DMI.settingsGuid))).toBeUndefined();
    const garbled = hpMud();
    garbled[2] = 0x01;
    garbled[3] = 0xd8;
    expect(readOf(hpVariable(HP_DMI.mudName, garbled))).toBeUndefined();
  });
});
