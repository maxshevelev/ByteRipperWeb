import { bitField } from "@/firmware/me/configuration/bitField";
import { uepMapById } from "@/firmware/me/configuration/uepMapData";
import { uepContainerOffset } from "@/firmware/me/layout/bootGuard";
import type { UEPReading } from "@/firmware/me/models/configurationFacts";

/**
 * The FPF/UEP settings a generation's tool writes into the `$UEP` area — the bits the
 * platform would burn at End of Manufacturing, as the tool's own documents lay them out.
 * The area is described nowhere public; each setting has a declaration and a
 * `GetBitArrayValue` action giving its place in one of several arrays the container
 * keeps. What an image's array holds is the state the build wrote: most settings read
 * zero, and that is the state, not a gap.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/UEPMap.swift#UEPMap
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/UEPMap.swift#UEPMap.init
 */
export interface UEPMap {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/UEPMap.swift#UEPMap.name */
  readonly name: string;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/UEPMap.swift#UEPMap.settings */
  readonly settings: readonly UEPSetting[];
  /**
   * How far past the container's signature the first bit array begins: 0x0C in the
   * CSME 15/16 area, 8 in CSME 18's (the tool's own 8-byte header).
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/UEPMap.swift#UEPMap.arrayStart
   */
  readonly arrayStart: number;
  /**
   * The size of one array where the container's arrays are laid contiguously and a map
   * names later ones (CSME 18: 0x80); zero where a map keeps to the first.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/UEPMap.swift#UEPMap.arraySize
   */
  readonly arraySize: number;
}

/**
 * Where a setting's bits sit: an array, a byte offset into it, and the bit the field
 * starts at, counted little-endian from that byte. A field may run past the 32-bit word
 * it starts in.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/UEPMap.swift#UEPMap.Placement
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/UEPMap.swift#UEPMap.Placement.init
 */
export interface UEPPlacement {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/UEPMap.swift#UEPMap.Placement.array */
  readonly array: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/UEPMap.swift#UEPMap.Placement.offset */
  readonly offset: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/UEPMap.swift#UEPMap.Placement.bit */
  readonly bit: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/UEPMap.swift#UEPMap.Placement.count */
  readonly count: number;
}

/**
 * One setting of the area, as the tool declares it.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/UEPMap.swift#UEPMap.Setting
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/UEPMap.swift#UEPMap.Setting.init
 */
export interface UEPSetting {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/UEPMap.swift#UEPMap.Setting.name */
  readonly name: string;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/UEPMap.swift#UEPMap.Setting.placement */
  readonly placement: UEPPlacement;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/UEPMap.swift#UEPMap.Setting.label */
  readonly label: string | undefined;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/UEPMap.swift#UEPMap.Setting.section */
  readonly section: string | undefined;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/UEPMap.swift#UEPMap.Setting.help */
  readonly help: string | undefined;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/UEPMap.swift#UEPMap.Setting.options */
  readonly options: ReadonlyMap<number, string> | undefined;
}

const UEP_IDS: Readonly<Record<number, string>> = {
  12: "csme12",
  13: "csme13",
  14: "csme14",
  15: "csme15",
  16: "csme16",
  18: "csme18",
};

/**
 * The map for a generation's major number, or nothing where the area is not one the
 * engine reads. 17 has no map of its own yet.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/UEPMap.swift#UEPMap.forME
 */
export function uepMapForME(major: number): UEPMap | undefined {
  const id = UEP_IDS[major];
  return id === undefined ? undefined : uepMapById(id);
}

/** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/UEPMap.swift#UEPMap.all */
export const allUEPMaps = (): UEPMap[] =>
  Object.values(UEP_IDS)
    .map(uepMapById)
    .filter((map): map is UEPMap => map !== undefined);

/**
 * How far past the container's signature the first array begins in the CSME 15/16 area.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/UEPMap.swift#UEPReader.firstArrayOffset
 */
export const UEP_FIRST_ARRAY_OFFSET = 0x0c;

/**
 * The values of every setting of `map` the area holds: the container's `$UEP` signature,
 * its first array `arrayStart` bytes past it, and each setting's bits from its array and
 * offset, little-endian. Nothing where the area has no container, or is too short for
 * every setting it is asked about — an area erased past reading answers nothing rather
 * than zeros.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/UEPMap.swift#UEPReader
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/UEPMap.swift#UEPReader.readings
 */
export function uepReadings(area: Uint8Array, map: UEPMap): UEPReading[] | undefined {
  const container = uepContainerOffset(area);
  if (container === undefined) return undefined;
  const arrays = container + map.arrayStart;
  const readings: UEPReading[] = [];
  for (const setting of map.settings) {
    const place = setting.placement;
    if (place.count <= 0 || place.count > 64 || place.bit < 0 || place.bit + place.count > 64)
      continue;
    const at = arrays + (map.arraySize > 0 ? place.array * map.arraySize : 0) + place.offset;
    const value = bitField(area, at, place.bit, place.count);
    if (value !== undefined) readings.push({ name: setting.name, value: Number(value) });
  }
  return readings.length === 0 ? undefined : readings;
}
