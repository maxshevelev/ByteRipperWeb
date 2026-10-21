import { describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import { ImageReader } from "@/firmware/imageReader";
import { HP_SERIAL, hpImage, hpMud, hpVariable, hpVariables } from "@/firmware/testing/testHPDMI";
import { allDMIStores } from "@/firmware/uefi/dmiStore";
import {
  HP_MUD_NAME,
  HP_SETTINGS_GUID,
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
import { parseUefiImage } from "@/firmware/uefi/uefiImage";
import { displayName, nodeRange, type UEFINode } from "@/firmware/uefi/uefiNode";

/**
 * HP's identity (`hpDmiArea.ts`): the `HP_MUD` variable and the three beside it in the main
 * VSS2 store. The layout is read off the dumps it was surveyed from, so the tests carry
 * synthetic variables in it (`testHPDMI.ts`).
 *
 * @upstream Packages/UEFIImage/Tests/UEFIImageTests/HPDMIAreaTests.swift#HPDMIAreaTests
 */

function parsed(bytes: Uint8Array) {
  const source = sourceOver(bytes);
  const image = parseUefiImage(source);
  const reader = new ImageReader(source);
  const store = image.allNodes.find((one) => one.kind === "vss2Store") as UEFINode;
  return { image, reader, store };
}

function area(bytes: Uint8Array): HPDMIArea {
  const { store, reader } = parsed(bytes);
  const found = readHPDMIArea(store, reader);
  if (found === undefined) throw new Error("no HP DMI area");
  return found;
}

describe("HP's DMI area", () => {
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/HPDMIAreaTests.swift#HPDMIAreaTests.testTheStoreSaysWhoTheMachineIs
  it("says who the machine is, as BCU reports it", () => {
    const found = area(hpImage());
    expect(hpSerialNumber(found)).toBe(HP_SERIAL);
    expect(hpSKU(found)).toBe("TEST123#ABD");
    expect(hpProductFamily(found)).toBe("103C_5336AN HP EliteBook");
    expect(hpCTNumber(found)).toBe("PTXTEST01JK100B");
    expect(hpProductName(found)).toBe("HP EliteBook 645 14 inch G11 Notebook PC");
    expect(hpUUIDText(found)).toBe("78563412-AB90-4788-89CD-EF0102030405");
    expect(found.buildID).toBe("24WWTEST602#SABD#DABD");
    expect(found.featureByte).toBe("476J6S6b7B7H.TR");
    expect(found.assetTag).toBe(HP_SERIAL);
    expect(found.isDeleted).toBe(false);
    expect(hpFindings(found)).toEqual([]);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/HPDMIAreaTests.swift#HPDMIAreaTests.testTheDMIStoresSeeTheEntry
  it("is the HP_MUD entry to the DMI search, and only with the bytes", () => {
    const { image, reader, store } = parsed(hpImage());
    const entry = image.allNodes.find(
      (one) => one.kind === "vssEntry" && one.name === HP_MUD_NAME
    ) as UEFINode;
    expect(allDMIStores(image.roots, reader)).toEqual([
      { kind: "vssEntry", range: nodeRange(entry) },
    ]);
    expect(allDMIStores(image.roots)).toEqual([]);
    expect(isHPDMIAreaEntry(entry, store, reader)).toBe(true);
    const tags = image.allNodes.find(
      (one) => one.kind === "vssEntry" && one.name === "HP_TAGS"
    ) as UEFINode;
    expect(isHPDMIAreaEntry(tags, store, reader)).toBe(false);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/HPDMIAreaTests.swift#HPDMIAreaTests.testADeletedCopyIsReadAndSaysSo
  it("reads a copy the store marks deleted, and says so", () => {
    const found = area(hpImage(hpVariables({ mudState: 0x3c })));
    expect(hpSerialNumber(found)).toBe(HP_SERIAL);
    expect(found.isDeleted).toBe(true);
    expect(hpFindings(found)).toEqual(["deletedCopy"]);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/HPDMIAreaTests.swift#HPDMIAreaTests.testTheCurrentCopyWinsOverAnEarlierOne
  it("reads the current copy over an earlier one", () => {
    const earlier = hpVariable(HP_MUD_NAME, hpMud({ serial: "5CDOLD0001" }), { state: 0x3c });
    const bytes = hpImage([earlier, ...hpVariables()]);
    const found = area(bytes);
    expect(hpSerialNumber(found)).toBe(HP_SERIAL);
    expect(found.isDeleted).toBe(false);
    const { image, reader, store } = parsed(bytes);
    const old = image.allNodes.find(
      (one) => one.kind === "vssEntry" && displayName(one) === "Invalid"
    ) as UEFINode;
    expect(old).toBeDefined();
    expect(isHPDMIAreaEntry(old, store, reader)).toBe(false);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/HPDMIAreaTests.swift#HPDMIAreaTests.testAnAssetTagOtherThanTheSerialIsANote
  it("notes an asset tag other than the serial", () => {
    const found = area(hpImage(hpVariables({ assetTag: "5CGOTHER01" })));
    expect(hpFindings(found)).toEqual(["assetTagIsNotTheSerial"]);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/HPDMIAreaTests.swift#HPDMIAreaTests.testWhatIsNotTheLayoutIsNotRead
  it("reads only the layout read from", () => {
    const unread = (variable: Uint8Array) => {
      const { store, reader } = parsed(hpImage([variable]));
      return readHPDMIArea(store, reader);
    };
    expect(unread(hpVariable(HP_MUD_NAME, hpMud().subarray(0, 0x100)))).toBeUndefined();
    expect(unread(hpVariable(HP_MUD_NAME, hpMud(), { guid: HP_SETTINGS_GUID }))).toBeUndefined();
    const garbled = hpMud();
    garbled[2] = 0x01;
    garbled[3] = 0xd8;
    expect(unread(hpVariable(HP_MUD_NAME, garbled))).toBeUndefined();
  });
});
