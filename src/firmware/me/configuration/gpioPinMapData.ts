import {
  MapDataError,
  type MapFile,
  type MapFileSection,
  MapKind,
  MapSection,
  NO_REFERENCE,
} from "@/firmware/mapData/mapFile";
import { decodedMapsOf } from "@/firmware/mapData/mapResources";
import type { GPIOPinMap } from "@/firmware/me/configuration/gpioPinMap";

/**
 * One generation's pin map as the binary states it.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/GPIOPinMapData.swift#LoadedGPIOPinMap
 */
export interface LoadedGPIOPinMap {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/GPIOPinMapData.swift#LoadedGPIOPinMap.id */
  readonly id: string;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/GPIOPinMapData.swift#LoadedGPIOPinMap.map */
  readonly map: GPIOPinMap;
}

/**
 * The feature pin maps read from `GPIOMaps.bin`, compiled upstream and brought across as
 * it is.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/GPIOPinMapData.swift#GPIOPinMapData
 */
function loaded(): readonly LoadedGPIOPinMap[] | MapDataError {
  return decodedMapsOf("gpio", decodeGPIOPinMaps);
}

/** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/GPIOPinMapData.swift#GPIOPinMapData.failure */
export function gpioPinMapFailure(): MapDataError | undefined {
  const maps = loaded();
  return maps instanceof MapDataError ? maps : undefined;
}

/**
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/GPIOPinMapData.swift#GPIOPinMapData.map
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/GPIOPinMapData.swift#GPIOPinMapData.required
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/GPIOPinMapData.swift#GPIOPinMap.csme11
 * @upstream-differs no named statics: `gpioPinMapForME` asks by id and lives without the map
 */
export function gpioPinMapById(id: string): GPIOPinMap | undefined {
  const all = loaded();
  if (all instanceof MapDataError) return undefined;
  return all.find((one) => one.id === id)?.map;
}

const MAP_RECORD_SIZE = 40;
const OPTION_RECORD_SIZE = 8;
/** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/GPIOPinMapData.swift#GPIOPinMapData.dictionaryNames */
const DICTIONARY_NAMES = ["features", "usages", "ownerships", "padModes", "groups"] as const;

/**
 * Kind 4 over the envelope: each map's five dictionaries.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/GPIOPinMapData.swift#GPIOPinMapData.decode
 */
export function decodeGPIOPinMaps(file: MapFile): LoadedGPIOPinMap[] {
  if (file.kind !== MapKind.gpio) throw new MapDataError({ kind: "wrongKind", mapKind: file.kind });
  const mapsSection = file.requireSection(MapSection.maps);
  const optionsSection = file.section(MapSection.options);
  const count = file.u32(mapsSection.offset);
  const mapsAt = file.records(mapsSection, 4, count, MAP_RECORD_SIZE, "map");
  const result: LoadedGPIOPinMap[] = [];
  for (let index = 0; index < count; index += 1) {
    const at = mapsAt + index * MAP_RECORD_SIZE;
    const id = file.string(file.u32(at)) ?? "";
    const name = file.string(file.u32(at + 4)) ?? "";
    const dictionaries = DICTIONARY_NAMES.map((dictionaryName, dictionary) =>
      readDictionary(
        file,
        optionsSection,
        id,
        dictionaryName,
        file.u32(at + 8 + dictionary * 4),
        file.u16(at + 28 + dictionary * 2)
      )
    );
    const [features, usages, ownerships, padModes, groups] = dictionaries as [
      Map<number, string>,
      Map<number, string>,
      Map<number, string>,
      Map<number, string>,
      Map<number, string>,
    ];
    result.push({ id, map: { name, features, usages, ownerships, padModes, groups } });
  }
  return result;
}

/** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/GPIOPinMapData.swift#GPIOPinMapData.readDictionary */
function readDictionary(
  file: MapFile,
  section: MapFileSection | undefined,
  id: string,
  name: string,
  offset: number,
  count: number
): Map<number, string> {
  const entries = new Map<number, string>();
  if (count === 0) return entries;
  if (section === undefined || offset === NO_REFERENCE) {
    throw new MapDataError({
      kind: "corrupt",
      reason: `${id}: ${name} has ${count} entries and no section`,
    });
  }
  const entriesAt = file.records(section, offset, count, OPTION_RECORD_SIZE, name);
  for (let index = 0; index < count; index++) {
    const at = entriesAt + index * OPTION_RECORD_SIZE;
    const text = file.string(file.u32(at + 4));
    if (text !== undefined) entries.set(file.u16(at), text);
  }
  return entries;
}
