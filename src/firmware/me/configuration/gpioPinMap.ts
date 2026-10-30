import { gpioPinMapById } from "@/firmware/me/configuration/gpioPinMapData";
import type { GPIOPin } from "@/firmware/me/models/configurationFacts";

/**
 * The pins the CSME firmware may drive, as Flash Image Tool names them: five value
 * classes behind a feature pin — the feature set, the usage, the owner, the pad mode and
 * the GPIO group — and the configured pins in `/home/gpio/csme_pins`. The record's shape
 * is the generation's: CSME 11 writes 20-byte records of five little-endian dwords,
 * CSME 12 and later 12-byte records of packed bytes. A file whose records do not
 * validate against the map is not read.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/GPIOPinMap.swift#GPIOPinMap
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/GPIOPinMap.swift#GPIOPinMap.init
 */
export interface GPIOPinMap {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/GPIOPinMap.swift#GPIOPinMap.name */
  readonly name: string;
  /**
   * Feature set (`GpioCsmeFeatureIdValues`). Empty on CSME 11.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/GPIOPinMap.swift#GPIOPinMap.features
   */
  readonly features: ReadonlyMap<number, string>;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/GPIOPinMap.swift#GPIOPinMap.usages */
  readonly usages: ReadonlyMap<number, string>;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/GPIOPinMap.swift#GPIOPinMap.ownerships */
  readonly ownerships: ReadonlyMap<number, string>;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/GPIOPinMap.swift#GPIOPinMap.padModes */
  readonly padModes: ReadonlyMap<number, string>;
  /**
   * GPIO group (`GpioGroupValues`). A number the tool's documents disagree about is
   * absent, and the reading shows the number instead of a name.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/GPIOPinMap.swift#GPIOPinMap.groups
   */
  readonly groups: ReadonlyMap<number, string>;
}

const GPIO_IDS: Readonly<Record<number, string>> = {
  11: "csme11",
  12: "csme12",
  13: "csme13",
  14: "csme14",
  15: "csme15",
};

/**
 * The map of a ME generation's major number, or nothing where none was emitted (CSME 16
 * and 18 keep their settings in MFIT's database, which does not carry these classes).
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/GPIOPinMap.swift#GPIOPinMap.forME
 */
export function gpioPinMapForME(major: number): GPIOPinMap | undefined {
  const id = GPIO_IDS[major];
  return id === undefined ? undefined : gpioPinMapById(id);
}

/** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/GPIOPinMap.swift#GPIOPinMap.all */
export const allGPIOPinMaps = (): GPIOPinMap[] =>
  Object.values(GPIO_IDS)
    .map(gpioPinMapById)
    .filter((map): map is GPIOPinMap => map !== undefined);

/**
 * The record's bytes each generation writes.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/GPIOPinMap.swift#GPIOPinReader.recordSize
 */
export const gpioRecordSize = (major: number): number => (major === 11 ? 20 : 12);

const u32 = (bytes: Uint8Array, at: number): number =>
  ((bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8) | ((bytes[at + 2] ?? 0) << 16)) +
  (bytes[at + 3] ?? 0) * 0x100_0000;

/**
 * The pins the file records, or nothing where its bytes are not a pin file of this
 * generation's shape: an empty file, a length that is not whole records, or a record
 * whose owner, pad mode or pad cannot be true of any pin.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/GPIOPinMap.swift#GPIOPinReader
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/GPIOPinMap.swift#GPIOPinReader.pins
 */
export function gpioPins(bytes: Uint8Array, map: GPIOPinMap, major: number): GPIOPin[] | undefined {
  const size = gpioRecordSize(major);
  if (bytes.length === 0 || bytes.length % size !== 0 || bytes.length / size > 256)
    return undefined;
  const pins: GPIOPin[] = [];
  for (let index = 0; index < bytes.length / size; index++) {
    const base = index * size;
    let featureID: number | undefined;
    let usageID: number;
    let groupID: number;
    let pad: number;
    let ownershipID: number;
    let padModeID: number;
    if (major === 11) {
      usageID = u32(bytes, base);
      groupID = u32(bytes, base + 4);
      pad = u32(bytes, base + 8);
      ownershipID = u32(bytes, base + 12);
      padModeID = u32(bytes, base + 16);
    } else {
      featureID = bytes[base] ?? 0;
      groupID = bytes[base + 1] ?? 0;
      pad = bytes[base + 2] ?? 0;
      usageID = bytes[base + 4] ?? 0;
      ownershipID = bytes[base + 6] ?? 0;
      padModeID = bytes[base + 7] ?? 0;
    }
    // A pin's owner is one of four modes and its pad mode one of five, and a pad number
    // is a byte of a GPIO community. A record that says otherwise is not this file's shape.
    if (ownershipID > 3 || padModeID > 4 || pad >= 64 || !(groupID < 32 || groupID === 0xff)) {
      return undefined;
    }
    pins.push({
      feature: featureID === undefined ? undefined : map.features.get(featureID),
      featureID,
      usage: map.usages.get(usageID),
      usageID,
      group: map.groups.get(groupID),
      groupID,
      pad,
      ownership: map.ownerships.get(ownershipID) ?? `${ownershipID}`,
      ownershipID,
      padMode: map.padModes.get(padModeID) ?? `${padModeID}`,
      padModeID,
    });
  }
  return pins;
}
