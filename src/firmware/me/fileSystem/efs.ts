import { crc32, crc32FromZero } from "@/firmware/me/crypto/checksum";
import type { EFSVolume, OEMConfiguration } from "@/firmware/me/models/fileSystemFacts";

/**
 * The EFS volume and the FITC OEM Configuration partition — upstream `efs_anl`
 * and `fitc_anl` — as raw `$FPT` partitions of the newer whole-flash layout.
 *
 * Only what the bytes say on their own: the page inventory, the System page
 * fields, the index permutation and the CRCs of the page headers, index areas
 * and Data page footers; and the FITC header, lengths and checksums. Naming the
 * EFS files and reading the FITC records needs `FileTable.dat`.
 *
 * Ported from `Packages/MEFirmware/FileSystem/EFS.swift`.
 */

const PAGE_SIZE = 0x1000;
const PAGE_HEADER_SIZE = 0x10;
const CRC_LENGTH = 0x04;
const INDEX_PADDING_LENGTH = 0x08;
const FITC_HEADER_SIZE = 0x10;

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

/**
 * The FITC partition's header. Revision 1 carries two plain CRC-32s — the
 * header's own, over its first twelve bytes with the checksum word zeroed, and
 * the data's. Any other revision (the CSME 15 TGP alpha layout) carries none: the
 * configuration length is the first word, and the tail past it must be erased.
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
