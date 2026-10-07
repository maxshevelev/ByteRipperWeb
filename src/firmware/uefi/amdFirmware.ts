import { L } from "@/core/localization/localization";
import type { ImageRange, ImageReader } from "@/firmware/imageReader";
import {
  AMD_ZLIB_COMPRESSED_SIZE_OFFSET,
  AMD_ZLIB_HEADER_SIZE,
} from "@/firmware/uefi/compressedSection";
import { isECFirmwarePadding } from "@/firmware/uefi/ecFirmware";
import type { Parser } from "@/firmware/uefi/parserState";
import { makeNode, nodeRange, type UEFINode } from "@/firmware/uefi/uefiNode";

/**
 * The map the AMD Platform Security Processor reads the flash by (`UEFI_IMAGE_FORMAT.md`
 * §9): the Embedded Firmware Structure, the directories it points at, and every blob
 * those directories list.
 *
 * On an AMD board the first megabytes of the flash are the PSP's — its boot loader, the SMU
 * firmware, the memory training (ABL, APCB, PMU), the microcode — and nothing in them is an
 * FFS volume. The PSP finds them through the EFS, a table at one of a few fixed offsets that
 * starts with `0x55AA55AA`, and the directories it points at:
 *
 * - **PSP directories**, `$PSP` and the second level `$PL2`: 16-byte entries — type,
 *   subprogram, flags (ROM id, writable, instance), size, location.
 * - **BIOS directories**, `$BHD` and `$BL2`: 24-byte entries — type, region type, flags
 *   (reset, copy, read-only, compressed, instance, subprogram, ROM id, writable), size,
 *   source, destination in memory.
 * - **Combo directories**, `2PSP` and `2BHD`: one directory per CPU family the flash
 *   serves, chosen by PSP id.
 * - **Image slot headers**, which a PSP directory's slot A and B entries (`0x48`, `0x4A`)
 *   point at on Zen 4 and later: the slot's priority and its second-level directory.
 *
 * A directory's header is its signature, a Fletcher-32 checksum of the rest, the number of
 * entries and a word whose address mode says how its entries' locations read: a
 * memory-mapped address, an offset in the flash, or an offset from the directory itself.
 *
 * The walk starts at the EFS and follows pointers. A scan for the signatures would find more
 * — directory headers turn up copied inside blobs — and they are not the ones the PSP reads.
 * The layout and the type names follow AMD's public BIOS and kernel-driver documentation as
 * coreboot's `amdfwtool` and PSPTool implement them; PSPTool is the reference this reading is
 * checked against.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#AMDFirmware
 */

/**
 * The EFS signature, `AA 55 AA 55` in the bytes.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#AMDFirmware.efsSignature
 */
export const EFS_SIGNATURE = 0x55aa_55aa;
/**
 * What the EFS is taken to span: the coreboot structure's length.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#AMDFirmware.efsLength
 */
export const EFS_LENGTH = 0x50;
/**
 * Where the EFS may be, from the start of the flash, in the order they are tried — the PSP's
 * own order on the boards PSPTool traced.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#AMDFirmware.efsOffsets
 */
export const EFS_OFFSETS: readonly number[] = [
  0x02_0000, 0xfa_0000, 0xf2_0000, 0xe2_0000, 0xc2_0000, 0x82_0000, 0x12_0000,
];

/** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#AMDFirmware.DirectoryKind */
export const DirectoryKind = {
  psp: 1,
  pspLevel2: 2,
  bios: 3,
  biosLevel2: 4,
  pspCombo: 5,
  biosCombo: 6,
  slotHeader: 7,
} as const;
export type DirectoryKindCode = (typeof DirectoryKind)[keyof typeof DirectoryKind];

const SIGNATURES: Readonly<Record<number, string | undefined>> = {
  1: "$PSP",
  2: "$PL2",
  3: "$BHD",
  4: "$BL2",
  5: "2PSP",
  6: "2BHD",
};

/** The four bytes it starts with; none for a slot header. */
/** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#AMDFirmware.DirectoryKind.signature */
export const directorySignature = (kind: number): string | undefined => SIGNATURES[kind];
/** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#AMDFirmware.DirectoryKind.isBIOS */
export const isBIOSDirectory = (kind: number): boolean =>
  kind === DirectoryKind.bios || kind === DirectoryKind.biosLevel2;
/** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#AMDFirmware.DirectoryKind.isCombo */
export const isComboDirectory = (kind: number): boolean =>
  kind === DirectoryKind.pspCombo || kind === DirectoryKind.biosCombo;

/** The header's length: a combo directory has sixteen more bytes. */
/** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#AMDFirmware.DirectoryKind.headerSize */
export function directoryHeaderSize(kind: number): number {
  return isComboDirectory(kind) || kind === DirectoryKind.slotHeader ? 0x20 : 0x10;
}

/** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#AMDFirmware.DirectoryKind.entrySize */
function entrySizeOf(kind: number): number {
  if (isBIOSDirectory(kind)) return 24;
  return kind === DirectoryKind.slotHeader ? 0 : 16;
}

/** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#AMDFirmware.DirectoryKind.kind */
function kindOfSignature(bytes: Uint8Array): DirectoryKindCode | undefined {
  const text = String.fromCharCode(...bytes);
  for (const [code, signature] of Object.entries(SIGNATURES)) {
    if (signature === text) return Number(code) as DirectoryKindCode;
  }
  return undefined;
}

/**
 * How a location in an entry reads.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#AMDFirmware.AddressMode
 */
export const AddressMode = {
  /** The address the x86 cores see the flash at, `0xFFxxxxxx`. */
  physical: 0,
  /** An offset from the start of the flash. */
  flashOffset: 1,
  /** An offset from the directory's own header. */
  directoryRelative: 2,
  /** An offset from the start of the slot the directory is in. */
  slotRelative: 3,
} as const;
export type AddressModeCode = (typeof AddressMode)[keyof typeof AddressMode];

/**
 * One entry of a PSP or BIOS directory.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#AMDFirmware.Entry
 */
export interface AMDEntry {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#AMDFirmware.Entry.index */
  readonly index: number;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#AMDFirmware.Entry.type */
  readonly type: number;
  /** A PSP entry's subprogram; a BIOS entry's region type. */
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#AMDFirmware.Entry.subtype */
  readonly subtype: number;
  /** The two flag bytes, as they are. */
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#AMDFirmware.Entry.flags */
  readonly flags: number;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#AMDFirmware.Entry.size */
  readonly size: number;
  /** The location field, address-mode bits included (64 bits). */
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#AMDFirmware.Entry.location */
  readonly location: bigint;
  /** A BIOS entry's destination in memory; nothing for a PSP entry. */
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#AMDFirmware.Entry.destination */
  readonly destination: bigint | undefined;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#AMDFirmware.Entry.isBIOS */
  readonly isBIOS: boolean;
  /**
   * Where the blob lies in the file; nothing for an entry with no blob — a value, a size of
   * zero — and for one that points outside the image.
   */
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#AMDFirmware.Entry.range */
  readonly range: ImageRange | undefined;
  /** The flash offset the location resolves to, in the image or not. */
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#AMDFirmware.Entry.resolvedOffset */
  readonly resolvedOffset: number | undefined;
  /**
   * A compressed BIOS image that is there as AMD stores one: the 0x100-byte header and a
   * zlib stream (`amdCompressedLength`).
   */
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#AMDFirmware.Entry.isStoredCompressed */
  readonly isStoredCompressed: boolean;
}

/** The soft-fuse chain and its kin keep a value where the location would be, and no size. */
/** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#AMDFirmware.Entry.isValue */
export const entryIsValue = (entry: AMDEntry): boolean =>
  !entry.isBIOS && entry.size === 0xffff_ffff;
/** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#AMDFirmware.Entry.instance */
export const entryInstance = (entry: AMDEntry): number =>
  entry.isBIOS ? (entry.flags >> 4) & 0xf : (entry.flags >> 3) & 0xf;
/** A BIOS entry's subprogram, which sits in its flags. */
/** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#AMDFirmware.Entry.subprogram */
export const entrySubprogram = (entry: AMDEntry): number =>
  entry.isBIOS ? (entry.flags >> 8) & 0x7 : entry.subtype;
/** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#AMDFirmware.Entry.isCompressed */
export const entryIsCompressed = (entry: AMDEntry): boolean =>
  entry.isBIOS && (entry.flags & 0x08) !== 0;
/** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#AMDFirmware.Entry.isReset */
export const entryIsReset = (entry: AMDEntry): boolean =>
  entry.isBIOS && (entry.flags & 0x01) !== 0;
/** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#AMDFirmware.Entry.isCopy */
export const entryIsCopy = (entry: AMDEntry): boolean => entry.isBIOS && (entry.flags & 0x02) !== 0;
/** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#AMDFirmware.Entry.isReadOnly */
export const entryIsReadOnly = (entry: AMDEntry): boolean =>
  entry.isBIOS && (entry.flags & 0x04) !== 0;
/** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#AMDFirmware.Entry.isWritable */
export const entryIsWritable = (entry: AMDEntry): boolean =>
  entry.isBIOS ? (entry.flags & 0x2000) !== 0 : (entry.flags & 0x04) !== 0;
/** Whether the entry points at another directory rather than at a blob. */
/** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#AMDFirmware.Entry.pointsAtDirectory */
export const entryPointsAtDirectory = (entry: AMDEntry): boolean =>
  entry.isBIOS ? entry.type === 0x70 : [0x40, 0x48, 0x49, 0x4a].includes(entry.type);

/**
 * One entry of a combo directory: the directory for one PSP id.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#AMDFirmware.ComboEntry
 */
export interface AMDComboEntry {
  /** 0: the id is a PSP id; 1: a chip family id. */
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#AMDFirmware.ComboEntry.selector */
  readonly selector: number;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#AMDFirmware.ComboEntry.id */
  readonly id: number;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#AMDFirmware.ComboEntry.location */
  readonly location: bigint;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#AMDFirmware.ComboEntry.resolvedOffset */
  readonly resolvedOffset: number | undefined;
}

/** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#AMDFirmware.Directory */
export interface AMDDirectory {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#AMDFirmware.Directory.kind */
  readonly kind: DirectoryKindCode;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#AMDFirmware.Directory.offset */
  readonly offset: number;
  /** The header and the entries. */
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#AMDFirmware.Directory.length */
  readonly length: number;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#AMDFirmware.Directory.entries */
  readonly entries: AMDEntry[];
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#AMDFirmware.Directory.comboEntries */
  readonly comboEntries: AMDComboEntry[];
  /** The header's fourth word: the directory's size, the SPI block size, a base address and the address mode. */
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#AMDFirmware.Directory.info */
  readonly info: number;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#AMDFirmware.Directory.storedChecksum */
  readonly storedChecksum: number | undefined;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#AMDFirmware.Directory.computedChecksum */
  readonly computedChecksum: number | undefined;
  /** The PSP id a combo directory or a slot header names it for. */
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#AMDFirmware.Directory.pspID */
  pspID: number | undefined;
  /** A slot header's slot — `A` or `B` — and its priority. */
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#AMDFirmware.Directory.slot */
  readonly slot?: string | undefined;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#AMDFirmware.Directory.priority */
  readonly priority?: number | undefined;
  /** A slot header's second-level directory. */
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#AMDFirmware.Directory.slotTarget */
  readonly slotTarget?: number | undefined;
}

/** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#AMDFirmware.Directory.range */
export const directoryRange = (directory: AMDDirectory): ImageRange => ({
  start: directory.offset,
  end: directory.offset + directory.length,
});

/** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#AMDFirmware.Directory.checksumMatches */
export const directoryChecksumMatches = (directory: AMDDirectory): boolean =>
  directory.storedChecksum === undefined || directory.storedChecksum === directory.computedChecksum;

/**
 * How the entries' locations read (`AddressMode`), from `info`: bits 24–25 when bit 31 marks
 * the newer layout, bits 29–30 otherwise.
 */
/** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#AMDFirmware.Directory.addressMode */
export function directoryAddressMode(directory: AMDDirectory): AddressModeCode {
  if (isComboDirectory(directory.kind) || directory.kind === DirectoryKind.slotHeader) {
    return AddressMode.physical;
  }
  const info = directory.info >>> 0;
  const mode = (info & 0x8000_0000) !== 0 ? (info >>> 24) & 3 : (info >>> 29) & 3;
  return mode as AddressModeCode;
}

/** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#AMDFirmware.Pointer */
/** One word of the EFS that points at a directory. */
export interface AMDPointer {
  /** Where in the EFS the word is. */
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#AMDFirmware.Pointer.field */
  readonly field: number;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#AMDFirmware.Pointer.value */
  readonly value: number;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#AMDFirmware.Pointer.target */
  readonly target: number;
}

export interface AMDFirmware {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#AMDFirmware.efsOffset */
  readonly efsOffset: number;
  /** The EFS's words that lead to a directory, in their order. */
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#AMDFirmware.pointers */
  readonly pointers: AMDPointer[];
  /** Every directory the walk reached, in the order it reached them. */
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#AMDFirmware.directories */
  readonly directories: AMDDirectory[];
  /** The flash the addresses are mapped over: 8, 16 or 32 MiB. */
  readonly romSize: number;
}

/** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#AMDFirmware.efsRange */
export const efsRange = (firmware: AMDFirmware): ImageRange => ({
  start: firmware.efsOffset,
  end: firmware.efsOffset + EFS_LENGTH,
});

/**
 * Every entry with a blob in the image, each blob once, with the directory it is in. Two
 * entries that name one start are one blob, at the smaller of their sizes: a first-level
 * directory gives the PSP's boot loader the room it may take, the second level its length,
 * and the room runs over the blobs after it.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#AMDFirmware.blobs
 */
export function amdBlobs(
  firmware: AMDFirmware
): { readonly entry: AMDEntry; readonly directory: AMDDirectory }[] {
  const byStart = new Map<number, { entry: AMDEntry; directory: AMDDirectory }>();
  const order: number[] = [];
  for (const directory of firmware.directories) {
    for (const entry of directory.entries) {
      if (entryPointsAtDirectory(entry) || entry.range === undefined) continue;
      const kept = byStart.get(entry.range.start);
      if (kept === undefined) {
        byStart.set(entry.range.start, { entry, directory });
        order.push(entry.range.start);
      } else if (
        kept.entry.range !== undefined &&
        entry.range.end - entry.range.start < kept.entry.range.end - kept.entry.range.start
      ) {
        byStart.set(entry.range.start, { entry, directory });
      }
    }
  }
  return order.flatMap((start) => {
    const one = byStart.get(start);
    return one === undefined ? [] : [one];
  });
}

// MARK: - Reading

/**
 * The map in `reader`, or nothing when there is no EFS that leads to a directory.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#AMDFirmware.read
 */
export function readAMDFirmware(reader: ImageReader): AMDFirmware | undefined {
  if (reader.count < 0x80_0000) return undefined;
  const romSize = amdRomSize(reader.count);
  for (const offset of EFS_OFFSETS) {
    if (offset + EFS_LENGTH > reader.count) continue;
    if (reader.uint32(offset) !== EFS_SIGNATURE) continue;
    const walk = new Walk(reader, romSize);
    const pointers: AMDPointer[] = [];
    for (let field = 4; field < EFS_LENGTH; field += 4) {
      const value = reader.uint32(offset + field);
      if (value === undefined) break;
      if (value === 0 || value === 0xffff_ffff || value === 0xffff_fffe) continue;
      const target = walk.physical(value);
      if (!walk.visit(target, "efs")) continue;
      pointers.push({ field, value, target });
    }
    if (pointers.length === 0) continue;
    return { efsOffset: offset, pointers, directories: walk.directories, romSize };
  }
  return undefined;
}

/**
 * The flash the image is taken to be: the largest of 32, 16 and 8 MiB that the file holds — a
 * dump with bytes appended is still its chip.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#AMDFirmware.romSize
 */
export function amdRomSize(fileSize: number): number {
  for (const mebibytes of [32, 16, 8])
    if (mebibytes * 0x10_0000 <= fileSize) return mebibytes * 0x10_0000;
  return fileSize;
}

type Origin = "efs" | "combo" | "entry" | "slot";

/**
 * The directories as the pointers lead to them, each read once.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#AMDFirmware.Walk
 */
class Walk {
  readonly directories: AMDDirectory[] = [];
  private readonly visited = new Set<number>();
  private readonly reader: ImageReader;
  private readonly romSize: number;

  constructor(reader: ImageReader, romSize: number) {
    this.reader = reader;
    this.romSize = romSize;
  }

  /** A memory-mapped address — or an offset already — as a flash offset. Past 16 MiB only the first 16 are mapped. */
  physical(address: number): number {
    if (address > 0xff00_0000 && this.romSize > 0x100_0000) return address % 0x100_0000;
    return address % this.romSize;
  }

  /** Reads the directory at `offset` and everything it leads to. False when there is none there. */
  visit(offset: number, origin: Origin, slot?: string): boolean {
    if (this.visited.has(offset)) return true;
    if (offset + 0x10 > this.reader.count) return false;
    const signature = this.reader.bytesAt(offset, 4);
    if (signature === undefined) return false;
    const kind = kindOfSignature(signature);
    if (kind !== undefined) {
      // The EFS points at first-level and combo directories only.
      if (
        origin === "efs" &&
        (kind === DirectoryKind.pspLevel2 || kind === DirectoryKind.biosLevel2)
      ) {
        return false;
      }
      this.visited.add(offset);
      return isComboDirectory(kind)
        ? this.readCombo(kind, offset)
        : this.readDirectory(kind, offset);
    }
    // A slot pointer leads to a slot header — or, on some boards, straight to the directory.
    if (origin !== "slot" || slot === undefined) return false;
    return this.readSlotHeader(offset, slot);
  }

  private checksums(
    offset: number,
    length: number
  ): { stored: number | undefined; computed: number | undefined } {
    const bytes = this.reader.bytes({ start: offset + 8, end: offset + length });
    return {
      stored: this.reader.uint32(offset + 4),
      computed: bytes === undefined ? undefined : fletcher32(bytes),
    };
  }

  private readDirectory(kind: DirectoryKindCode, offset: number): boolean {
    const count = this.reader.uint32(offset + 8);
    const info = this.reader.uint32(offset + 12);
    if (count === undefined || count === 0 || count > 0x200 || info === undefined) return false;
    const length = directoryHeaderSize(kind) + count * entrySizeOf(kind);
    if (offset + length > this.reader.count) return false;
    const { stored, computed } = this.checksums(offset, length);
    const directory: AMDDirectory = {
      kind,
      offset,
      length,
      entries: [],
      comboEntries: [],
      info,
      storedChecksum: stored,
      computedChecksum: computed,
      pspID: undefined,
    };
    const bios = isBIOSDirectory(kind);
    for (let index = 0; index < count; index++) {
      const at = offset + directoryHeaderSize(kind) + index * entrySizeOf(kind);
      const type = this.reader.uint8(at);
      const subtype = this.reader.uint8(at + 1);
      const flags = this.reader.uint16(at + 2);
      const size = this.reader.uint32(at + 4);
      const location = this.reader.uint64Bits(at + 8);
      if (
        type === undefined ||
        subtype === undefined ||
        flags === undefined ||
        size === undefined ||
        location === undefined
      ) {
        break;
      }
      let entry: AMDEntry = {
        index,
        type,
        subtype,
        flags,
        size,
        location,
        destination: bios ? this.reader.uint64Bits(at + 16) : undefined,
        isBIOS: bios,
        range: undefined,
        resolvedOffset: undefined,
        isStoredCompressed: false,
      };
      if (!entryIsValue(entry) && location !== 0n) {
        const resolved = this.resolve(location, directory);
        // A compressed BIOS image's size is what it inflates to; what the flash holds is
        // AMD's header and the stream.
        const stored = entryIsCompressed(entry)
          ? amdCompressedLength(resolved, this.reader)
          : undefined;
        const length = stored ?? size;
        entry = {
          ...entry,
          resolvedOffset: resolved,
          isStoredCompressed: stored !== undefined,
          range:
            length > 0 && resolved < this.reader.count && resolved + length <= this.reader.count
              ? { start: resolved, end: resolved + length }
              : undefined,
        };
      }
      directory.entries.push(entry);
    }
    this.directories.push(directory);
    for (const entry of directory.entries) {
      if (!entryPointsAtDirectory(entry) || entry.resolvedOffset === undefined) continue;
      if (!entry.isBIOS && entry.type === 0x48) this.visit(entry.resolvedOffset, "slot", "A");
      else if (!entry.isBIOS && entry.type === 0x4a) this.visit(entry.resolvedOffset, "slot", "B");
      else this.visit(entry.resolvedOffset, "entry");
    }
    return true;
  }

  private readCombo(kind: DirectoryKindCode, offset: number): boolean {
    const count = this.reader.uint32(offset + 8);
    const info = this.reader.uint32(offset + 12);
    if (count === undefined || count === 0 || count > 0x40 || info === undefined) return false;
    const length = directoryHeaderSize(kind) + count * entrySizeOf(kind);
    if (offset + length > this.reader.count) return false;
    const { stored, computed } = this.checksums(offset, length);
    const directory: AMDDirectory = {
      kind,
      offset,
      length,
      entries: [],
      comboEntries: [],
      info,
      storedChecksum: stored,
      computedChecksum: computed,
      pspID: undefined,
    };
    for (let index = 0; index < count; index++) {
      const at = offset + directoryHeaderSize(kind) + index * 16;
      const selector = this.reader.uint32(at);
      const id = this.reader.uint32(at + 4);
      const location = this.reader.uint64Bits(at + 8);
      if (selector === undefined || id === undefined || location === undefined) break;
      const low = Number(location & 0xffff_ffffn);
      const resolved = low === 0 || low === 0xffff_ffff ? undefined : this.physical(low);
      directory.comboEntries.push({ selector, id, location, resolvedOffset: resolved });
    }
    this.directories.push(directory);
    for (const entry of directory.comboEntries) {
      if (entry.resolvedOffset === undefined) continue;
      const before = this.directories.length;
      this.visit(entry.resolvedOffset, "combo");
      // The directory a combo entry chose is the one for its id.
      const chosen = this.directories[before];
      if (this.directories.length > before && chosen !== undefined && chosen.pspID === undefined) {
        chosen.pspID = entry.id;
      }
    }
    return true;
  }

  private readSlotHeader(offset: number, slot: string): boolean {
    if (offset + 0x20 > this.reader.count) return false;
    const priority = this.reader.uint32(offset + 4);
    const target = this.reader.uint32(offset + 0x10);
    const pspID = this.reader.uint32(offset + 0x14);
    if (priority === undefined || target === undefined || pspID === undefined) return false;
    const resolved = this.physical(target);
    // Only a header whose second level is there is one.
    if (resolved + 4 > this.reader.count) return false;
    const signature = this.reader.bytesAt(resolved, 4);
    const kind = signature === undefined ? undefined : kindOfSignature(signature);
    if (kind !== DirectoryKind.pspLevel2 && kind !== DirectoryKind.psp) return false;
    this.visited.add(offset);
    this.directories.push({
      kind: DirectoryKind.slotHeader,
      offset,
      length: 0x20,
      entries: [],
      comboEntries: [],
      info: 0,
      storedChecksum: undefined,
      computedChecksum: undefined,
      pspID,
      slot,
      priority,
      slotTarget: resolved,
    });
    const before = this.directories.length;
    this.visit(resolved, "entry");
    const chosen = this.directories[before];
    if (this.directories.length > before && chosen !== undefined && chosen.pspID === undefined) {
      chosen.pspID = pspID;
    }
    return true;
  }

  /**
   * An entry's location as a flash offset, by the directory's address mode — or the entry's
   * own, where the directory says entries carry one — the way PSPTool reads them.
   */
  private resolve(location: bigint, directory: AMDDirectory): number {
    const value = Number(location & 0xffff_ffffn);
    const entryMode = Number((location >> 62n) & 3n) as AddressModeCode;
    let mode = directoryAddressMode(directory);
    if (mode === AddressMode.directoryRelative || mode === AddressMode.slotRelative) {
      mode = entryMode;
    } else if (
      mode === AddressMode.flashOffset &&
      entryMode === AddressMode.physical &&
      value >= 0xff00_0000
    ) {
      // coreboot writes some entries of a mode-1 directory as physical addresses; no flash
      // offset reaches 0xFF000000.
      mode = AddressMode.physical;
    }
    switch (mode) {
      case AddressMode.physical:
        return this.physical(value);
      case AddressMode.flashOffset:
        return value;
      default:
        return directory.offset + value;
    }
  }
}

/**
 * What a compressed BIOS image takes in the flash: the 0x100-byte header AMD puts in front of
 * a zlib stream — zeros but for the stream's length at `+0x14` — and the stream. Nothing when
 * the bytes at `offset` are not that header followed by a zlib stream.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#AMDFirmware.compressedLength
 */
export function amdCompressedLength(offset: number, reader: ImageReader): number | undefined {
  const stored = reader.uint32(offset + AMD_ZLIB_COMPRESSED_SIZE_OFFSET);
  const first = reader.uint8(offset + AMD_ZLIB_HEADER_SIZE);
  const second = reader.uint8(offset + AMD_ZLIB_HEADER_SIZE + 1);
  if (stored === undefined || stored === 0 || first === undefined || second === undefined)
    return undefined;
  if ((first & 0x0f) !== 8 || ((first << 8) | second) % 31 !== 0) return undefined;
  const length = AMD_ZLIB_HEADER_SIZE + stored;
  return offset + length <= reader.count ? length : undefined;
}

// MARK: - The checksum

/**
 * Fletcher-32 over 16-bit little-endian words, folded as the PSP folds it — what a directory's
 * second word holds for the bytes after it.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#AMDFirmware.fletcher32
 */
export function fletcher32(bytes: Uint8Array): number {
  let c0 = 0xffff;
  let c1 = 0xffff;
  let word = 0;
  for (let index = 0; index + 1 < bytes.length; index += 2) {
    c0 += (bytes[index] ?? 0) | ((bytes[index + 1] ?? 0) << 8);
    c1 += c0;
    if (word % 360 === 0) {
      c0 = (c0 & 0xffff) + Math.floor(c0 / 0x10000);
      c1 = (c1 & 0xffff) + Math.floor(c1 / 0x10000);
    }
    word += 1;
  }
  for (let pass = 0; pass < 2; pass++) {
    c0 = (c0 & 0xffff) + Math.floor(c0 / 0x10000);
    c1 = (c1 & 0xffff) + Math.floor(c1 / 0x10000);
  }
  return (((c1 & 0xffff) << 16) | (c0 & 0xffff)) >>> 0;
}

// MARK: - Names

/**
 * AMD's name for an entry's type. A BIOS directory's own types come first in one; the rest
 * are the PSP's.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#AMDFirmware.typeName
 */
export function amdTypeName(type: number, inBIOSDirectory: boolean): string {
  if (inBIOSDirectory) {
    const name = BIOS_TYPE_NAMES[type];
    if (name !== undefined) return name;
  }
  return PSP_TYPE_NAMES[type] ?? `Type 0x${type.toString(16).toUpperCase().padStart(2, "0")}`;
}

/** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#AMDFirmware.biosTypeNames */
/** The types a BIOS directory has of its own. */
const BIOS_TYPE_NAMES: Readonly<Record<number, string | undefined>> = {
  96: "APCB",
  97: "APOB",
  98: "BIOS",
  99: "APOB_NV_COPY",
  100: "PMU_CODE",
  101: "PMU_DATA",
  102: "MICROCODE_PATCH",
  103: "CORE_MCE_DATA",
  104: "APCB_COPY",
  105: "EARLY_VGA_IMAGE",
  107: "COREBOOT_VBOOT_CONTEXT",
  109: "ROM_ARMOR_BIOS_NVSTORE",
  110: "DEBUG_UNIT",
  111: "OEM_LOGO_IMAGE",
  112: "BIOS_L2_PTR",
  119: "DDRPHY_PCU_FW",
  123: "MPRAS_TRUSTED_APP_IMG",
  124: "OC_SWEET_SPOT_PROFILE",
};

/** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#AMDFirmware.pspTypeNames */
/** The PSP's types — and a BIOS directory's where it lists one of them. */
const PSP_TYPE_NAMES: Readonly<Record<number, string | undefined>> = {
  0: "AMD_PUBLIC_KEY",
  1: "PSP_FW_BOOT_LOADER",
  2: "PSP_FW_TRUSTED_OS",
  3: "PSP_FW_RECOVERY_BOOT_LOADER",
  4: "PSP_NV_DATA",
  5: "BIOS_PUBLIC_KEY",
  6: "BIOS_RTM_FIRMWARE",
  7: "BIOS_RTM_SIGNATURE",
  8: "SMU_OFFCHIP_FW",
  9: "SEC_DBG_PUBLIC_KEY",
  10: "OEM_PSP_FW_PUBLIC_KEY",
  11: "SOFT_FUSE_CHAIN_01",
  12: "PSP_BOOT_TIME_TRUSTLETS",
  13: "PSP_BOOT_TIME_TRUSTLETS_KEY",
  16: "PSP_AGESA_RESUME_FW",
  18: "SMU_OFF_CHIP_FW_2",
  19: "DEBUG_UNLOCK",
  21: "TEE_IP_KEY_MGR_DRIVER",
  26: "PSP_S3_NV_DATA_OR_SEV_DRIVER",
  27: "TEE_BOOT_DRIVER",
  28: "TEE_SOC_DRIVER",
  29: "TEE_FBG_DRIVER",
  31: "TEE_INTERFACE_DRIVER",
  32: "HARDWARE_IP_CONFIG",
  33: "WRAPPED_IKEK",
  34: "TOKEN_UNLOCK",
  35: "PSP_DIAG_BL",
  36: "SEC_GASKET",
  37: "MP2_FW",
  38: "MP2_FW_2",
  39: "USER_MODE_UNIT_TEST",
  40: "DRIVER_ENTRIES",
  41: "KVM_IMAGE",
  42: "MP5_FW",
  43: "EMBEDDED_FW_STRUCTURE",
  44: "TEE_WRITE_ONCE_NVRAM",
  45: "S0I3_DRIVER",
  46: "PREMIUM_CHIPSET_MP0_DXIO_FW",
  47: "PREMIUM_CHIPSET_MP1_FW",
  48: "ABL0",
  49: "ABL1",
  50: "ABL2",
  51: "ABL3",
  52: "ABL4",
  53: "ABL5",
  54: "ABL6",
  55: "ABL7",
  56: "SEV_DATA",
  57: "SEV_CODE",
  58: "FW_PSP_WHITELIST",
  60: "VBIOS_PRELOAD",
  61: "WLAN_UMAC",
  62: "WLAN_IMAC",
  63: "WLAN_BT",
  64: "PSP_FW_L2_PTR",
  65: "FW_IMC",
  66: "FW_GEC_OR_DXIO_PHY_SRAM_FW",
  67: "DXIO_PHY_SRAM_FW_PUBKEY",
  68: "FW_XHCI",
  69: "TOS_SECURITY_POLICY",
  70: "ANOTHER_FET",
  71: "DRTM_TA",
  72: "PSP_FW_L2A_PTR",
  73: "BIOS_L2AB_PTR",
  74: "PSP_FW_L2B_PTR",
  75: "RESERVED",
  76: "PREMIUM_CHIPSET_SEC_POLICY",
  77: "PREMIUM_CHIPSET_DEBUG_UNLOCK",
  78: "PMU_PUBKEY",
  79: "UMC_FW",
  80: "BL_PUBLIC_KEY",
  81: "TOS_PUBLIC_KEY",
  82: "OEM_PSP_BL_USER_APP",
  83: "OEM_PSP_BL_USER_APP_KEY",
  84: "PSP_NVRAM",
  85: "BL_ROLLBACK_SPL",
  86: "TOS_ROLLBACK_SPL",
  87: "PSP_BL_CVIP_TABLE",
  88: "DMCU_ERAM",
  89: "DMCU_ISR",
  90: "MSMU_BINARY_0",
  91: "MSMU_BINARY_1",
  92: "SPI_ROM_CONFIG",
  93: "MPIO_FW",
  94: "DF_TOPOLOGY",
  95: "FW_PSP_SMUSCS_OR_TPMLITE",
  100: "TEE_RAS_DRIVER",
  101: "TEE_RAS_TRUSTED_APP",
  103: "TEE_FHP_DRIVER_FW",
  104: "TEE_SPDM_DRIVER_FW",
  105: "TEE_DPE_DRIVER_FW",
  106: "TEE_PRE_MEM_DRIVER_FW",
  107: "TEE_MP_RAS_DRIVER_FW",
  108: "TEE_POST_MEM_DRIVER_FW",
  112: "BIOS_L2_PTR",
  113: "PSP_DMCUB_CODE",
  114: "PSP_DMCUB_DATA",
  115: "PSP_FW_BOOT_LOADER",
  116: "PSP_PLATFORM_DRIVER",
  117: "FW_SOFT_FUSING_BINARY",
  118: "REGISTER_INIT_BIN",
  128: "OEM_SYS_TA",
  129: "OEM_SYS_TA_SIGNING_KEY",
  130: "IKEK_OEM",
  132: "TKEK_OEM",
  133: "AMF_FW1",
  134: "AMF_FW2",
  135: "MFD_MPM_FACTORY",
  136: "MFD_MPM_WLAN_FW",
  137: "MPM_DRIVER",
  138: "USB4_PHY_FW",
  139: "FIPS_CERTIFICATION_MODULE",
  140: "MPDMA_TF_FW",
  141: "IKEK_TA",
  142: "SEC_FW_DATA_RECORDER",
  143: "OFFCHIP_USB4_FW",
  144: "CCX_CORE_INIT_AND_PM",
  145: "GMI3_PHY_FW",
  146: "MPDMA_MPDACC_TIERED_MEMORY_PAGE_MIGRATION_FW",
  147: "PROM21_FW",
  148: "LSDMA_FW",
  149: "C20_PHY_FW",
  150: "NPU_FW",
  151: "AMD_SFFS_PUBKEY",
  152: "CPU_FEAT_CONFIG_TBL",
  153: "PMF_BINARY",
  154: "REDUCED_MSMU_SIZE",
  155: "GFX_IMU_LX7_CODE",
  156: "GFX_IMU_LX7_DATA",
  157: "FW_ROM_OR_FIPS_SRAM",
  158: "SFDR_DATA",
  159: "REG_ACCESS_WHITELIST",
  160: "CPU_S3_IMAGE",
  162: "UZSC_RESET_WORKAROUND",
  163: "USB_NATIVE_DP",
  164: "USB_TYPEC_DP",
  165: "USB_SS_FW",
  166: "USB4",
  167: "OFFCHIP_XHCI_SATA_PCIE",
  170: "ASP_LIBSEC",
  171: "ART_FMC_IMG",
  172: "ART_RUNTIME_FW",
  173: "ART_KEY_DATABASE",
  174: "SEC_ASP_LIBROM_OVERLAY_FW",
  176: "MPM_CONTEXT",
};

/** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#AMDFirmware.Entry.typeName */
export const amdEntryTypeName = (entry: AMDEntry): string => amdTypeName(entry.type, entry.isBIOS);

/**
 * What a kind of directory is, in words.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#AMDFirmware.kindName
 */
export function amdKindName(kind: number): string {
  switch (kind) {
    case DirectoryKind.psp:
      return L("PSP directory");
    case DirectoryKind.pspLevel2:
      return L("PSP level 2 directory");
    case DirectoryKind.bios:
      return L("BIOS directory");
    case DirectoryKind.biosLevel2:
      return L("BIOS level 2 directory");
    case DirectoryKind.pspCombo:
      return L("PSP combo directory");
    case DirectoryKind.biosCombo:
      return L("BIOS combo directory");
    default:
      return L("Image slot header");
  }
}

/**
 * What a directory is called: what it is, and its signature.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#AMDFirmware.directoryName
 */
export function amdDirectoryName(directory: AMDDirectory): string {
  const signature = directorySignature(directory.kind) ?? "";
  switch (directory.kind) {
    case DirectoryKind.psp:
      return L("PSP directory %1$@", signature);
    case DirectoryKind.pspLevel2:
      return L("PSP level 2 directory %1$@", signature);
    case DirectoryKind.bios:
      return L("BIOS directory %1$@", signature);
    case DirectoryKind.biosLevel2:
      return L("BIOS level 2 directory %1$@", signature);
    case DirectoryKind.pspCombo:
      return L("PSP combo directory %1$@", signature);
    case DirectoryKind.biosCombo:
      return L("BIOS combo directory %1$@", signature);
    default:
      return L("Image slot header %1$@", directory.slot ?? "");
  }
}

/**
 * What a blob is called: AMD's name for its type, and its instance where it has one — the
 * PMU firmware comes in one per kind of memory.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#AMDFirmware.entryName
 */
export function amdEntryName(entry: AMDEntry): string {
  const instance = entryInstance(entry);
  return instance === 0
    ? amdEntryTypeName(entry)
    : L("%1$@, instance %2$@", amdEntryTypeName(entry), `${instance}`);
}

// MARK: - Rows

/**
 * The PSP's map of the image this parser reads, worked out once: every raw area the parser
 * scans asks.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#Parser.amdFirmware
 */
export function amdFirmwareOf(parser: Parser): AMDFirmware | undefined {
  if (parser.amdFirmwareCache === undefined) {
    parser.amdFirmwareCache = { found: readAMDFirmware(parser.reader) };
  }
  return parser.amdFirmwareCache.found;
}

/**
 * `nodes` with the PSP's map read out of the padding that holds it (§9): the EFS, every
 * directory, and every blob a directory lists, each as a row where a stretch of padding — or
 * an Insyde map's region — holds the whole of it. A blob something else already reads, a
 * patch of microcode or a volume, keeps that row; the directory's details lead to it all the
 * same.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#Parser.readingAMDFirmware
 */
export function readingAMDFirmware(
  parser: Parser,
  nodes: readonly UEFINode[],
  emptyByte: number,
  depth: number
): UEFINode[] {
  const firmware = amdFirmwareOf(parser);
  if (firmware === undefined) return [...nodes];
  let result = [...nodes];
  for (const node of amdFirmwareNodes(firmware, depth)) {
    const placed = placingInLayout(parser, node, result, false, emptyByte);
    if (placed === undefined) continue;
    result = placed;
    // A directory whose checksum is wrong is said once, where its row stands.
    if (node.kind === "amdDirectory") {
      const directory = firmware.directories.find((one) => one.offset === node.header.start);
      if (
        directory !== undefined &&
        directory.storedChecksum !== undefined &&
        directory.computedChecksum !== undefined &&
        !directoryChecksumMatches(directory)
      ) {
        parser.note(
          {
            kind: "checksumMismatch",
            structure: "pspDirectory",
            stored: directory.storedChecksum,
            computed: directory.computedChecksum,
          },
          directory.offset + 4
        );
      }
    }
  }
  return result;
}

/**
 * The rows the map gives: the EFS, the directories, then the blobs by where they lie. A
 * compressed BIOS image is left closed, as a compressed section is, and opens to what it
 * inflates to.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#Parser.amdFirmwareNodes
 */
export function amdFirmwareNodes(firmware: AMDFirmware, depth: number): UEFINode[] {
  const efs = efsRange(firmware);
  const nodes: UEFINode[] = [
    makeNode({
      kind: "amdEFS",
      name: L("Embedded Firmware Structure"),
      header: efs,
      body: { start: efs.end, end: efs.end },
      // The PSP looks for it where it is.
      isFixed: true,
    }),
  ];
  for (const directory of firmware.directories) {
    const range = directoryRange(directory);
    const headerEnd = directory.offset + directoryHeaderSize(directory.kind);
    nodes.push(
      makeNode({
        kind: "amdDirectory",
        subtype: directory.kind,
        name: amdDirectoryName(directory),
        header: { start: directory.offset, end: Math.min(headerEnd, range.end) },
        body: { start: Math.min(headerEnd, range.end), end: range.end },
        isFixed: true,
      })
    );
  }
  const blobs = amdBlobs(firmware).sort(
    (one, other) => (one.entry.range?.start ?? 0) - (other.entry.range?.start ?? 0)
  );
  for (const blob of blobs) {
    const range = blob.entry.range;
    if (range === undefined) continue;
    const compressed = blob.entry.isStoredCompressed;
    const bodyStart = compressed ? range.start + AMD_ZLIB_HEADER_SIZE : range.start;
    nodes.push(
      makeNode({
        kind: "amdFirmwareEntry",
        subtype: blob.entry.type,
        name: amdEntryName(blob.entry),
        header: { start: range.start, end: bodyStart },
        body: { start: bodyStart, end: range.end },
        isFixed: true,
        ...(compressed ? { compression: { algorithm: "Zlib (AMD)", decodes: true } } : {}),
        isExpandable: compressed,
        childDepth: depth + 1,
      })
    );
  }
  return nodes;
}

/**
 * `nodes` with `found` laid in the deepest stretch of padding — or Insyde map region, or blob
 * — that holds the whole of it, the way a FIT structure is laid in padding: a stretch at the
 * top keeps its row and gets rows of its own, a padding row inside one is replaced by the
 * rows around `found`.
 *
 * Inside a stretch, `found` may also hold rows already read — the microcode patch a Zen 4
 * entry wraps in a header of its own, the EFS inside a BIOS image — and then takes them in as
 * its own rows, cutting the padding at its edges. Nothing when what holds it is something
 * else — a volume, a row already read — or nothing at all.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#Parser.placingInLayout
 */
export function placingInLayout(
  parser: Parser,
  found: UEFINode,
  nodes: readonly UEFINode[],
  inner: boolean,
  emptyByte: number
): UEFINode[] | undefined {
  const where = nodeRange(found);
  const index = nodes.findIndex((node) => {
    const around = nodeRange(node);
    return around.start <= where.start && where.end <= around.end;
  });
  if (index >= 0) {
    const node = { ...(nodes[index] as UEFINode) };
    if (!sameSpace(node.space, found.space) || !holdsAMDFirmware(node)) return undefined;
    const result = [...nodes];
    if (node.children.length > 0) {
      const children = placingInLayout(parser, found, node.children, true, emptyByte);
      if (children === undefined) return undefined;
      node.children = children;
      result[index] = node;
      return result;
    }
    const around = nodeRange(node);
    const pieces = [
      ...parser.padding(around.start, where.start, emptyByte),
      found,
      ...parser.padding(where.end, around.end, emptyByte),
    ];
    if (inner && node.kind === "padding") {
      result.splice(index, 1, ...pieces);
    } else {
      node.children = pieces;
      result[index] = node;
    }
    return result;
  }
  return inner ? wrapping(parser, found, nodes, emptyByte) : undefined;
}

const sameSpace = (one: readonly number[], other: readonly number[]): boolean =>
  one.length === other.length && one.every((value, index) => value === other[index]);

const overlaps = (one: ImageRange, other: ImageRange): boolean =>
  one.start < other.end && other.start < one.end;

/**
 * `nodes` — the rows of one stretch — with `found` standing over a run of them: the rows
 * wholly inside it become its own, and a padding row it reaches only into is cut at its
 * edge. Nothing when an edge falls in a row that is not padding.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#Parser.wrapping
 */
function wrapping(
  parser: Parser,
  found: UEFINode,
  nodes: readonly UEFINode[],
  emptyByte: number
): UEFINode[] | undefined {
  const where = nodeRange(found);
  const touched = nodes.flatMap((node, index) => (overlaps(nodeRange(node), where) ? [index] : []));
  const first = touched[0];
  const last = touched.at(-1);
  if (first === undefined || last === undefined) return undefined;
  const inside: UEFINode[] = [];
  const before: UEFINode[] = [];
  const after: UEFINode[] = [];
  for (let index = first; index <= last; index++) {
    const node = nodes[index] as UEFINode;
    if (!sameSpace(node.space, found.space)) return undefined;
    const range = nodeRange(node);
    if (where.start <= range.start && range.end <= where.end) {
      inside.push(node);
      continue;
    }
    // Cut at an edge: only a padding row with nothing read in it.
    if (node.kind !== "padding" || node.children.length > 0) return undefined;
    if (range.start < where.start) {
      before.push(...parser.padding(range.start, where.start, emptyByte));
      inside.push(...parser.padding(where.start, Math.min(range.end, where.end), emptyByte));
    }
    if (range.end > where.end) {
      if (range.start >= where.start) {
        inside.push(...parser.padding(range.start, where.end, emptyByte));
      }
      after.push(...parser.padding(where.end, range.end, emptyByte));
    }
  }
  // The bytes of `found` no row covered are padding too.
  const rows: UEFINode[] = [];
  let at = where.start;
  for (const node of inside.sort((one, other) => nodeRange(one).start - nodeRange(other).start)) {
    rows.push(...parser.padding(at, nodeRange(node).start, emptyByte));
    rows.push(node);
    at = nodeRange(node).end;
  }
  rows.push(...parser.padding(at, where.end, emptyByte));
  const wrapped: UEFINode = { ...found, children: rows };
  const result = [...nodes];
  result.splice(first, last - first + 1, ...before, wrapped, ...after);
  return result;
}

/**
 * Whether `node` is somewhere the PSP's structures are laid in: padding that is not an EC
 * image's, an Insyde map's region, a blob.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/AMDFirmware.swift#Parser.holdsAMDFirmware
 */
function holdsAMDFirmware(node: UEFINode): boolean {
  switch (node.kind) {
    case "flashDeviceMapRegion":
    case "amdFirmwareEntry":
      return true;
    case "padding":
      return !isECFirmwarePadding(node);
    default:
      return false;
  }
}
