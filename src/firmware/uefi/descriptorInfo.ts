import type { ImageReader } from "@/firmware/imageReader";
import { Descriptor, FLASH_REGIONS, type FlashRegionType } from "@/firmware/uefi/descriptorParser";
import { jedecName } from "@/firmware/uefi/jedecIds";

/**
 * What a flash descriptor says about itself, beyond the regions it maps: the
 * reserved vector it opens with, where each region it declares begins, which
 * master may read and write which region, and the flash chips the board's
 * firmware was built to drive.
 *
 * The regions are already the tree — a descriptor's children are its regions —
 * but the rest of this is not anywhere else in the application, and it is what
 * a bench asks a descriptor: *can the BIOS master even write the ME region on
 * this board, and is the chip I am about to solder on one this firmware knows?*
 *
 * Read as a value, once, so the detail panel formats rather than parses, and so
 * the reading itself is testable without a window.
 */

export interface DescriptorMaster {
  readonly name: string;
  /** Each bit stands for a region — which regions a master may touch. */
  readonly read: number;
  readonly write: number;
}

export interface DescriptorAccess {
  readonly region: string;
  readonly read: boolean;
  readonly write: boolean;
}

export interface DescriptorChip {
  readonly jedecId: number;
  readonly name: string | undefined;
}

export interface DescriptorInfo {
  /**
   * The sixteen bytes before the signature. Reserved, and reliably not zero: on
   * many boards they are the first instruction the chip ever executes.
   */
  readonly reservedVector: Uint8Array;
  /**
   * Where each region the descriptor declares begins, in the file's own
   * offsets, in the format's region order.
   */
  readonly regionOffsets: readonly { readonly type: FlashRegionType; readonly offset: number }[];
  /** BIOS, ME, GbE — and EC where the descriptor is new enough to have one. */
  readonly masters: readonly DescriptorMaster[];
  /**
   * How wide a mask is written: two hex digits on a version 1 descriptor, where
   * a mask is a byte, and three on a version 2, where it is twelve bits.
   * UEFITool writes them the same way, and the width is the only sign on screen
   * of which kind of descriptor this is.
   */
  readonly maskDigits: number;
  /**
   * What the BIOS master may do to each region — the question behind "why can't
   * my programmer write this area from inside the OS".
   */
  readonly biosAccess: readonly DescriptorAccess[];
  /** The chips in the VSCC table. */
  readonly chips: readonly DescriptorChip[];
}

/** The region bits a master's access mask carries. */
const RegionAccess = {
  descriptor: 0x01,
  bios: 0x02,
  me: 0x04,
  gbe: 0x08,
  pdr: 0x10,
  ec: 0x20,
} as const;

/**
 * The upper map, at a fixed offset near the end of the descriptor, which says
 * where the VSCC table is and how long it is.
 */
const UpperMap = {
  offset: 0x0efc,
  /**
   * A VSCC entry is two dwords: the id and its register value. The map's size
   * field counts dwords, so the entry count is half of it.
   */
  entrySize: 8,
} as const;

/** Its second word, which carries the master section's base. */
const MAP1_OFFSET = 0x18;

/**
 * Reads the descriptor at `base`. Nothing when there is no readable map there —
 * the caller has a node that says it is a descriptor, and this says whether its
 * own header can be believed.
 */
export function readDescriptorInfo(base: number, reader: ImageReader): DescriptorInfo | undefined {
  const map = reader.uint32(base + Descriptor.mapOffset);
  const map1 = reader.uint32(base + MAP1_OFFSET);
  const version = reader.uint32(base + Descriptor.versionOffset);
  const vector = reader.bytesAt(base, 16);
  if (map === undefined || map1 === undefined || version === undefined || vector === undefined) {
    return undefined;
  }

  // Version 1 keeps a byte per mask and has no EC master; version 2 —
  // everything from Skylake on — packs twelve bits per mask and adds one.
  const isVersion1 = version === Descriptor.reservedVersion;
  // The master section's base is the second map word's low byte, in the 0x10
  // units every base in this header is written in. Out of range — an erased
  // word says `0xFF` — there is no section to read, and the bytes at whatever
  // that points to are not masters.
  const masterAt = map1 & 0xff;
  const masterBase =
    masterAt > 0 && masterAt <= Descriptor.maxBase ? base + masterAt * 16 : undefined;

  return {
    reservedVector: vector,
    regionOffsets: regionOffsets(base, map, isVersion1, reader),
    masters: masters(masterBase, isVersion1, reader),
    maskDigits: isVersion1 ? 2 : 3,
    biosAccess: biosAccess(masterBase, isVersion1, reader),
    chips: chips(base, reader),
  };
}

/**
 * Every region the table declares, by where it starts. A region with a zero
 * limit is not there at all, which is the table's way of saying so, and is left
 * out rather than shown as an area at zero.
 */
function regionOffsets(
  base: number,
  map: number,
  isVersion1: boolean,
  reader: ImageReader
): { type: FlashRegionType; offset: number }[] {
  const regionBase = (map >>> 16) & 0xff;
  if (regionBase === 0 || regionBase > Descriptor.maxBase) return [];
  const section = base + regionBase * 16;
  const count = isVersion1 ? Descriptor.version1RegionCount : FLASH_REGIONS.length;

  const offsets: { type: FlashRegionType; offset: number }[] = [];
  for (let index = 0; index < count; index++) {
    const type = FLASH_REGIONS[index];
    const first = reader.uint16(section + index * 4);
    const last = reader.uint16(section + index * 4 + 2);
    if (type === undefined || first === undefined || last === undefined) break;
    // The descriptor's own entry is zero/zero on every image — it is the first
    // 0x1000 bytes by definition — so it is stated rather than read, and every
    // other region needs a limit to exist.
    if (type === "descriptor") {
      offsets.push({ type, offset: base });
      continue;
    }
    if (last === 0 || first > last) continue;
    offsets.push({ type, offset: base + first * 0x1000 });
  }
  return offsets;
}

/** The master section's read and write masks, one master per row. */
function masters(
  masterBase: number | undefined,
  isVersion1: boolean,
  reader: ImageReader
): DescriptorMaster[] {
  if (masterBase === undefined) return [];
  if (isVersion1) {
    // Three records of `id, read, write` — two bytes, then one each.
    const rows: DescriptorMaster[] = [];
    const names = ["BIOS", "ME", "GbE"];
    for (let index = 0; index < names.length; index++) {
      const entry = masterBase + index * 4;
      const read = reader.uint8(entry + 2);
      const write = reader.uint8(entry + 3);
      if (read === undefined || write === undefined) continue;
      rows.push({ name: names[index] ?? "", read, write });
    }
    return rows;
  }
  // One dword per master: eight reserved bits, then twelve of read and twelve
  // of write. EC's sits a dword past a reserved one.
  const layout: [string, number][] = [
    ["BIOS", 0],
    ["ME", 4],
    ["GbE", 8],
    ["EC", 16],
  ];
  const rows: DescriptorMaster[] = [];
  for (const [name, offset] of layout) {
    const word = reader.uint32(masterBase + offset);
    if (word === undefined) continue;
    rows.push({ name, read: (word >>> 8) & 0xfff, write: (word >>> 20) & 0xfff });
  }
  return rows;
}

/**
 * What the BIOS master may do to each region, read off its own masks — except
 * to the BIOS region itself, which it owns and which the table states rather
 * than reads, exactly as the reference parser does.
 */
function biosAccess(
  masterBase: number | undefined,
  isVersion1: boolean,
  reader: ImageReader
): DescriptorAccess[] {
  if (masterBase === undefined) return [];
  let read: number;
  let write: number;
  if (isVersion1) {
    const readByte = reader.uint8(masterBase + 2);
    const writeByte = reader.uint8(masterBase + 3);
    if (readByte === undefined || writeByte === undefined) return [];
    read = readByte;
    write = writeByte;
  } else {
    const word = reader.uint32(masterBase);
    if (word === undefined) return [];
    read = (word >>> 8) & 0xfff;
    write = (word >>> 20) & 0xfff;
  }

  const rows: DescriptorAccess[] = [
    {
      region: "Desc",
      read: (read & RegionAccess.descriptor) !== 0,
      write: (write & RegionAccess.descriptor) !== 0,
    },
    { region: "BIOS", read: true, write: true },
    { region: "ME", read: (read & RegionAccess.me) !== 0, write: (write & RegionAccess.me) !== 0 },
    {
      region: "GbE",
      read: (read & RegionAccess.gbe) !== 0,
      write: (write & RegionAccess.gbe) !== 0,
    },
    {
      region: "PDR",
      read: (read & RegionAccess.pdr) !== 0,
      write: (write & RegionAccess.pdr) !== 0,
    },
  ];
  if (!isVersion1) {
    rows.push({
      region: "EC",
      read: (read & RegionAccess.ec) !== 0,
      write: (write & RegionAccess.ec) !== 0,
    });
  }
  return rows;
}

/**
 * The VSCC table: the flash chips this firmware was built to drive, by JEDEC
 * id, named where the catalogue knows them.
 */
function chips(base: number, reader: ImageReader): DescriptorChip[] {
  const map = reader.uint16(base + UpperMap.offset);
  if (map === undefined) return [];
  // The same rule as every other base in this header: out of range is no table
  // rather than a table read from wherever it points.
  const tableAt = map & 0xff;
  if (tableAt === 0 || tableAt > Descriptor.maxBase) return [];
  const tableBase = base + tableAt * 16;
  // The size field counts dwords; an entry is two of them.
  const count = Math.floor(((map >>> 8) & 0xff) / 2);
  if (count <= 0) return [];

  const found: DescriptorChip[] = [];
  for (let index = 0; index < count; index++) {
    const entry = tableBase + index * UpperMap.entrySize;
    const vendor = reader.uint8(entry);
    const device0 = reader.uint8(entry + 1);
    const device1 = reader.uint8(entry + 2);
    if (vendor === undefined || device0 === undefined || device1 === undefined) break;
    const id = (vendor << 16) | (device0 << 8) | device1;
    // An erased or empty tail is not a chip.
    if (id === 0 || id === 0xff_ffff) continue;
    found.push({ jedecId: id, name: jedecName(id) });
  }
  return found;
}
