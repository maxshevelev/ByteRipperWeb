import type { ImageRange, ImageReader } from "@/firmware/imageReader";
import { sum32Of } from "@/firmware/uefi/checksums";
import type { Parser } from "@/firmware/uefi/parserState";
import { makeNode, type UEFINode } from "@/firmware/uefi/uefiNode";

/**
 * `INTEL_MICROCODE_HEADER`.
 *
 * Microcode is what the FIT table mostly points at, so recognising it is not a
 * luxury here: a tool editing FIT needs to know whether the address in an entry
 * lands on a microcode image, on an empty slot, or on nothing at all.
 */
export const Microcode = {
  headerSize: 0x30,
  /** `HeaderType`, and the dword the raw scan looks for. */
  headerType: 1,
  loaderRevision: 1,
  maxSize: 0xff_ffff,
  /**
   * A `DataSize` of zero means 2000 bytes, which the specification wrote down
   * once and never repeated.
   */
  defaultDataSize: 2000,
} as const;

/**
 * The date is packed BCD, and it is the only field in this header with enough
 * structure to reject a false positive on its own.
 */
export function isValidBcdDay(day: number): boolean {
  return (
    (day >= 0x01 && day <= 0x09) ||
    (day >= 0x10 && day <= 0x19) ||
    (day >= 0x20 && day <= 0x29) ||
    (day >= 0x30 && day <= 0x31)
  );
}

export function isValidBcdMonth(month: number): boolean {
  return (month >= 0x01 && month <= 0x09) || (month >= 0x10 && month <= 0x12);
}

export function isValidBcdYear(year: number): boolean {
  const decades = [0x1990, 0x2000, 0x2010, 0x2020, 0x2030, 0x2040];
  return decades.some((start) => year >= start && year <= start + 9);
}

/**
 * Every check of `intelMicrocodeHeaderValid`, all of them required — the dword
 * `0x00000001` is far too common for any subset to do.
 */
export function microcodeHeaderIsValid(fields: {
  readonly headerType: number;
  readonly loaderRevision: number;
  readonly dataSize: number;
  readonly totalSize: number;
  readonly year: number;
  readonly month: number;
  readonly day: number;
}): boolean {
  if (fields.headerType !== Microcode.headerType) return false;
  if (fields.loaderRevision !== Microcode.loaderRevision) return false;
  if (fields.dataSize % 4 !== 0) return false;
  if (fields.dataSize > Microcode.maxSize) return false;
  if (fields.totalSize < fields.dataSize) return false;
  if (fields.totalSize > Microcode.maxSize) return false;
  return isValidBcdDay(fields.day) && isValidBcdMonth(fields.month) && isValidBcdYear(fields.year);
}

/**
 * A microcode header that checked out, read back as values.
 *
 * Exported because a FIT table's entries point at these, and the tool that
 * edits FIT has to show which processor and which revision an entry leads to.
 * Reading them there instead would be this written down twice.
 */
export interface MicrocodeHeader {
  readonly offset: number;
  readonly updateRevision: number;
  /** The date, as the packed BCD it is stored in. */
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly processorSignature: number;
  readonly checksum: number;
  readonly platformIDs: number;
  readonly dataSize: number;
  readonly totalSize: number;
  /**
   * Whether the image's dwords, this field included, sum to zero — the check
   * the loader runs, so a panel can say the checksum counts or not.
   */
  readonly checksumIsCorrect: boolean;
  /**
   * The value the checksum field would have to hold for the image's dwords to
   * sum to zero — what a fix writes when the field is wrong. Nothing when the
   * image cannot be read whole, where there is no answer to give.
   */
  readonly computedChecksum: number | undefined;
}

/**
 * Reads a header and puts it through every check. Nothing means these bytes are
 * not microcode — which is the usual answer, since the dword this starts with
 * is `0x00000001`.
 */
export function readMicrocodeHeader(
  offset: number,
  reader: ImageReader
): MicrocodeHeader | undefined {
  const headerType = reader.uint32(offset);
  const updateRevision = reader.uint32(offset + 0x04);
  const year = reader.uint16(offset + 0x08);
  const day = reader.uint8(offset + 0x0a);
  const month = reader.uint8(offset + 0x0b);
  const processorSignature = reader.uint32(offset + 0x0c);
  const checksum = reader.uint32(offset + 0x10);
  const loaderRevision = reader.uint32(offset + 0x14);
  const platformIDs = reader.uint32(offset + 0x18);
  const dataSize = reader.uint32(offset + 0x1c);
  const totalSize = reader.uint32(offset + 0x20);
  if (
    headerType === undefined ||
    updateRevision === undefined ||
    year === undefined ||
    day === undefined ||
    month === undefined ||
    processorSignature === undefined ||
    checksum === undefined ||
    loaderRevision === undefined ||
    platformIDs === undefined ||
    dataSize === undefined ||
    totalSize === undefined ||
    totalSize === 0
  ) {
    return undefined;
  }
  if (
    !microcodeHeaderIsValid({ headerType, loaderRevision, dataSize, totalSize, year, month, day })
  ) {
    return undefined;
  }

  // The image's dwords, the checksum field included, must sum to zero. The
  // range is the whole image as `totalSize` declares it; a truncated or ragged
  // one has no zero sum, so it reads as not counting — and, having no sum, has
  // no value to say it should be.
  const sum = sum32Of({ start: offset, end: offset + totalSize }, reader);

  return {
    offset,
    updateRevision,
    year,
    month,
    day,
    processorSignature,
    checksum,
    platformIDs,
    dataSize,
    totalSize,
    checksumIsCorrect: sum === 0,
    computedChecksum: sum === undefined ? undefined : (checksum - sum) >>> 0,
  };
}

/** Header and data together, as `TotalSize` gives it. */
export function microcodeRange(header: MicrocodeHeader): ImageRange {
  return { start: header.offset, end: header.offset + header.totalSize };
}

/**
 * `2019-07-15`, unpacked from the BCD. The fields are already known to be valid
 * BCD, or this header would not exist.
 */
export function microcodeDate(header: MicrocodeHeader): string {
  const pad = (value: number, width: number) =>
    value.toString(16).toUpperCase().padStart(width, "0");
  return `${pad(header.year, 4)}-${pad(header.month, 2)}-${pad(header.day, 2)}`;
}

/**
 * One microcode image. Nothing when the header does not check out, which leaves
 * no diagnostic — `0x00000001` appears everywhere.
 */
export function parseMicrocode(
  parser: Parser,
  offset: number,
  limit: number
): UEFINode | undefined {
  if (offset + Microcode.headerSize > limit) return undefined;
  const header = readMicrocodeHeader(offset, parser.reader);
  if (header === undefined) return undefined;

  let end = microcodeRange(header).end;
  if (end > limit) {
    parser.note({ kind: "truncated", structure: "microcodeHeader" }, offset + 0x20);
    end = limit;
  }
  verifyMicrocodeChecksum(parser, offset, end);

  const hex8 = (value: number) => value.toString(16).toUpperCase().padStart(8, "0");
  return makeNode({
    kind: "microcode",
    name: `Microcode ${hex8(header.processorSignature)}, revision ${hex8(header.updateRevision)}`,
    header: { start: offset, end: offset + Microcode.headerSize },
    body: { start: offset + Microcode.headerSize, end },
    // Whatever FIT points at must not move, and the FIT table points at
    // microcode. Deciding that here saves every tool that reads this tree from
    // having to.
    isFixed: true,
  });
}

/** The whole image, dwords, sums to zero. */
function verifyMicrocodeChecksum(parser: Parser, offset: number, end: number): void {
  if ((end - offset) % 4 !== 0) return;
  const sum = sum32Of({ start: offset, end }, parser.reader);
  if (sum === undefined || sum === 0) return;
  const stored = parser.reader.uint32(offset + 0x10);
  if (stored === undefined) return;
  parser.note(
    {
      kind: "checksumMismatch",
      structure: "microcodeHeader",
      stored,
      computed: (stored - sum) >>> 0,
    },
    offset + 0x10
  );
}
