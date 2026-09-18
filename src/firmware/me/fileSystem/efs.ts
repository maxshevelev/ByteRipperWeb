import { crc32, crc32FromZero } from "@/firmware/me/crypto/checksum";
import type { EfsTableEntry } from "@/firmware/me/data/fileTable";
import { integrityTable, secHeaderSize } from "@/firmware/me/fileSystem/mfs";
import type {
  EFSFile,
  EFSVolume,
  MFSIntegrityTable,
  OEMConfiguration,
} from "@/firmware/me/models/fileSystemFacts";

/**
 * The EFS volume and the FITC OEM Configuration partition — upstream `efs_anl`
 * and `fitc_anl` — as raw `$FPT` partitions of the newer whole-flash layout.
 *
 * `parseEfs` is what the bytes say on their own: the page inventory, the System
 * page fields, the index permutation and the CRCs of the page headers, index
 * areas and Data page footers; and the FITC header, lengths and checksums. The
 * file walk that follows it (`efsDataArea` + `efsFiles`) needs the external
 * `FileTable.dat`: an EFS volume's pages are one flat byte area, and the
 * offsets that cut it into files are the EFST records, with the Integrity flag
 * that decides each file's end coming from the FTBL rows beside them — which is
 * why upstream calls that read necessary and not optional (MEA.py 8846).
 * Reading the FITC records stays a parked increment.
 *
 * Ported from `Packages/MEFirmware/FileSystem/EFS.swift`.
 */

/**
 * @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/EFS.swift#EFSParser
 * @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/EFS.swift#EFSParser.pageSize
 */
const PAGE_SIZE = 0x1000;
/** @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/EFS.swift#EFSParser.pageHeaderSize */
const PAGE_HEADER_SIZE = 0x10;
/** @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/EFS.swift#EFSParser.crcLength */
const CRC_LENGTH = 0x04;
/** @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/EFS.swift#EFSParser.indexPaddingLength */
const INDEX_PADDING_LENGTH = 0x08;
/**
 * @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/EFS.swift#FITCParser
 * @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/EFS.swift#FITCParser.headerSize
 */
const FITC_HEADER_SIZE = 0x10;
/** @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/EFS.swift#EFSParser.metadataSize */
const METADATA_SIZE = 0x04;
/** @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/EFS.swift#EFSParser.pageFooterSize */
const PAGE_FOOTER_SIZE = 0x08;

const u16 = (bytes: Uint8Array, at: number): number | undefined =>
  at >= 0 && at + 2 <= bytes.length
    ? ((bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8)) >>> 0
    : undefined;

const u32 = (bytes: Uint8Array, at: number): number | undefined =>
  at >= 0 && at + 4 <= bytes.length
    ? ((bytes[at] ?? 0) |
        ((bytes[at + 1] ?? 0) << 8) |
        ((bytes[at + 2] ?? 0) << 16) |
        ((bytes[at + 3] ?? 0) << 24)) >>>
      0
    : undefined;

const allErased = (bytes: Uint8Array): boolean => bytes.every((byte) => byte === 0xff);

/**
 * The EFS volume in `bytes[offset, offset + size)`. Nothing when it does not open
 * with a System page — a Dictionary that is neither 0x0000 nor 0xFFFF, which is
 * what upstream's fixed format pattern amounts to.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/EFS.swift#EFSParser.parse
 */
export function parseEfs(
  bytes: Uint8Array,
  offset: number,
  size: number,
  absoluteOffset: number,
  mfsDictionary: number | undefined
): EFSVolume | undefined {
  if (offset < 0 || size < PAGE_SIZE || offset + size > bytes.length) return undefined;
  const buffer = bytes.subarray(offset, offset + size);
  const pageCount = Math.floor(buffer.length / PAGE_SIZE);
  if (pageCount < 1) return undefined;
  const firstDictionary = u16(buffer, 0x02);
  if (firstDictionary === undefined || firstDictionary === 0x0000 || firstDictionary === 0xffff) {
    return undefined;
  }

  // System pages carry a Dictionary; Data pages a Dictionary of 0 or 0xFFFF with a
  // written Unknown0; everything else is a Scratch page, which must be erased.
  const systemPages: number[] = [];
  const dataPages: number[] = [];
  let scratchPageCount = 0;
  let scratchPagesEmpty = true;
  for (let page = 0; page < pageCount; page++) {
    const base = page * PAGE_SIZE;
    const dictionary = u16(buffer, base + 0x02) ?? 0;
    const unknown0 = u16(buffer, base) ?? 0xffff;
    if (dictionary !== 0x0000 && dictionary !== 0xffff) {
      systemPages.push(base);
    } else if (unknown0 !== 0xffff) {
      dataPages.push(base);
    } else {
      if (!allErased(buffer.subarray(base, base + PAGE_SIZE))) scratchPagesEmpty = false;
      scratchPageCount++;
    }
  }

  const system = systemPages[0] ?? 0;
  const dictionary = u16(buffer, system + 0x02) ?? 0;
  const revision = u32(buffer, system + 0x04) ?? 0;
  const unknown1 = buffer[system + 0x08] ?? 0;
  const dataPagesCommitted = buffer[system + 0x09] ?? 0;
  const dataPagesReserved = buffer[system + 0x0a] ?? 0;
  const dictionaryRevision = buffer[system + 0x0b] ?? 0;
  const systemHeaderCRCValid =
    crc32FromZero(buffer.subarray(system, system + 0x0c)) === (u32(buffer, system + 0x0c) ?? 0);

  // Each index area on the System page is [one byte per Data page][8 zero
  // padding][CRC].
  const sysDataCount = dataPagesCommitted + dataPagesReserved;
  const indexAreaSize = sysDataCount + INDEX_PADDING_LENGTH + CRC_LENGTH;
  const firstPaddingStart = PAGE_HEADER_SIZE + sysDataCount;
  const firstIndexPaddingEmpty =
    firstPaddingStart + INDEX_PADDING_LENGTH <= PAGE_SIZE &&
    buffer
      .subarray(system + firstPaddingStart, system + firstPaddingStart + INDEX_PADDING_LENGTH)
      .every((byte) => byte === 0x00);

  // The current index area is the last one written: it sits just before the
  // page's first run of free space big enough for one more.
  let indexOffset = -1;
  if (indexAreaSize <= PAGE_SIZE - PAGE_HEADER_SIZE) {
    for (let probe = PAGE_HEADER_SIZE; probe <= PAGE_SIZE - indexAreaSize; probe++) {
      if (allErased(buffer.subarray(system + probe, system + probe + indexAreaSize))) {
        indexOffset = probe - indexAreaSize;
        break;
      }
    }
  }

  const dataPageOrder: number[] = [];
  let indexesCRCValid = false;
  if (indexOffset >= 0) {
    let valid = true;
    for (let index = 0; index < sysDataCount; index++) {
      if (indexOffset + index >= buffer.length - system) {
        valid = false;
        break;
      }
      dataPageOrder.push(buffer[system + indexOffset + index] ?? 0);
    }
    if (valid) {
      const start = system + indexOffset;
      const end = start + sysDataCount + INDEX_PADDING_LENGTH;
      indexesCRCValid = crc32FromZero(buffer.subarray(start, end)) === (u32(buffer, end) ?? 0);
    }
  }

  // Data page CRCs, in index order. A reserved page — its body erased and its
  // footer CRC erased too — has no footer to check.
  let dataPageHeaderCRCsValid = true;
  let dataPageFooterCRCsValid = true;
  const orderValid =
    dataPageOrder.length === dataPages.length &&
    dataPageOrder.every((value) => value < dataPages.length);
  if (orderValid) {
    for (const value of dataPageOrder) {
      const base = dataPages[value] ?? 0;
      if (crc32FromZero(buffer.subarray(base, base + 0x0c)) !== (u32(buffer, base + 0x0c) ?? 0)) {
        dataPageHeaderCRCsValid = false;
      }
      const body = buffer.subarray(base + PAGE_HEADER_SIZE, base + PAGE_SIZE - CRC_LENGTH);
      const footer = u32(buffer, base + PAGE_SIZE - CRC_LENGTH) ?? 0;
      const skip = allErased(body) && footer === 0xffff_ffff;
      if (!skip && crc32FromZero(body) !== footer) dataPageFooterCRCsValid = false;
    }
  } else {
    dataPageHeaderCRCsValid = dataPages.length === 0;
    dataPageFooterCRCsValid = dataPages.length === 0;
  }

  return {
    offset: absoluteOffset,
    pageSize: PAGE_SIZE,
    systemPageCount: systemPages.length,
    dataPageCount: dataPages.length,
    scratchPageCount,
    scratchPagesEmpty,
    dataPageCountMatchesSystem: dataPages.length === sysDataCount,
    dictionary,
    revision,
    unknown1,
    dictionaryRevision,
    dataPagesCommitted,
    dataPagesReserved,
    systemHeaderCRCValid,
    indexesCRCValid,
    firstIndexPaddingEmpty,
    dataPageOrder,
    dataPageHeaderCRCsValid,
    dataPageFooterCRCsValid,
    matchesMFSDictionary: mfsDictionary === undefined ? undefined : dictionary === mfsDictionary,
  };
}

// MARK: - The file walk (upstream 8745–8850, `-unp86` only)

/**
 * The volume's data area: its Data pages in System-index order, each
 * contributing the bytes between its 0x10 header and its 0x8 footer (upstream
 * `efs_data_all`). This is the buffer the EFS table's offsets are offsets into
 * — the volume has no other notion of a file position.
 *
 * Empty when `order` is not a permutation of the volume's Data pages: the index
 * area is what says which physical page is the logical first, and without a
 * usable one there is no data area to speak of.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/EFS.swift#EFSParser.dataArea
 */
export function efsDataArea(
  bytes: Uint8Array,
  offset: number,
  size: number,
  order: readonly number[]
): Uint8Array {
  if (offset < 0 || size < PAGE_SIZE || offset + size > bytes.length) return new Uint8Array(0);
  const buffer = bytes.subarray(offset, offset + size);
  const bases = dataPageBases(buffer);
  if (
    order.length !== bases.length ||
    !order.every((value) => value < bases.length) ||
    new Set(order).size !== order.length
  ) {
    return new Uint8Array(0);
  }
  const pageBytes = PAGE_SIZE - PAGE_HEADER_SIZE - PAGE_FOOTER_SIZE;
  const area = new Uint8Array(bases.length * pageBytes);
  let at = 0;
  for (const value of order) {
    const base = bases[value] ?? 0;
    area.set(buffer.subarray(base + PAGE_HEADER_SIZE, base + PAGE_SIZE - PAGE_FOOTER_SIZE), at);
    at += pageBytes;
  }
  return area;
}

/**
 * The physical bases of the volume's Data pages, in page order — the same
 * classification `parseEfs` makes: a Data page carries a Dictionary of
 * 0x0000/0xFFFF and a written Unknown0.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/EFS.swift#EFSParser.dataPageBases
 */
function dataPageBases(buffer: Uint8Array): number[] {
  const bases: number[] = [];
  for (let page = 0; page < Math.floor(buffer.length / PAGE_SIZE); page++) {
    const base = page * PAGE_SIZE;
    const dictionary = u16(buffer, base + 0x02) ?? 0;
    const unknown0 = u16(buffer, base + 0x00) ?? 0xffff;
    if ((dictionary === 0x0000 || dictionary === 0xffff) && unknown0 !== 0xffff) bases.push(base);
  }
  return bases;
}

/**
 * The volume's files: one per EFS table entry that the data area actually
 * carries, in the order they sit there.
 *
 * Each entry gives an offset; the four bytes there are the file's own metadata,
 * and its `Size` — preferred over the table's length, as upstream prefers it —
 * is how much follows. `integrityFileIds` are the files the FTBL rows flag as
 * Integrity-protected: their content ends with an `MFS_Integrity_Table`, and
 * nothing in the EFS bytes says so, which is why the flags are an argument.
 *
 * Skipped, exactly as upstream skips them: an entry the data area is too small
 * to hold, a metadata `Size` of 0xFFFF (a file never written), and a file whose
 * metadata claims more bytes than the table allotted it — the table is then the
 * wrong one for this volume, and cutting the area at its offsets would name
 * bytes that belong to something else.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/EFS.swift#EFSParser.files
 */
export function efsFiles(options: {
  readonly dataArea: Uint8Array;
  readonly entries: readonly EfsTableEntry[];
  readonly integrityFileIds: ReadonlySet<number>;
  readonly variant: string;
  readonly major: number;
  readonly minor: number;
  readonly platform: number;
}): EFSFile[] {
  const { dataArea, entries, integrityFileIds, variant, major, minor, platform } = options;
  const sec = secHeaderSize(variant, major, minor, platform);
  const result: EFSFile[] = [];
  for (const entry of [...entries].sort((one, other) => one.dataOffset - other.dataOffset)) {
    const start = entry.dataOffset;
    if (start < 0 || start + METADATA_SIZE > dataArea.length) continue;
    const storedSize = u16(dataArea, start);
    const unknown = u16(dataArea, start + 0x02);
    if (storedSize === undefined || unknown === undefined || storedSize === 0xffff) continue;
    if (storedSize > entry.size || start + METADATA_SIZE + storedSize > dataArea.length) continue;
    const content = dataArea.subarray(start + METADATA_SIZE, start + METADATA_SIZE + storedSize);

    let contentSize = storedSize;
    let integrity: MFSIntegrityTable | undefined;
    if (integrityFileIds.has(entry.fileId)) {
      let tableSize = sec;
      if (content.length >= sec) {
        let table = integrityTable(content.subarray(content.length - sec));
        if (
          sec === 0x28 &&
          table !== undefined &&
          table.arCounter > 0xffff &&
          content.length >= 0x38
        ) {
          const wider = integrityTable(
            content.subarray(content.length - 0x38, content.length - 0x10)
          );
          if (wider !== undefined) {
            // The same workaround the MFS split needs: the table sits 0x10
            // earlier than it looked, and the extra bytes are part of what the
            // file ends with.
            tableSize = 0x38;
            table = wider;
          }
        }
        integrity = table;
      }
      contentSize = Math.max(0, storedSize - tableSize);
    }
    result.push({
      fileId: entry.fileId,
      dataOffset: start,
      storedSize,
      metadataUnknown: unknown,
      contentSize,
      ...(integrity === undefined ? {} : { integrity }),
    });
  }
  return result;
}

/**
 * The FITC partition's header. Revision 1 carries two plain CRC-32s — the
 * header's own, over its first twelve bytes with the checksum word zeroed, and
 * the data's. Any other revision (the CSME 15 TGP alpha layout) carries none: the
 * configuration length is the first word, and the tail past it must be erased.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/EFS.swift#FITCParser.parse
 */
export function parseFitc(
  bytes: Uint8Array,
  offset: number,
  size: number,
  absoluteOffset: number
): OEMConfiguration | undefined {
  if (offset < 0 || size < FITC_HEADER_SIZE || offset + size > bytes.length) return undefined;
  const buffer = bytes.subarray(offset, offset + size);
  const headerRevision = u32(buffer, 0x00) ?? 0;

  let dataLength: number | undefined;
  let headerCRCStored: number | undefined;
  let headerCRCValid: boolean | undefined;
  let dataCRCStored: number | undefined;
  let dataCRCValid: boolean | undefined;
  let configLength: number | undefined;
  let paddingAllFF: boolean | undefined;

  if (headerRevision === 1) {
    dataLength = u32(buffer, 0x08) ?? 0;
    headerCRCStored = u32(buffer, 0x04);
    const span = new Uint8Array(0x0c);
    span.set(buffer.subarray(0x00, 0x04));
    span.set(buffer.subarray(0x08, 0x0c), 0x08);
    if (headerCRCStored !== undefined) headerCRCValid = crc32(span) === headerCRCStored;
    if (FITC_HEADER_SIZE + dataLength <= buffer.length) {
      dataCRCStored = u32(buffer, 0x0c);
      const payload = buffer.subarray(FITC_HEADER_SIZE, FITC_HEADER_SIZE + dataLength);
      if (dataCRCStored !== undefined) dataCRCValid = crc32(payload) === dataCRCStored;
    }
  } else {
    configLength = u32(buffer, 0x00) ?? 0;
    if (0x04 + configLength <= buffer.length) {
      paddingAllFF = allErased(buffer.subarray(0x04 + configLength));
    }
  }
  return {
    offset: absoluteOffset,
    headerRevision,
    dataLength,
    headerCRCStored,
    headerCRCValid,
    dataCRCStored,
    dataCRCValid,
    configLength,
    paddingAllFF,
  };
}
