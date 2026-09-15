import type { ImageReader } from "@/firmware/imageReader";

/**
 * One sixteen-byte row of the table — the header included, since it is a row
 * like any other.
 *
 * ```
 *   0x00   8   Address    (LE)
 *   0x08   3   Size       (LE, 24-bit, in 16-byte units)
 *   0x0B   1   Reserved
 *   0x0C   2   Version    (LE, BCD)
 *   0x0E   1   Type[6:0] | ChecksumValid[7]
 *   0x0F   1   Checksum
 * ```
 *
 * @upstream Modules/FITTool/Sources/FITTool/FITEntry.swift#FITEntry
 */
export interface FITEntry {
  /**
   * Its place in the table; 0 is the header.
   *
   * @upstream Modules/FITTool/Sources/FITTool/FITEntry.swift#FITEntry.index
   */
  readonly index: number;
  /**
   * Where the row itself is in the file — what a write to it addresses.
   *
   * @upstream Modules/FITTool/Sources/FITTool/FITEntry.swift#FITEntry.offset
   */
  readonly offset: number;
  /**
   * Exact to 2^53, which covers every address a 32-bit image is mapped at. A
   * corrupt row can hold more and comes back rounded — and then every check
   * that it lands in the image fails, which is the same answer.
   *
   * @upstream Modules/FITTool/Sources/FITTool/FITEntry.swift#FITEntry.address
   */
  readonly address: number;
  /**
   * As stored. Most types do not use it, and for microcode it is required to
   * be zero — the real size lives in the component, which is why showing this
   * raw is how a tool ends up displaying a silent `0`.
   *
   * @upstream Modules/FITTool/Sources/FITTool/FITEntry.swift#FITEntry.size
   */
  readonly size: number;
  /**
   * Must be zero, except on a CSE SecureBoot entry where it is the subtype.
   *
   * @upstream Modules/FITTool/Sources/FITTool/FITEntry.swift#FITEntry.reserved
   */
  readonly reserved: number;
  /**
   * BCD: high byte major, low byte minor.
   *
   * @upstream Modules/FITTool/Sources/FITTool/FITEntry.swift#FITEntry.version
   */
  readonly version: number;
  /**
   * Seven bits. The eighth is `checksumValid`.
   *
   * @upstream Modules/FITTool/Sources/FITTool/FITEntry.swift#FITEntry.type
   */
  readonly type: number;
  /** @upstream Modules/FITTool/Sources/FITTool/FITEntry.swift#FITEntry.checksumValid */
  readonly checksumValid: boolean;
  /** @upstream Modules/FITTool/Sources/FITTool/FITEntry.swift#FITEntry.checksum */
  readonly checksum: number;
}

export const FIT_ENTRY_SIZE = 16;

/**
 * Reads a row. Nothing only when the bytes are not there — every field of a row
 * is valid as a value, and what is wrong with it is a diagnostic rather than a
 * refusal to read.
 *
 * @upstream Modules/FITTool/Sources/FITTool/FITEntry.swift#FITEntry.read
 */
export function readFitEntry(
  offset: number,
  index: number,
  reader: ImageReader
): FITEntry | undefined {
  const address = reader.uint64(offset);
  const size = reader.uint24(offset + 0x08);
  const reserved = reader.uint8(offset + 0x0b);
  const version = reader.uint16(offset + 0x0c);
  const typeByte = reader.uint8(offset + 0x0e);
  const checksum = reader.uint8(offset + 0x0f);
  if (
    address === undefined ||
    size === undefined ||
    reserved === undefined ||
    version === undefined ||
    typeByte === undefined ||
    checksum === undefined
  ) {
    return undefined;
  }
  return {
    index,
    offset,
    address,
    size,
    reserved,
    version,
    type: typeByte & 0x7f,
    checksumValid: (typeByte & 0x80) !== 0,
    checksum,
  };
}

/**
 * `1.00`, unpacked from the BCD the field holds.
 *
 * @upstream Modules/FITTool/Sources/FITTool/FITEntry.swift#FITEntry.versionText
 */
export function versionText(entry: FITEntry): string {
  const major = (entry.version >>> 8).toString(16).toUpperCase();
  const minor = (entry.version & 0xff).toString(16).toUpperCase().padStart(2, "0");
  return `${major}.${minor}`;
}

/** @upstream Modules/FITTool/Sources/FITTool/FITEntry.swift#FITEntry.isHeader */
export const isHeaderEntry = (entry: FITEntry): boolean => entry.type === FIT.headerType;

/**
 * A slot a vendor reserved for a later update. Legal, and the safest place to
 * add an entry.
 *
 * @upstream Modules/FITTool/Sources/FITTool/FITEntry.swift#FITEntry.isEmptySlot
 */
export const isEmptySlot = (entry: FITEntry): boolean => entry.type === FIT.emptyType;

/**
 * What `Size` means in bytes, for the types that use it at all.
 *
 * @upstream Modules/FITTool/Sources/FITTool/FITEntry.swift#FITEntry.sizeInBytes
 */
export const sizeInBytes = (entry: FITEntry): number => entry.size * 16;

/**
 * The table's constants and the names for what is in it.
 *
 * @upstream Modules/FITTool/Sources/FITTool/FITEntry.swift#FIT
 */
export const FIT = {
  /**
   * `_FIT_   ` read as a little-endian 64-bit number — it lives in the header
   * row's `Address` field, where every other row keeps a pointer.
   *
   * A `bigint`, because these eight bytes are a magic number and every one of
   * them matters: as a double the value is past 2^53 and two different byte
   * patterns could round to the same one.
   *
   * @upstream Modules/FITTool/Sources/FITTool/FITEntry.swift#FIT.signature
   */
  signature: 0x2020_205f_5449_465fn,
  /**
   * The pointer's physical address: `0x40` from the top of the address space.
   *
   * @upstream Modules/FITTool/Sources/FITTool/FITEntry.swift#FIT.pointerAddress
   */
  pointerAddress: 0xffff_ffc0,

  /** @upstream Modules/FITTool/Sources/FITTool/FITEntry.swift#FIT.headerType */
  headerType: 0x00,
  /** @upstream Modules/FITTool/Sources/FITTool/FITEntry.swift#FIT.microcodeType */
  microcodeType: 0x01,
  /** @upstream Modules/FITTool/Sources/FITTool/FITEntry.swift#FIT.startupACMType */
  startupACMType: 0x02,
  /** @upstream Modules/FITTool/Sources/FITTool/FITEntry.swift#FIT.tpmPolicyType */
  tpmPolicyType: 0x08,
  /** @upstream Modules/FITTool/Sources/FITTool/FITEntry.swift#FIT.txtPolicyType */
  txtPolicyType: 0x0a,
  /** @upstream Modules/FITTool/Sources/FITTool/FITEntry.swift#FIT.cseSecureBootType */
  cseSecureBootType: 0x10,
  /** @upstream Modules/FITTool/Sources/FITTool/FITEntry.swift#FIT.emptyType */
  emptyType: 0x7f,

  /**
   * A policy entry whose version is 0 keeps an Index/IO register descriptor in
   * the first eight bytes, not an address.
   *
   * @upstream Modules/FITTool/Sources/FITTool/FITEntry.swift#FIT.policyIndexIOVersion
   */
  policyIndexIOVersion: 0,
} as const;

/**
 * The same eight bytes, derived rather than typed a second time — upstream's
 * first spelling of them was `_TIF_`, and it cost a test to notice.
 *
 * @upstream Modules/FITTool/Sources/FITTool/FITEntry.swift#FIT.signatureBytes
 */
export const FIT_SIGNATURE_BYTES = Uint8Array.from("_FIT_   ", (one) => one.charCodeAt(0));

const TYPE_NAMES: Readonly<Record<number, string>> = {
  0: "FIT Header",
  1: "Microcode",
  2: "Startup ACM",
  3: "Diagnostic ACM",
  4: "Platform Boot Policy",
  6: "FIT Reset State",
  7: "BIOS Startup Module",
  8: "TPM Policy",
  9: "BIOS Policy",
  10: "TXT Policy",
  11: "Boot Guard Key Manifest",
  12: "Boot Guard Boot Policy",
  16: "CSE SecureBoot Settings",
  26: "VAB Provisioning Table",
  27: "VAB Key Manifest",
  28: "VAB Image Manifest",
  29: "VAB Image Hash Descriptors",
  44: "SACM Debug Record",
  45: "ACM Feature Policy",
  46: "SCRTM Error Record",
  47: "JMP Debug Policy",
  127: "Empty slot",
};

const hex2 = (value: number) => `0x${value.toString(16).toUpperCase().padStart(2, "0")}`;

/** @upstream Modules/FITTool/Sources/FITTool/FITEntry.swift#FIT.typeName */
export function fitTypeName(type: number): string {
  const known = TYPE_NAMES[type];
  if (known !== undefined) return known;
  if (type >= 0x30 && type <= 0x70) return `OEM reserved ${hex2(type)}`;
  return `Reserved ${hex2(type)}`;
}

const CSE_SUBTYPES: Readonly<Record<number, string>> = {
  1: "Key Hash",
  2: "CSE Measurement Hash",
  3: "Boot Policy",
  4: "Other Boot Policy",
  5: "OEM SMIP",
  6: "MRC Training Data",
  7: "IBBL Hash",
  8: "IBB Hash",
  9: "OEM ID",
  10: "OEM SKU ID",
  11: "Boot Device Indicator",
  12: "FIT Patch Manifest",
  13: "AC Module Manifest",
};

/**
 * The subtype a CSE SecureBoot entry keeps in its `Reserved` byte.
 *
 * @upstream Modules/FITTool/Sources/FITTool/FITEntry.swift#FIT.cseSecureBootSubtypeName
 */
export function cseSecureBootSubtypeName(subtype: number): string {
  return CSE_SUBTYPES[subtype] ?? `Subtype ${subtype}`;
}
