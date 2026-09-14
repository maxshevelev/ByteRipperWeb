import { find } from "@/firmware/me/bytes";
import { crc32, crc32FromZero } from "@/firmware/me/crypto/checksum";
import { MFS_PAGE_SIZE, parseMfs } from "@/firmware/me/fileSystem/mfs";
import type { MFSBackup, MFSBackupEntry } from "@/firmware/me/models/fileSystemFacts";

/**
 * An MFS *backup* area — upstream `mfs_anl`'s two MFSB branches. It opens with
 * "MFSB" where a normal volume opens with the page tag, in a partition named
 * "MFSB" or in a main MFS region whose volume is in backup state.
 *
 * - R0: a 0x20 header whose reserved words are all erased — that *is* the R0
 *   dispatch — and one body, CRC-32 from a zero register, that is a compacted
 *   volume: each erased stretch stored as `01 03 02 04` and its big-endian
 *   length. Reconstructing it gives a paged volume, and whether that reads as MFS
 *   is reported.
 * - R1: a 0x24 header with a plain CRC-32, locating three low-level files — 6
 *   Intel Configuration, 9 Manifest Backup, 7 OEM Configuration — each opened by
 *   an entry header with its own two CRC-32s.
 *
 * Ported from `Packages/MEFirmware/FileSystem/MFSBackup.swift`.
 */

const SIGNATURE = 0x4d46_5342;
const R0_HEADER_SIZE = 0x20;
const CHUNK_MARKER = Uint8Array.of(0x01, 0x03, 0x02, 0x04);

/**
 * A ceiling on the rebuilt image. Upstream allocates whatever the length words
 * say; a malformed body saying four gigabytes would take the worker down with
 * it, and no real backup rebuilds into more than an MFS partition.
 */
const MAX_RECONSTRUCTED = 0x400_0000;

const u32 = (bytes: Uint8Array, at: number): number | undefined =>
  at >= 0 && at + 4 <= bytes.length
    ? ((bytes[at] ?? 0) |
        ((bytes[at + 1] ?? 0) << 8) |
        ((bytes[at + 2] ?? 0) << 16) |
        ((bytes[at + 3] ?? 0) << 24)) >>>
      0
    : undefined;

const u32be = (bytes: Uint8Array, at: number): number | undefined =>
  at >= 0 && at + 4 <= bytes.length
    ? (((bytes[at] ?? 0) << 24) |
        ((bytes[at + 1] ?? 0) << 16) |
        ((bytes[at + 2] ?? 0) << 8) |
        (bytes[at + 3] ?? 0)) >>>
      0
    : undefined;

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
 * The backup area in `bytes[offset, offset + size)`, reported at
 * `absoluteOffset`. Nothing when it does not open with "MFSB".
 */
export function parseMfsBackup(
  bytes: Uint8Array,
  offset: number,
  size: number,
  absoluteOffset: number
): MFSBackup | undefined {
  if (offset < 0 || size < R0_HEADER_SIZE || offset + size > bytes.length) return undefined;
  const buffer = bytes.subarray(offset, offset + size);
  if (u32(buffer, 0) !== SIGNATURE) return undefined;
  let reservedAllFF = buffer.length >= 0x20;
  for (let at = 0x08; reservedAllFF && at < 0x20; at++) {
    if (buffer[at] !== 0xff) reservedAllFF = false;
  }
  return reservedAllFF ? r0(buffer, absoluteOffset) : r1(buffer, absoluteOffset);
}

function r0(buffer: Uint8Array, absoluteOffset: number): MFSBackup {
  const stored = u32(buffer, 0x04) ?? 0;
  const body = buffer.subarray(R0_HEADER_SIZE);
  let parses: boolean | undefined;
  if (body.length >= 4) {
    const rebuilt = reconstructR0Body(body);
    parses = parseMfs(rebuilt, 0, rebuilt.length)?.volumeSignatureValid ?? false;
  }
  return {
    offset: absoluteOffset,
    format: "r0",
    headerCRCStored: stored,
    headerCRCValid: crc32FromZero(body) === stored,
    reservedAllFF: true,
    reconstructedVolumeParses: parses,
    headerRevision: undefined,
    headerRevisionValid: undefined,
    entries: [],
  };
}

/**
 * The paged image an R0 body rebuilds into: each marker's big-endian length of
 * erased space reinserted, the tail past the last marker (or up to the first
 * 32-byte erased run) kept, the whole padded to the page size.
 */
export function reconstructR0Body(body: Uint8Array): Uint8Array {
  const bodyEnd = firstErasedRun(body, 32) ?? body.length;
  const parts: Uint8Array[] = [];
  let total = 0;
  let dataStart = 0;
  let cursor = 0;
  for (;;) {
    const at = find(body, CHUNK_MARKER, cursor, body.length);
    if (at < 0) break;
    const padding = at + CHUNK_MARKER.length + 4 <= body.length ? (u32be(body, at + 4) ?? 0) : 0;
    if (at > dataStart) {
      parts.push(body.subarray(dataStart, at));
      total += at - dataStart;
    }
    total += padding;
    if (total > MAX_RECONSTRUCTED) return new Uint8Array(0);
    parts.push(new Uint8Array(padding).fill(0xff));
    cursor = at + CHUNK_MARKER.length;
    dataStart = at + CHUNK_MARKER.length + 4;
  }
  if (dataStart < bodyEnd) parts.push(body.subarray(dataStart, bodyEnd));
  let out = concat(parts);
  const remainder = out.length % MFS_PAGE_SIZE;
  if (out.length > 0 && remainder !== 0) {
    out = concat([out, new Uint8Array(MFS_PAGE_SIZE - remainder).fill(0xff)]);
  }
  return out;
}

function r1(buffer: Uint8Array, absoluteOffset: number): MFSBackup {
  const headerRevision = u32(buffer, 0x04) ?? 0;
  const headerCRCStored = u32(buffer, 0x08) ?? 0;
  // The header CRC covers [0, 8), a zeroed CRC word, and [0xC, Entry6Offset).
  let headerLength = u32(buffer, 0x0c) ?? 0;
  if (headerLength < 0x0c || headerLength > buffer.length) headerLength = buffer.length;
  const span = concat([
    buffer.subarray(0, Math.min(0x08, buffer.length)),
    new Uint8Array(4),
    headerLength > 0x0c ? buffer.subarray(0x0c, headerLength) : new Uint8Array(0),
  ]);
  return {
    offset: absoluteOffset,
    format: "r1",
    headerCRCStored,
    headerCRCValid: crc32(span) === headerCRCStored,
    reservedAllFF: undefined,
    reconstructedVolumeParses: undefined,
    headerRevision,
    headerRevisionValid: headerRevision === 1,
    entries: [
      entry(buffer, 6, u32(buffer, 0x0c), u32(buffer, 0x10)),
      entry(buffer, 9, u32(buffer, 0x14), u32(buffer, 0x18)),
      entry(buffer, 7, u32(buffer, 0x1c), u32(buffer, 0x20)),
    ],
  };
}

/**
 * One R1 blob. One too short for its header, or pointing outside the area, comes
 * back with every validity flag false rather than failing the whole backup.
 */
function entry(
  buffer: Uint8Array,
  fileIndex: number,
  offsetWord: number | undefined,
  sizeWord: number | undefined
): MFSBackupEntry {
  const offset = offsetWord ?? -1;
  const blobSize = sizeWord ?? 0;
  const hasHeader = offset >= 0 && blobSize >= 0x10 && offset + 0x10 <= buffer.length;
  const revision = hasHeader ? (u32(buffer, offset) ?? 0) : 0;
  const headerCRCStored = hasHeader ? (u32(buffer, offset + 0x04) ?? 0) : 0;
  const dataSize = hasHeader ? (u32(buffer, offset + 0x08) ?? 0) : 0;
  const dataCRCStored = hasHeader ? (u32(buffer, offset + 0x0c) ?? 0) : 0;

  // Revision, a zeroed CRC word, and Size; the data CRC word is left out.
  const headerCRCValid =
    hasHeader &&
    crc32(
      concat([
        buffer.subarray(offset, offset + 0x04),
        new Uint8Array(4),
        buffer.subarray(offset + 0x08, offset + 0x0c),
      ])
    ) === headerCRCStored;

  let dataCRCValid = false;
  if (hasHeader) {
    const available = Math.min(offset + blobSize, buffer.length);
    const dataEnd = Math.min(offset + 0x10 + dataSize, available);
    if (dataEnd > offset + 0x10) {
      dataCRCValid = crc32(buffer.subarray(offset + 0x10, dataEnd)) === dataCRCStored;
    }
  }
  return {
    fileIndex,
    blobOffset: offset,
    blobSize,
    revision,
    revisionValid: hasHeader && revision === 1,
    headerCRCStored,
    headerCRCValid,
    dataSize,
    dataCRCStored,
    dataCRCValid,
  };
}

function firstErasedRun(bytes: Uint8Array, length: number): number | undefined {
  let run = 0;
  for (let index = 0; index < bytes.length; index++) {
    if (bytes[index] === 0xff) {
      run++;
      if (run >= length) return index - length + 1;
    } else {
      run = 0;
    }
  }
  return undefined;
}
