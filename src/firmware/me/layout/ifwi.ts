import { filledWith, has, slice, tag, tagBytes, u8, u16, u32 } from "@/firmware/me/bytes";
import { crc32 } from "@/firmware/me/crypto/checksum";

/**
 * The IFWI pieces the `$FPT` spine needs: the CSE Layout Table, and the Boot
 * Partition Descriptor Tables.
 *
 * Why the Layout Table matters beyond its own contents: upstream decides where a
 * `$FPT`'s partitions are measured from with "the marker, unless a Layout Table
 * says otherwise — then the marker minus 0x10". A pre-IFWI engine has no Layout
 * Table, so its `$FPT` sits 0x10 into the region and its partitions measure from
 * the region base. Getting that wrong puts every partition on a CSME 11 image
 * 0x10 bytes too high.
 *
 * Ported from `Packages/MEFirmware/Layout/IFWI.swift`.
 */

/** One slot of the Layout Table's partition inventory. */
export interface LayoutSlot {
  readonly name: string;
  /** The table's base plus the slot's own offset field, region-relative. */
  readonly offset: number;
  readonly size: number;
  /** The offset or size is absent, or the whole content is erased. */
  readonly empty: boolean;
}

/** The decoded CSE Layout Table. */
export interface LayoutInfo {
  /** The table's own region-relative offset. */
  readonly base: number;
  /** 0x16 or 0x17. */
  readonly version: number;
  /** The 1.7 flag saying the first boot partition is backed up in the second. */
  readonly redundancy: boolean;
  /** The 1.7 pointer block's CRC-32 result; nothing for 1.6, which has none. */
  readonly checksumValid: boolean | undefined;
  readonly slots: readonly LayoutSlot[];
}

/** The Data partition's own label — the one slot a size total treats apart. */
export const DATA_SLOT_NAME = "Data";

/** The IFWI 1.6/1.7 Layout Table and 2.0 Boot Partition Descriptor signatures. */
const BPDT_SIGNATURES: readonly (readonly number[])[] = [
  [0xaa, 0x55, 0x00, 0x00],
  [0xaa, 0x55, 0xaa, 0x00],
];

const FPT_TAG = tagBytes("$FPT");
const CPD_TAG = tagBytes("$CPD");

const startsWith = (bytes: Uint8Array, at: number, pattern: readonly number[]): boolean =>
  has(bytes, at, pattern.length) && pattern.every((byte, index) => bytes[at + index] === byte);

const isBpdtSignature = (bytes: Uint8Array, at: number): boolean =>
  BPDT_SIGNATURES.some((one) => startsWith(bytes, at, one));

const isFptSignature = (bytes: Uint8Array, at: number): boolean =>
  startsWith(bytes, at, [...FPT_TAG]);

/**
 * The version — 0x16 or 0x17 — of the Layout Table at `at`, or nothing when
 * there is none.
 *
 * A 2.0 Boot Partition Descriptor header here is not a Layout Table, which is
 * the first thing ruled out. Then a 1.6 table (Data, boot partition one and
 * erased padding), a 1.7 table, and the two variants without Data — each gated
 * on where its pointers lead and on the erased padding that fills the rest of
 * the table's own 0x1000.
 */
export function detectLayoutTable(bytes: Uint8Array, at: number): 0x16 | 0x17 | undefined {
  if (!has(bytes, at, 0x48)) return undefined;
  if (isBpdtSignature(bytes, at)) return undefined;

  const dataAt16 = u32(bytes, at + 0x10);
  const bootAt16 = u32(bytes, at + 0x18);
  const dataAt17 = u32(bytes, at + 0x18);
  const bootAt17 = u32(bytes, at + 0x20);

  // The erased padding after each version's struct, out to the table's 0x1000.
  const padded = (from: number) => {
    const low = at + from;
    if (low > bytes.length) return false;
    const high = Math.min(at + 0x1000, bytes.length);
    return high > low && filledWith(bytes, low, high - low, 0xff);
  };
  const pad16 = padded(0x48);
  const pad17 = padded(0x58);

  if (isFptSignature(bytes, at + dataAt16) && isBpdtSignature(bytes, at + bootAt16) && pad16) {
    return 0x16;
  }
  if (isFptSignature(bytes, at + dataAt17) && isBpdtSignature(bytes, at + bootAt17) && pad17) {
    return 0x17;
  }
  if (isBpdtSignature(bytes, at + bootAt16) && pad16) return 0x16;
  if (isBpdtSignature(bytes, at + bootAt17) && pad17) return 0x17;
  return undefined;
}

/**
 * The full Layout Table at `at`: its partition inventory, its 1.7 checksum and
 * its redundancy flag. Nothing when no table is there.
 */
export function layoutTable(bytes: Uint8Array, at: number): LayoutInfo | undefined {
  const version = detectLayoutTable(bytes, at);
  if (version === undefined) return undefined;
  const is17 = version === 0x17;
  if (!has(bytes, at, is17 ? 0x58 : 0x48)) return undefined;

  // 1.6 puts Data at 0x10 and the five boot partitions from 0x18; 1.7 inserts a
  // size, flags and checksum prefix, so everything moves on by eight — and it
  // adds Temp and, when its size field declares one, ELog.
  const fields: readonly (readonly [string, number])[] = is17
    ? [
        ["Data", 0x18],
        ["Boot 1", 0x20],
        ["Boot 2", 0x28],
        ["Boot 3", 0x30],
        ["Boot 4", 0x38],
        ["Boot 5", 0x40],
      ]
    : [
        ["Data", 0x10],
        ["Boot 1", 0x18],
        ["Boot 2", 0x20],
        ["Boot 3", 0x28],
        ["Boot 4", 0x30],
        ["Boot 5", 0x38],
      ];

  let redundancy = false;
  let checksumValid: boolean | undefined;
  if (is17) {
    const sizeField = u16(bytes, at + 0x10);
    redundancy = (u8(bytes, at + 0x12) & 0x01) !== 0;
    // The 1.7 CRC covers the size and flags, the checksum word read as zero,
    // and everything from the Data pointer to the end the size field declares.
    const windowStart = at + 0x18;
    const windowEnd = at + 0x10 + sizeField;
    if (sizeField > 0 && windowStart <= bytes.length && windowEnd <= bytes.length) {
      const window = new Uint8Array(8 + (windowEnd - windowStart));
      window.set(bytes.subarray(at + 0x10, at + 0x14));
      window.set(bytes.subarray(windowStart, windowEnd), 8);
      checksumValid = crc32(window) === u32(bytes, at + 0x14);
    }
  }

  const slots = fields.map(([name, offsetField]) =>
    slotEntry(bytes, at, name, offsetField, offsetField + 4)
  );
  if (is17) {
    // Temp is always there on 1.7; ELog only when the size field declares it.
    slots.push(slotEntry(bytes, at, "Temp", 0x48, 0x4c));
    if (u16(bytes, at + 0x10) >= 0x48) slots.push(slotEntry(bytes, at, "ELog", 0x50, 0x54));
  }
  return { base: at, version, redundancy, checksumValid, slots };
}

/** An offset or size field that means "no partition here". */
const isAbsent = (value: number) => value === 0 || value === 0xffff_ffff;

function slotEntry(
  bytes: Uint8Array,
  base: number,
  name: string,
  offsetField: number,
  sizeField: number
): LayoutSlot {
  const rawOffset = u32(bytes, base + offsetField);
  const rawSize = u32(bytes, base + sizeField);
  const offset = base + rawOffset;
  const size = rawSize;
  let empty = isAbsent(rawOffset) || isAbsent(rawSize);
  if (!empty && size > 0 && has(bytes, offset, size)) {
    // A Layout Table slot counts as empty when it is all zeros *or* all erased:
    // both are what a table that reserved a slot and never filled it looks like.
    empty = filledWith(bytes, offset, size, 0x00) || filledWith(bytes, offset, size, 0xff);
  }
  return { name, offset, size, empty };
}

// MARK: - Boot Partition Descriptor Tables

/** A descriptor entry's type, as a partition name. */
export const BPDT_TYPE_NAMES: Readonly<Record<number, string>> = {
  0: "SMIP",
  1: "RBEP",
  2: "FTPR",
  3: "UCOD",
  4: "IBBP",
  5: "S-BPDT",
  6: "OBBP",
  7: "NFTP",
  8: "ISHC",
  9: "DLMP",
  10: "UEPB",
  11: "UTOK",
  12: "UFS PHY",
  13: "UFS GPP LUN",
  14: "PMCP",
  15: "IUNP",
  16: "NVMC",
  17: "UEP",
  18: "WCOD",
  19: "LOCL",
  20: "OEMP",
  21: "FITC",
  22: "PAVP",
  23: "IOMP",
  24: "xPHY",
  25: "TBTP",
  26: "PLTS",
  31: "DPHY",
  32: "PCHC",
  33: "ISIF",
  34: "ISIC",
  35: "HBMI",
  36: "OMSM",
  37: "GTGP",
  38: "MDFI",
  39: "PUNP",
  40: "PHYP",
  41: "SAMF",
  42: "PPHY",
  43: "GBST",
  44: "TCCP",
  45: "PSEP",
};

export interface BPDTSlot {
  readonly name: string;
  readonly type: number;
  readonly offset: number;
  readonly size: number;
  readonly empty: boolean;
}

export interface BPDTInfo {
  readonly base: number;
  readonly partitionName: string;
  /** 1 for IFWI 1.6 and 2.0, 2 for IFWI 1.7. */
  readonly version: number;
  readonly redundancy: boolean;
  readonly checksumValid: boolean | undefined;
  /** The header's FIT fields, all absent together when it carries no FIT. */
  readonly fitMajor: number | undefined;
  readonly fitMinor: number | undefined;
  readonly fitHotfix: number | undefined;
  readonly fitBuild: number | undefined;
  readonly slots: readonly BPDTSlot[];
}

/**
 * The first Boot Partition Descriptor Table in `bytes[low, high)`.
 *
 * Upstream's pattern is a regular expression whose free bytes impose no
 * constraint, so this checks only the fixed ones: the two signature bytes, the
 * version tag, and three twelve-byte blocks each holding zero at four fixed
 * positions — which is what an entry table looks like and what four bytes of
 * coincidence do not.
 */
export function findBpdt(bytes: Uint8Array, low: number, high: number): number | undefined {
  if (low < 0 || high > bytes.length || high - low < 60) return undefined;
  for (let at = low; at <= high - 60; at++) {
    if (bytes[at] !== 0xaa || bytes[at + 1] !== 0x55) continue;
    if (bytes[at + 2] !== 0x00 && bytes[at + 2] !== 0xaa) continue;
    if (bytes[at + 3] !== 0x00 || bytes[at + 5] !== 0x00) continue;
    if (bytes[at + 6] !== 0x01 && bytes[at + 6] !== 0x02) continue;
    if (bytes[at + 7] !== 0x00 && bytes[at + 7] !== 0x01) continue;
    if (looksLikeEntryTable(bytes, at + 24)) return at;
  }
  return undefined;
}

function looksLikeEntryTable(bytes: Uint8Array, at: number): boolean {
  for (let block = 0; block < 3; block++) {
    const start = at + block * 12;
    for (const offset of [1, 3, 7, 11]) {
      if (bytes[start + offset] !== 0x00) return false;
    }
  }
  return true;
}

/**
 * The Boot Partition Descriptor Table whose header begins at `base`: the header
 * and its entries, each entry's offset measured from the table's own base.
 */
export function bpdtTable(
  bytes: Uint8Array,
  base: number,
  partitionName: string
): BPDTInfo | undefined {
  if (!has(bytes, base, 0x18 + 0x0c)) return undefined;
  const version = u8(bytes, base + 0x06);
  if (version !== 1 && version !== 2) return undefined;
  const count = u16(bytes, base + 0x04);
  const end = base + 0x18 + count * 0x0c;
  if (count === 0 || end > bytes.length) return undefined;

  // The 1.7 redundancy flag. Version 1's checksum field is an XOR value rather
  // than a flag, so it says nothing about redundancy at all.
  const redundancy = version === 2 && (u8(bytes, base + 0x07) & 0x01) !== 0;

  // Both header versions put the FIT fields at the same place, and one gate
  // covers all four: a major of 0 or 0xFFFF is the marker for "no FIT here", so
  // the whole quartet is absent rather than three fields beside a zero.
  const rawFit = u16(bytes, base + 0x10);
  const noFit = rawFit === 0 || rawFit === 0xffff;
  const fitMajor = noFit ? undefined : rawFit;
  const fitMinor = noFit ? undefined : u16(bytes, base + 0x12);
  const fitHotfix = noFit ? undefined : u16(bytes, base + 0x14);
  const fitBuild = noFit ? undefined : u16(bytes, base + 0x16);

  // The 1.7 CRC covers the whole table without the signature, with the checksum
  // field read as zero.
  let checksumValid: boolean | undefined;
  if (version === 2) {
    const tail = end - base - 0x0c;
    const window = new Uint8Array(8 + Math.max(0, tail));
    window.set(slice(bytes, base + 0x04, 0x04) ?? new Uint8Array(4));
    window.set(slice(bytes, base + 0x0c, tail) ?? new Uint8Array(0), 8);
    checksumValid = crc32(window) === u32(bytes, base + 0x08);
  }

  const slots: BPDTSlot[] = [];
  for (let index = 0; index < count; index++) {
    const entry = base + 0x18 + index * 0x0c;
    const type = u16(bytes, entry);
    const rawOffset = u32(bytes, entry + 0x04);
    const rawSize = u32(bytes, entry + 0x08);
    const offset = base + rawOffset;
    const size = rawSize;
    let empty = isAbsent(rawOffset) || isAbsent(rawSize);
    if (!empty && size > 0 && has(bytes, offset, size)) {
      // Erased only, here: a descriptor entry filled with zeros is a real
      // partition of zeros, where a Layout Table slot of zeros is an unused one.
      empty = filledWith(bytes, offset, size, 0xff);
    }
    // A `$CPD` partition names its own row, which is the name worth having: the
    // type table is a guess about what the vendor put in that slot.
    const named =
      !empty && has(bytes, offset, 0x10) && startsWith(bytes, offset, [...CPD_TAG])
        ? tag(bytes, offset + 0x0c, 4)
        : undefined;
    slots.push({
      name: named !== undefined && named.length > 0 ? named : (BPDT_TYPE_NAMES[type] ?? "Unknown"),
      type,
      offset,
      size,
      empty,
    });
  }

  return {
    base,
    partitionName,
    version,
    redundancy,
    checksumValid,
    fitMajor,
    fitMinor,
    fitHotfix,
    fitBuild,
    slots,
  };
}
