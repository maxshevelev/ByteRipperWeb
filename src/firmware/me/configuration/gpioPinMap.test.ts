import { describe, expect, it } from "vitest";
import { gpioPinMapForME, gpioPins } from "@/firmware/me/configuration/gpioPinMap";
import { gpioPinName } from "@/firmware/me/models/configurationFacts";

/**
 * The GPIO feature pin map and the reader of `/home/gpio/csme_pins`.
 *
 * The map is emitted from Flash Image Tool's own value classes, so it is not pinned here
 * name by name; what is worth pinning is the shape of each generation's record and the
 * refusal to read a file that is not one — the two things a wrong guess would silently
 * turn into pins. Both shapes are settled on the images at hand: CSME 11's records match
 * FIT 11's defaults (`NFC_RST` = GPP_E_4, `FWUPDATE` = GPP_B_15) and CSME 12's the field
 * set of its `GpioCsmeFeature` class.
 */

function present<T>(value: T | undefined, what = "value"): T {
  if (value === undefined) throw new Error(`no ${what}`);
  return value;
}

const u32 = (value: number): number[] => [
  value & 0xff,
  (value >>> 8) & 0xff,
  (value >>> 16) & 0xff,
  (value >>> 24) & 0xff,
];

describe("the GPIO pin map", () => {
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/GPIOPinTests.swift#GPIOPinTests.testTheMapsCarryTheToolsValues
  it("carries the tool's values", () => {
    const eleven = present(gpioPinMapForME(11));
    expect(eleven.features.size, "CSME 11's file carries no feature id").toBe(0);
    expect(eleven.usages.get(0)).toBe("NFC_RST");
    expect(eleven.usages.get(8)).toBe("FWUPDATE");
    expect(eleven.ownerships.get(1)).toBe("CSME_MODE");
    expect(eleven.padModes.get(4)).toBe("DEFAULT_MODE");
    expect(eleven.groups.get(4)).toBe("GPP_E");
    expect(eleven.groups.get(0xff)).toBe("NONE");

    const twelve = present(gpioPinMapForME(12));
    expect(twelve.features.get(1)).toBe("GPIO_TOUCH_FEATURE_ID");
    expect(twelve.features.get(3)).toBe("GPIO_SMT_FEATURE_ID");
    expect(twelve.usages.get(5)).toBe("CPU_DETECTION");
    expect(twelve.usages.get(12)).toBe("SMT_SMLINK1_CLK");
    expect(gpioPinMapForME(15)).toBeDefined();
    // MFIT's generations carry no `GpioCsme*` classes, so there is no map.
    expect(gpioPinMapForME(16)).toBeUndefined();
    expect(gpioPinMapForME(18)).toBeUndefined();
  });

  // CSME 11 writes five dwords per record, and the values are the ones FIT 11 itself
  // gives the same usages in its documents.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/GPIOPinTests.swift#GPIOPinTests.testAnElevenRecordIsFiveDwords
  it("reads an 11 record as five dwords", () => {
    const map = present(gpioPinMapForME(11));
    const bytes = new Uint8Array([
      ...[...u32(0), ...u32(4), ...u32(4), ...u32(0), ...u32(4)], // NFC_RST at GPP_E_4
      ...[...u32(8), ...u32(1), ...u32(15), ...u32(1), ...u32(0)], // FWUPDATE at GPP_B_15
    ]);
    const pins = present(gpioPins(bytes, map, 11));
    expect(pins.length).toBe(2);
    const [first, second] = [present(pins[0]), present(pins[1])];
    expect(first.usage).toBe("NFC_RST");
    expect(gpioPinName(first)).toBe("GPP_E_4");
    expect(first.ownership).toBe("HOST_MODE");
    expect(first.padMode).toBe("DEFAULT_MODE");
    expect(first.feature).toBeUndefined();
    expect(second.usage).toBe("FWUPDATE");
    expect(gpioPinName(second)).toBe("GPP_B_15");
    expect(second.ownershipID).toBe(1);
    expect(second.padModeID).toBe(0);
  });

  // CSME 12 and later write packed bytes: feature id, group, pad, reserved, usage,
  // reserved, ownership, pad mode, then four reserved bytes.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/GPIOPinTests.swift#GPIOPinTests.testATwelveRecordIsPackedBytes
  it("reads a 12 record as packed bytes", () => {
    const map = present(gpioPinMapForME(12));
    const touch = [1, 1, 14, 0, 0, 0, 0, 4, 0, 0, 0, 0];
    const smt = [3, 2, 6, 0, 12, 0, 1, 1, 0, 0, 0, 0];
    const pins = present(gpioPins(new Uint8Array([...touch, ...smt]), map, 12));
    expect(pins.length).toBe(2);
    const [first, second] = [present(pins[0]), present(pins[1])];
    expect(first.feature).toBe("GPIO_TOUCH_FEATURE_ID");
    expect(first.usage).toBe("INTEGRATED_TOUCH_1");
    expect(gpioPinName(first)).toBe("GPP_B_14");
    expect(first.ownership).toBe("HOST_MODE");
    expect(first.padMode).toBe("DEFAULT_MODE");
    expect(second.feature).toBe("GPIO_SMT_FEATURE_ID");
    expect(second.usage).toBe("SMT_SMLINK1_CLK");
    expect(gpioPinName(second)).toBe("GPP_C_6");
    expect(second.ownership).toBe("CSME_MODE");
    expect(second.padMode).toBe("NATIVE_FUNCTION_1");
  });

  // A number the tool has no name for is shown as the number, not guessed at, and an
  // ambiguous group keeps its number.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/GPIOPinTests.swift#GPIOPinTests.testANumberWithoutANameIsShownAsTheNumber
  it("shows a number without a name as the number", () => {
    const map = present(gpioPinMapForME(12));
    const bytes = new Uint8Array([1, 9, 4, 0, 200, 0, 0, 0, 0, 0, 0, 0]);
    const pin = present(gpioPins(bytes, map, 12)?.[0]);
    expect(pin.usage).toBeUndefined();
    expect(pin.usageID).toBe(200);
    // The documents disagree about 9 (GPP_J in one family, GPD in the other), so the
    // map carries no name and the pin keeps its number.
    expect(pin.group).toBeUndefined();
    expect(gpioPinName(pin)).toBe("9:4");
  });

  // An empty file is what a platform with no feature pins carries; a length that is not
  // whole records is not one of these files; and a record whose owner or pad mode cannot
  // be true of any pin is not read at all rather than named.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/GPIOPinTests.swift#GPIOPinTests.testAFileThatIsNotAPinFileIsNotRead
  it("does not read a file that is not a pin file", () => {
    const eleven = present(gpioPinMapForME(11));
    const twelve = present(gpioPinMapForME(12));
    expect(gpioPins(new Uint8Array(0), eleven, 11)).toBeUndefined();
    expect(gpioPins(new Uint8Array(19), eleven, 11)).toBeUndefined();
    expect(gpioPins(new Uint8Array(13), twelve, 12)).toBeUndefined();

    const ownerOutOfRange = new Uint8Array(12);
    ownerOutOfRange[4] = 0;
    ownerOutOfRange[6] = 9;
    expect(gpioPins(ownerOutOfRange, twelve, 12)).toBeUndefined();

    const padModeOutOfRange = new Uint8Array(12);
    padModeOutOfRange[7] = 9;
    expect(gpioPins(padModeOutOfRange, twelve, 12)).toBeUndefined();
  });
});
