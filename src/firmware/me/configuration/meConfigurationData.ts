import { MapDataError, type MapFile, MapKind, MapSection } from "@/firmware/mapData/mapFile";
import { decodedMapsOf } from "@/firmware/mapData/mapResources";
import type {
  MapCondition,
  MapSetting,
  MEConfigurationFileLayout,
  MEConfigurationMap,
} from "@/firmware/me/configuration/meConfigurationMap";

/**
 * One generation's configuration map as the binary states it.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/MEConfigurationData.swift#LoadedConfigurationMap
 */
export interface LoadedConfigurationMap {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/MEConfigurationData.swift#LoadedConfigurationMap.id */
  readonly id: string;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/MEConfigurationData.swift#LoadedConfigurationMap.map */
  readonly map: MEConfigurationMap;
}

/**
 * The configuration maps read from `ConfigMaps.bin`, compiled upstream and brought across
 * as it is (`src/firmware/mapData`). A file whose version differs from the code's mark is
 * refused before a section is read.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/MEConfigurationData.swift#MEConfigurationData
 */
function loaded(): readonly LoadedConfigurationMap[] | MapDataError {
  return decodedMapsOf("configuration", decodeConfigurationMaps);
}

/** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/MEConfigurationData.swift#MEConfigurationData.failure */
export function configurationMapFailure(): MapDataError | undefined {
  const maps = loaded();
  return maps instanceof MapDataError ? maps : undefined;
}

/**
 * A map by its id, or nothing where the resource has none — or cannot be used.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/MEConfigurationData.swift#MEConfigurationData.map
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/MEConfigurationData.swift#MEConfigurationData.required
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/MEConfigurationData.swift#MEConfigurationMap.csme11
 * @upstream-differs no named statics: `configurationMapForME` asks by id and lives without the map
 */
export function meConfigurationMapById(id: string): MEConfigurationMap | undefined {
  const all = loaded();
  if (all instanceof MapDataError) return undefined;
  return all.find((one) => one.id === id)?.map;
}

const MAP_RECORD_SIZE = 24;
const FILE_RECORD_SIZE = 20;
const SETTING_RECORD_SIZE = 50;
const OPTION_RECORD_SIZE = 8;

const HAS_BITS = 1;
const HAS_OPTIONS = 2;
const IS_AUTO = 16;
const IS_HEX = 32;
const IS_TEXT = 64;
const HAS_CONDITION = 128;
const HAS_DISABLED_BY = 256;

const corrupt = (reason: string) => new MapDataError({ kind: "corrupt", reason });

/**
 * Kind 2 over the envelope: the maps, their files, and the files' settings.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/MEConfigurationData.swift#MEConfigurationData.decode
 */
export function decodeConfigurationMaps(file: MapFile): LoadedConfigurationMap[] {
  if (file.kind !== MapKind.configuration) {
    throw new MapDataError({ kind: "wrongKind", mapKind: file.kind });
  }
  const mapsSection = file.requireSection(MapSection.maps);
  const filesSection = file.requireSection(MapSection.files);
  const settingsSection = file.requireSection(MapSection.settings);
  const optionsSection = file.section(MapSection.options);

  const count = file.u32(mapsSection.offset);
  const mapsAt = file.records(mapsSection, 4, count, MAP_RECORD_SIZE, "map");
  const result: LoadedConfigurationMap[] = [];
  for (let index = 0; index < count; index += 1) {
    const at = mapsAt + index * MAP_RECORD_SIZE;
    const id = file.string(file.u32(at)) ?? "";
    const name = file.string(file.u32(at + 4)) ?? "";
    const fileCount = file.u32(at + 8);
    const filesAt = file.records(
      filesSection,
      file.u32(at + 12),
      fileCount,
      FILE_RECORD_SIZE,
      "file"
    );
    const files: MEConfigurationFileLayout[] = [];
    for (let fileIndex = 0; fileIndex < fileCount; fileIndex += 1) {
      const fileAt = filesAt + fileIndex * FILE_RECORD_SIZE;
      const path = file.string(file.u32(fileAt)) ?? "";
      const alias = file.string(file.u32(fileAt + 4)) ?? "";
      const settingCount = file.u32(fileAt + 8);
      const settingsAt = file.records(
        settingsSection,
        file.u32(fileAt + 12),
        settingCount,
        SETTING_RECORD_SIZE,
        "setting"
      );
      const settings: MapSetting[] = [];
      for (let settingIndex = 0; settingIndex < settingCount; settingIndex += 1) {
        const settingAt = settingsAt + settingIndex * SETTING_RECORD_SIZE;
        const settingName = file.string(file.u32(settingAt)) ?? "";
        const offset = file.u32(settingAt + 4);
        const length = file.u16(settingAt + 8);
        const flags = file.u16(settingAt + 10);
        const low = file.u8(settingAt + 12);
        const high = file.u8(settingAt + 13);
        const label = file.string(file.u32(settingAt + 14));
        const help = file.string(file.u32(settingAt + 18));
        const optionsOffset = file.u32(settingAt + 22);
        const optionCount = file.u16(settingAt + 26);
        const condition = readCondition(
          file,
          settingAt + 30,
          settingAt + 34,
          (flags & HAS_CONDITION) !== 0
        );
        const disabledBy = readCondition(
          file,
          settingAt + 38,
          settingAt + 42,
          (flags & HAS_DISABLED_BY) !== 0
        );
        if (length <= 0 || offset < 0)
          throw corrupt(`${id}: ${settingName} at ${offset}, length ${length}`);
        if ((flags & HAS_BITS) !== 0 && !(low <= high && high < length * 8)) {
          throw corrupt(`${id}: ${settingName} bits ${low}…${high} of ${length} bytes`);
        }
        const options = new Map<number, string>();
        if ((flags & HAS_OPTIONS) !== 0 && optionsSection !== undefined) {
          const optionsAt = file.records(
            optionsSection,
            optionsOffset,
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
          offset,
          length,
          label,
          help,
          condition,
          disabledBy,
          bits: (flags & HAS_BITS) !== 0 ? { low, high } : undefined,
          options: options.size === 0 ? undefined : options,
          auto: (flags & IS_AUTO) !== 0,
          hex: (flags & IS_HEX) !== 0,
          text: (flags & IS_TEXT) !== 0,
        });
      }
      files.push({ path, alias, settings });
    }
    result.push({ id, map: { name, files } });
  }
  return result;
}

/** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/MEConfigurationData.swift#MEConfigurationData.readCondition */
function readCondition(
  file: MapFile,
  nameAt: number,
  valueAt: number,
  enabled: boolean
): MapCondition | undefined {
  if (!enabled) return undefined;
  const name = file.string(file.u32(nameAt));
  return name === undefined ? undefined : { name, value: file.i32(valueAt) };
}
