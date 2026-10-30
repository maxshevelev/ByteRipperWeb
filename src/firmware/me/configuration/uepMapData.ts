import { MapDataError, type MapFile, MapKind, MapSection } from "@/firmware/mapData/mapFile";
import { decodedMapsOf } from "@/firmware/mapData/mapResources";
import type { UEPMap, UEPSetting } from "@/firmware/me/configuration/uepMap";

/**
 * One generation's UEP map as the binary states it.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/UEPMapData.swift#LoadedUEPMap
 */
export interface LoadedUEPMap {
  readonly id: string;
  readonly map: UEPMap;
}

/**
 * The UEP maps read from `UEPMaps.bin`, compiled upstream and brought across as it is.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/UEPMapData.swift#UEPMapData
 */
function loaded(): readonly LoadedUEPMap[] | MapDataError {
  return decodedMapsOf("uep", decodeUEPMaps);
}

/** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/UEPMapData.swift#UEPMapData.failure */
export function uepMapFailure(): MapDataError | undefined {
  const maps = loaded();
  return maps instanceof MapDataError ? maps : undefined;
}

/**
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/UEPMapData.swift#UEPMapData.map
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/UEPMapData.swift#UEPMapData.required
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/UEPMapData.swift#UEPMap.csme12
 * @upstream-differs no named statics: `uepMapForME` asks by id and lives without the map
 */
export function uepMapById(id: string): UEPMap | undefined {
  const all = loaded();
  if (all instanceof MapDataError) return undefined;
  return all.find((one) => one.id === id)?.map;
}

const MAP_RECORD_SIZE = 24;
const SETTING_RECORD_SIZE = 32;
const OPTION_RECORD_SIZE = 8;
const HAS_LABEL = 1;
const HAS_SECTION = 2;
const HAS_HELP = 4;
const HAS_OPTIONS = 8;

/**
 * Kind 3 over the envelope: the maps and their settings.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/UEPMapData.swift#UEPMapData.decode
 */
export function decodeUEPMaps(file: MapFile): LoadedUEPMap[] {
  if (file.kind !== MapKind.uep) throw new MapDataError({ kind: "wrongKind", mapKind: file.kind });
  const mapsSection = file.requireSection(MapSection.maps);
  const settingsSection = file.requireSection(MapSection.settings);
  const optionsSection = file.section(MapSection.options);
  const count = file.u32(mapsSection.offset);
  const mapsAt = file.records(mapsSection, 4, count, MAP_RECORD_SIZE, "map");
  const result: LoadedUEPMap[] = [];
  for (let index = 0; index < count; index += 1) {
    const at = mapsAt + index * MAP_RECORD_SIZE;
    const id = file.string(file.u32(at)) ?? "";
    const name = file.string(file.u32(at + 4)) ?? "";
    const arrayStart = file.u16(at + 8);
    const arraySize = file.u16(at + 10);
    const settingCount = file.u32(at + 12);
    const settingsAt = file.records(
      settingsSection,
      file.u32(at + 16),
      settingCount,
      SETTING_RECORD_SIZE,
      "setting"
    );
    const settings: UEPSetting[] = [];
    for (let settingIndex = 0; settingIndex < settingCount; settingIndex += 1) {
      const settingAt = settingsAt + settingIndex * SETTING_RECORD_SIZE;
      const settingName = file.string(file.u32(settingAt)) ?? "";
      const flags = file.u16(settingAt + 4);
      const array = file.u16(settingAt + 6);
      const offset = file.u16(settingAt + 8);
      const bit = file.u8(settingAt + 10);
      const bits = file.u8(settingAt + 11);
      if (bits <= 0 || bit + bits > 64) {
        throw new MapDataError({
          kind: "corrupt",
          reason: `${id}: ${settingName} bits ${bit}…${bit + bits - 1}`,
        });
      }
      const options = new Map<number, string>();
      if ((flags & HAS_OPTIONS) !== 0 && optionsSection !== undefined) {
        const optionCount = file.u16(settingAt + 28);
        const optionsAt = file.records(
          optionsSection,
          file.u32(settingAt + 24),
          optionCount,
          OPTION_RECORD_SIZE,
          "option"
        );
        for (let optionIndex = 0; optionIndex < optionCount; optionIndex += 1) {
          const optionAt = optionsAt + optionIndex * OPTION_RECORD_SIZE;
          const text = file.string(file.u32(optionAt + 4));
          if (text !== undefined) options.set(file.u16(optionAt), text);
        }
      }
      settings.push({
        name: settingName,
        placement: { array, offset, bit, count: bits },
        label: (flags & HAS_LABEL) !== 0 ? file.string(file.u32(settingAt + 12)) : undefined,
        section: (flags & HAS_SECTION) !== 0 ? file.string(file.u32(settingAt + 16)) : undefined,
        help: (flags & HAS_HELP) !== 0 ? file.string(file.u32(settingAt + 20)) : undefined,
        options: options.size === 0 ? undefined : options,
      });
    }
    result.push({ id, map: { name, settings, arrayStart, arraySize } });
  }
  return result;
}
