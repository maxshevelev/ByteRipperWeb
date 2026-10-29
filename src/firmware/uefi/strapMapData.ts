import {
  MapDataError,
  type MapFile,
  MapKind,
  MapSection,
  NO_REFERENCE,
} from "@/firmware/mapData/mapFile";
import { decodedMapsOf } from "@/firmware/mapData/mapResources";
import type { DescriptorStrapMap, StrapField } from "@/firmware/uefi/strapMap";

/**
 * One map as the binary states it: the identifier the code asks for, the set it
 * belongs to (PCH, SPT, CPU, PMC, MIP, the legacy guides) and the table itself.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/StrapMapData.swift#LoadedStrapMap
 */
export interface LoadedStrapMap {
  readonly id: string;
  readonly set: number;
  readonly map: DescriptorStrapMap;
}

/**
 * The strap tables read from `StrapMaps.bin`.
 *
 * The file is compiled upstream from its JSON sources and brought across as it
 * is (`src/firmware/mapData`). Its header carries a version the code was marked
 * with too; a file whose version differs is refused before a section is read,
 * so a stale resource can never be mistaken for a changed layout.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/StrapMapData.swift#StrapMapData
 */
function loaded(): readonly LoadedStrapMap[] | MapDataError {
  return decodedMapsOf("strap", decodeStrapMaps);
}

/**
 * What went wrong, for the panel's diagnostics and the tests. `undefined` when the
 * resource loaded.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/StrapMapData.swift#StrapMapData.failure
 */
export function strapMapFailure(): MapDataError | undefined {
  const maps = loaded();
  return maps instanceof MapDataError ? maps : undefined;
}

function maps(set: number): DescriptorStrapMap[] {
  const all = loaded();
  if (all instanceof MapDataError) return [];
  return all.filter((one) => one.set === set).map((one) => one.map);
}

/**
 * The PCH tables, in the order the source states them.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/StrapMapData.swift#StrapMapData.pchMaps
 */
export const pchStrapMaps = (): DescriptorStrapMap[] => maps(0);

/**
 * FIT 11's SPT spellings, a set of their own: a length can mean two different
 * sections in the two sets.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/StrapMapData.swift#StrapMapData.sptMaps
 */
export const sptStrapMaps = (): DescriptorStrapMap[] => maps(1);

/**
 * The processor strap sections, keyed by the length `FLMAP2` states.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/StrapMapData.swift#StrapMapData.cpuMaps
 */
export const cpuStrapMaps = (): DescriptorStrapMap[] => maps(2);

/**
 * The PMC soft straps, keyed by the block's length less the CPU message.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/StrapMapData.swift#StrapMapData.pmcMaps
 */
export const pmcStrapMaps = (): DescriptorStrapMap[] => maps(4);

/**
 * The CPU strap messages in the MIP area, keyed by their length.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/StrapMapData.swift#StrapMapData.mipMaps
 */
export const mipStrapMaps = (): DescriptorStrapMap[] => maps(5);

/**
 * The generations before FIT's documents, from Intel's guides.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/StrapMapData.swift#StrapMapData.legacyMaps
 */
export const legacyStrapMaps = (): DescriptorStrapMap[] => maps(6);

/**
 * FIT 11's three-word processor table, not the newer three-word one.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/StrapMapData.swift#StrapMapData.sptCPUMaps
 */
export const sptCPUStrapMaps = (): DescriptorStrapMap[] => maps(7);

/** @upstream Packages/UEFIImage/Sources/UEFIImage/StrapMapData.swift#StrapMapData.map */
export function strapMapById(id: string): DescriptorStrapMap | undefined {
  const all = loaded();
  if (all instanceof MapDataError) return undefined;
  return all.find((one) => one.id === id)?.map;
}

/**
 * The map a test or a table names, or an error naming the resource problem.
 * Production code asks {@link strapMapById} and lives without the table.
 *
 * The generated tables upstream were `DescriptorStrapMap.pch69` and the like;
 * the names stay, as the ids this takes.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/StrapMapData.swift#StrapMapData.required
 * @upstream Packages/UEFIImage/Sources/UEFIImage/StrapMapData.swift#DescriptorStrapMap.pch69
 */
export function requiredStrapMap(id: string): DescriptorStrapMap {
  const all = loaded();
  if (all instanceof MapDataError) throw new Error(`the map resource: ${all.message}`);
  const map = all.find((one) => one.id === id)?.map;
  if (map === undefined) throw new Error(`the map resource has no ${id}`);
  return map;
}

const MAP_RECORD_SIZE = 24;
const FIELD_RECORD_SIZE = 28;
const OPTION_RECORD_SIZE = 8;

const corrupt = (reason: string) => new MapDataError({ kind: "corrupt", reason });

/**
 * Kind 1 over the envelope: the maps, their fields and the fields' options.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/StrapMapData.swift#StrapMapData.decode
 */
export function decodeStrapMaps(file: MapFile): LoadedStrapMap[] {
  if (file.kind !== MapKind.strap) {
    throw new MapDataError({ kind: "wrongKind", mapKind: file.kind });
  }
  const mapsSection = file.requireSection(MapSection.maps);
  const fieldsSection = file.requireSection(MapSection.fields);
  const optionsSection = file.section(MapSection.options);

  const count = file.u32(mapsSection.offset);
  const mapsAt = file.records(mapsSection, 4, count, MAP_RECORD_SIZE, "map");
  const result: LoadedStrapMap[] = [];
  for (let index = 0; index < count; index += 1) {
    const at = mapsAt + index * MAP_RECORD_SIZE;
    const id = file.string(file.u32(at)) ?? "";
    const name = file.string(file.u32(at + 4)) ?? "";
    const words = file.u16(at + 8);
    const set = file.u16(at + 10);
    const fieldCount = file.u32(at + 12);
    const fieldsOffset = file.u32(at + 16);
    if (words <= 0) throw corrupt(`map ${id} states no words`);
    const fieldsAt = file.records(
      fieldsSection,
      fieldsOffset,
      fieldCount,
      FIELD_RECORD_SIZE,
      "field"
    );
    const fields: StrapField[] = [];
    for (let fieldIndex = 0; fieldIndex < fieldCount; fieldIndex += 1) {
      const fieldAt = fieldsAt + fieldIndex * FIELD_RECORD_SIZE;
      const fieldName = file.string(file.u32(fieldAt)) ?? "";
      const word = file.u16(fieldAt + 4);
      const low = file.u8(fieldAt + 6);
      const high = file.u8(fieldAt + 7);
      const flags = file.u16(fieldAt + 8);
      const defaultWord = file.u32(fieldAt + 10);
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
        word,
        low,
        high,
        defaultValue: (flags & 1) !== 0 ? defaultWord : undefined,
        label,
        options: options.size === 0 ? undefined : options,
      });
    }
    result.push({ id, set, map: { name, words, fields } });
  }
  return result;
}
