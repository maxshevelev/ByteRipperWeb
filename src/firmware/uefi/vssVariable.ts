import type { ImageRange, ImageReader } from "@/firmware/imageReader";
import type { EFIGUID } from "@/firmware/uefi/efiGuid";
import { NVRAM } from "@/firmware/uefi/nvramParser";
import type { UEFIImage } from "@/firmware/uefi/uefiImage";
import type { UEFINode } from "@/firmware/uefi/uefiNode";

/**
 * One VSS or VSS2 variable's header, taken apart (`UEFI_IMAGE_FORMAT.md` §9): which
 * of the four header forms it is, the fields that form carries, and where its name
 * and its value lie.
 *
 * The form is decided by the state and the attribute bits, the way the reference
 * parser's Kaitai struct decides it — Intel legacy by its own states, authenticated
 * by an authentication bit or by a size field that reads zero, Apple by the
 * data-checksum bit, the standard form otherwise. VSS2 has neither the Intel nor the
 * Apple form. The parser and the detail panel read a variable through this one
 * decision, so they never disagree on where its value is.
 *
 * The header carries no type for the value: what the value is comes from the
 * variable's name and from the bytes themselves (`NvramValue`).
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/VSSVariable.swift#VSSVariable
 */
export interface VSSVariable {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/VSSVariable.swift#VSSVariable.form */
  readonly form: VSSForm;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/VSSVariable.swift#VSSVariable.state */
  readonly state: number;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/VSSVariable.swift#VSSVariable.reserved */
  readonly reserved: number;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/VSSVariable.swift#VSSVariable.attributes */
  readonly attributes: number;
  /**
   * The fixed header, before the name.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/VSSVariable.swift#VSSVariable.header
   */
  readonly header: ImageRange;
  /**
   * The UCS-2 name, its terminator included.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/VSSVariable.swift#VSSVariable.name
   */
  readonly name: ImageRange;
  /**
   * The value.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/VSSVariable.swift#VSSVariable.data
   */
  readonly data: ImageRange;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/VSSVariable.swift#VSSVariable.vendorGuid */
  readonly vendorGuid?: EFIGUID | undefined;
  /**
   * The name and data sizes as the header states them; nothing on the Intel form,
   * which states only `totalSize`.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/VSSVariable.swift#VSSVariable.nameSize
   */
  readonly nameSize?: number | undefined;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/VSSVariable.swift#VSSVariable.dataSize */
  readonly dataSize?: number | undefined;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/VSSVariable.swift#VSSVariable.totalSize */
  readonly totalSize?: number | undefined;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/VSSVariable.swift#VSSVariable.monotonicCount */
  readonly monotonicCount?: bigint | undefined;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/VSSVariable.swift#VSSVariable.timestamp */
  readonly timestamp?: EFITime | undefined;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/VSSVariable.swift#VSSVariable.publicKeyIndex */
  readonly publicKeyIndex?: number | undefined;
  /**
   * The Apple form's CRC32 of the data.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/VSSVariable.swift#VSSVariable.dataCRC32
   */
  readonly dataCRC32?: number | undefined;
}

/**
 * @upstream Packages/UEFIImage/Sources/UEFIImage/VSSVariable.swift#VSSVariable.Form
 */
export type VSSForm =
  /** `VARIABLE_HEADER`: 32 bytes. */
  | "standard"
  /** The standard header and a CRC32 of the data after the GUID: 36. */
  | "apple"
  /**
   * `AUTHENTICATED_VARIABLE_HEADER`: a monotonic count, a time stamp and a public
   * key index before the sizes; 60.
   */
  | "authenticated"
  /**
   * Intel's legacy header: one total size and the GUID; the name runs to its
   * terminator and the data follows it. 28.
   */
  | "intelLegacy";

/**
 * Whether the state is one a live variable has.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/VSSVariable.swift#VSSVariable.isValid
 */
export function isValidVssVariable(variable: VSSVariable): boolean {
  return variable.form === "intelLegacy"
    ? variable.state === NVRAM.vssVariableIntelValid
    : variable.state === NVRAM.vssVariableValid || variable.state === NVRAM.vssVariableAdded;
}

/**
 * Where the variable ends: past its name and its value.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/VSSVariable.swift#VSSVariable.end
 */
export const vssVariableEnd = (variable: VSSVariable): number =>
  Math.max(variable.name.end, variable.data.end);

/**
 * The variable whose header starts at `offset`, read no further than `limit`;
 * nothing when its fixed header is not all there. `inVss2` says the store is VSS2.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/VSSVariable.swift#VSSVariable.read
 */
export function readVssVariable(
  offset: number,
  limit: number,
  inVss2: boolean,
  reader: ImageReader
): VSSVariable | undefined {
  const state = reader.uint8(offset + 2);
  const reserved = reader.uint8(offset + 3);
  const attributes = reader.uint32(offset + 4);
  if (state === undefined || reserved === undefined || attributes === undefined) return undefined;

  if (
    !inVss2 &&
    (state === NVRAM.vssVariableIntelValid || state === NVRAM.vssVariableIntelInvalid)
  ) {
    const size = NVRAM.vssIntelLegacyHeaderSize;
    const totalSize = reader.uint32(offset + 8);
    if (offset + size > limit || totalSize === undefined) return undefined;
    const end = Math.min(Math.max(offset + totalSize, offset + size), limit);
    // The name is UCS-2 up to and including its terminator.
    let nameEnd = offset + size;
    while (nameEnd + 2 <= end) {
      const unit = reader.uint16(nameEnd);
      nameEnd += 2;
      if (unit === 0 || unit === undefined) break;
    }
    return {
      form: "intelLegacy",
      state,
      reserved,
      attributes,
      header: { start: offset, end: offset + size },
      name: { start: offset + size, end: nameEnd },
      data: { start: nameEnd, end },
      vendorGuid: reader.guid(offset + 12),
      totalSize,
    };
  }

  // The two size fields are read up front whatever the header turns out to be: for
  // an authenticated variable they are the monotonic count's two halves. A standard
  // variable always has a name and data, so a field that reads zero cannot be one of
  // its sizes — the variable is authenticated, with a count that happens to be zero.
  // Firmware that never raises the count writes every variable this way, so the zero
  // check matters as much as the attribute bit.
  const sizeLow = reader.uint32(offset + 8);
  const sizeHigh = reader.uint32(offset + 12);
  if (sizeLow === undefined || sizeHigh === undefined) return undefined;
  const isAuth =
    (attributes &
      (NVRAM.vssAttributeAuthWrite |
        NVRAM.vssAttributeTimeBasedAuth |
        NVRAM.vssAttributeAppendWrite)) !==
      0 ||
    sizeLow === 0 ||
    sizeHigh === 0;

  let form: VSSForm;
  let size: number;
  if (isAuth) {
    form = "authenticated";
    size = NVRAM.vssAuthHeaderSize;
  } else if (!inVss2 && (attributes & NVRAM.vssAttributeAppleDataChecksum) !== 0) {
    form = "apple";
    size = NVRAM.vssAppleHeaderSize;
  } else {
    form = "standard";
    size = NVRAM.vssStandardHeaderSize;
  }
  if (offset + size > limit) return undefined;

  let nameSize: number;
  let dataSize: number;
  let vendorGuid: EFIGUID | undefined;
  let monotonicCount: bigint | undefined;
  let timestamp: EFITime | undefined;
  let publicKeyIndex: number | undefined;
  let dataCRC32: number | undefined;
  switch (form) {
    case "authenticated": {
      const n = reader.uint32(offset + 36);
      const d = reader.uint32(offset + 40);
      if (n === undefined || d === undefined) return undefined;
      nameSize = n;
      dataSize = d;
      monotonicCount = BigInt(sizeLow) | (BigInt(sizeHigh) << 32n);
      const stamp = reader.bytesAt(offset + 16, 16);
      timestamp = stamp === undefined ? undefined : efiTime(stamp);
      publicKeyIndex = reader.uint32(offset + 32);
      vendorGuid = reader.guid(offset + 44);
      break;
    }
    case "apple":
      // The data CRC follows the GUID, which is where the standard form's name would
      // begin.
      nameSize = sizeLow;
      dataSize = sizeHigh;
      vendorGuid = reader.guid(offset + 16);
      dataCRC32 = reader.uint32(offset + 32);
      break;
    default:
      nameSize = sizeLow;
      dataSize = sizeHigh;
      vendorGuid = reader.guid(offset + 16);
  }
  const nameStart = offset + size;
  const nameEnd = Math.min(nameStart + nameSize, limit);
  return {
    form,
    state,
    reserved,
    attributes,
    header: { start: offset, end: offset + size },
    name: { start: nameStart, end: nameEnd },
    data: { start: nameEnd, end: Math.min(nameEnd + dataSize, limit) },
    vendorGuid,
    nameSize,
    dataSize,
    monotonicCount,
    timestamp,
    publicKeyIndex,
    dataCRC32,
  };
}

/**
 * The variable a parsed entry stands for. `inVss2` says its store is VSS2 — the one
 * thing the entry cannot say for itself.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/VSSVariable.swift#VSSVariable.read
 */
export function readVssEntry(
  entry: UEFINode,
  inVss2: boolean,
  reader: ImageReader
): VSSVariable | undefined {
  if (entry.kind !== "vssEntry") return undefined;
  const end = Math.max(entry.header.end, entry.body.end, entry.tail.end);
  return readVssVariable(entry.header.start, end, inVss2, reader);
}

/**
 * The variable `entry` stands for, with its store looked up in `image`; an entry
 * with no store above it is read as a `$VSS` one.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/VSSVariable.swift#VSSVariable.read
 */
export function readVssEntryIn(
  entry: UEFINode,
  image: UEFIImage,
  reader: ImageReader
): VSSVariable | undefined {
  const store = entry.id.length === 0 ? undefined : image.node(entry.id.slice(0, -1));
  return readVssEntry(entry, store?.kind === "vss2Store", reader);
}

/**
 * The name, UCS-2 up to its terminator; nothing when it is not readable text.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/VSSVariable.swift#VSSVariable.decodedName
 */
export function decodedVssName(variable: VSSVariable, reader: ImageReader): string | undefined {
  const bytes = reader.bytes(variable.name);
  if (bytes === undefined || bytes.length < 2) return undefined;
  let text = "";
  for (let index = 0; index + 1 < bytes.length; index += 2) {
    const unit = (bytes[index] ?? 0) | ((bytes[index + 1] ?? 0) << 8);
    if (unit === 0) break;
    text += String.fromCharCode(unit);
  }
  return text.length === 0 ? undefined : text;
}

/**
 * `EFI_TIME`, as an authenticated variable stamps its last write.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/VSSVariable.swift#EFITime
 */
export interface EFITime {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  readonly nanosecond: number;
}

/** @upstream Packages/UEFIImage/Sources/UEFIImage/VSSVariable.swift#EFITime.init */
export function efiTime(bytes: Uint8Array): EFITime {
  const u16 = (at: number) => (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8);
  return {
    year: u16(0),
    month: bytes[2] ?? 0,
    day: bytes[3] ?? 0,
    hour: bytes[4] ?? 0,
    minute: bytes[5] ?? 0,
    second: bytes[6] ?? 0,
    nanosecond: (u16(8) | (u16(10) << 16)) >>> 0,
  };
}

/**
 * Nothing written: most firmware leaves the stamp at zero for a variable that is not
 * time-based.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/VSSVariable.swift#EFITime.isZero
 */
export const isZeroTime = (time: EFITime): boolean =>
  time.year === 0 &&
  time.month === 0 &&
  time.day === 0 &&
  time.hour === 0 &&
  time.minute === 0 &&
  time.second === 0 &&
  time.nanosecond === 0;

/**
 * `2023-05-01 12:34:56`; nothing when the fields are not a date. The zone is left
 * out: the spec's revisions disagree on its sign.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/VSSVariable.swift#EFITime.text
 */
export function timeText(time: EFITime): string | undefined {
  if (
    time.month < 1 ||
    time.month > 12 ||
    time.day < 1 ||
    time.day > 31 ||
    time.hour >= 24 ||
    time.minute >= 60 ||
    time.second >= 60
  ) {
    return undefined;
  }
  const two = (value: number) => String(value).padStart(2, "0");
  return `${String(time.year).padStart(4, "0")}-${two(time.month)}-${two(time.day)} ${two(time.hour)}:${two(time.minute)}:${two(time.second)}`;
}
