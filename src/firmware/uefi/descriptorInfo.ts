import type { ImageReader } from "@/firmware/imageReader";
import {
  type DescriptorGeneration,
  densityBits,
  espiClockOf,
  generationClock,
  hasEightInvalidInstructions,
  hasMIPDescriptorTable,
  hasMIPProcessorStraps,
  hasProcessorStrapSection,
  hasWideMasks,
  meDisableBit,
  readDescriptorGeneration,
  regionCount,
} from "@/firmware/uefi/descriptorGeneration";
import { Descriptor, FLASH_REGIONS, type FlashRegionType } from "@/firmware/uefi/descriptorParser";
import {
  type DescriptorRegisterReading,
  type RegisterPlace,
  registerMapForGeneration,
} from "@/firmware/uefi/descriptorRegisterMap";
import { flashVendor } from "@/firmware/uefi/flashVendors";
import { jedecChip } from "@/firmware/uefi/jedecIds";
import {
  espiClockField,
  mipProcessorStrapMap,
  pmcStrapMap,
  processorStrapMap,
  protectedRangeField,
  type StrapField,
  type StrapReading,
  strapField,
  strapFieldValue,
  strapMapForSection,
  strapReadings,
} from "@/firmware/uefi/strapMap";

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
  /**
   * The PCH strap section: the words the chipset reads at power-on, before any
   * firmware runs. Nothing when its base is not one or it is empty.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.straps
   */
  readonly straps: DescriptorStraps | undefined;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.processorStraps */
  readonly processorStraps: DescriptorProcessorStraps | undefined;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.mip */
  readonly mip: DescriptorMIPTable | undefined;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.pmcStraps */
  readonly pmcStraps: DescriptorPMCSection | undefined;
  /**
   * The descriptor's registers read through Flash Image Tool's own layouts
   * (`DescriptorRegisterMap`): FLMAP0/1/2, FLCOMP and FLIL at the component base, the
   * masters' FLMSTR registers, FLDRPLCY and FLUMAP1. Empty where the generation has no
   * map, or a register's base is not readable.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.registerReadings
   */
  readonly registerReadings: readonly DescriptorRegisterReading[];
  /**
   * The OEM section: `0x100` bytes at `0xF00` in the descriptor, where a board's maker
   * keeps what it likes — a serial, a BIOS version, a signature — and which is erased on
   * many boards. Empty when the reader does not reach it.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.oemSection
   */
  readonly oemSection: Uint8Array;
}

/**
 * The strap words as they stand, and where a table of the section's length is at
 * hand, the fields they are made of. The layout is the chipset's and changes with every
 * generation — and between the mobile and desktop parts of one — and next to none of it
 * is published, which is what `DescriptorStrapMap` is: Intel's own layout, taken from
 * the Flash Image Tool that writes the section.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.Straps
 */
export interface DescriptorStraps {
  /**
   * Where the first word lies, in the file's own offsets.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.Straps.base
   */
  readonly base: number;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.Straps.words */
  readonly words: readonly number[];
  /**
   * The one bit with a settled meaning on every generation that names it; nothing on
   * one that does not, or a section too short to hold it.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.Straps.meDisable
   */
  readonly meDisable: DescriptorMEDisable | undefined;
  /**
   * The clock the chipset drives the eSPI bus to the EC at. Nothing where the layout is
   * not one whose word for it is known.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.Straps.espiClock
   */
  readonly espiClock: DescriptorESPIClock | undefined;
  /**
   * The flash range the chipset protects from the host, from the strap the SPI controller
   * loads its GPR0 register from. Nothing where the layout is not one whose word for it
   * is known.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.Straps.gpr0
   */
  readonly gpr0: DescriptorProtectedRange | undefined;
  /**
   * The section read as the fields of its layout, each with what this image holds
   * there. Nothing where no table of this length is at hand, in which case the words
   * above are all there is to say.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.Straps.fields
   */
  readonly fields: readonly StrapReading[] | undefined;
}

/**
 * The processor strap section — the words the processor reads at power-on, in the
 * descriptor's third map word (`FLMAP2`), or from Tiger Point to Alder Point the CPU
 * strap message in the MIP area. Nothing from Meteor Lake on.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.ProcessorStraps
 */
export interface DescriptorProcessorStraps {
  /**
   * Where the first word lies, in the file's own offsets.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.ProcessorStraps.base
   */
  readonly base: number;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.ProcessorStraps.words */
  readonly words: readonly number[];
  /**
   * The section read as the fields of its layout. Nothing where no table of this
   * length is at hand.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.ProcessorStraps.fields
   */
  readonly fields: readonly StrapReading[] | undefined;
}

/**
 * The MIP area's descriptor table, which Cannon Point introduced: a count and the
 * area's size, then one eight-byte entry per block — type, offset, length, reserved —
 * whose payload the entry's offset places after the table. Block type 1 is the PMC and
 * CPU soft straps, type 0 the CSE DbC configuration.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.MIPTable
 */
export interface DescriptorMIPTable {
  /**
   * The table's first byte, in the file's own offsets.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.MIPTable.base
   */
  readonly base: number;
  /**
   * `NumberOfDescriptors`.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.MIPTable.count
   */
  readonly count: number;
  /**
   * `SizeOfMip`: the area's length in bytes.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.MIPTable.size
   */
  readonly size: number;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.MIPTable.blocks */
  readonly blocks: readonly DescriptorMIPBlock[];
}

/** @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.MIPTable.Block */
export interface DescriptorMIPBlock {
  /**
   * The tool's block type: 0 is the CSE DbC configuration and 1 the PMC and CPU soft
   * straps.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.MIPTable.Block.type
   */
  readonly type: number;
  /**
   * The block's first byte, in the file's own offsets.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.MIPTable.Block.base
   */
  readonly base: number;
  /**
   * Its place, in bytes, from the table's first byte.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.MIPTable.Block.offset
   */
  readonly offset: number;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.MIPTable.Block.length */
  readonly length: number;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.MIPTable.Block.words */
  readonly words: readonly number[];
}

/**
 * The CSE DbC configuration — block type 0's two dwords. Every Flash Image Tool
 * document that states the block agrees on these three masks in its second word; the
 * variants add the eHAP and DAM bits or the USB2 AFE signal strengths above them,
 * which the documents do not agree on and which are therefore not claimed here.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.DBCStraps
 */
export interface DescriptorDBCStraps {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.DBCStraps.base */
  readonly base: number;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.DBCStraps.words */
  readonly words: readonly number[];
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.DBCStraps.fields */
  readonly fields: readonly StrapReading[];
}

/** @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.DBCStraps.layout */
const DBC_LAYOUT: readonly StrapField[] = [
  strapField("DbC_Strap_CSME_Early_USB_DbC_ME_Boot_Stall_Enable", 1, 16, 23, {
    label: "Early USB DbC ME boot stall",
  }),
  strapField("DbC_Strap_CSME_USB3_DbC_port_enable", 1, 8, 15, { label: "USB3 DbC port enable" }),
  strapField("DbC_Strap_CSME_USB2_DbC_port_enable", 1, 0, 7, { label: "USB2 DbC port enable" }),
];

/**
 * The CSE DbC configuration, where the table carries one.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.MIPTable.dbc
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.DBCStraps.init
 */
export function mipDbcStraps(mip: DescriptorMIPTable): DescriptorDBCStraps | undefined {
  const block = mip.blocks.find((one) => one.type === 0);
  if (block === undefined || block.words.length < 2) return undefined;
  const fields: StrapReading[] = [];
  for (const field of DBC_LAYOUT) {
    const word = block.words[field.word];
    if (word !== undefined) fields.push({ field, value: strapFieldValue(field, word) });
  }
  return { base: block.base, words: block.words, fields };
}

/**
 * The PMC soft straps — the leading words of the MIP area's PMC and CPU block, before
 * the CPU strap message that ends it.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.PMCSection
 */
export interface DescriptorPMCSection {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.PMCSection.base */
  readonly base: number;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.PMCSection.words */
  readonly words: readonly number[];
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.PMCSection.fields */
  readonly fields: readonly StrapReading[];
}

/**
 * The eSPI clock: bits 3–5 of its word.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.ESPIClock
 */
export interface DescriptorESPIClock {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.ESPIClock.word */
  readonly word: number;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.ESPIClock.clock */
  readonly clock: DescriptorClock;
}

/**
 * The bit that soft-disables the ME, under the name the trade knows it by on this
 * generation (HAP, AltMeDisable, ICH_MeDisable).
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.MEDisable
 */
export interface DescriptorMEDisable {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.MEDisable.name */
  readonly name: string;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.MEDisable.word */
  readonly word: number;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.MEDisable.bit */
  readonly bit: number;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.MEDisable.isSet */
  readonly isSet: boolean;
}

/**
 * A GPRD word: a start and an end in 4 KiB units, inclusive, and whether reads and
 * writes inside are refused. Neither refused, the range is off whatever it says.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.ProtectedRange
 */
export interface DescriptorProtectedRange {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.ProtectedRange.word */
  readonly word: number;
  /**
   * In the file's own offsets, as the region table's are.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.ProtectedRange.start
   */
  readonly start: number;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.ProtectedRange.end */
  readonly end: number;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.ProtectedRange.readProtected */
  readonly readProtected: boolean;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.ProtectedRange.writeProtected */
  readonly writeProtected: boolean;
}

/** @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.ProtectedRange.isOn */
export const isProtectedRangeOn = (range: DescriptorProtectedRange): boolean =>
  range.readProtected || range.writeProtected;

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
  const map2 = reader.uint32(base + Descriptor.map2Offset);
  const read = readDescriptorGeneration(base, reader);
  const vector = reader.bytesAt(base, 16);
  if (
    map === undefined ||
    map1 === undefined ||
    map2 === undefined ||
    read === undefined ||
    vector === undefined
  ) {
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
  const mip = mipTable(base, generation, reader);

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
    straps: straps(base, map1, generation, isCertain, reader),
    processorStraps: processorStraps(base, map2, generation, isCertain, reader),
    mip,
    pmcStraps: pmcStraps(map2, generation, mip),
    registerReadings: registerReadings(base, map, map1, generation, reader),
    oemSection:
      reader.bytesAt(base + Descriptor.oemSectionOffset, Descriptor.oemSectionSize) ??
      new Uint8Array(),
  };
}

/** `count` words from `at`, as far as the reader reaches. */
function wordsAt(reader: ImageReader, at: number, count: number): number[] {
  const words: number[] = [];
  for (let index = 0; index < count; index++) {
    const word = reader.uint32(at + index * 4);
    if (word === undefined) break;
    words.push(word);
  }
  return words;
}

/**
 * The MIP area's block table: its place from the upper map's high byte, its count and
 * size, and each block's payload. A table whose entries do not fit the area, or a
 * payload past the reader's end, is no table — the erased area of Meteor Lake reads
 * `0xFFFF` throughout and answers nothing by the count check alone.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.mipTable
 */
export function mipTable(
  base: number,
  generation: DescriptorGeneration,
  reader: ImageReader
): DescriptorMIPTable | undefined {
  if (!hasMIPDescriptorTable(generation)) return undefined;
  const upper = reader.uint32(base + UpperMap.offset);
  if (upper === undefined) return undefined;
  const area = upper >>> 24;
  if (area === 0 || area > Descriptor.maxBase) return undefined;
  const tableAt = base + area * 16;
  const count = reader.uint16(tableAt);
  const size = reader.uint16(tableAt + 2);
  if (count === undefined || size === undefined || count === 0 || count > 8) return undefined;
  const blocks: DescriptorMIPBlock[] = [];
  for (let index = 0; index < count; index++) {
    const entry = tableAt + 4 + index * 8;
    const type = reader.uint16(entry);
    const offset = reader.uint16(entry + 2);
    const length = reader.uint16(entry + 4);
    const reserved = reader.uint16(entry + 6);
    if (
      type === undefined ||
      offset === undefined ||
      length === undefined ||
      reserved !== 0 ||
      offset < 4 + count * 8 ||
      length === 0 ||
      length % 4 !== 0
    ) {
      return undefined;
    }
    const payload = tableAt + offset;
    const words = wordsAt(reader, payload, length / 4);
    if (words.length !== length / 4) return undefined;
    blocks.push({ type, base: payload, offset, length, words });
  }
  const end = Math.max(0, ...blocks.map((block) => block.offset + block.length));
  if (size < end) return undefined;
  return { base: tableAt, count, size, blocks };
}

/**
 * The PMC soft straps: the MIP area's PMC and CPU block less the CPU strap message that
 * ends it. Up to Cannon Point `FLMAP2` states the processor section's words, which is
 * the message's length in the block too; from Tiger Point on it states the message's
 * length directly. A block whose remainder matches no table at hand answers none.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.pmcStraps
 */
function pmcStraps(
  map2: number,
  generation: DescriptorGeneration,
  mip: DescriptorMIPTable | undefined
): DescriptorPMCSection | undefined {
  const block = mip?.blocks.find((one) => one.type === 1);
  if (block === undefined) return undefined;
  let cpuWords: number;
  if (hasMIPProcessorStraps(generation)) cpuWords = (map2 >>> 16) & 0xff;
  else if (hasProcessorStrapSection(generation)) cpuWords = (map2 >>> 8) & 0xff;
  else return undefined;
  const pmcWords = block.words.length - cpuWords;
  const map = pmcWords > 0 ? pmcStrapMap(pmcWords) : undefined;
  if (map === undefined) return undefined;
  const words = block.words.slice(0, pmcWords);
  return { base: block.base, words, fields: strapReadings(map, words) };
}

/**
 * The descriptor's registers through the tool's layout: each register's place
 * resolved (absolute, or the component/master base the map words state) and its words
 * read. A register whose base is out of range or whose words do not fit is left out.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.registerReadings
 */
function registerReadings(
  base: number,
  map: number,
  map1: number,
  generation: DescriptorGeneration,
  reader: ImageReader
): DescriptorRegisterReading[] {
  const registerMap = registerMapForGeneration(generation);
  if (registerMap === undefined) return [];
  const componentAt = map & 0xff;
  const masterAt = map1 & 0xff;
  const inRange = (at: number) => at > 0 && at <= Descriptor.maxBase;
  const address = (place: RegisterPlace): number | undefined => {
    switch (place.kind) {
      case "absolute":
        return base + place.offset;
      case "flashComponent":
        return inRange(componentAt) ? base + componentAt * 16 + place.offset : undefined;
      case "flashMaster":
        return inRange(masterAt) ? base + masterAt * 16 + place.offset : undefined;
    }
  };
  const readings: DescriptorRegisterReading[] = [];
  for (const register of registerMap.registers) {
    const start = address(register.place);
    if (start === undefined) continue;
    const words = wordsAt(reader, start, register.words);
    if (words.length !== register.words) continue;
    readings.push({ register, base: start, words });
  }
  return readings;
}

/**
 * The processor straps, where this generation's descriptor keeps them: the section the
 * classic third map word points at up to Cannon Point, or — from Tiger Point to Alder
 * Point and the embedded lines — the message in the MIP area, at `0xC00` plus the
 * offset the same word carries (`FLMAP2[2:11]`), as many words as `FLMAP2[16:23]`
 * says. Nothing where neither applies, where the generation is only assumed (the MIP
 * reading needs the map word's Tiger Point meaning), or where a section lies outside
 * the descriptor. Meteor Lake and later have none by generation: their descriptor
 * carries no CPU message, and the map-word bits there mean other straps.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.processorStraps
 */
function processorStraps(
  base: number,
  map2: number,
  generation: DescriptorGeneration,
  isGenerationCertain: boolean,
  reader: ImageReader
): DescriptorProcessorStraps | undefined {
  if (hasProcessorStrapSection(generation)) {
    return classicProcessorStraps(base, map2, generation, isGenerationCertain, reader);
  }
  if (!hasMIPProcessorStraps(generation) || !isGenerationCertain) return undefined;
  const offset = (map2 >>> 2) & 0x3ff;
  const count = (map2 >>> 16) & 0xff;
  if (count === 0 || Descriptor.mipOffset + offset + count * 4 > Descriptor.size) {
    return undefined;
  }
  const section = base + Descriptor.mipOffset + offset;
  const words = wordsAt(reader, section, count);
  if (words.length === 0) return undefined;
  const map = mipProcessorStrapMap(words.length);
  return {
    base: section,
    words,
    fields: map === undefined ? undefined : strapReadings(map, words),
  };
}

/**
 * The processor strap section of the classic map word, at its base and as long as its
 * count — the fields Tiger Point stopped writing. Cut at the descriptor's end, as the
 * PCH section is.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.classicProcessorStraps
 */
function classicProcessorStraps(
  base: number,
  map2: number,
  generation: DescriptorGeneration,
  isGenerationCertain: boolean,
  reader: ImageReader
): DescriptorProcessorStraps | undefined {
  const strapAt = map2 & 0xff;
  if (strapAt === 0 || strapAt > Descriptor.maxBase) return undefined;
  const offset = strapAt * 16;
  const count = Math.min((map2 >>> 8) & 0xff, Math.floor((Descriptor.size - offset) / 4));
  if (count <= 0) return undefined;
  const section = base + offset;
  const words = wordsAt(reader, section, count);
  if (words.length === 0) return undefined;
  const map = processorStrapMap(words.length, generation, isGenerationCertain);
  return {
    base: section,
    words,
    fields: map === undefined ? undefined : strapReadings(map, words),
  };
}

/**
 * The PCH strap section, at `PchStrapBase << 4`, as many words long as the map's strap
 * length says — cut at the descriptor's end, past which nothing is a strap however long
 * an erased length claims to be.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorInfo.swift#DescriptorInfo.straps
 */
function straps(
  base: number,
  map1: number,
  generation: DescriptorGeneration,
  isGenerationCertain: boolean,
  reader: ImageReader
): DescriptorStraps | undefined {
  const strapAt = (map1 >>> 16) & 0xff;
  if (strapAt === 0 || strapAt > Descriptor.maxBase) return undefined;
  const offset = strapAt * 16;
  const count = Math.min(map1 >>> 24, Math.floor((Descriptor.size - offset) / 4));
  const section = base + offset;
  const words = wordsAt(reader, section, count);
  if (words.length === 0) return undefined;
  const named = meDisableBit(generation);
  const namedWord = named === undefined ? undefined : words[named.word];
  const meDisable =
    named === undefined || namedWord === undefined
      ? undefined
      : {
          name: named.name,
          word: named.word,
          bit: named.bit,
          isSet: ((namedWord >>> named.bit) & 1) !== 0,
        };
  // The chipset's layout of this length, where one is at hand: what names the words and
  // says which of them the two fields below are.
  const map = strapMapForSection(words.length, generation, isGenerationCertain);
  const clockField = map === undefined ? undefined : espiClockField(map);
  const clockWord = clockField === undefined ? undefined : words[clockField.word];
  const rangeField = map === undefined ? undefined : protectedRangeField(map);
  const rangeWord = rangeField === undefined ? undefined : words[rangeField.word];
  const code =
    clockField === undefined || clockWord === undefined
      ? undefined
      : strapFieldValue(clockField, clockWord);
  // Fifteen bits of start, a read enable, fifteen of end, a write enable — ifdtool's
  // `union gprd`, which is the whole of the field.
  const gprd =
    rangeField === undefined || rangeWord === undefined
      ? undefined
      : strapFieldValue(rangeField, rangeWord);
  return {
    base: section,
    words,
    meDisable,
    espiClock:
      clockField === undefined || code === undefined
        ? undefined
        : { word: clockField.word, clock: { code, megahertz: espiClockOf(code) } },
    gpr0:
      rangeField === undefined || gprd === undefined
        ? undefined
        : {
            word: rangeField.word,
            start: base + (gprd & 0x7fff) * 0x1000,
            end: base + (((gprd >>> 16) & 0x7fff) * 0x1000 + 0xfff),
            readProtected: ((gprd >>> 15) & 1) !== 0,
            writeProtected: ((gprd >>> 31) & 1) !== 0,
          },
    fields: map === undefined ? undefined : strapReadings(map, words),
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
