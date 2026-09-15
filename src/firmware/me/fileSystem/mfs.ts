import { crc16_14 } from "@/firmware/me/crypto/checksum";
import type {
  MFSHomeDirectory,
  MFSHomeRecord,
  MFSIntegrityTable,
  MFSReservedFileIntegrity,
} from "@/firmware/me/models/fileSystemFacts";
import type { MFSState } from "@/firmware/me/models/firmwareFacts";

/**
 * The CSE MFS file system — upstream `mfs_anl`: the page inventory, the System
 * area's chunk assembly with its CRC-16/14 de-obfuscation, the volume header and
 * FAT, and the low-level file walk that follows them.
 *
 * An MFS volume is 0x2000-byte pages, each opening with a page header tagged
 * `87 78 55 AA`. Pages whose first chunk index is 0 are System pages, the rest
 * Data pages; their 0x40-byte chunks (plus a CRC-16 each) are scattered for wear
 * levelling, and the System pages' chunk indexes are stored obfuscated. The
 * logical volume header is assembled System chunk 0.
 *
 * The FAT is two runs of u16 over the assembled System area: the first
 * `fileRecordCount` are the file records (0x0000 unused, 0xFFFE erased, 0xFFFF
 * used but empty), each holding its file's first data slot; the rest chain slot
 * to slot until a value 1…0x40 marks the end and says how much of the last chunk
 * is used. Data slot `f` is chunk `systemChunkCount + f − fileRecordCount`.
 *
 * Ported from `Packages/MEFirmware/FileSystem/MFS.swift`.
 */

/**
 * @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/MFS.swift#MFSParser
 * @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/MFS.swift#MFSParser.pageSize
 * @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/MFSBackup.swift#MFSBackupDecoder.pageSize
 * @upstream-differs the backup reuses the MFS page size rather than naming its own
 */
export const MFS_PAGE_SIZE = 0x2000;
/** @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/MFS.swift#MFSParser.pageHeaderSize */
const PAGE_HEADER_SIZE = 0x12;
/** @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/MFS.swift#MFSParser.chunkAllSize */
const CHUNK_ALL_SIZE = 0x42;
/** @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/MFS.swift#MFSParser.chunkRawSize */
const CHUNK_RAW_SIZE = 0x40;
/** @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/MFS.swift#MFSParser.systemIndexSize */
const SYSTEM_INDEX_SIZE = 2;
/** @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/MFS.swift#MFSParser.dataIndexSize */
const DATA_INDEX_SIZE = 1;
/** @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/MFS.swift#MFSParser.volumeHeaderSize */
const VOLUME_HEADER_SIZE = 0xe;
/** @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/MFS.swift#MFSParser.pageTag */
const PAGE_TAG = 0xaa55_7887;
/** @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/MFS.swift#MFSParser.volumeTag */
const VOLUME_TAG = 0x724f_6201;

/**
 * One present low-level file: the raw bytes of its FAT chain.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/MFS.swift#MFSLowLevelFile
 */
export interface MFSLowLevelFile {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/MFS.swift#MFSLowLevelFile.index */
  readonly index: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/MFS.swift#MFSLowLevelFile.content */
  readonly content: Uint8Array;
}

/**
 * One decoded `MFS_Config_Record_0x1C`.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/MFS.swift#MFSRawConfigRecord
 */
export interface MFSRawConfigRecord {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/MFS.swift#MFSRawConfigRecord.name */
  readonly name: string;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/MFS.swift#MFSRawConfigRecord.isFolder */
  readonly isFolder: boolean;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/MFS.swift#MFSRawConfigRecord.size */
  readonly size: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/MFS.swift#MFSRawConfigRecord.offset */
  readonly offset: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/MFS.swift#MFSRawConfigRecord.unixRights */
  readonly unixRights: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/MFS.swift#MFSRawConfigRecord.integrity */
  readonly integrity: boolean;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/MFS.swift#MFSRawConfigRecord.encryption */
  readonly encryption: boolean;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/MFS.swift#MFSRawConfigRecord.antiReplay */
  readonly antiReplay: boolean;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/MFS.swift#MFSRawConfigRecord.oemConfigurable */
  readonly oemConfigurable: boolean;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/MFS.swift#MFSRawConfigRecord.mcaConfigurable */
  readonly mcaConfigurable: boolean;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/MFS.swift#MFSRawConfigRecord.reserved */
  readonly reserved: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/MFS.swift#MFSRawConfigRecord.ownerUserID */
  readonly ownerUserID: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/MFS.swift#MFSRawConfigRecord.ownerGroupID */
  readonly ownerGroupID: number;
}

/**
 * A legacy configuration stream: file 6 (Intel) or 7 (OEM).
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/MFS.swift#MFSConfigDecode
 */
export interface MFSConfigDecode {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/MFS.swift#MFSConfigDecode.owningFile */
  readonly owningFile: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/MFS.swift#MFSConfigDecode.records */
  readonly records: readonly MFSRawConfigRecord[];
}

/** @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/MFS.swift#MFSVolumeInfo */
export interface MFSVolumeInfo {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/MFS.swift#MFSVolumeInfo.pageSize */
  readonly pageSize: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/MFS.swift#MFSVolumeInfo.systemPageCount */
  readonly systemPageCount: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/MFS.swift#MFSVolumeInfo.dataPageCount */
  readonly dataPageCount: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/MFS.swift#MFSVolumeInfo.volumeSignatureValid */
  readonly volumeSignatureValid: boolean;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/MFS.swift#MFSVolumeInfo.volumeSize */
  readonly volumeSize: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/MFS.swift#MFSVolumeInfo.computedVolumeSize */
  readonly computedVolumeSize: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/MFS.swift#MFSVolumeInfo.fileRecordCount */
  readonly fileRecordCount: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/MFS.swift#MFSVolumeInfo.usedFileCount */
  readonly usedFileCount: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/MFS.swift#MFSVolumeInfo.ftblDictionary */
  readonly ftblDictionary: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/MFS.swift#MFSVolumeInfo.ftblPlatform */
  readonly ftblPlatform: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/MFS.swift#MFSVolumeInfo.ftblReserved */
  readonly ftblReserved: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/MFS.swift#MFSVolumeInfo.usesFTBL */
  readonly usesFTBL: boolean;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/MFS.swift#MFSVolumeInfo.files */
  readonly files: readonly MFSLowLevelFile[];
  /**
   * Every used chain reached a clean end marker.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/MFS.swift#MFSVolumeInfo.fileChainsIntact
   */
  readonly fileChainsIntact: boolean;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/MFS.swift#MFSVolumeInfo.configurations */
  readonly configurations: readonly MFSConfigDecode[];
}

const le16 = (bytes: Uint8Array, at: number): number =>
  at >= 0 && at + 2 <= bytes.length ? ((bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8)) >>> 0 : 0;

const le32 = (bytes: Uint8Array, at: number): number =>
  at >= 0 && at + 4 <= bytes.length
    ? ((bytes[at] ?? 0) |
        ((bytes[at + 1] ?? 0) << 8) |
        ((bytes[at + 2] ?? 0) << 16) |
        ((bytes[at + 3] ?? 0) << 24)) >>>
      0
    : 0;

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, one) => sum + one.length, 0));
  let at = 0;
  for (const one of parts) {
    out.set(one, at);
    at += one.length;
  }
  return out;
}

/**
 * The volume in `bytes[offset, offset + size)`. Nothing when the area carries no
 * MFS pages at all; a volume whose System chunk 0 is not a volume header comes
 * back with `volumeSignatureValid` false rather than failing.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/MFS.swift#MFSParser.parse
 */
export function parseMfs(
  bytes: Uint8Array,
  offset: number,
  size: number
): MFSVolumeInfo | undefined {
  if (offset < 0 || size < MFS_PAGE_SIZE || offset + size > bytes.length) return undefined;
  const buffer = bytes.subarray(offset, offset + size);
  const pageCount = Math.floor(buffer.length / MFS_PAGE_SIZE);
  if (pageCount < 1) return undefined;

  // The page inventory: System pages by their logical number, Data pages by
  // their first chunk index. Other tags are Scratch pages.
  const systemPages: { page: number; number: number }[] = [];
  const dataPages: { page: number; firstChunk: number }[] = [];
  let systemChunkCountTarget = 0xffff;
  for (let page = 0; page < pageCount; page++) {
    const base = page * MFS_PAGE_SIZE;
    if (le32(buffer, base) !== PAGE_TAG) continue;
    const firstChunk = le16(buffer, base + 0x0e);
    const pageNumber = le32(buffer, base + 0x04);
    if (firstChunk === 0) {
      systemPages.push({ page, number: pageNumber });
    } else {
      dataPages.push({ page, firstChunk });
      systemChunkCountTarget = Math.min(systemChunkCountTarget, firstChunk);
    }
  }
  if (systemPages.length === 0 && dataPages.length === 0) return undefined;
  systemPages.sort((one, two) => one.number - two.number);
  dataPages.sort((one, two) => one.firstChunk - two.firstChunk);

  // The System chunks. Indexes are de-obfuscated per page, the running value
  // starting again on each.
  const systemChunkCount = Math.floor(
    (MFS_PAGE_SIZE - PAGE_HEADER_SIZE - SYSTEM_INDEX_SIZE) / (SYSTEM_INDEX_SIZE + CHUNK_ALL_SIZE)
  );
  const systemIndexSizeTotal = systemChunkCount * SYSTEM_INDEX_SIZE + SYSTEM_INDEX_SIZE;
  const chunks = new Map<number, Uint8Array>();
  for (const { page } of systemPages) {
    const base = page * MFS_PAGE_SIZE;
    let running = 0;
    const used: number[] = [];
    for (let index = 0; index <= systemChunkCount; index++) {
      const value = le16(buffer, base + PAGE_HEADER_SIZE + index * SYSTEM_INDEX_SIZE);
      if ((value & 0xc000) !== 0) break;
      running = (crc16_14(running) ^ value) & 0xffff;
      used.push(running);
    }
    const chunkStart = PAGE_HEADER_SIZE + systemIndexSizeTotal;
    for (const [slot, index] of used.entries()) {
      const at = base + chunkStart + slot * CHUNK_ALL_SIZE;
      if (at + CHUNK_RAW_SIZE > base + MFS_PAGE_SIZE) break;
      chunks.set(index, buffer.subarray(at, at + CHUNK_RAW_SIZE));
    }
  }

  // The Data chunks: a one-byte index per slot, 0x00 used and 0xFF unused.
  const dataChunkCount = Math.floor(
    (MFS_PAGE_SIZE - PAGE_HEADER_SIZE) / (DATA_INDEX_SIZE + CHUNK_ALL_SIZE)
  );
  const dataIndexSizeTotal = dataChunkCount * DATA_INDEX_SIZE;
  for (const { page, firstChunk } of dataPages) {
    const base = page * MFS_PAGE_SIZE;
    const chunkStart = PAGE_HEADER_SIZE + dataIndexSizeTotal;
    for (let slot = 0; slot < dataChunkCount; slot++) {
      if (buffer[base + PAGE_HEADER_SIZE + slot] !== 0) continue;
      const at = base + chunkStart + slot * CHUNK_ALL_SIZE;
      if (at + CHUNK_RAW_SIZE > base + MFS_PAGE_SIZE) break;
      chunks.set(firstChunk + slot, buffer.subarray(at, at + CHUNK_RAW_SIZE));
    }
  }

  // The logical System area is chunks 0…systemChunkCount laid end to end, the
  // volume header being chunk 0.
  const maxDataChunks = dataPages.length * dataChunkCount;
  let effectiveSystemChunkCount = systemChunkCountTarget;
  if (effectiveSystemChunkCount === 0xffff) {
    effectiveSystemChunkCount = (chunks.size === 0 ? -1 : Math.max(...chunks.keys())) + 1;
  }
  const systemAreaSize = effectiveSystemChunkCount * CHUNK_RAW_SIZE;
  const readArea = (areaOffset: number) => readSystemAreaU16(chunks, areaOffset);

  const info = {
    pageSize: MFS_PAGE_SIZE,
    systemPageCount: systemPages.length,
    dataPageCount: dataPages.length,
    volumeSignatureValid: false,
    volumeSize: 0,
    computedVolumeSize: systemAreaSize + maxDataChunks * CHUNK_RAW_SIZE,
    fileRecordCount: 0,
    usedFileCount: 0,
    ftblDictionary: 0,
    ftblPlatform: 0,
    ftblReserved: 0,
    usesFTBL: false,
    files: [] as MFSLowLevelFile[],
    fileChainsIntact: true,
    configurations: [] as MFSConfigDecode[],
  };

  const volume = chunks.get(0);
  if (volume === undefined || volume.length < VOLUME_HEADER_SIZE) return info;
  info.volumeSignatureValid = le32(volume, 0) === VOLUME_TAG;
  if (!info.volumeSignatureValid) return info;

  info.ftblDictionary = volume[4] ?? 0;
  info.ftblPlatform = volume[5] ?? 0;
  info.ftblReserved = le16(volume, 6);
  info.usesFTBL = !(
    info.ftblDictionary === 1 &&
    info.ftblPlatform === 0 &&
    info.ftblReserved === 0
  );
  info.volumeSize = le32(volume, 8);
  info.fileRecordCount = le16(volume, 12);

  if (info.fileRecordCount > 0 && VOLUME_HEADER_SIZE + info.fileRecordCount * 2 <= systemAreaSize) {
    let used = 0;
    for (let record = 0; record < info.fileRecordCount; record++) {
      const value = readArea(VOLUME_HEADER_SIZE + record * 2);
      if (value !== 0x0000 && value !== 0xfffe && value !== 0xffff) used++;
    }
    info.usedFileCount = used;
  }

  // The low-level file walk. A chain that runs out of the FAT or the chunk area
  // ends with what it has and clears `fileChainsIntact`, as upstream errors and
  // carries on.
  if (info.fileRecordCount > 0) {
    const dataPageEstimate = Math.max(0, pageCount - Math.floor(pageCount / 12) - 1);
    const reachableChunks = dataPageEstimate * dataChunkCount;
    const fatValue = (slot: number) => {
      if (slot < 0) return 0;
      const areaOffset = VOLUME_HEADER_SIZE + slot * 2;
      return areaOffset + 2 > systemAreaSize ? 0 : readArea(areaOffset);
    };
    let intact = true;
    for (let record = 0; record < info.fileRecordCount; record++) {
      let value = fatValue(record);
      if (value === 0x0000 || value === 0xfffe || value === 0xffff) continue;
      const body: Uint8Array[] = [];
      let steps = 0;
      for (;;) {
        // A chain can never visit more distinct chunks than exist: a cyclic FAT
        // would spin on upstream, and this must not.
        steps++;
        if (steps > reachableChunks + 1 || value < info.fileRecordCount) {
          intact = false;
          break;
        }
        const dataSlot = value - info.fileRecordCount;
        if (dataSlot < 0 || dataSlot >= reachableChunks) {
          intact = false;
          break;
        }
        const chunk = chunks.get(effectiveSystemChunkCount + dataSlot);
        if (chunk === undefined) {
          intact = false;
          break;
        }
        value = fatValue(value);
        if (value >= 1 && value <= CHUNK_RAW_SIZE) {
          body.push(chunk.subarray(0, value));
          break;
        }
        body.push(chunk);
      }
      info.files.push({ index: record, content: concat(body) });
    }
    info.fileChainsIntact = intact;
  }

  // Only the legacy layout lays files 6 and 7 out as `MFS_Config_Record_0x1C`
  // streams; a file-table volume names them through FileTable.dat.
  if (!info.usesFTBL) {
    for (const owner of [6, 7]) {
      const file = info.files.find((one) => one.index === owner);
      if (file === undefined || file.content.length === 0) continue;
      const records = decodeConfigRecords(file.content);
      if (records !== undefined) info.configurations.push({ owningFile: owner, records });
    }
  }
  return info;
}

/**
 * A legacy configuration stream: a u32 count, then that many 0x1C records. A
 * stream shorter than its count decodes the records that fit.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/MFS.swift#MFSParser.decodeConfigRecords
 */
export function decodeConfigRecords(content: Uint8Array): MFSRawConfigRecord[] | undefined {
  if (content.length < 4) return undefined;
  const count = le32(content, 0);
  const records: MFSRawConfigRecord[] = [];
  for (let index = 0; index < count; index++) {
    const base = 4 + index * 0x1c;
    if (base + 0x1c > content.length) break;
    const accessMode = le16(content, base + 0x0e);
    const deployOptions = le16(content, base + 0x10);
    records.push({
      name: nulTruncated(content.subarray(base, base + 12)),
      isFolder: (accessMode & (1 << 12)) !== 0,
      size: le16(content, base + 0x12),
      offset: le32(content, base + 0x18),
      unixRights: accessMode & 0x1ff,
      integrity: (accessMode & (1 << 9)) !== 0,
      encryption: (accessMode & (1 << 10)) !== 0,
      antiReplay: (accessMode & (1 << 11)) !== 0,
      oemConfigurable: (deployOptions & 1) !== 0,
      mcaConfigurable: (deployOptions & (1 << 1)) !== 0,
      reserved: le16(content, base + 0x0c),
      ownerUserID: le16(content, base + 0x14),
      ownerGroupID: le16(content, base + 0x16),
    });
  }
  return records;
}

function readSystemAreaU16(chunks: ReadonlyMap<number, Uint8Array>, areaOffset: number): number {
  let value = 0;
  for (let byteSlot = 0; byteSlot < 2; byteSlot++) {
    const at = areaOffset + byteSlot;
    const chunk = chunks.get(Math.floor(at / CHUNK_RAW_SIZE));
    const inChunk = at % CHUNK_RAW_SIZE;
    const byte = chunk !== undefined && inChunk < chunk.length ? (chunk[inChunk] ?? 0) : 0;
    value |= byte << (8 * byteSlot);
  }
  return value;
}

function nulTruncated(bytes: Uint8Array): string {
  const end = bytes.indexOf(0);
  return utf8Lossy(end < 0 ? bytes : bytes.subarray(0, end));
}

/**
 * UTF-8, with every malformed sequence read as U+FFFD — upstream's
 * `String(decoding:as:)`. Here rather than `TextDecoder` because the domain half
 * runs where the platform's text codecs are not assumed.
 */
function utf8Lossy(bytes: Uint8Array): string {
  let text = "";
  let index = 0;
  while (index < bytes.length) {
    const lead = bytes[index] ?? 0;
    const width =
      lead < 0x80
        ? 1
        : lead >= 0xc2 && lead < 0xe0
          ? 2
          : lead >= 0xe0 && lead < 0xf0
            ? 3
            : lead >= 0xf0 && lead < 0xf5
              ? 4
              : 0;
    let codePoint =
      width === 1 ? lead : width === 2 ? lead & 0x1f : width === 3 ? lead & 0x0f : lead & 0x07;
    let valid = width > 0 && index + width <= bytes.length;
    for (let next = 1; valid && next < width; next++) {
      const byte = bytes[index + next] ?? 0;
      if ((byte & 0xc0) !== 0x80) valid = false;
      else codePoint = (codePoint << 6) | (byte & 0x3f);
    }
    const minimum = width === 3 ? 0x800 : width === 4 ? 0x10000 : 0;
    if (
      valid &&
      codePoint >= minimum &&
      codePoint <= 0x10ffff &&
      !(codePoint >= 0xd800 && codePoint <= 0xdfff)
    ) {
      text += String.fromCodePoint(codePoint);
      index += width;
    } else {
      text += "�";
      index++;
    }
  }
  return text;
}

// MARK: - File System State

/**
 * The File System State row, in upstream's steps:
 *
 * 1. the reserved low-level files the volume holds — 0–5 or 8 mean initialised,
 *    7 or 9 configured. A file-table volume has no reserved files by index at
 *    all: upstream's own loop breaks out before reading one.
 * 2. failing that, a configuration partition of any kind — a `fitc.cfg` module,
 *    a FITC, CDMD or MFSB partition — means at least configured.
 *
 * Not ported: an EFS volume holding file contents raises the state to
 * Initialized, but which bytes of an EFS are a file only `FileTable.dat` says.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/MFS.swift#MFSStateDecoder
 * @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/MFS.swift#MFSStateDecoder.state
 */
export function mfsState(options: {
  readonly usesFTBL: boolean;
  readonly presentFileIndices: readonly number[];
  readonly hasConfiguration: boolean;
}): MFSState {
  let state: MFSState = "unconfigured";
  if (!options.usesFTBL) {
    if (options.presentFileIndices.some((index) => [0, 1, 2, 3, 4, 5, 8].includes(index))) {
      state = "initialized";
    } else if (options.presentFileIndices.some((index) => index === 7 || index === 9)) {
      state = "configured";
    }
  }
  if (state === "unconfigured" && options.hasConfiguration) state = "configured";
  return state;
}

// MARK: - The legacy home tree and integrity tables

/**
 * `get_sec_hdr_size`: the length of the trailing integrity table a reserved or
 * home file carries — 0x28 or 0x34.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/MFS.swift#MFSHomeDecoder
 * @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/MFS.swift#MFSHomeDecoder.secHeaderSize
 */
export function secHeaderSize(
  variant: string,
  major: number,
  minor: number,
  platform: number
): number {
  const is = (v: string, m: number) => variant === v && major === m;
  if (is("CSME", 14) && minor === 5) return 0x34;
  if ((is("CSSPS", 4) && minor === 4) || (is("CSSPS", 5) && platform === 10)) return 0x28;
  if (is("CSME", 11) || is("CSTXE", 3) || is("CSTXE", 4) || is("CSSPS", 4) || is("CSSPS", 5)) {
    return 0x34;
  }
  return 0x28;
}

/**
 * `get_vfs_start_0`: whether the volume's files start at System offset 0. When
 * they do, the files are named through FTBL/EFST and the reserved walk reads
 * nothing.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/MFS.swift#MFSHomeDecoder.vfsStartsAtZero
 */
export function vfsStartsAtZero(variant: string, major: number, minor: number): boolean {
  if (variant === "CSME" && major === 13 && minor === 30) return true;
  if (variant === "CSME" && (major === 15 || major === 16)) return true;
  if (variant === "CSME" && major >= 11 && major <= 14) return false;
  if (variant === "CSTXE" && (major === 3 || major === 4)) return false;
  if (variant === "CSSPS" && major >= 4 && major <= 6) return false;
  return true;
}

/**
 * The trailing integrity tables of the reserved low-level files (1–5, and 6 and
 * 7 on AFS). A file whose role carries none — Quota Storage before CSME 12, SVN
 * Migration on AFS — or that is too short for one is left out.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/MFS.swift#MFSHomeDecoder.reservedIntegrity
 */
export function reservedIntegrity(options: {
  readonly files: readonly MFSLowLevelFile[];
  readonly variant: string;
  readonly major: number;
  readonly minor: number;
  readonly platform: number;
  readonly isAFS: boolean;
}): MFSReservedFileIntegrity[] {
  const { files, variant, major, minor, platform, isAFS } = options;
  const sec = secHeaderSize(variant, major, minor, platform);
  const result: MFSReservedFileIntegrity[] = [];
  for (const file of files) {
    if (file.content.length === 0) continue;
    if (
      !(file.index >= 1 && (file.index <= 5 || (isAFS && (file.index === 6 || file.index === 7))))
    ) {
      continue;
    }
    const exempt =
      (file.index === 5 && !(variant === "CSME" && major >= 12)) || (file.index === 4 && isAFS);
    if (exempt || file.content.length < sec) continue;
    const table = integrityTable(file.content.subarray(file.content.length - sec));
    if (table === undefined) continue;
    result.push({
      fileIndex: file.index,
      contentSize: file.content.length - sec,
      integrity: table,
    });
  }
  return result;
}

/**
 * The home record size, from the first two `.`/`..` marker rows — upstream's
 * `\x2E[\x00\xAA]{10}`. The `..` row's first dot is followed by a dot, which is
 * not in the set, so its *second* dot is the second match and the distance less
 * one is the record size. Nothing with fewer than two markers.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/MFS.swift#MFSHomeDecoder.homeRecordSize
 */
export function homeRecordSize(content: Uint8Array): number | undefined {
  const matches: number[] = [];
  let index = 0;
  while (index + 11 <= content.length && matches.length < 2) {
    if (content[index] === 0x2e) {
      let isMarker = true;
      for (let offset = 1; offset <= 10; offset++) {
        const byte = content[index + offset];
        if (byte !== 0x00 && byte !== 0xaa) {
          isMarker = false;
          break;
        }
      }
      if (isMarker) {
        matches.push(index);
        index += 11;
        continue;
      }
    }
    index++;
  }
  const [first, second] = matches;
  return first === undefined || second === undefined ? undefined : second - first - 1;
}

/**
 * File 8 of a legacy volume as the home tree it names. Nothing when the layout's
 * files start at 0, file 8 is absent, or its markers do not resolve.
 *
 * Two divergences from a literal transcription, both needed for the walk to end,
 * and both upstream's own port: a name is cut at its first NUL before the marker
 * test — a dirty row named `.\0faults…` is a marker, not a folder to recurse into
 * for ever — and a folder whose file is already being walked yields no children.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/MFS.swift#MFSHomeDecoder.homeDirectory
 */
export function homeDirectory(options: {
  readonly files: readonly MFSLowLevelFile[];
  readonly variant: string;
  readonly major: number;
  readonly minor: number;
  readonly platform: number;
}): MFSHomeDirectory | undefined {
  const { files, variant, major, minor, platform } = options;
  if (vfsStartsAtZero(variant, major, minor)) return undefined;
  const sec = secHeaderSize(variant, major, minor, platform);
  const file8 = files.find((one) => one.index === 8);
  if (file8 === undefined || file8.content.length === 0) return undefined;
  const recordSize = homeRecordSize(file8.content);
  if (recordSize === undefined) return undefined;
  const long = file8.content.length >= sec;
  const rootBuffer = file8.content.subarray(0, long ? file8.content.length - sec : 0);
  const contentByIndex = new Map(files.map((one) => [one.index, one.content]));
  return {
    homeRecordSize: recordSize,
    rootRecordCount: Math.floor(rootBuffer.length / recordSize),
    integrity: long
      ? integrityTable(file8.content.subarray(file8.content.length - sec))
      : undefined,
    entries: walkHome(rootBuffer, recordSize, sec, contentByIndex, [8]),
  };
}

function walkHome(
  buffer: Uint8Array,
  recordSize: number,
  sec: number,
  contentByIndex: ReadonlyMap<number, Uint8Array>,
  path: readonly number[]
): MFSHomeRecord[] {
  if (recordSize <= 0 || buffer.length < recordSize) return [];
  const entries: MFSHomeRecord[] = [];
  for (let row = 0; row < Math.floor(buffer.length / recordSize); row++) {
    const slice = buffer.subarray(row * recordSize, row * recordSize + recordSize);
    const fileInfo = le32(slice, 0);
    const access = le16(slice, 4);
    const fileIndex = fileInfo & 0xfff;
    const isIntegrity = (access & (1 << 9)) !== 0;
    const isFolder = ((access >> 14) & 1) === 1;
    const name = nulTruncated(slice.subarray(recordSize - 12, recordSize));
    // Current and parent markers — never surfaced, never walked again.
    if (name === "." || name === "..") continue;

    // The pointed-to file; a protected row's file loses its trailing table.
    const raw = contentByIndex.get(fileIndex) ?? new Uint8Array(0);
    let fileData = raw;
    let integrity: MFSIntegrityTable | undefined;
    if (isIntegrity) {
      if (raw.length >= sec) {
        fileData = raw.subarray(0, raw.length - sec);
        integrity = integrityTable(raw.subarray(raw.length - sec));
      } else {
        fileData = new Uint8Array(0);
      }
    }

    const children =
      isFolder && fileData.length >= recordSize && !path.includes(fileIndex)
        ? walkHome(fileData, recordSize, sec, contentByIndex, [...path, fileIndex])
        : [];
    // UnknownSalt: one u16 on the 0x18 row, three on the 0x1C one.
    const saltWidth = recordSize === 0x1c ? 6 : 2;
    let salt = 0;
    for (let at = 0x0a + saltWidth - 1; at >= 0x0a; at--) salt = salt * 256 + (slice[at] ?? 0);
    entries.push({
      fileIndex,
      name,
      isFolder,
      fileSystemID: (fileInfo >>> 28) & 0xf,
      unixRights: access & 0x1ff,
      ownerUserID: le16(slice, 6),
      ownerGroupID: le16(slice, 8),
      integrityProtection: isIntegrity,
      encryptionProtection: (access & (1 << 10)) !== 0,
      antiReplayProtection: (access & (1 << 11)) !== 0,
      accessUnknown0: (access & (1 << 12)) !== 0,
      accessUnknown1: (access & (1 << 15)) !== 0,
      keyType: (access >> 13) & 1,
      integritySalt: (fileInfo >>> 12) & 0xffff,
      unknownSalt: salt,
      size: fileData.length,
      integrity,
      children,
    });
  }
  return entries;
}

/**
 * A trailing `MFS_Integrity_Table`: 0x28 (HMAC-MD5, flags, the anti-replay words,
 * an AES-GCM nonce) or 0x34 (HMAC-SHA-256, flags, a 128-bit region whose first
 * two words are the anti-replay values). Nothing for any other length.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/MFS.swift#MFSHomeDecoder.integrityTable
 */
export function integrityTable(table: Uint8Array): MFSIntegrityTable | undefined {
  let flagsRaw: number;
  let hmac: Uint8Array;
  let arRandom: number;
  let arCounter: number;
  let nonce: Uint8Array;
  let encryptionBit: number;
  let arIndexShift: number;
  let svnShift: number;
  switch (table.length) {
    case 0x28:
      flagsRaw = le32(table, 0x10);
      hmac = table.subarray(0, 16);
      arRandom = le32(table, 0x14);
      arCounter = le32(table, 0x18);
      nonce = table.subarray(0x1c, 0x28);
      encryptionBit = 3;
      arIndexShift = 11;
      svnShift = 22;
      break;
    case 0x34:
      flagsRaw = le32(table, 0x20);
      hmac = table.subarray(0, 32);
      arRandom = le32(table, 0x24);
      arCounter = le32(table, 0x28);
      nonce = table.subarray(0x24, 0x34);
      encryptionBit = 2;
      arIndexShift = 10;
      svnShift = 21;
      break;
    default:
      return undefined;
  }
  return {
    size: table.length,
    hmacHex: upperHex(hmac),
    flagsRaw,
    antiReplayProtection: (flagsRaw & 0x2) !== 0,
    encryptionProtection: ((flagsRaw >>> encryptionBit) & 1) !== 0,
    antiReplayIndex: (flagsRaw >>> arIndexShift) & 0x3ff,
    securityVersion: (flagsRaw >>> svnShift) & 0xff,
    arRandom,
    arCounter,
    nonceHex: upperHex(nonce),
  };
}

/** Natural byte order, as every digest in this model is written. */
function upperHex(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += byte.toString(16).toUpperCase().padStart(2, "0");
  return text;
}
