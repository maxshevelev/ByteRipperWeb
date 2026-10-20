import {
  authVssVariable,
  nvramVolume,
  sysfStore,
  sysfVariable,
  vss2Store,
} from "@/firmware/testing/testNvram";
import type { EFIGUID } from "@/firmware/uefi/efiGuid";
import { HP_DMI } from "@/firmware/uefi/hpDmiArea";
import { NVRAM } from "@/firmware/uefi/nvramParser";

/**
 * Images that keep a machine's identity the way HP and Apple do: synthetic variables in the
 * layouts the dumps were surveyed in.
 *
 * @upstream Packages/UEFIImage/Tests/UEFIImageTests/HPDMIAreaTests.swift#HPDMIAreaTests
 * @upstream Packages/UEFIImage/Tests/UEFIImageTests/AppleDMIAreaTests.swift#AppleDMIAreaTests
 */

// MARK: - HP

/** @upstream Packages/UEFIImage/Tests/UEFIImageTests/HPDMIAreaTests.swift#HPDMIAreaTests.serial */
export const HP_SERIAL = "5CDTEST001";
/**
 * The UUID as SMBIOS stores it: 78563412-AB90-4788-89CD-EF0102030405.
 *
 * @upstream Packages/UEFIImage/Tests/UEFIImageTests/HPDMIAreaTests.swift#HPDMIAreaTests.uuid
 */
const UUID = Uint8Array.of(
  0x12,
  0x34,
  0x56,
  0x78,
  0x90,
  0xab,
  0x88,
  0x47,
  0x89,
  0xcd,
  0xef,
  0x01,
  0x02,
  0x03,
  0x04,
  0x05
);

/** @upstream Packages/UEFIImage/Tests/UEFIImageTests/HPDMIAreaTests.swift#HPDMIAreaTests.utf16 */
function utf16(text: string, bytes: Uint8Array, offset: number): void {
  for (let index = 0; index < text.length; index++) {
    const unit = text.charCodeAt(index);
    bytes[offset + 2 * index] = unit & 0xff;
    bytes[offset + 2 * index + 1] = unit >> 8;
  }
}

/**
 * An `HP_MUD` value with every field written.
 *
 * @upstream Packages/UEFIImage/Tests/UEFIImageTests/HPDMIAreaTests.swift#HPDMIAreaTests.mud
 */
export function hpMud(serial = HP_SERIAL): Uint8Array {
  const bytes = new Uint8Array(HP_DMI.mudSize);
  utf16(serial, bytes, 0x000);
  utf16("TEST123#ABD", bytes, 0x042);
  utf16("103C_5336AN HP EliteBook", bytes, 0x0a4);
  utf16("PTXTEST01JK100B", bytes, 0x106);
  utf16("HP EliteBook 645 14 inch G11 Notebook PC", bytes, 0x124);
  bytes.set(UUID, 0x19e);
  return bytes;
}

/** @upstream Packages/UEFIImage/Tests/UEFIImageTests/HPDMIAreaTests.swift#HPDMIAreaTests.text */
function utf16Text(value: string, size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  utf16(value, bytes, 0);
  return bytes;
}

/**
 * An HP variable as the firmware writes one: the authenticated header, attributes 07.
 *
 * @upstream Packages/UEFIImage/Tests/UEFIImageTests/HPDMIAreaTests.swift#HPDMIAreaTests.variable
 */
export function hpVariable(
  name: string,
  data: Uint8Array,
  owner: EFIGUID = HP_DMI.factoryGuid,
  state: number = NVRAM.vssVariableAdded
): Uint8Array {
  return authVssVariable({ name, data, vendorGuid: owner, state, attributes: 0x07 });
}

/**
 * `HP_MUD` and the variables beside it, the asset tag the serial.
 *
 * @upstream Packages/UEFIImage/Tests/UEFIImageTests/HPDMIAreaTests.swift#HPDMIAreaTests.variables
 */
export function hpVariables(
  mudState: number = NVRAM.vssVariableAdded,
  assetTag: string = HP_SERIAL
): Uint8Array[] {
  return [
    hpVariable("Timeout", Uint8Array.of(5, 0), HP_DMI.settingsGuid),
    hpVariable("BuildId", utf16Text("24WWTEST602#SABD#DABD", 112)),
    hpVariable("FactoryConfig", utf16Text("476J6S6b7B7H.TR", 500)),
    hpVariable(HP_DMI.mudName, hpMud(), HP_DMI.factoryGuid, mudState),
    hpVariable("HP_TAGS", utf16Text(assetTag, 324), HP_DMI.settingsGuid),
  ];
}

/**
 * A volume of one VSS2 store holding `held`.
 *
 * @upstream Packages/UEFIImage/Tests/UEFIImageTests/HPDMIAreaTests.swift#HPDMIAreaTests.image
 */
export function hpImage(held: readonly Uint8Array[] = hpVariables()): Uint8Array {
  return nvramVolume({ stores: [vss2Store({ variables: held })] });
}

// MARK: - Apple

/** @upstream Packages/UEFIImage/Tests/UEFIImageTests/AppleDMIAreaTests.swift#AppleDMIAreaTests.serial */
export const APPLE_SERIAL = "C02TEST00G94";
/** @upstream Packages/UEFIImage/Tests/UEFIImageTests/AppleDMIAreaTests.swift#AppleDMIAreaTests.board */
export const APPLE_BOARD = "C02542600KXG91TAN";

const ascii = (text: string): Uint8Array => Uint8Array.from(text, (unit) => unit.charCodeAt(0));

/** @upstream Packages/UEFIImage/Tests/UEFIImageTests/AppleDMIAreaTests.swift#AppleDMIAreaTests.variable */
export function appleVariable(name: string, text: string, invalid = false): Uint8Array {
  return sysfVariable({ name, data: ascii(text), invalid });
}

/**
 * The variables of a Mac that keeps its identity: two calibration variables named by the
 * board's serial, then the three of the identity.
 *
 * @upstream Packages/UEFIImage/Tests/UEFIImageTests/AppleDMIAreaTests.swift#AppleDMIAreaTests.variables
 */
export function appleVariables(serial = APPLE_SERIAL, code = "0G94"): Uint8Array[] {
  return [
    sysfVariable({ name: `${APPLE_BOARD}TCFMAC-1`, data: Uint8Array.of(1, 2, 3, 4) }),
    sysfVariable({ name: `${APPLE_BOARD}MAC-1`, data: Uint8Array.of(5, 6, 7, 8) }),
    appleVariable("ssn", serial),
    appleVariable("hwc", code),
    appleVariable("son", "MJVE2D/"),
  ];
}

/** @upstream Packages/UEFIImage/Tests/UEFIImageTests/AppleDMIAreaTests.swift#AppleDMIAreaTests.image */
export function appleImage(
  held: readonly Uint8Array[] = appleVariables(),
  signature: number = NVRAM.appleSysfSignature
): Uint8Array {
  return nvramVolume({ stores: [sysfStore({ variables: held, signature })] });
}
