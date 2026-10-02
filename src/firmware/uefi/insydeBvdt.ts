import type { ImageRange, ImageReader } from "@/firmware/imageReader";
import { type EFIGUID, guidFromBytes } from "@/firmware/uefi/efiGuid";

/**
 * Insyde's BIOS Version Data Table, the `$BVDT$` block the flash device map names
 * `BIOS Version Data Table` (`UEFI_IMAGE_FORMAT.md` §9).
 *
 * No specification describes it; the layout here is what six Insyde dumps agree
 * on. Three strings sit at fixed places, each after a `$`: the BIOS version, the
 * product name and the Insyde kernel version. Further on, a run of `$`-tagged
 * records ends with `$ENDOFBVDT`:
 *
 * - `$RDATE` — three BCD bytes, year, month, day, which on every dump at hand is
 *   a date that fits the BIOS version.
 * - `$_MSC_VER=` — a 16-bit number, the value of Microsoft's compiler macro of
 *   that name: 1600 or 1900 on the dumps, Visual Studio 2010 and 2015.
 * - `$ESRT` — a 32-bit version and a GUID. The GUID is the firmware class of the
 *   board's entry in the EFI System Resource Table, the hardware ID
 *   (`UEFI\RES_{…}`) Windows Update matches a BIOS capsule against; the
 *   version's low byte is the BIOS build number on four of the five boards.
 * - `$BME$` — up to three offset and size pairs in the BIOS region, each followed
 *   by a `$`. On the dumps they are the table's own region, one FFSv2 volume
 *   exactly, and on one board the EC firmware region; what the firmware or its
 *   flash tool does with them is not known.
 *
 * `$QUIRK`, on one board, is not read.
 *
 * Public because the details panel shows it, and it is a reading of bytes, which
 * belongs here and not in a view.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/InsydeBVDT.swift#InsydeBVDT
 */
export interface InsydeBVDT {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/InsydeBVDT.swift#InsydeBVDT.biosVersion */
  readonly biosVersion?: string | undefined;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/InsydeBVDT.swift#InsydeBVDT.productName */
  readonly productName?: string | undefined;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/InsydeBVDT.swift#InsydeBVDT.kernelVersion */
  readonly kernelVersion?: string | undefined;
  /**
   * The `$RDATE` record as `YYYY-MM-DD`, the way a microcode's date reads.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/InsydeBVDT.swift#InsydeBVDT.releaseDate
   */
  readonly releaseDate?: string | undefined;
  /**
   * The `$_MSC_VER=` record: the compiler version the firmware was built with, as
   * Microsoft numbers it.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/InsydeBVDT.swift#InsydeBVDT.compilerVersion
   */
  readonly compilerVersion?: number | undefined;
  /**
   * The `$ESRT` record's version and firmware class.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/InsydeBVDT.swift#InsydeBVDT.esrtVersion
   */
  readonly esrtVersion?: number | undefined;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/InsydeBVDT.swift#InsydeBVDT.esrtClass */
  readonly esrtClass?: EFIGUID | undefined;
  /**
   * The `$BME$` record's ranges, as offsets into the BIOS region.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/InsydeBVDT.swift#InsydeBVDT.listedRanges
   */
  readonly listedRanges: readonly ImageRange[];
}

const ascii = (text: string) => Uint8Array.from(text, (character) => character.charCodeAt(0));

/** @upstream Packages/UEFIImage/Sources/UEFIImage/InsydeBVDT.swift#InsydeBVDT.signature */
const SIGNATURE = ascii("$BVDT$");
/** @upstream Packages/UEFIImage/Sources/UEFIImage/InsydeBVDT.swift#InsydeBVDT.end */
const END = ascii("$ENDOFBVDT");
/** @upstream Packages/UEFIImage/Sources/UEFIImage/InsydeBVDT.swift#InsydeBVDT.dateTag */
const DATE_TAG = ascii("$RDATE");
/** @upstream Packages/UEFIImage/Sources/UEFIImage/InsydeBVDT.swift#InsydeBVDT.compilerTag */
const COMPILER_TAG = ascii("$_MSC_VER=");
/** @upstream Packages/UEFIImage/Sources/UEFIImage/InsydeBVDT.swift#InsydeBVDT.esrtTag */
const ESRT_TAG = ascii("$ESRT");
/** @upstream Packages/UEFIImage/Sources/UEFIImage/InsydeBVDT.swift#InsydeBVDT.rangesTag */
const RANGES_TAG = ascii("$BME$");
/**
 * `$BME$` holds no more pairs than this on any dump at hand, and the next record
 * follows the third.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/InsydeBVDT.swift#InsydeBVDT.rangeSlots
 */
const RANGE_SLOTS = 3;

/**
 * Each string field: where its `$` is, and where the next field begins.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/InsydeBVDT.swift#InsydeBVDT.biosVersionField
 * @upstream Packages/UEFIImage/Sources/UEFIImage/InsydeBVDT.swift#InsydeBVDT.productNameField
 * @upstream Packages/UEFIImage/Sources/UEFIImage/InsydeBVDT.swift#InsydeBVDT.kernelVersionField
 */
const BIOS_VERSION_FIELD = { start: 0x0d, end: 0x26 } as const;
const PRODUCT_NAME_FIELD = { start: 0x26, end: 0x40 } as const;
const KERNEL_VERSION_FIELD = { start: 0x40, end: 0x66 } as const;

/** The table and its records fit in the first 4 KiB, the size the region has on every dump at hand. */
const READ_LIMIT = 0x1000;

/**
 * The table at the start of `range`, or nothing when it does not open with
 * `$BVDT$`. A field whose `$` is missing, or that holds no text, is absent.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/InsydeBVDT.swift#InsydeBVDT.read
 */
export function readInsydeBvdt(range: ImageRange, reader: ImageReader): InsydeBVDT | undefined {
  const length = Math.min(range.end - range.start, READ_LIMIT);
  const bytes = reader.bytesAt(range.start, length);
  if (bytes === undefined || !startsWith(bytes, SIGNATURE)) return undefined;

  const end = indexOf(bytes, END);
  const records = end < 0 ? bytes : bytes.subarray(0, end);
  let releaseDate: string | undefined;
  const tag = indexOf(records, DATE_TAG);
  if (tag >= 0 && tag + DATE_TAG.length + 3 <= records.length) {
    const date = records.subarray(tag + DATE_TAG.length, tag + DATE_TAG.length + 3);
    const month = bcd(date[1] ?? 0);
    const day = bcd(date[2] ?? 0);
    if (date.every(isBcd) && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      releaseDate = `20${hex2(date[0])}-${hex2(date[1])}-${hex2(date[2])}`;
    }
  }
  const compiler = valueAfter(records, COMPILER_TAG, 2);
  const esrt = valueAfter(records, ESRT_TAG, 20);
  const rangesAt = indexOf(records, RANGES_TAG);
  return {
    biosVersion: textField(bytes, BIOS_VERSION_FIELD),
    productName: textField(bytes, PRODUCT_NAME_FIELD),
    kernelVersion: textField(bytes, KERNEL_VERSION_FIELD),
    releaseDate,
    compilerVersion:
      compiler === undefined ? undefined : (compiler[0] ?? 0) | ((compiler[1] ?? 0) << 8),
    esrtVersion: esrt === undefined ? undefined : dword(esrt, 0),
    esrtClass: esrt === undefined ? undefined : guidFromBytes(esrt.subarray(4, 20)),
    listedRanges: rangesAt < 0 ? [] : rangesFrom(records, rangesAt + RANGES_TAG.length),
  };
}

/**
 * The `count` bytes after `tag` among the records, if they are there.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/InsydeBVDT.swift#InsydeBVDT.value
 */
function valueAfter(records: Uint8Array, tag: Uint8Array, count: number): Uint8Array | undefined {
  const found = indexOf(records, tag);
  if (found < 0 || found + tag.length + count > records.length) return undefined;
  return records.subarray(found + tag.length, found + tag.length + count);
}

const dword = (bytes: Uint8Array, at: number): number =>
  ((bytes[at] ?? 0) |
    ((bytes[at + 1] ?? 0) << 8) |
    ((bytes[at + 2] ?? 0) << 16) |
    ((bytes[at + 3] ?? 0) << 24)) >>>
  0;

/**
 * `$BME$`'s pairs: a 32-bit offset and size, then a `$` when another follows. A
 * pair that is erased — a size of all ones — is a slot not in use, and so is one
 * of size zero.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/InsydeBVDT.swift#InsydeBVDT.ranges
 */
function rangesFrom(records: Uint8Array, start: number): ImageRange[] {
  const ranges: ImageRange[] = [];
  let at = start;
  for (let slot = 0; slot < RANGE_SLOTS; slot++) {
    if (at + 8 > records.length) break;
    const offset = dword(records, at);
    const size = dword(records, at + 4);
    if (size !== 0 && size !== 0xffff_ffff && offset < 0xffff_0000) {
      ranges.push({ start: offset, end: offset + size });
    }
    at += 8;
    if (slot >= RANGE_SLOTS - 1 || at >= records.length || records[at] !== 0x24) break;
    at += 1;
  }
  return ranges;
}

function textField(bytes: Uint8Array, field: ImageRange): string | undefined {
  if (field.end > bytes.length || bytes[field.start] !== 0x24) return undefined;
  const run = bytes.subarray(field.start + 1, field.end);
  const zero = run.indexOf(0);
  const text = zero < 0 ? run : run.subarray(0, zero);
  if (text.length === 0 || !text.every((byte) => byte >= 0x20 && byte < 0x7f)) return undefined;
  return String.fromCharCode(...text).trim();
}

const isBcd = (byte: number): boolean => (byte & 0x0f) <= 9 && byte >> 4 <= 9;
const bcd = (byte: number): number => (byte >> 4) * 10 + (byte & 0x0f);
const hex2 = (byte: number | undefined): string =>
  (byte ?? 0).toString(16).toUpperCase().padStart(2, "0");

const startsWith = (bytes: Uint8Array, prefix: Uint8Array): boolean =>
  bytes.length >= prefix.length && prefix.every((byte, index) => bytes[index] === byte);

function indexOf(bytes: Uint8Array, needle: Uint8Array): number {
  for (
    let at = bytes.indexOf(needle[0] ?? 0);
    at >= 0;
    at = bytes.indexOf(needle[0] ?? 0, at + 1)
  ) {
    if (at + needle.length > bytes.length) return -1;
    if (needle.every((byte, index) => bytes[at + index] === byte)) return at;
  }
  return -1;
}
