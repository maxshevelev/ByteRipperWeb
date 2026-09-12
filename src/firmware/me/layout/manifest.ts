import { has, slice, tag, u8, u16, u32 } from "@/firmware/me/bytes";

/**
 * The `$MN2` / `$MAN` manifest — the structure that identifies an engine, and
 * the source of its version, its security version number and its date.
 *
 * The anchor is the vendor id rather than the tag: a manifest begins with
 * `0x8086` little-endian at its own base plus 0x10, and the tag follows twelve
 * bytes later. That is what upstream's pattern matches, so the offset a scan
 * reports is the *vendor* field and the struct's base is sixteen bytes before
 * it — an easy thing to be off by, and the reason it is said twice here.
 *
 * Ported from `Packages/MEFirmware/Layout/Manifest.swift`.
 */

export type ManifestFormat =
  /** Pre-CSE `$MAN`/`$MN2`, with no MEU version block. */
  | "r0"
  /** CSE with a 2048-bit key. */
  | "r1"
  /** CSE with a 3072-bit key. */
  | "r2";

export interface Manifest {
  /** The struct's own base, which is the anchor minus 0x10. */
  readonly base: number;
  /**
   * The struct's size in bytes. A `.man` module's extension chain starts right
   * after it.
   */
  readonly headerLengthBytes: number;
  /**
   * The whole manifest's size in bytes. The signature's protected data ends
   * here.
   */
  readonly sizeBytes: number;
  readonly tag: string;
  readonly format: ManifestFormat;

  readonly day: number;
  readonly month: number;
  readonly year: number;

  readonly major: number;
  readonly minor: number;
  readonly hotfix: number;
  readonly build: number;
  /** The security version number. */
  readonly svn: number;

  /** The MEU version block, which only the CSE formats have. */
  readonly meMajor: number | undefined;
  readonly meMinor: number | undefined;
  readonly meHotfix: number | undefined;
  readonly meBuild: number | undefined;

  /**
   * The version control number of a pre-CSE manifest. The CSE formats reuse
   * those bytes for the MEU block, so it is absent rather than zero there.
   */
  readonly vcn: number | undefined;
  /**
   * A pre-CSE manifest's module count — the declared length of its `$MME`
   * directory. The CSE formats put a build tag in the same word.
   */
  readonly numModules: number | undefined;

  /** Production-signed. */
  readonly pvBit: boolean;
  readonly debugSigned: boolean;

  readonly rsaPublicKey: Uint8Array | undefined;
  readonly rsaExponent: number | undefined;
  readonly rsaSignature: Uint8Array | undefined;
}

/**
 * Every manifest anchor in the region, in offset order.
 *
 * A flash image carries many — one per engine and independent-update partition,
 * plus the recovery copies — so identification needs all of them to pick the
 * operational one. The first in byte order is usually a recovery copy, which is
 * exactly the wrong answer.
 *
 * The scan leans on the platform's own byte search for the vendor id's first
 * byte: it is vectorised where a loop is not, and one byte in 256 means the skip
 * does nearly all the work.
 */
export function manifestAnchors(bytes: Uint8Array): number[] {
  if (bytes.length < 16) return [];
  const found: number[] = [];
  const limit = bytes.length - 16;
  for (let at = bytes.indexOf(0x86); at >= 0 && at <= limit; at = bytes.indexOf(0x86, at + 1)) {
    if (bytes[at + 1] !== 0x80 || bytes[at + 11] !== 0x00) continue;
    // `$MN2` and `$MAN` share their first two bytes and differ in the last two.
    if (bytes[at + 12] !== 0x24 || bytes[at + 13] !== 0x4d) continue;
    const third = bytes[at + 14];
    const fourth = bytes[at + 15];
    if ((third === 0x4e && fourth === 0x32) || (third === 0x41 && fourth === 0x4e)) {
      found.push(at);
    }
  }
  return found;
}

/** The first manifest anchor, or nothing. */
export const findManifestAnchor = (bytes: Uint8Array): number | undefined =>
  manifestAnchors(bytes)[0];

/** Decodes the manifest whose vendor anchor sits at `anchor`. */
export function decodeManifest(bytes: Uint8Array, anchor: number): Manifest | undefined {
  const base = anchor - 0x10;
  if (base < 0) return undefined;
  // Everything up to the exponent size at 0x7C, which the key slices need.
  if (!has(bytes, base, 0x80)) return undefined;

  const found = tag(bytes, base + 0x1c, 4);
  if (found !== "$MN2" && found !== "$MAN") return undefined;

  const headerVersion = u32(bytes, base + 0x08);
  // The same word is a module count on the pre-CSE format and a build tag on
  // the CSE ones, which is what the dispatch turns on.
  const numInfo = u32(bytes, base + 0x20);
  const format: ManifestFormat =
    headerVersion === 0x10000 ? (numInfo > 0 && numInfo < 0x50 ? "r0" : "r1") : "r2";

  const flags = u32(bytes, base + 0x0c);
  const isR0 = format === "r0";

  // The date is packed BCD: Intel stores each calendar digit as a hex nibble,
  // which is why upstream prints it as hex and never converts. A byte that is
  // not valid BCD falls back to its raw value rather than to a wrong date.
  const rawDay = u8(bytes, base + 0x14);
  const rawMonth = u8(bytes, base + 0x15);
  const rawYear = u16(bytes, base + 0x16);

  const keyLength = u32(bytes, base + 0x78) * 4;
  const exponentLength = u32(bytes, base + 0x7c) * 4;
  const keyStart = base + 0x80;
  const signatureStart = keyStart + keyLength + exponentLength;

  return {
    base,
    headerLengthBytes: u32(bytes, base + 0x04) * 4,
    sizeBytes: u32(bytes, base + 0x18) * 4,
    tag: found,
    format,
    day: bcdByte(rawDay) ?? rawDay,
    month: bcdByte(rawMonth) ?? rawMonth,
    year: bcdYear(rawYear) ?? rawYear,
    major: u16(bytes, base + 0x24),
    minor: u16(bytes, base + 0x26),
    hotfix: u16(bytes, base + 0x28),
    build: u16(bytes, base + 0x2a),
    svn: u32(bytes, base + 0x2c),
    // The CSE formats carry the MEU block here; the pre-CSE one reuses the same
    // bytes for its own fields, so these are absent rather than misread.
    meMajor: isR0 ? undefined : u16(bytes, base + 0x30),
    meMinor: isR0 ? undefined : u16(bytes, base + 0x32),
    meHotfix: isR0 ? undefined : u16(bytes, base + 0x34),
    meBuild: isR0 ? undefined : u16(bytes, base + 0x36),
    vcn: isR0 ? u32(bytes, base + 0x34) : undefined,
    numModules: isR0 ? numInfo : undefined,
    pvBit: (flags & 0x1) !== 0,
    debugSigned: (flags & 0x8000_0000) !== 0,
    rsaPublicKey: keyLength > 0 ? slice(bytes, keyStart, keyLength) : undefined,
    // The exponent is one word at the key's end, and the signature follows it
    // with the same length as the key.
    rsaExponent:
      keyLength > 0 && has(bytes, keyStart + keyLength, 4)
        ? u32(bytes, keyStart + keyLength)
        : undefined,
    rsaSignature: keyLength > 0 ? slice(bytes, signatureStart, keyLength) : undefined,
  };
}

/**
 * The window the signature covers: the first 0x80 bytes of the struct, and
 * everything from the header's end to the manifest's end.
 *
 * Nothing when the manifest's own size fields do not describe a window that is
 * there — a signature cannot be checked against bytes the region does not hold,
 * and pretending otherwise would report a valid signature over a short read.
 */
export function manifestProtectedData(
  bytes: Uint8Array,
  manifest: Manifest
): Uint8Array | undefined {
  const head = slice(bytes, manifest.base, 0x80);
  const tailStart = manifest.base + manifest.headerLengthBytes;
  const tailEnd = manifest.base + manifest.sizeBytes;
  if (head === undefined || tailEnd < tailStart) return undefined;
  const tail = slice(bytes, tailStart, tailEnd - tailStart);
  if (tail === undefined) return undefined;
  const window = new Uint8Array(head.length + tail.length);
  window.set(head);
  window.set(tail, head.length);
  return window;
}

/** Every plausible manifest in the region, in offset order. */
export function parseManifestCandidates(bytes: Uint8Array): Manifest[] {
  const found: Manifest[] = [];
  for (const anchor of manifestAnchors(bytes)) {
    const manifest = decodeManifest(bytes, anchor);
    if (manifest !== undefined) found.push(manifest);
  }
  return found;
}

/** The first plausible manifest, which only a test with one wants. */
export const parseFirstManifest = (bytes: Uint8Array): Manifest | undefined =>
  parseManifestCandidates(bytes)[0];

/** One packed-BCD byte as a decimal number. Nothing when a nibble is above 9. */
function bcdByte(value: number): number | undefined {
  const high = (value >> 4) & 0xf;
  const low = value & 0xf;
  return high <= 9 && low <= 9 ? high * 10 + low : undefined;
}

/** A packed-BCD year. Nothing when any of its four nibbles is above 9. */
function bcdYear(value: number): number | undefined {
  const nibbles = [(value >> 12) & 0xf, (value >> 8) & 0xf, (value >> 4) & 0xf, value & 0xf];
  if (nibbles.some((one) => one > 9)) return undefined;
  return (
    (nibbles[0] ?? 0) * 1000 + (nibbles[1] ?? 0) * 100 + (nibbles[2] ?? 0) * 10 + (nibbles[3] ?? 0)
  );
}
