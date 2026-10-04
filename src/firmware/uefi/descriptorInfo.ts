import type { ImageReader } from "@/firmware/imageReader";
import {
  type DescriptorGeneration,
  densityBits,
  generationClock,
  hasEightInvalidInstructions,
  hasWideMasks,
  readDescriptorGeneration,
  regionCount,
} from "@/firmware/uefi/descriptorGeneration";
import { Descriptor, FLASH_REGIONS, type FlashRegionType } from "@/firmware/uefi/descriptorParser";
import { flashVendor } from "@/firmware/uefi/flashVendors";
import { jedecChip } from "@/firmware/uefi/jedecIds";

/**
 * What a flash descriptor says about itself, beyond the regions it maps: the
 * reserved vector it opens with, the chipset generation its layout is, where
 * each region it declares begins and ends, how many flash chips the image spans
 * and how fast the chipset clocks them, which master may read and write which
 * region, and the chips its VSCC table knows how to drive.
 *
 * The regions are already the tree — a descriptor's children are its regions —
 * but the rest of this is not anywhere else in the application, and it is what
 * a bench asks a descriptor: *can the BIOS master even write the ME region on
 * this board, and is the chip I am about to solder on one this firmware knows?*
 *
 * Read as a value, once, so the detail panel formats rather than parses, and so
 * the reading itself is testable without a window.
 */

/** @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.Master */
export interface DescriptorMaster {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.Master.name */
  readonly name: string;
  /**
   * Each bit stands for a region — which regions a master may touch.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.Master.read
   */
  readonly read: number;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.Master.write */
  readonly write: number;
}

/** @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.Access */
export interface DescriptorAccess {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.Access.region */
  readonly region: string;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.Access.read */
  readonly read: boolean;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.Access.write */
  readonly write: boolean;
}

/**
 * A chip in the VSCC table: the JEDEC id the table lists, and the chip that
 * id names when it is one the catalogue knows. For an id it does not know,
 * `vendor` is still the maker the first byte names, when that code is one
 * `flashVendor` has.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.Chip
 */
export interface DescriptorChip {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.Chip.jedecID */
  readonly jedecId: number;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.Chip.name */
  readonly name: string | undefined;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.Chip.vendor */
  readonly vendor: string | undefined;
  /**
   * The chip's capacity in kilobytes, when the catalogue lists one.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.Chip.sizeKB
   */
  readonly sizeKB: number | undefined;
  /**
   * Where the catalogue took the name from; undefined when it has none.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.Chip.source
   */
  readonly source: DescriptorChipSource | undefined;
}

/** Where the catalogue took a VSCC chip's name from.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.Chip.Source
 */
export type DescriptorChipSource = "uefiTool" | "linux" | "flashrom";

/**
 * A region the descriptor declares, where it begins and where it ends —
 * inclusive, as the table writes it — in the file's own offsets.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.Region
 */
export interface DescriptorRegion {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.Region.type */
  readonly type: FlashRegionType;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.Region.base */
  readonly base: number;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.Region.limit */
  readonly limit: number;
}

/**
 * A three-bit clock code and what the generation makes of it.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.Clock
 */
export interface DescriptorClock {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.Clock.code */
  readonly code: number;
  /**
   * In MHz; two when the generation gives the code two, nothing when it reserves it.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.Clock.megahertz
   */
  readonly megahertz: readonly number[] | undefined;
}

/** @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.Component */
export interface DescriptorComponent {
  /**
   * Each chip's size in bytes, one entry per chip the map counts. Nothing for a
   * density code the generation reserves.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.Component.chipSizes
   */
  readonly chipSizes: readonly (number | undefined)[];
  /**
   * The clock for reading the chip's id and status.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.Component.readIDClock
   */
  readonly readIDClock: DescriptorClock;
  /**
   * The clock for writing and erasing.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.Component.writeEraseClock
   */
  readonly writeEraseClock: DescriptorClock;
  /**
   * The clock for fast reads, nothing when fast reads are off.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.Component.fastReadClock
   */
  readonly fastReadClock: DescriptorClock | undefined;
  /**
   * The opcodes the chipset refuses to send to the chip — four, or eight from
   * Sunrise Point on — with the unused zero ones left out.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.Component.invalidInstructions
   */
  readonly invalidInstructions: readonly number[];
}

/** @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo */
export interface DescriptorInfo {
  /**
   * The sixteen bytes before the signature. Reserved, and reliably not zero: on
   * many boards they are the first instruction the chip ever executes.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.reservedVector
   */
  readonly reservedVector: Uint8Array;
  /**
   * The chipset generation the layout is (`DescriptorGeneration`).
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.generation
   */
  readonly generation: DescriptorGeneration;
  /**
   * Whether the layout is one the rules know rather than the nearest they assume.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.isGenerationCertain
   */
  readonly isGenerationCertain: boolean;
  /**
   * In the format's region order, the descriptor's own first.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.regions
   */
  readonly regions: readonly DescriptorRegion[];
  /**
   * The component section: the flash chips the image was laid out for and how the
   * chipset drives them. Nothing when its base is not one.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.component
   */
  readonly component: DescriptorComponent | undefined;
  /**
   * BIOS, ME, GbE — and EC where the descriptor is new enough to have one.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.masters
   */
  readonly masters: readonly DescriptorMaster[];
  /**
   * How wide a mask is written: two hex digits on a version 1 descriptor, where
   * a mask is a byte, and three on a version 2, where it is twelve bits.
   * UEFITool writes them the same way, and the width is the only sign on screen
   * of which kind of descriptor this is.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.maskDigits
   */
  readonly maskDigits: number;
  /**
   * What the BIOS master may do to each region — the question behind "why can't
   * my programmer write this area from inside the OS".
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.biosAccess
   */
  readonly biosAccess: readonly DescriptorAccess[];
  /**
   * The chips in the VSCC table.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.chips
   */
  readonly chips: readonly DescriptorChip[];
}

/**
 * The region bits a master's access mask carries.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.RegionAccess
 */
const RegionAccess = {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.RegionAccess.descriptor */
  descriptor: 0x01,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.RegionAccess.bios */
  bios: 0x02,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.RegionAccess.me */
  me: 0x04,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.RegionAccess.gbe */
  gbe: 0x08,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.RegionAccess.pdr */
  pdr: 0x10,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.RegionAccess.ec */
  ec: 0x20,
} as const;

/**
 * The upper map, at a fixed offset near the end of the descriptor, which says
 * where the VSCC table is and how long it is.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.UpperMap
 */
export const UpperMap = {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.UpperMap.offset */
  offset: 0x0efc,
  /**
   * A VSCC entry is two dwords: the id and its register value. The map's size
   * field counts dwords, so the entry count is half of it.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.UpperMap.entrySize
   */
  entrySize: 8,
} as const;

/**
 * Reads the descriptor at `base`. Nothing when there is no readable map there —
 * the caller has a node that says it is a descriptor, and this says whether its
 * own header can be believed.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.read
 */
export function readDescriptorInfo(base: number, reader: ImageReader): DescriptorInfo | undefined {
  const map = reader.uint32(base + Descriptor.mapOffset);
  const map1 = reader.uint32(base + Descriptor.map1Offset);
  const read = readDescriptorGeneration(base, reader);
  const vector = reader.bytesAt(base, 16);
  if (map === undefined || map1 === undefined || read === undefined || vector === undefined) {
    return undefined;
  }
  const { generation, isCertain } = read;

  // Up to Wildcat Point a master keeps a byte per mask and there is no EC
  // master; from Sunrise Point on twelve bits per mask, and one more.
  const isVersion1 = !hasWideMasks(generation);
  // The master section's base is the second map word's low byte, in the 0x10
  // units every base in this header is written in. Out of range — an erased
  // word says `0xFF` — there is no section to read, and the bytes at whatever
  // that points to are not masters.
  const masterAt = map1 & 0xff;
  const masterBase =
    masterAt > 0 && masterAt <= Descriptor.maxBase ? base + masterAt * 16 : undefined;

  return {
    reservedVector: vector,
    generation,
    isGenerationCertain: isCertain,
    regions: regions(base, map, generation, reader),
    component: component(base, map, generation, reader),
    masters: masters(masterBase, isVersion1, reader),
    maskDigits: isVersion1 ? 2 : 3,
    biosAccess: biosAccess(masterBase, isVersion1, reader),
    chips: chips(base, reader),
  };
}

/**
 * Every region the table declares. A region with a zero limit is not there at
 * all, which is the table's way of saying so, and is left out rather than shown
 * as an area at zero.
 */
function regions(
  base: number,
  map: number,
  generation: DescriptorGeneration,
  reader: ImageReader
): DescriptorRegion[] {
  const regionBase = (map >>> 16) & 0xff;
  if (regionBase === 0 || regionBase > Descriptor.maxBase) return [];
  const section = base + regionBase * 16;

  const found: DescriptorRegion[] = [];
  for (let index = 0; index < regionCount(generation); index++) {
    const type = FLASH_REGIONS[index];
    const first = reader.uint16(section + index * 4);
    const last = reader.uint16(section + index * 4 + 2);
    if (type === undefined || first === undefined || last === undefined) break;
    // The descriptor's own entry is zero/zero on every image — it is the first
    // 0x1000 bytes by definition — so it is stated rather than read, and every
    // other region needs a limit to exist.
    if (type === "descriptor") {
      found.push({ type, base, limit: base + Descriptor.size - 1 });
      continue;
    }
    if (last === 0 || first > last || first === Descriptor.erasedRegionEntry) continue;
    found.push({ type, base: base + first * 0x1000, limit: base + (last * 0x1000 + 0xfff) });
  }
  return found;
}

/**
 * The component section, at `ComponentBase << 4`: `FLCOMP`, then the forbidden
 * opcodes in one dword — two from Sunrise Point on, where the partition boundary
 * register became the second.
 */
function component(
  base: number,
  map: number,
  generation: DescriptorGeneration,
  reader: ImageReader
): DescriptorComponent | undefined {
  const componentBase = map & 0xff;
  if (componentBase === 0 || componentBase > Descriptor.maxBase) return undefined;
  const section = base + componentBase * 16;
  const flcomp = reader.uint32(section);
  const invalid = reader.uint32(section + 4);
  const invalid1 = reader.uint32(section + 8);
  if (flcomp === undefined || invalid === undefined || invalid1 === undefined) return undefined;

  // The map counts the chips less one, in two bits.
  const chipCount = ((map >>> 8) & 0x3) + 1;
  const bits = densityBits(generation);
  const mask = 2 ** bits - 1;
  const chipSizes: (number | undefined)[] = [];
  for (let index = 0; index < Math.min(chipCount, 2); index++) {
    const code = (flcomp >>> (index * bits)) & mask;
    // 512 KiB doubled per step: up to 16 MB in three bits, 64 MB in four.
    const largest = bits === 3 ? 5 : 7;
    chipSizes.push(code <= largest ? 0x8_0000 * 2 ** code : undefined);
  }
  const clock = (shift: number): DescriptorClock => {
    const code = (flcomp >>> shift) & 0x7;
    return { code, megahertz: generationClock(generation, code) };
  };
  const words = hasEightInvalidInstructions(generation) ? [invalid, invalid1] : [invalid];
  const opcodes = words.flatMap((word) =>
    [0, 1, 2, 3].map((index) => (word >>> (index * 8)) & 0xff)
  );

  return {
    chipSizes,
    readIDClock: clock(27),
    writeEraseClock: clock(24),
    fastReadClock: (flcomp & (1 << 20)) !== 0 ? clock(21) : undefined,
    invalidInstructions: opcodes.filter((opcode) => opcode !== 0),
  };
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
    const known = jedecChip(id);
    found.push({
      jedecId: id,
      name: known?.name,
      vendor: known === undefined ? flashVendor(id) : undefined,
      sizeKB: known?.sizeKB,
      source: known?.source,
    });
  }
  return found;
}
