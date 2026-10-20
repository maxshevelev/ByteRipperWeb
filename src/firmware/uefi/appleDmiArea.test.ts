import { describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import { ImageReader } from "@/firmware/imageReader";
import { sysfVariable } from "@/firmware/testing/testNvram";
import {
  APPLE_BOARD,
  APPLE_SERIAL,
  appleImage,
  appleVariable,
  appleVariables,
} from "@/firmware/testing/testVendorDMI";
import { type AppleDMIArea, appleFindings, readAppleDMIArea } from "@/firmware/uefi/appleDmiArea";
import { allDMIStores } from "@/firmware/uefi/dmiStore";
import { NVRAM } from "@/firmware/uefi/nvramParser";
import { parseUefiImage } from "@/firmware/uefi/uefiImage";
import { nodeRange, type UEFINode } from "@/firmware/uefi/uefiNode";

/**
 * Apple's identity (`appleDmiArea.ts`): the `ssn`, `hwc` and `son` variables of the SysF store,
 * and the board's serial in the names of the calibration variables beside them. The layout is
 * read off the dumps it was surveyed from, so the tests carry synthetic variables in it.
 *
 * @upstream Packages/UEFIImage/Tests/UEFIImageTests/AppleDMIAreaTests.swift#AppleDMIAreaTests
 */

const parse = (bytes: Uint8Array) => parseUefiImage(sourceOver(bytes));
const readerOf = (bytes: Uint8Array) => new ImageReader(sourceOver(bytes));

function store(bytes: Uint8Array): UEFINode {
  const found = parse(bytes).allNodes.find((node) => node.kind === "sysFStore");
  if (found === undefined) throw new Error("no SysF store");
  return found;
}

function area(bytes: Uint8Array): AppleDMIArea {
  const read = readAppleDMIArea(store(bytes), readerOf(bytes));
  if (read === undefined) throw new Error("no Apple DMI area");
  return read;
}

describe("Apple's DMI area", () => {
  /**
   * The store says whose the Mac is: the serial, the configuration code, the order number and
   * the board's serial.
   *
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/AppleDMIAreaTests.swift#AppleDMIAreaTests.testTheStoreSaysWhoseTheMacIs
   */
  it("says whose the Mac is", () => {
    const read = area(appleImage(appleVariables("C02TEST00G94", "0G94")));
    expect(read.serialNumber).toBe("C02TEST00G94");
    expect(read.configCode).toBe("0G94");
    expect(read.orderNumber).toBe("MJVE2D/");
    expect(read.boardSerial).toBe(APPLE_BOARD);
    expect(read.isDeleted).toBe(false);
    expect(appleFindings(read)).toEqual([]);
  });

  /**
   * The bench's "show the DMI area" goes to the store, and only with the bytes: a SysF store is
   * told for Apple's identity by what it holds.
   *
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/AppleDMIAreaTests.swift#AppleDMIAreaTests.testTheDMIStoresSeeTheStore
   */
  it("is seen by the DMI stores, with the bytes", () => {
    const bytes = appleImage();
    const parsed = parse(bytes);
    expect(allDMIStores(parsed.roots, readerOf(bytes))).toEqual([
      { kind: "sysFStore", range: nodeRange(store(bytes)) },
    ]);
    expect(allDMIStores(parsed.roots)).toEqual([]);
  });

  /**
   * A store of the overrides only — the 2010 and 2011 boards — holds no identity, and is no
   * DMI area.
   *
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/AppleDMIAreaTests.swift#AppleDMIAreaTests.testAStoreWithoutTheIdentityIsNoArea
   */
  it("is no area where the store holds no identity", () => {
    const bytes = appleImage([
      sysfVariable({ name: "overrides", data: Uint8Array.of(0x42, 0x5a, 0x68) }),
    ]);
    expect(readAppleDMIArea(store(bytes), readerOf(bytes))).toBeUndefined();
    expect(allDMIStores(parse(bytes).roots, readerOf(bytes))).toEqual([]);
  });

  /**
   * The Diag store shares the format but is not the identity.
   *
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/AppleDMIAreaTests.swift#AppleDMIAreaTests.testTheDiagStoreIsNotRead
   */
  it("does not read the Diag store", () => {
    const bytes = appleImage(appleVariables(), NVRAM.appleDiagSignature);
    expect(readAppleDMIArea(store(bytes), readerOf(bytes))).toBeUndefined();
  });

  /**
   * A placeholder serial does not end in the configuration code, nor begin as the board's
   * serial does.
   *
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/AppleDMIAreaTests.swift#AppleDMIAreaTests.testAPlaceholderSerialIsNoted
   */
  it("notes a placeholder serial", () => {
    expect(appleFindings(area(appleImage(appleVariables("123456789012", "HV2H"))))).toEqual([
      "configCodeIsNotTheSerialsEnd",
      "serialIsNotTheBoardsLocation",
    ]);
  });

  /**
   * A copy marked invalid is read, and says so; a current one wins over it.
   *
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/AppleDMIAreaTests.swift#AppleDMIAreaTests.testAnInvalidCopyIsReadAndSaysSo
   */
  it("reads an invalid copy, and a current one wins over it", () => {
    const held = appleVariables();
    held[2] = appleVariable("ssn", APPLE_SERIAL, true);
    const marked = area(appleImage(held));
    expect(marked.serialNumber).toBe(APPLE_SERIAL);
    expect(appleFindings(marked)).toEqual(["deletedCopy"]);
    held.push(appleVariable("ssn", "C02NEW00G940"));
    expect(area(appleImage(held)).serialNumber).toBe("C02NEW00G940");
  });

  /**
   * The 2010 boards: an 11-character serial with a three-character code, and no calibration
   * variables, so no board's serial.
   *
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/AppleDMIAreaTests.swift#AppleDMIAreaTests.testAnOlderMacHasAThreeCharacterCodeAndNoBoardSerial
   */
  it("reads an older Mac's three-character code, and no board serial", () => {
    const read = area(
      appleImage([
        appleVariable("overrides", "BZh"),
        appleVariable("ssn", "W8037597AGU"),
        appleVariable("hwc", "AGU"),
        appleVariable("son", "MC371D/A"),
      ])
    );
    expect(read.serialNumber).toBe("W8037597AGU");
    expect(read.configCode).toBe("AGU");
    expect(read.boardSerial).toBeUndefined();
    expect(appleFindings(read)).toEqual([]);
  });

  /**
   * The board's serial needs two variables that share it: a single long name is no proof.
   *
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/AppleDMIAreaTests.swift#AppleDMIAreaTests.testTheBoardSerialNeedsTwoNames
   */
  it("needs two names to read the board's serial", () => {
    const one = appleImage([
      sysfVariable({ name: `${APPLE_BOARD}MAC-1`, data: Uint8Array.of(1, 2, 3, 4) }),
      appleVariable("ssn", APPLE_SERIAL),
    ]);
    expect(area(one).boardSerial).toBeUndefined();
  });
});
