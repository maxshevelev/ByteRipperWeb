import { filledWith, find, has, slice, tag, tagBytes, u8, u32 } from "@/firmware/me/bytes";
import { crc32 } from "@/firmware/me/crypto/checksum";

/**
 * The Code Partition Directory — the directory Intel puts at the start of each
 * engine or independent-update partition.
 *
 * It lists the partition's modules, and the first module of a boot partition is
 * the manifest whose owning directory is found by scanning a small window
 * *before* it.
 *
 * Ported from `Packages/MEFirmware/Partition/CPD.swift`.
 */

export const CPD_TAG = tagBytes("$CPD");

export interface CPDHeader {
  /** The header's own region-relative base. */
  readonly base: number;
  readonly numModules: number;
  /** 1 or 2, which is what decides the header's length and its checksum. */
  readonly headerVersion: number;
  readonly entryVersion: number;
  /** 0x10 for revision 1, 0x14 for revision 2. */
  readonly headerLength: number;
  readonly partitionName: string;
  /** The stored checksum: a byte on revision 1, a word on revision 2. */
  readonly checksumField: number;
}

export interface CPDEntry {
  readonly name: string;
  /** Raw: the low twenty-five bits are the offset and bit 25 says Huffman. */
  readonly offsetAttrib: number;
  /** The offset from the directory's own base. */
  readonly offset: number;
  readonly isHuffman: boolean;
  /** The uncompressed size. */
  readonly size: number;
}

/**
 * The `$CPD` header whose base sits at `at`.
 *
 * Nothing unless the tag, the version, the entry version and the header length
 * all look like a real directory. Four bytes are not enough on their own: a
 * `$CPD` is found by scanning, and a scan that accepted the tag alone would find
 * one in every compressed module.
 */
export function decodeCpdHeader(bytes: Uint8Array, at: number): CPDHeader | undefined {
  if (at < 0 || !has(bytes, at, 0x10)) return undefined;
  if (tag(bytes, at, 4) !== "$CPD") return undefined;

  const numModules = u32(bytes, at + 0x04);
  // The count's high three bytes must be zero, which is what the anchor pattern
  // requires and what keeps a run of text from reading as a directory.
  if (numModules >= 0x0100_0000) return undefined;

  const headerVersion = u8(bytes, at + 0x08);
  if (headerVersion !== 1 && headerVersion !== 2) return undefined;
  if (u8(bytes, at + 0x09) !== 1) return undefined;

  const headerLength = u8(bytes, at + 0x0a);
  if (headerLength !== 0x10 && headerLength !== 0x14) return undefined;
  // Revision 2 keeps a word of checksum at 0x10, so it needs the longer header.
  if (headerVersion === 2 && !has(bytes, at, 0x14)) return undefined;

  return {
    base: at,
    numModules,
    headerVersion,
    entryVersion: 1,
    headerLength,
    partitionName: tag(bytes, at + 0x0c, 4),
    checksumField: headerVersion === 2 ? u32(bytes, at + 0x10) : u8(bytes, at + 0x0b),
  };
}

/**
 * The directory's entry table.
 *
 * Reads are bounded by the region: a truncated tail simply shortens the list,
 * because an image cut short is still an image worth saying something about.
 */
export function cpdEntries(
  bytes: Uint8Array,
  header: CPDHeader,
  cpdBase = header.base
): CPDEntry[] {
  if (header.numModules <= 0) return [];
  const table = cpdBase + header.headerLength;
  const entries: CPDEntry[] = [];
  for (let index = 0; index < header.numModules; index++) {
    const at = table + index * 0x18;
    if (!has(bytes, at, 0x18)) break;
    const offsetAttrib = u32(bytes, at + 0x0c);
    entries.push({
      name: tag(bytes, at, 12),
      offsetAttrib,
      offset: offsetAttrib & 0x01ff_ffff,
      isHuffman: (offsetAttrib & 0x0200_0000) !== 0,
      size: u32(bytes, at + 0x10),
    });
  }
  return entries;
}

/**
 * The nearest well-formed `$CPD` header strictly before `base`.
 *
 * A manifest does not say which directory owns it, so the directory is found by
 * walking back: the window is the largest a directory can be plus the manifest's
 * own offset into it, and the *last* match wins because that is the one nearest
 * the manifest.
 */
export function findPrecedingCpd(
  bytes: Uint8Array,
  base: number
): { readonly offset: number; readonly header: CPDHeader } | undefined {
  if (base <= 0 || base > bytes.length) return undefined;
  const start = Math.max(0, base - 0x201d);
  let best: { offset: number; header: CPDHeader } | undefined;
  for (let scan = start; scan <= base - 4; ) {
    const found = find(bytes, CPD_TAG, scan, base);
    if (found < 0) break;
    const header = decodeCpdHeader(bytes, found);
    if (header !== undefined) best = { offset: found, header };
    scan = found + 1;
  }
  return best;
}

/**
 * Whether the directory's own checksum checks out, over the header and entries
 * with the checksum field read as zero.
 *
 * Nothing only when the region is too short to cover the whole directory, which
 * is a different answer from "it does not check out".
 */
export function cpdChecksumValid(bytes: Uint8Array, header: CPDHeader): boolean | undefined {
  const length = header.headerLength + header.numModules * 0x18;
  if (!has(bytes, header.base, length)) return undefined;

  if (header.headerVersion === 1) {
    // Revision 1 is a checksum-8: every byte, the field itself counted as zero,
    // summing to zero.
    let sum = 0;
    for (let index = 0; index < length; index++) {
      if (index === 0x0b) continue;
      sum += bytes[header.base + index] ?? 0;
    }
    return ((0x100 - (sum & 0xff)) & 0xff) === header.checksumField;
  }
  const span = Uint8Array.from(bytes.subarray(header.base, header.base + length));
  span.fill(0, 0x10, 0x14);
  return crc32(span) === header.checksumField;
}

/**
 * How many all-zero slots follow the directory's last declared entry.
 *
 * Some directories under-count themselves when the real table carries extra
 * empty entries. Upstream tolerates five and complains beyond that; this counts
 * them either way and adds none of them as modules — a module's content is found
 * from its own entry, so an empty entry is a thing to report rather than to use.
 */
export function trailingEmptyCpdEntries(bytes: Uint8Array, header: CPDHeader): number {
  let at = header.base + header.headerLength + header.numModules * 0x18;
  let count = 0;
  while (has(bytes, at, 0x18) && filledWith(bytes, at, 0x18, 0)) {
    count++;
    at += 0x18;
    if (count > 5) break;
  }
  return count;
}

/**
 * Where the last module's content ends.
 *
 * Used only to notice module content overflowing the region — never to size
 * anything, since a size taken from the largest entry would believe a field that
 * is exactly what is under suspicion.
 */
export function cpdModuleContentEnd(header: CPDHeader, entries: readonly CPDEntry[]): number {
  let end = 0;
  for (const entry of entries) {
    if (entry.size > 0) end = Math.max(end, header.base + entry.offset + entry.size);
  }
  return end;
}

/** The bytes of one module, as its entry describes them. */
export function cpdModuleBytes(
  bytes: Uint8Array,
  header: CPDHeader,
  entry: CPDEntry
): Uint8Array | undefined {
  return slice(bytes, header.base + entry.offset, entry.size);
}
