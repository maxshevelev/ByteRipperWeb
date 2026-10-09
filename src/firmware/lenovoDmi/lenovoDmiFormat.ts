import { L } from "@/core/localization/localization";

/**
 * Lenovo's DMI store: the `LDBG` change log and the two `LENV` blocks after it,
 * where Lenovo's InsydeH2O firmware keeps a machine's identity.
 *
 * The format was reverse-engineered from `LenovoVariableDxe` by
 * LenovoDMIDecryptor (github.com/Shmurkio/LenovoDMIDecryptor, MIT), and checked
 * upstream against real dumps; where the two disagree, the dumps win and the
 * comment says so.
 */

const ascii = (text: string): readonly number[] =>
  Array.from(text, (character) => character.charCodeAt(0));

/**
 * The fixed numbers of the store, as `LenovoVariableDxe` hard-codes them.
 *
 * Upstream's `Lenovo.hpp` is the source; the two places it is wrong — the size
 * of a log entry and how the year is stored — are corrected against real dumps
 * and say so where they are.
 *
 * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIFormat.swift#LenovoDMIFormat
 */
export const LenovoDMIFormat = {
  /** @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIFormat.swift#LenovoDMIFormat.lenvSignature */
  lenvSignature: ascii("LENV"),
  /** @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIFormat.swift#LenovoDMIFormat.ldbgSignature */
  ldbgSignature: ascii("LDBG"),
  /**
   * The change log: two pages.
   *
   * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIFormat.swift#LenovoDMIFormat.ldbgSize
   */
  ldbgSize: 0x2000,
  /**
   * Each `LENV` block: one page.
   *
   * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIFormat.swift#LenovoDMIFormat.lenvSize
   */
  lenvSize: 0x1000,
  /**
   * The whole area — the log and the two blocks, back to back.
   *
   * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIFormat.swift#LenovoDMIFormat.areaSize
   */
  areaSize: 0x2000 + 2 * 0x1000,
  /**
   * `LENV_HEADER`: signature, generation, entry count, access flag, XOR key,
   * checksum. Never encoded.
   *
   * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIFormat.swift#LenovoDMIFormat.lenvHeaderSize
   */
  lenvHeaderSize: 0x10,
  /**
   * What comes before an entry's data: the key (16), the data size (4), the
   * flags (1) and two fields nobody has explained (1 + 2).
   *
   * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIFormat.swift#LenovoDMIFormat.lenvEntryHeaderSize
   */
  lenvEntryHeaderSize: 0x18,
  /**
   * `LDBG_HEADER`: signature, write offset, 24 bytes nobody has explained.
   * Never encoded — the write offset reads in the clear on every dump looked
   * at, while the entries after it do not.
   *
   * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIFormat.swift#LenovoDMIFormat.ldbgHeaderSize
   */
  ldbgHeaderSize: 0x20,
  /**
   * One `LDBG_ENTRY`. Upstream's comments put the size field at `+0x10`, which
   * would make an entry 24 bytes; the structure itself is 32 — a 7-byte
   * timestamp, the operation, the 16-byte key, the size and four bytes nobody
   * has explained — and on real dumps the write offset is `0x20 + 32·n`
   * exactly.
   *
   * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIFormat.swift#LenovoDMIFormat.ldbgEntrySize
   */
  ldbgEntrySize: 0x20,
  /**
   * The namespace every SMBIOS entry is filed under.
   *
   * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIFormat.swift#LenovoDMIFormat.smbiosNamespace
   */
  smbiosNamespace: [
    0x55, 0x57, 0x0e, 0xc2, 0x69, 0x11, 0x56, 0x4c, 0xa4, 0x8a, 0x98, 0x24, 0xab, 0x43,
  ] as readonly number[],
  /** @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIFormat.swift#LenovoDMIFormat.namespaceSize */
  namespaceSize: 14,
} as const;

/**
 * What the firmware files an entry under: a 14-byte namespace and a type within
 * it.
 *
 * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIFormat.swift#LenovoDMIKey
 * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIFormat.swift#LenovoDMIKey.init
 */
export interface LenovoDMIKey {
  /** @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIFormat.swift#LenovoDMIKey.namespace */
  readonly namespace: readonly number[];
  /** @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIFormat.swift#LenovoDMIKey.type */
  readonly type: number;
}

/** @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIFormat.swift#LenovoDMIKey.smbios */
export const smbiosKey = (type: number): LenovoDMIKey => ({
  namespace: LenovoDMIFormat.smbiosNamespace,
  type,
});

const sameBytes = (left: readonly number[], right: readonly number[]): boolean =>
  left.length === right.length && left.every((byte, index) => byte === right[index]);

/**
 * Whether two keys are the same key — Swift's `Hashable`, which an object here
 * is not.
 *
 * @web-only a key is a plain record here, compared by its bytes
 */
export const keysEqual = (left: LenovoDMIKey, right: LenovoDMIKey): boolean =>
  left.type === right.type && sameBytes(left.namespace, right.namespace);

/**
 * The key as one string, for a set or a map to hold it by.
 *
 * @web-only Swift hashes the key itself
 */
export const keyId = (key: LenovoDMIKey): string =>
  `${key.namespace.map((byte) => byte.toString(16).padStart(2, "0")).join("")}:${key.type}`;

/** @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIFormat.swift#LenovoDMIKey.isSMBIOS */
export const isSMBIOS = (key: LenovoDMIKey): boolean =>
  sameBytes(key.namespace, LenovoDMIFormat.smbiosNamespace);

/**
 * Reads the 16 bytes at `offset` of `bytes`.
 *
 * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIFormat.swift#LenovoDMIKey.read
 */
export function readKey(bytes: Uint8Array, offset: number): LenovoDMIKey {
  return {
    namespace: Array.from(bytes.subarray(offset, offset + LenovoDMIFormat.namespaceSize)),
    type: u16(bytes, offset + LenovoDMIFormat.namespaceSize),
  };
}

/**
 * The type as the panel writes it: four hex digits, the way upstream and the
 * firmware's own constants write it.
 *
 * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIFormat.swift#LenovoDMIKey.typeText
 */
export const keyTypeText = (key: LenovoDMIKey): string => hexText(key.type, 4);

/**
 * The namespace as hex bytes, for one nobody has named.
 *
 * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIFormat.swift#LenovoDMIKey.namespaceText
 */
export const keyNamespaceText = (key: LenovoDMIKey): string =>
  key.namespace.map((byte) => hexText(byte, 2, false)).join(" ");

/**
 * How an entry's value reads: text, a UUID, bytes, or the Windows key behind
 * the MSDM header.
 *
 * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIValue.swift#LenovoDMIValue.Reading
 */
export type LenovoDMIReadingKind = "text" | "uuid" | "bytes" | "windowsKey";

/**
 * The entry types whose meaning upstream established, and how their value
 * reads. A type not listed here is called unknown — in the panel and in the
 * help — since real dumps carry several more (`0x0000`, `0x0300`, `0x0700`, …)
 * and what they hold has not been documented.
 *
 * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIFormat.swift#LenovoDMIKnownType
 */
export type LenovoDMIKnownType =
  | "windowsKey"
  | "oa3KeyID"
  | "motherboardName"
  | "machineTypeModel"
  | "baseboardSerialNumber"
  | "systemUUID"
  | "baseboardPlatformID"
  | "osPreloadSuffix";

/** The types' raw values, in upstream's order. */
const KNOWN_TYPES: readonly (readonly [number, LenovoDMIKnownType])[] = [
  [0x0001, "windowsKey"],
  [0x000b, "oa3KeyID"],
  [0x0100, "motherboardName"],
  [0x0200, "machineTypeModel"],
  [0x0400, "baseboardSerialNumber"],
  [0x0500, "systemUUID"],
  [0x0f00, "baseboardPlatformID"],
  [0x1000, "osPreloadSuffix"],
];

/**
 * The known type an SMBIOS key is, if it is one.
 *
 * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIFormat.swift#LenovoDMIKnownType.init
 */
export function knownType(key: LenovoDMIKey): LenovoDMIKnownType | undefined {
  if (!isSMBIOS(key)) return undefined;
  return KNOWN_TYPES.find(([raw]) => raw === key.type)?.[1];
}

/** @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIFormat.swift#LenovoDMIKnownType.name */
export function knownTypeName(type: LenovoDMIKnownType): string {
  switch (type) {
    case "windowsKey":
      return L("Windows key");
    case "oa3KeyID":
      return L("OA3 key ID");
    case "motherboardName":
      return L("Motherboard name");
    case "machineTypeModel":
      return L("Machine type/model");
    case "baseboardSerialNumber":
      return L("Baseboard serial number");
    case "systemUUID":
      return L("System UUID");
    case "baseboardPlatformID":
      return L("Baseboard platform ID");
    case "osPreloadSuffix":
      return L("OS preload suffix");
  }
}

/**
 * How the value reads: a UUID, text, or bytes.
 *
 * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIFormat.swift#LenovoDMIKnownType.reading
 */
export function knownTypeReading(type: LenovoDMIKnownType): LenovoDMIReadingKind {
  switch (type) {
    case "systemUUID":
      return "uuid";
    case "windowsKey":
      return "windowsKey";
    default:
      return "text";
  }
}

/**
 * Little-endian reads and hex text, over a plain byte array.
 *
 * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIFormat.swift#LE
 * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIFormat.swift#LE.u16
 */
export const u16 = (bytes: Uint8Array, offset: number): number =>
  (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);

/** @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIFormat.swift#LE.u32 */
export const u32 = (bytes: Uint8Array, offset: number): number =>
  ((bytes[offset] ?? 0) |
    ((bytes[offset + 1] ?? 0) << 8) |
    ((bytes[offset + 2] ?? 0) << 16) |
    ((bytes[offset + 3] ?? 0) << 24)) >>>
  0;

/** @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIFormat.swift#LE.bytes16 */
export const bytes16 = (value: number): Uint8Array =>
  Uint8Array.of(value & 0xff, (value >>> 8) & 0xff);

/** @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIFormat.swift#LE.hex */
export function hexText(value: number, digits: number, prefix = true): string {
  const padded = value.toString(16).toUpperCase().padStart(digits, "0");
  return prefix ? `0x${padded}` : padded;
}

/**
 * Every byte XORed with `key` — both directions of the store's cipher.
 *
 * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIFormat.swift#Array.xored
 */
export function xored(bytes: Uint8Array, key: number): Uint8Array {
  if (key === 0) return bytes.slice();
  return bytes.map((byte) => byte ^ key);
}

/**
 * The store's checksum: the bytes added up, kept to 16 bits.
 *
 * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIFormat.swift#Array.sum16
 */
export function sum16(bytes: Uint8Array): number {
  let sum = 0;
  for (const byte of bytes) sum = (sum + byte) & 0xffff;
  return sum;
}

/** Whether `bytes` at `offset` hold `signature`. */
export const startsWith = (bytes: Uint8Array, signature: readonly number[], offset = 0): boolean =>
  signature.every((byte, index) => bytes[offset + index] === byte);
