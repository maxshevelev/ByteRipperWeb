import { nvramVolume, sysfStore, sysfVariable } from "@/firmware/testing/testNvram";
import { NVRAM } from "@/firmware/uefi/nvramParser";

/**
 * Apple's identity as the firmware keeps it, for the tests of the reader (`appleDmiArea.ts`) and of
 * the detail (`uefiAppleDMIDetail.ts`): `ssn`, `hwc` and `son` in a SysF store, the board's serial
 * in the names of the calibration variables beside them. Synthetic variables in the layout the
 * dumps were surveyed in.
 *
 * @upstream Packages/UEFIImage/Tests/UEFIImageTests/AppleDMIAreaTests.swift#AppleDMIAreaTests
 */
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
