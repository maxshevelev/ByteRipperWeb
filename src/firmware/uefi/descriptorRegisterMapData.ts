import {
  MapDataError,
  type MapFile,
  MapKind,
  MapSection,
  NO_REFERENCE,
} from "@/firmware/mapData/mapFile";
import { decodedMapsOf } from "@/firmware/mapData/mapResources";
import type {
  DescriptorRegister,
  DescriptorRegisterMap,
  RegisterField,
  RegisterPlace,
} from "@/firmware/uefi/descriptorRegisterMap";

/**
 * One generation's register map as the binary states it.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorRegisterMapData.swift#LoadedRegisterMap
 */
export interface LoadedRegisterMap {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorRegisterMapData.swift#LoadedRegisterMap.id */
  readonly id: string;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorRegisterMapData.swift#LoadedRegisterMap.map */
  readonly map: DescriptorRegisterMap;
}

/**
 * The descriptor's register maps read from `RegisterMaps.bin`, compiled upstream and
 * brought across as it is (`src/firmware/mapData`). A file whose version differs from
 * the code's mark is refused before a section is read.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorRegisterMapData.swift#DescriptorRegisterMapData
 */
function loaded(): readonly LoadedRegisterMap[] | MapDataError {
  return decodedMapsOf("register", decodeRegisterMaps);
}

/**
 * What went wrong, for the tests. `undefined` when the resource loaded.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorRegisterMapData.swift#DescriptorRegisterMapData.failure
 */
export function registerMapFailure(): MapDataError | undefined {
  const maps = loaded();
  return maps instanceof MapDataError ? maps : undefined;
}

/**
 * A generation's map by the id the source gives it, or `undefined` where the
 * resource has none — or cannot be used.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorRegisterMapData.swift#DescriptorRegisterMapData.map
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorRegisterMapData.swift#DescriptorRegisterMapData.required
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorRegisterMapData.swift#DescriptorRegisterMap.sunrisePoint
 * @upstream-differs no named statics: `registerMapForGeneration` asks by id and lives without the map
 */
export function registerMapById(id: string): DescriptorRegisterMap | undefined {
  const all = loaded();
  if (all instanceof MapDataError) return undefined;
  return all.find((one) => one.id === id)?.map;
}

const MAP_RECORD_SIZE = 20;
const REGISTER_RECORD_SIZE = 24;
const FIELD_RECORD_SIZE = 28;
const OPTION_RECORD_SIZE = 8;

const corrupt = (reason: string) => new MapDataError({ kind: "corrupt", reason });

/**
 * Kind 5 over the envelope: the maps, their registers and the registers' fields.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorRegisterMapData.swift#DescriptorRegisterMapData.decode
 */
export function decodeRegisterMaps(file: MapFile): LoadedRegisterMap[] {
  if (file.kind !== MapKind.register) {
    throw new MapDataError({ kind: "wrongKind", mapKind: file.kind });
  }
  const mapsSection = file.requireSection(MapSection.maps);
  const registersSection = file.requireSection(MapSection.registers);
  const fieldsSection = file.requireSection(MapSection.fields);
  const optionsSection = file.section(MapSection.options);

  const count = file.u32(mapsSection.offset);
  const mapsAt = file.records(mapsSection, 4, count, MAP_RECORD_SIZE, "map");
  const result: LoadedRegisterMap[] = [];
  for (let index = 0; index < count; index += 1) {
    const at = mapsAt + index * MAP_RECORD_SIZE;
    const id = file.string(file.u32(at)) ?? "";
    const registerCount = file.u32(at + 4);
    const registersAt = file.records(
      registersSection,
      file.u32(at + 8),
      registerCount,
      REGISTER_RECORD_SIZE,
      "register"
    );
    const registers: DescriptorRegister[] = [];
    for (let registerIndex = 0; registerIndex < registerCount; registerIndex += 1) {
      const registerAt = registersAt + registerIndex * REGISTER_RECORD_SIZE;
      const name = file.string(file.u32(registerAt)) ?? "";
      const placeKind = file.u16(registerAt + 4);
      const placeOffset = file.u32(registerAt + 8);
      const words = file.u16(registerAt + 12);
      const fieldCount = file.u16(registerAt + 14);
      const fieldsOffset = file.u32(registerAt + 16);
      if (words <= 0) throw corrupt(`${id}: ${name} states no words`);
      const kinds = ["absolute", "flashComponent", "flashMaster"] as const;
      const kind = kinds[placeKind];
      if (kind === undefined) throw corrupt(`${id}: ${name} has place kind ${placeKind}`);
      const place: RegisterPlace = { kind, offset: placeOffset };
      const fieldsAt = file.records(
        fieldsSection,
        fieldsOffset,
        fieldCount,
        FIELD_RECORD_SIZE,
        "field"
      );
      const fields: RegisterField[] = [];
      for (let fieldIndex = 0; fieldIndex < fieldCount; fieldIndex += 1) {
        const fieldAt = fieldsAt + fieldIndex * FIELD_RECORD_SIZE;
        const fieldName = file.string(file.u32(fieldAt)) ?? "";
        const word = file.u16(fieldAt + 4);
        const low = file.u8(fieldAt + 6);
        const high = file.u8(fieldAt + 7);
        const flags = file.u16(fieldAt + 8);
        const label = file.string(file.u32(fieldAt + 14));
        const optionsOffset = file.u32(fieldAt + 18);
        const optionCount = file.u16(fieldAt + 22);
        if (word >= words || low > high || high >= 32) {
          throw corrupt(`${id}: ${fieldName} at word ${word}, bits ${low}…${high}`);
        }
        const options = new Map<number, string>();
        if ((flags & 2) !== 0 && optionsSection !== undefined) {
          if (optionsOffset === NO_REFERENCE) throw corrupt(`${id}: ${fieldName} has no options`);
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
        fields.push({
          name: fieldName,
          bitOffset: word * 32 + low,
          count: high - low + 1,
          label,
          options: options.size === 0 ? undefined : options,
        });
      }
      registers.push({ name, place, words, fields });
    }
    result.push({ id, map: { registers } });
  }
  return result;
}
