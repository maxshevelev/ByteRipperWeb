import type { ImageRange, ImageReader } from "@/firmware/imageReader";
import { checksumText, sum32Of } from "@/firmware/uefi/checksums";
import type { Parser } from "@/firmware/uefi/parserState";
import { makeNode, type UEFINode } from "@/firmware/uefi/uefiNode";

/**
 * `INTEL_MICROCODE_HEADER`.
 *
 * Microcode is what the FIT table mostly points at, so recognising it is not a
 * luxury here: a tool editing FIT needs to know whether the address in an entry
 * lands on a microcode image, on an empty slot, or on nothing at all.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/MicrocodeParser.swift#Microcode
 */
export const Microcode = {
  /**
   * @upstream Packages/UEFIImage/Sources/UEFIImage/MicrocodeParser.swift#Microcode.headerSize
   * @upstream Packages/UEFIImage/Sources/UEFIImage/MicrocodeParser.swift#MicrocodeHeader.size
   */
  headerSize: 0x30,
  /**
   * `HeaderType`, and the dword the raw scan looks for.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/MicrocodeParser.swift#Microcode.headerType
   */
  headerType: 1,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/MicrocodeParser.swift#Microcode.loaderRevision */
  loaderRevision: 1,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/MicrocodeParser.swift#Microcode.maxSize */
  maxSize: 0xff_ffff,
  /**
   * A `DataSize` of zero means 2000 bytes, which the specification wrote down
   * once and never repeated.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/MicrocodeParser.swift#Microcode.defaultDataSize
   */
  defaultDataSize: 2000,
} as const;

/**
 * The date is packed BCD, and it is the only field in this header with enough
 * structure to reject a false positive on its own.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/MicrocodeParser.swift#Microcode.isValidBCDDay
 */
export function isValidBcdDay(day: number): boolean {
  return (
    (day >= 0x01 && day <= 0x09) ||
    (day >= 0x10 && day <= 0x19) ||
    (day >= 0x20 && day <= 0x29) ||
    (day >= 0x30 && day <= 0x31)
  );
}

/** @upstream Packages/UEFIImage/Sources/UEFIImage/MicrocodeParser.swift#Microcode.isValidBCDMonth */
export function isValidBcdMonth(month: number): boolean {
  return (month >= 0x01 && month <= 0x09) || (month >= 0x10 && month <= 0x12);
}

/** @upstream Packages/UEFIImage/Sources/UEFIImage/MicrocodeParser.swift#Microcode.isValidBCDYear */
export function isValidBcdYear(year: number): boolean {
  const decades = [0x1990, 0x2000, 0x2010, 0x2020, 0x2030, 0x2040];
  return decades.some((start) => year >= start && year <= start + 9);
}

/**
 * Every check of `intelMicrocodeHeaderValid`, all of them required — the dword
 * `0x00000001` is far too common for any subset to do.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/MicrocodeParser.swift#Microcode.headerIsValid
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
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/MicrocodeParser.swift#MicrocodeHeader
 */
export interface MicrocodeHeader {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/MicrocodeParser.swift#MicrocodeHeader.offset */
  readonly offset: number;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/MicrocodeParser.swift#MicrocodeHeader.updateRevision */
  readonly updateRevision: number;
  /**
   * The date, as the packed BCD it is stored in.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/MicrocodeParser.swift#MicrocodeHeader.year
   */
  readonly year: number;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/MicrocodeParser.swift#MicrocodeHeader.month */
  readonly month: number;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/MicrocodeParser.swift#MicrocodeHeader.day */
  readonly day: number;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/MicrocodeParser.swift#MicrocodeHeader.processorSignature */
  readonly processorSignature: number;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/MicrocodeParser.swift#MicrocodeHeader.checksum */
  readonly checksum: number;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/MicrocodeParser.swift#MicrocodeHeader.platformIDs */
  readonly platformIDs: number;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/MicrocodeParser.swift#MicrocodeHeader.dataSize */
  readonly dataSize: number;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/MicrocodeParser.swift#MicrocodeHeader.totalSize */
  readonly totalSize: number;
  /**
   * Whether the image's dwords, this field included, sum to zero — the check
   * the loader runs, so a panel can say the checksum counts or not.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/MicrocodeParser.swift#MicrocodeHeader.checksumIsCorrect
   */
  readonly checksumIsCorrect: boolean;
  /**
   * The value the checksum field would have to hold for the image's dwords to
   * sum to zero — what a fix writes when the field is wrong. Nothing when the
   * image cannot be read whole, where there is no answer to give.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/MicrocodeParser.swift#MicrocodeHeader.computedChecksum
   */
  readonly computedChecksum: number | undefined;
  /**
   * `MetadataSize` (offset 0x24). Reserved, and zero, in every image made before
   * the field was defined.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/MicrocodeParser.swift#MicrocodeHeader.metadataSize
   */
  readonly metadataSize: number;
  /**
   * The extended signature table behind the data, which an update carries when
   * it fits more than one processor; nothing when there is none.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/MicrocodeParser.swift#MicrocodeHeader.extendedTable
   */
  readonly extendedTable: MicrocodeExtendedTable | undefined;
}

/**
 * The extended signature table an update carries behind its data when it fits
 * more than one processor: a count, a checksum, and for each further processor
 * its signature, platform IDs and checksum (Intel SDM, vol. 3, "Microcode
 * Update").
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/MicrocodeParser.swift#MicrocodeExtendedTable
 */
export interface MicrocodeExtendedTable {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/MicrocodeParser.swift#MicrocodeExtendedTable.offset */
  readonly offset: number;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/MicrocodeParser.swift#MicrocodeExtendedTable.count */
  readonly count: number;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/MicrocodeParser.swift#MicrocodeExtendedTable.checksum */
  readonly checksum: number;
  /**
   * Whether the table's dwords, this checksum included, sum to zero.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/MicrocodeParser.swift#MicrocodeExtendedTable.checksumIsCorrect
   */
  readonly checksumIsCorrect: boolean;
  /**
   * The value the checksum would have to hold; nothing when the table the count
   * declares does not fit in the image.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/MicrocodeParser.swift#MicrocodeExtendedTable.computedChecksum
   */
  readonly computedChecksum: number | undefined;
  /**
   * As many signatures as the count declares and the image has room for.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/MicrocodeParser.swift#MicrocodeExtendedTable.signatures
   */
  readonly signatures: readonly MicrocodeExtendedSignature[];
  /**
   * What the count says the table takes — 20 bytes and 12 per signature.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/MicrocodeParser.swift#MicrocodeExtendedTable.declaredSize
   */
  readonly declaredSize: number;
  /**
   * What the image's total size leaves for the table.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/MicrocodeParser.swift#MicrocodeExtendedTable.availableSize
   */
  readonly availableSize: number;
}

/** @upstream Packages/UEFIImage/Sources/UEFIImage/MicrocodeParser.swift#MicrocodeExtendedTable.Signature */
export interface MicrocodeExtendedSignature {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/MicrocodeParser.swift#MicrocodeExtendedTable.Signature.processorSignature */
  readonly processorSignature: number;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/MicrocodeParser.swift#MicrocodeExtendedTable.Signature.platformIDs */
  readonly platformIDs: number;
  /**
   * The checksum the update would carry with this signature in the header instead.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/MicrocodeParser.swift#MicrocodeExtendedTable.Signature.checksum
   */
  readonly checksum: number;
}

/** @upstream Packages/UEFIImage/Sources/UEFIImage/MicrocodeParser.swift#MicrocodeExtendedTable.headerSize */
const EXTENDED_HEADER_SIZE = 20;
/** @upstream Packages/UEFIImage/Sources/UEFIImage/MicrocodeParser.swift#MicrocodeExtendedTable.entrySize */
const EXTENDED_ENTRY_SIZE = 12;

/**
 * The table between the end of the data and the end of the image; nothing when
 * there is no room for one, or its count is zero — bytes behind the data that
 * list no processor are not a table.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/MicrocodeParser.swift#MicrocodeExtendedTable.read
 */
export function readMicrocodeExtendedTable(
  offset: number,
  end: number,
  reader: ImageReader
): MicrocodeExtendedTable | undefined {
  if (end < offset + EXTENDED_HEADER_SIZE) return undefined;
  const count = reader.uint32(offset);
  const checksum = reader.uint32(offset + 4);
  if (count === undefined || count === 0 || checksum === undefined) return undefined;
  const available = end - offset;
  const declared = EXTENDED_HEADER_SIZE + count * EXTENDED_ENTRY_SIZE;
  const listed = Math.min(
    count,
    Math.floor((available - EXTENDED_HEADER_SIZE) / EXTENDED_ENTRY_SIZE)
  );
  const signatures: MicrocodeExtendedSignature[] = [];
  for (let index = 0; index < listed; index++) {
    const at = offset + EXTENDED_HEADER_SIZE + index * EXTENDED_ENTRY_SIZE;
    const processorSignature = reader.uint32(at);
    const platformIDs = reader.uint32(at + 4);
    const entryChecksum = reader.uint32(at + 8);
    if (
      processorSignature === undefined ||
      platformIDs === undefined ||
      entryChecksum === undefined
    )
      break;
    signatures.push({ processorSignature, platformIDs, checksum: entryChecksum });
  }
  const sum =
    declared <= available ? sum32Of({ start: offset, end: offset + declared }, reader) : undefined;
  return {
    offset,
    count,
    checksum,
    checksumIsCorrect: sum === 0,
    computedChecksum: sum === undefined ? undefined : (checksum - sum) >>> 0,
    signatures,
    declaredSize: declared,
    availableSize: available,
  };
}

/**
 * One row of a microcode header's reading.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/MicrocodeParser.swift#MicrocodeField
 * @upstream Packages/UEFIImage/Sources/UEFIImage/MicrocodeParser.swift#MicrocodeField.init
 */
export interface MicrocodeField {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/MicrocodeParser.swift#MicrocodeField.label */
  readonly label: string;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/MicrocodeParser.swift#MicrocodeField.value */
  readonly value: string;
  /**
   * A value that reads as a problem — a checksum that does not add up.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/MicrocodeParser.swift#MicrocodeField.isProblem
   */
  readonly isProblem: boolean;
}

/**
 * The processor signature the way a CPUID is looked up — `806EA`, bare.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/MicrocodeParser.swift#MicrocodeHeader.cpuid
 */
export function microcodeCpuid(signature: number): string {
  return signature.toString(16).toUpperCase();
}

const hexText = (value: number) => `0x${value.toString(16).toUpperCase()}`;

/**
 * The processor a signature names, the way CPUID leaf 1 is read: the family and
 * model with their extended parts folded in — `0x806EA` is family 0x6, model
 * 0x8E, stepping 0xA.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/MicrocodeParser.swift#MicrocodeHeader.processorText
 */
export function microcodeProcessorText(signature: number): string {
  const stepping = signature & 0xf;
  const model = (signature >>> 4) & 0xf;
  const family = (signature >>> 8) & 0xf;
  const type = (signature >>> 12) & 0x3;
  const extendedModel = (signature >>> 16) & 0xf;
  const extendedFamily = (signature >>> 20) & 0xff;
  const displayFamily = family === 0xf ? family + extendedFamily : family;
  const displayModel = family === 0x6 || family === 0xf ? (extendedModel << 4) | model : model;
  let text = `Family ${hexText(displayFamily)}, model ${hexText(displayModel)}, stepping ${hexText(stepping)}`;
  if (type !== 0) text += `, type ${type}`;
  return text;
}

/**
 * Which platforms an update is for: each set bit of the platform IDs is one
 * value of the processor's `MSR_IA32_PLATFORM_ID` bits 52–50.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/MicrocodeParser.swift#MicrocodeHeader.platformsText
 */
export function microcodePlatformsText(platformIDs: number): string {
  const bits: number[] = [];
  for (let bit = 0; bit < 32; bit++) if ((platformIDs >>> bit) & 1) bits.push(bit);
  return bits.length === 0 ? "None" : bits.join(", ");
}

/**
 * What the header says, row by row — the one reading the FIT panel shows for the
 * microcode an entry points at and the UEFI panel shows for a microcode node, so
 * the two name and spell every field alike. The checksum's verdict can be given
 * by the caller: a panel whose word on checksums is a list of repairs keeps that
 * word here too.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/MicrocodeParser.swift#MicrocodeHeader.fields
 */
export function microcodeFields(
  header: MicrocodeHeader,
  checksumIsCorrect = header.checksumIsCorrect,
  expectedChecksum = header.computedChecksum
): MicrocodeField[] {
  // `0x40 (64)`: hex for the dump, decimal for the mind.
  const size = (value: number) => (value === 0 ? "Empty" : `${hexText(value)} (${value})`);
  const row = (label: string, value: string, isProblem = false) => ({ label, value, isProblem });
  const fields = [
    row("CPUID", microcodeCpuid(header.processorSignature)),
    row("Processor", microcodeProcessorText(header.processorSignature)),
    // "Update revision", so it does not read as the same thing as a FIT entry's
    // own Revision.
    row("Update revision", hexText(header.updateRevision)),
    row("Date", microcodeDate(header)),
    row("Platform IDs", hexText(header.platformIDs)),
    row("Platforms", microcodePlatformsText(header.platformIDs)),
    // Zero is not an empty update: the specification reads it as 2000 bytes, and
    // the row says so rather than "Empty".
    row(
      "Data size",
      header.dataSize === 0
        ? `0 — read as ${size(Microcode.defaultDataSize)}`
        : size(header.dataSize)
    ),
    row("Total size", size(header.totalSize)),
  ];
  if (header.metadataSize !== 0) fields.push(row("Metadata size", size(header.metadataSize)));
  const table = header.extendedTable;
  if (table !== undefined) {
    fields.push(
      row(
        "Extended signatures",
        table.signatures.length === 0
          ? "None"
          : table.signatures.map((one) => microcodeCpuid(one.processorSignature)).join(", ")
      )
    );
    fields.push(
      row(
        "Extended checksum",
        checksumText({
          value: table.checksum,
          valid: table.checksumIsCorrect,
          expected: table.computedChecksum,
          digits: 8,
        }),
        !table.checksumIsCorrect
      )
    );
    if (table.declaredSize !== table.availableSize) {
      fields.push(
        row(
          "Extended table",
          `${table.count} signatures take ${size(table.declaredSize)}, ` +
            `the image leaves ${size(table.availableSize)}`,
          true
        )
      );
    }
  }
  // The image's dword checksum, distinct from a FIT header's checksum byte:
  // whether the image sums to zero, and what the dword should be when it does
  // not.
  fields.push(
    row(
      "Image checksum",
      checksumText({
        value: header.checksum,
        valid: checksumIsCorrect,
        expected: expectedChecksum,
        digits: 8,
      }),
      !checksumIsCorrect
    )
  );
  return fields;
}

/**
 * Reads a header and puts it through every check. Nothing means these bytes are
 * not microcode — which is the usual answer, since the dword this starts with
 * is `0x00000001`.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/MicrocodeParser.swift#MicrocodeHeader.read
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
  const data = dataSize === 0 ? Microcode.defaultDataSize : dataSize;

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
    metadataSize: reader.uint32(offset + 0x24) ?? 0,
    extendedTable: readMicrocodeExtendedTable(
      offset + Microcode.headerSize + data,
      offset + totalSize,
      reader
    ),
  };
}

/**
 * Header and data together, as `TotalSize` gives it.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/MicrocodeParser.swift#MicrocodeHeader.range
 */
export function microcodeRange(header: MicrocodeHeader): ImageRange {
  return { start: header.offset, end: header.offset + header.totalSize };
}

/**
 * `2019-07-15`, unpacked from the BCD. The fields are already known to be valid
 * BCD, or this header would not exist.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/MicrocodeParser.swift#MicrocodeHeader.date
 */
export function microcodeDate(header: MicrocodeHeader): string {
  const pad = (value: number, width: number) =>
    value.toString(16).toUpperCase().padStart(width, "0");
  return `${pad(header.year, 4)}-${pad(header.month, 2)}-${pad(header.day, 2)}`;
}

/**
 * One microcode image. Nothing when the header does not check out, which leaves
 * no diagnostic — `0x00000001` appears everywhere.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/MicrocodeParser.swift#Parser.parseMicrocode
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

  const bare = (value: number) => value.toString(16).toUpperCase();
  return makeNode({
    kind: "microcode",
    name: `Microcode ${bare(header.processorSignature)}, revision ${bare(header.updateRevision)}`,
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
