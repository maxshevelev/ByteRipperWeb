import { MapDataError, type MapFile, MapKind, MapSection } from "@/firmware/mapData/mapFile";
import { decodedMapsOf } from "@/firmware/mapData/mapResources";
import { bitField } from "@/firmware/me/configuration/bitField";
import type {
  CPUStrapReading,
  CPUStrapReadings,
  MIPStrapContainerReadings,
  MIPStrapReading,
} from "@/firmware/me/models/configurationFacts";

/**
 * CSME 18's three layouts, as the tool's own documents state them: the MIP table's strap
 * containers, the CPU strap message and the SPHY OEM configuration nvar — all of them in
 * the FITC partition's payload, none in the descriptor. Compiled upstream into
 * `LayoutMaps.bin` and read here, with the readers that take each out of an image.
 */

/** A field of a layout, by its bits. @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/MIPStrapMap.swift#MIPStrapMap.Field */
export interface LayoutField {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/MIPStrapMap.swift#MIPStrapMap.Field.name */
  readonly name: string;
  /**
   * The bit the field starts at, counted from the container's (or the nvar's) first byte.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/MIPStrapMap.swift#MIPStrapMap.Field.bitOffset
   */
  readonly bitOffset: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/MIPStrapMap.swift#MIPStrapMap.Field.count */
  readonly count: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/MIPStrapMap.swift#MIPStrapMap.Field.label */
  readonly label: string | undefined;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/MIPStrapMap.swift#MIPStrapMap.Field.section */
  readonly section: string | undefined;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/MIPStrapMap.swift#MIPStrapMap.Field.help */
  readonly help: string | undefined;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/MIPStrapMap.swift#MIPStrapMap.Field.options */
  readonly options: ReadonlyMap<number, string> | undefined;
}

/**
 * The MIP table's strap containers beside the CPU message — CSME (DBC), PMC IOE, IOE —
 * each chosen by its block's type and length, because the same names sit at different
 * offsets in the tool's documents for different blocks.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/MIPStrapMap.swift#MIPStrapMap
 */
export interface MIPStrapMap {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/MIPStrapMap.swift#MIPStrapMap.name */
  readonly name: string;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/MIPStrapMap.swift#MIPStrapMap.containers */
  readonly containers: readonly MIPStrapContainer[];
}

/** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/MIPStrapMap.swift#MIPStrapMap.Container */
export interface MIPStrapContainer {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/MIPStrapMap.swift#MIPStrapMap.Container.name */
  readonly name: string;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/MIPStrapMap.swift#MIPStrapMap.Container.blockType */
  readonly blockType: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/MIPStrapMap.swift#MIPStrapMap.Container.blockLength */
  readonly blockLength: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/MIPStrapMap.swift#MIPStrapMap.Container.offset */
  readonly offset: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/MIPStrapMap.swift#MIPStrapMap.Container.length */
  readonly length: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/MIPStrapMap.swift#MIPStrapMap.Container.fields */
  readonly fields: readonly LayoutField[];
}

/**
 * The CPU strap message's layout: each field the tool's byte `offset` and `bit` in the
 * little-endian dword there.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/CPUStrapMap.swift#CPUStrapMap
 */
export interface CPUStrapMap {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/CPUStrapMap.swift#CPUStrapMap.name */
  readonly name: string;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/CPUStrapMap.swift#CPUStrapMap.fields */
  readonly fields: readonly CPUStrapField[];
}

/** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/CPUStrapMap.swift#CPUStrapMap.Field */
export interface CPUStrapField extends Omit<LayoutField, "bitOffset"> {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/CPUStrapMap.swift#CPUStrapMap.Field.offset */
  readonly offset: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/CPUStrapMap.swift#CPUStrapMap.Field.bit */
  readonly bit: number;
}

/**
 * The SPHY OEM configuration nvar's layout, and the anchors its reader checks before it
 * reads a byte — the package carries several SPHY variants with identical headers.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/SphyNvarMap.swift#SphyNvarMap
 */
export interface SphyNvarMap {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/SphyNvarMap.swift#SphyNvarMap.name */
  readonly name: string;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/SphyNvarMap.swift#SphyNvarMap.anchors */
  readonly anchors: readonly SphyNvarAnchor[];
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/SphyNvarMap.swift#SphyNvarMap.fields */
  readonly fields: readonly SphyNvarField[];
}

/**
 * A value the nvar must hold before any of its fields is read.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/SphyNvarMap.swift#SphyNvarMap.Anchor
 */
export interface SphyNvarAnchor {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/SphyNvarMap.swift#SphyNvarMap.Anchor.name */
  readonly name: string;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/SphyNvarMap.swift#SphyNvarMap.Anchor.bitOffset */
  readonly bitOffset: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/SphyNvarMap.swift#SphyNvarMap.Anchor.count */
  readonly count: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/SphyNvarMap.swift#SphyNvarMap.Anchor.value */
  readonly value: number;
}

/** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/SphyNvarMap.swift#SphyNvarMap.Field */
export interface SphyNvarField {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/SphyNvarMap.swift#SphyNvarMap.Field.name */
  readonly name: string;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/SphyNvarMap.swift#SphyNvarMap.Field.bitOffset */
  readonly bitOffset: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/SphyNvarMap.swift#SphyNvarMap.Field.count */
  readonly count: number;
}

/** One layout as the binary states it. @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/LayoutMapData.swift#LoadedLayoutMap */
interface LoadedLayoutMap {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/LayoutMapData.swift#LoadedLayoutMap.id */
  readonly id: string;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/LayoutMapData.swift#LoadedLayoutMap.name */
  readonly name: string;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/LayoutMapData.swift#LoadedLayoutMap.layout */
  readonly layout: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/LayoutMapData.swift#LoadedLayoutMap.containers */
  readonly containers: readonly MIPStrapContainer[];
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/LayoutMapData.swift#LoadedLayoutMap.anchors */
  readonly anchors: readonly SphyNvarAnchor[];
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/LayoutMapData.swift#LoadedLayoutMap.fields */
  readonly fields: readonly (LayoutField & { readonly bit: number })[];
}

const LAYOUT_MIP = 0;
const LAYOUT_CPU = 1;
const LAYOUT_SPHY = 2;

/**
 * The layouts read from `LayoutMaps.bin`.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/LayoutMapData.swift#LayoutMapData
 */
function loaded(): readonly LoadedLayoutMap[] | MapDataError {
  return decodedMapsOf("layout", decodeLayoutMaps);
}

/** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/LayoutMapData.swift#LayoutMapData.failure */
export function layoutMapFailure(): MapDataError | undefined {
  const maps = loaded();
  return maps instanceof MapDataError ? maps : undefined;
}

/** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/LayoutMapData.swift#LayoutMapData.map */
function layoutMap(id: string, layout: number): LoadedLayoutMap | undefined {
  const all = loaded();
  if (all instanceof MapDataError) return undefined;
  const map = all.find((one) => one.id === id);
  return map?.layout === layout ? map : undefined;
}

/**
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/LayoutMapData.swift#LayoutMapData.mipStrapMap
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/MIPStrapMap.swift#MIPStrapMap.forME
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/LayoutMapData.swift#MIPStrapMap.csme18
 */
export function mipStrapMapForME(major: number): MIPStrapMap | undefined {
  const map = major === 18 ? layoutMap("csme18-mip", LAYOUT_MIP) : undefined;
  return map === undefined ? undefined : { name: map.name, containers: map.containers };
}

/**
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/LayoutMapData.swift#LayoutMapData.cpuStrapMap
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/CPUStrapMap.swift#CPUStrapMap.forME
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/LayoutMapData.swift#CPUStrapMap.csme18
 */
export function cpuStrapMapForME(major: number): CPUStrapMap | undefined {
  const map = major === 18 ? layoutMap("csme18-cpu", LAYOUT_CPU) : undefined;
  if (map === undefined) return undefined;
  return {
    name: map.name,
    fields: map.fields.map(({ bitOffset, ...field }) => ({ ...field, offset: bitOffset })),
  };
}

/**
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/LayoutMapData.swift#LayoutMapData.sphyNvarMap
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/SphyNvarMap.swift#SphyNvarMap.forME
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/LayoutMapData.swift#SphyNvarMap.csme18
 */
export function sphyNvarMapForME(major: number): SphyNvarMap | undefined {
  const map = major === 18 ? layoutMap("csme18-sphy", LAYOUT_SPHY) : undefined;
  if (map === undefined) return undefined;
  return {
    name: map.name,
    anchors: map.anchors,
    fields: map.fields.map((field) => ({
      name: field.name,
      bitOffset: field.bitOffset,
      count: field.count,
    })),
  };
}

const MAP_RECORD_SIZE = 40;
const CONTAINER_RECORD_SIZE = 28;
const ANCHOR_RECORD_SIZE = 16;
const FIELD_RECORD_SIZE = 36;
const OPTION_RECORD_SIZE = 8;
const HAS_LABEL = 1;
const HAS_SECTION = 2;
const HAS_HELP = 4;
const HAS_OPTIONS = 8;

const corrupt = (reason: string) => new MapDataError({ kind: "corrupt", reason });

/**
 * Kind 6 over the envelope: each layout's containers, anchors and fields.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/LayoutMapData.swift#LayoutMapData.decode
 */
export function decodeLayoutMaps(file: MapFile): LoadedLayoutMap[] {
  if (file.kind !== MapKind.layout)
    throw new MapDataError({ kind: "wrongKind", mapKind: file.kind });
  const mapsSection = file.requireSection(MapSection.maps);
  const fieldsSection = file.requireSection(MapSection.layoutFields);
  const optionsSection = file.section(MapSection.options);
  const containersSection = file.section(MapSection.containers);
  const anchorsSection = file.section(MapSection.anchors);

  const fields = (offset: number, count: number, name: string) => {
    const result: (LayoutField & { bit: number })[] = [];
    if (count === 0) return result;
    const start = file.records(fieldsSection, offset, count, FIELD_RECORD_SIZE, name);
    for (let index = 0; index < count; index++) {
      const at = start + index * FIELD_RECORD_SIZE;
      const fieldName = file.string(file.u32(at)) ?? "";
      const bits = file.u16(at + 10);
      const flags = file.u16(at + 12);
      if (bits <= 0 || bits > 32) throw corrupt(`${fieldName} states ${bits} bits`);
      const options = new Map<number, string>();
      if ((flags & HAS_OPTIONS) !== 0 && optionsSection !== undefined) {
        const optionCount = file.u16(at + 32);
        const optionsAt = file.records(
          optionsSection,
          file.u32(at + 28),
          optionCount,
          OPTION_RECORD_SIZE,
          "option"
        );
        for (let optionIndex = 0; optionIndex < optionCount; optionIndex++) {
          const optionAt = optionsAt + optionIndex * OPTION_RECORD_SIZE;
          const text = file.string(file.u32(optionAt + 4));
          if (text !== undefined) options.set(file.u16(optionAt), text);
        }
      }
      result.push({
        name: fieldName,
        bitOffset: file.u32(at + 4),
        bit: file.u16(at + 8),
        count: bits,
        label: (flags & HAS_LABEL) !== 0 ? file.string(file.u32(at + 16)) : undefined,
        section: (flags & HAS_SECTION) !== 0 ? file.string(file.u32(at + 20)) : undefined,
        help: (flags & HAS_HELP) !== 0 ? file.string(file.u32(at + 24)) : undefined,
        options: options.size === 0 ? undefined : options,
      });
    }
    return result;
  };

  const count = file.u32(mapsSection.offset);
  const mapsAt = file.records(mapsSection, 4, count, MAP_RECORD_SIZE, "map");
  const result: LoadedLayoutMap[] = [];
  for (let index = 0; index < count; index++) {
    const at = mapsAt + index * MAP_RECORD_SIZE;
    const id = file.string(file.u32(at)) ?? "";
    const name = file.string(file.u32(at + 4)) ?? "";
    const layout = file.u16(at + 8);
    if (![LAYOUT_MIP, LAYOUT_CPU, LAYOUT_SPHY].includes(layout))
      throw corrupt(`${id} has layout ${layout}`);
    const containerCount = file.u32(at + 12);
    const anchorCount = file.u32(at + 20);
    const containers: MIPStrapContainer[] = [];
    if (containerCount > 0) {
      if (containersSection === undefined) throw corrupt(`${id} has no containers section`);
      const containersAt = file.records(
        containersSection,
        file.u32(at + 16),
        containerCount,
        CONTAINER_RECORD_SIZE,
        "container"
      );
      for (let containerIndex = 0; containerIndex < containerCount; containerIndex++) {
        const cat = containersAt + containerIndex * CONTAINER_RECORD_SIZE;
        const containerName = file.string(file.u32(cat)) ?? "";
        const blockLength = file.u32(cat + 8);
        const offset = file.u32(cat + 12);
        const length = file.u32(cat + 16);
        if (blockLength <= 0 || length <= 0 || offset + length > blockLength) {
          throw corrupt(`${id}: ${containerName} is not a container`);
        }
        containers.push({
          name: containerName,
          blockType: file.u16(cat + 4),
          blockLength,
          offset,
          length,
          fields: fields(file.u32(cat + 24), file.u32(cat + 20), "container field"),
        });
      }
    }
    const anchors: { name: string; bitOffset: number; count: number; value: number }[] = [];
    if (anchorCount > 0) {
      if (anchorsSection === undefined) throw corrupt(`${id} has no anchors section`);
      const anchorsAt = file.records(
        anchorsSection,
        file.u32(at + 24),
        anchorCount,
        ANCHOR_RECORD_SIZE,
        "anchor"
      );
      for (let anchorIndex = 0; anchorIndex < anchorCount; anchorIndex++) {
        const aat = anchorsAt + anchorIndex * ANCHOR_RECORD_SIZE;
        const anchorName = file.string(file.u32(aat)) ?? "";
        const bits = file.u16(aat + 8);
        if (bits <= 0 || bits > 32) throw corrupt(`${id}: anchor ${anchorName} has ${bits} bits`);
        anchors.push({
          name: anchorName,
          bitOffset: file.u32(aat + 4),
          count: bits,
          value: file.u32(aat + 12),
        });
      }
    }
    result.push({
      id,
      name,
      layout,
      containers,
      anchors,
      fields: fields(file.u32(at + 32), file.u32(at + 28), "field"),
    });
  }
  return result;
}

// MARK: - The readers

const u16 = (bytes: Uint8Array, at: number) => (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8);
const u32 = (bytes: Uint8Array, at: number) => u16(bytes, at) + u16(bytes, at + 2) * 0x10000;

/** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/CPUStrapMap.swift#MIPTableReader.cpuHeaderOffset */
export const CPU_HEADER_OFFSET = 0x48;
/** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/CPUStrapMap.swift#MIPTableReader.cpuMessageOffset */
export const CPU_MESSAGE_OFFSET = 0x4c;
/** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/CPUStrapMap.swift#MIPTableReader.fitcHeaderSize */
const FITC_HEADER_SIZE = 4;

interface MIPBlock {
  readonly type: number;
  readonly offset: number;
  readonly length: number;
}

/**
 * The MIP table the FITC payload's record table carries — the `smip` nvar: the first
 * record whose bytes read as a MIP table (a count of blocks, the table's size, and one
 * type/offset/length/reserved entry per block, laid end to end).
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/CPUStrapMap.swift#MIPTableReader.mipTable
 */
export function fitcMIPTable(
  payload: Uint8Array
): { readonly blocks: readonly MIPBlock[]; readonly size: number } | undefined {
  if (payload.length < FITC_HEADER_SIZE + 4) return undefined;
  const count = u32(payload, 0);
  if (count === 0 || count > 4096 || FITC_HEADER_SIZE + count * 12 > payload.length)
    return undefined;
  for (let index = 0; index < count; index++) {
    const entry = FITC_HEADER_SIZE + index * 12;
    const offset = u32(payload, entry + 4);
    const size = u16(payload, entry + 8);
    if (size < 12 || offset + size > payload.length) continue;
    const blocks = blocksOfMIP(payload.subarray(offset, offset + size));
    if (blocks === undefined) continue;
    return { blocks: blocks.map((block) => ({ ...block, offset: offset + block.offset })), size };
  }
  return undefined;
}

/** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/CPUStrapMap.swift#MIPTableReader.blocks */
function blocksOfMIP(data: Uint8Array): MIPBlock[] | undefined {
  if (data.length < 12) return undefined;
  const count = u16(data, 0);
  const size = u16(data, 2);
  if (count < 1 || count > 8 || size !== data.length || 4 + count * 8 > data.length)
    return undefined;
  const blocks: MIPBlock[] = [];
  let expected = 4 + count * 8;
  for (let index = 0; index < count; index++) {
    const at = 4 + index * 8;
    const type = u16(data, at);
    const offset = u16(data, at + 2);
    const length = u16(data, at + 4);
    if (
      type > 4 ||
      u16(data, at + 6) !== 0 ||
      length === 0 ||
      offset !== expected ||
      offset + length > size
    ) {
      return undefined;
    }
    expected += length;
    blocks.push({ type, offset, length });
  }
  return expected === size ? blocks : undefined;
}

/** CRC-16/CCITT-FALSE. @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/CPUStrapMap.swift#MIPTableReader.crc16 */
function crc16(data: Uint8Array): number {
  let crc = 0xffff;
  for (const byte of data) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

/**
 * The CPU strap message a CSME 18 image keeps in its MIP table's first block, read
 * through the tool's own layout: its length from the header word, its fields, and the
 * CRC-16 the last word's high half stores over the words after the first.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/CPUStrapMap.swift#MIPTableReader
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/CPUStrapMap.swift#MIPTableReader.cpuStraps
 */
export function mipCPUStraps(payload: Uint8Array, map: CPUStrapMap): CPUStrapReadings | undefined {
  const first = fitcMIPTable(payload)?.blocks[0];
  if (
    first === undefined ||
    first.type !== 1 ||
    first.offset + CPU_MESSAGE_OFFSET + 4 > payload.length
  ) {
    return undefined;
  }
  const lengthWords = (u32(payload, first.offset + CPU_HEADER_OFFSET) >>> 24) & 0xff;
  if (lengthWords < 1 || lengthWords > 16) return undefined;
  const messageAt = first.offset + CPU_MESSAGE_OFFSET;
  const messageBytes = lengthWords * 4;
  if (
    messageAt + messageBytes > first.offset + first.length ||
    messageAt + messageBytes > payload.length
  ) {
    return undefined;
  }
  const message = payload.slice(messageAt, messageAt + messageBytes);
  const stored = u16(message, messageBytes - 2);
  const checked = message.slice();
  checked[messageBytes - 2] = 0;
  checked[messageBytes - 1] = 0;
  const valid = crc16(checked.subarray(4)) === stored;
  const readings: CPUStrapReading[] = [];
  for (const field of map.fields) {
    if (field.count <= 0 || field.count > 32 || field.bit < 0 || field.bit + field.count > 32)
      continue;
    const value = bitField(message, field.offset, field.bit, field.count);
    if (value !== undefined) readings.push({ name: field.name, value: Number(value) });
  }
  return readings.length === 0
    ? undefined
    : { readings, messageLengthWords: lengthWords, crcStored: stored, crcValid: valid };
}

/**
 * The MIP table's other strap containers, each read through the tool's layout of a block
 * of that type and length.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/MIPStrapMap.swift#MIPTableReader.containers
 */
export function mipStrapContainers(
  payload: Uint8Array,
  map: MIPStrapMap
): MIPStrapContainerReadings[] | undefined {
  const table = fitcMIPTable(payload);
  if (table === undefined) return undefined;
  const results: MIPStrapContainerReadings[] = [];
  for (const container of map.containers) {
    const block = table.blocks.find(
      (one) => one.type === container.blockType && one.length === container.blockLength
    );
    if (
      block === undefined ||
      block.offset + block.length > payload.length ||
      container.offset + container.length > block.length
    ) {
      continue;
    }
    const start = block.offset + container.offset;
    const data = payload.subarray(start, start + container.length);
    const readings = layoutReadings(data, container.fields);
    if (readings.length > 0) {
      results.push({
        name: container.name,
        blockType: container.blockType,
        length: container.length,
        readings,
      });
    }
  }
  return results.length === 0 ? undefined : results;
}

function layoutReadings(
  data: Uint8Array,
  fields: readonly { readonly name: string; readonly bitOffset: number; readonly count: number }[]
): MIPStrapReading[] {
  const readings: MIPStrapReading[] = [];
  for (const field of fields) {
    if (field.count <= 0 || field.count > 32) continue;
    const value = bitField(data, Math.floor(field.bitOffset / 8), field.bitOffset % 8, field.count);
    if (value !== undefined) readings.push({ name: field.name, value: Number(value) });
  }
  return readings;
}

/** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/SphyNvarMap.swift#SphyNvarReader.fileIDs */
export const SPHY_FILE_IDS: ReadonlySet<number> = new Set([0x1001_f200, 0x1201_f200]);

/**
 * The SPHY OEM configuration nvar's fields — the FITC payload's `phy_oem_cfg` record,
 * read only where every anchor of the layout holds.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/SphyNvarMap.swift#SphyNvarReader
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/SphyNvarMap.swift#SphyNvarReader.readings
 */
export function sphyNvarReadings(
  payload: Uint8Array,
  map: SphyNvarMap
): MIPStrapReading[] | undefined {
  const record = sphyRecord(payload);
  if (record === undefined || record.length < 12) return undefined;
  const value = (bitOffset: number, count: number) => {
    const read =
      count > 32 ? undefined : bitField(record, Math.floor(bitOffset / 8), bitOffset % 8, count);
    return read === undefined ? undefined : Number(read);
  };
  if (map.anchors.some((anchor) => value(anchor.bitOffset, anchor.count) !== anchor.value))
    return undefined;
  const readings = layoutReadings(record, map.fields);
  return readings.length === 0 ? undefined : readings;
}

/** @upstream Packages/MEFirmware/Sources/MEFirmware/Configuration/SphyNvarMap.swift#SphyNvarReader.record */
function sphyRecord(payload: Uint8Array): Uint8Array | undefined {
  if (payload.length < 4) return undefined;
  const count = u32(payload, 0);
  if (count === 0 || count > 4096 || 4 + count * 12 > payload.length) return undefined;
  for (let index = 0; index < count; index++) {
    const entry = 4 + index * 12;
    if (!SPHY_FILE_IDS.has(u32(payload, entry))) continue;
    const offset = u32(payload, entry + 4);
    const size = u16(payload, entry + 8);
    if (size > 0 && offset + size <= payload.length) return payload.subarray(offset, offset + size);
  }
  return undefined;
}
