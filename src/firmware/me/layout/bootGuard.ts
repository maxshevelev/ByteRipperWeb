import {
  type BootGuardProfile,
  bootGuardProfileOfIndex,
  type OEMKeyHash,
} from "@/firmware/me/models/manufacturingFacts";

/**
 * Boot Guard, as much of it as a dump can carry: the profile the image is built for,
 * and the OEM public key hash the ME region holds.
 *
 * Three places, all read by shape rather than through a table, because none is
 * described by any specification:
 *
 *   * the **profile**, first source — a JSON record of the CDMD partition's
 *     configuration, where MFIT writes the setting as an index into its own list;
 *   * the **profile**, second source — the four flags FIT builds a profile from, as bits
 *     of the UEP area: the first `UepBitsArray` of CSME 15 and 16, and the area's own
 *     record on CSME 12 to 14;
 *   * the **OEM public key hash**, a 48-byte SHA-384 the UEP area holds (a 32-byte
 *     SHA-256 on CSME 12 to 14).
 *
 * All were established upstream on real dumps with known Boot Guard levels, and on
 * builds of one image that differ in the profile and nothing else.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Layout/BootGuard.swift#BootGuardReader
 */

const ascii = (text: string): Uint8Array => Uint8Array.from(text, (one) => one.charCodeAt(0));

/** Where `needle` first occurs in `haystack` at or after `from`, or -1. */
function indexOf(haystack: Uint8Array, needle: Uint8Array, from = 0): number {
  const first = needle[0];
  if (first === undefined) return -1;
  let at = haystack.indexOf(first, from);
  while (at >= 0 && at + needle.length <= haystack.length) {
    let match = true;
    for (let index = 1; index < needle.length; index++) {
      if (haystack[at + index] !== needle[index]) {
        match = false;
        break;
      }
    }
    if (match) return at;
    at = haystack.indexOf(first, at + 1);
  }
  return -1;
}

const PROFILE_KEY = ascii("BtGuardProfileConfig");
const COLON = 0x3a;
const CLOSE = 0x7d;
const SPACE = 0x20;

/**
 * The profile the CDMD configuration names, or `undefined` when the image carries no
 * such record. The record is `{"BtGuardProfileConfig": <index>}`: the value is MFIT's
 * index, not the level. The key is looked for as text and the number read behind it, so
 * a partition carrying other records around it reads the same.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Layout/BootGuard.swift#BootGuardReader.profile
 */
export function bootGuardProfileInCDMD(cdmd: Uint8Array): BootGuardProfile | undefined {
  let from = 0;
  for (;;) {
    const found = indexOf(cdmd, PROFILE_KEY, from);
    if (found < 0) return undefined;
    from = found + PROFILE_KEY.length;
    let at = from;
    // The value's colon: a `}` first means this was another key of the same record.
    while (at < cdmd.length && cdmd[at] !== COLON && cdmd[at] !== CLOSE) at++;
    if (at >= cdmd.length || cdmd[at] !== COLON) continue;
    at++;
    while (at < cdmd.length && cdmd[at] === SPACE) at++;
    let value = 0;
    let digits = 0;
    while (at < cdmd.length && (cdmd[at] ?? 0) >= 0x30 && (cdmd[at] ?? 0) <= 0x39) {
      value = value * 10 + ((cdmd[at] ?? 0x30) - 0x30);
      digits++;
      at++;
    }
    const profile = digits > 0 ? bootGuardProfileOfIndex(value) : undefined;
    if (profile !== undefined) return profile;
  }
}

/**
 * How far into the `$UEP` container the first bit array's flags byte sits, and the word
 * the same array keeps just ahead of it — both measured off the container's signature.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Layout/BootGuard.swift#BootGuardReader.flagsOffset
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Layout/BootGuard.swift#BootGuardReader.wordOffset
 */
const FLAGS_OFFSET = 0x6e;
const WORD_OFFSET = 0x68;

/**
 * The profile the UEP area's Boot Guard bits name, or `undefined` when the area is
 * erased or its bits are no combination of the four settings.
 *
 * Where an image has no CDMD record — every CSME 15 image, and the older CSME 16 ones —
 * FIT keeps the four settings a profile is made of as bits of the area's first
 * `UepBitsArray`: the byte at **+0x6E** off the container's signature — bit 0
 * `FBGAcmEn`, 3 `ProtectBiosEnvironment`, 4 `MeasuredBoot`, 5 `VerifiedBoot`. An area
 * never written is not a profile, and a container with zeroes in the word ahead of the
 * flags is another structure behind the same signature.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Layout/BootGuard.swift#BootGuardReader.profile
 */
export function bootGuardProfileInUEPArea(uep: Uint8Array): BootGuardProfile | undefined {
  const signature = uepContainerOffset(uep);
  if (signature === undefined) return undefined;
  const flagsAt = signature + FLAGS_OFFSET;
  if (flagsAt >= uep.length) return undefined;
  // The body behind the signature, not the signature, says whether the area is written:
  // a CSME 12 image's UEP partition carries it over a blank body.
  const body = uep.subarray(
    signature + Math.min(8, uep.length - signature),
    signature + Math.min(0x80, uep.length - signature)
  );
  if (
    body.length === 0 ||
    body.every((byte) => byte === 0) ||
    body.every((byte) => byte === 0xff)
  ) {
    return undefined;
  }
  const wordAt = signature + WORD_OFFSET;
  if (uep.length - wordAt < 2) return undefined;
  const word = (uep[wordAt] ?? 0) | ((uep[wordAt + 1] ?? 0) << 8);
  if (word === 0 || word === 0xffff) return undefined;
  return profileOfFlags(uep[flagsAt] ?? 0);
}

/**
 * Where a generation keeps the four settings in its UEP container's record: the mask
 * that guards the layout, the record's source pointer, and the flags byte of each copy
 * the record is kept in.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Layout/BootGuard.swift#BootGuardReader.RecordLayout
 */
interface RecordLayout {
  readonly maskOffset: number;
  readonly maskWithoutACM: number;
  readonly maskWithACM: number;
  readonly sourceOffset: number;
  readonly flagOffsets: readonly number[];
}

/**
 * CSME 12 and 14: mask 0xCC/0xFF at +0x34, the record's source at +0x48, the flags byte
 * at +0x4C, +0xE8 and +0x178.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Layout/BootGuard.swift#BootGuardReader.earlierRecordLayout
 */
const EARLIER_RECORD_LAYOUT: RecordLayout = {
  maskOffset: 0x34,
  maskWithoutACM: 0xcc,
  maskWithACM: 0xff,
  sourceOffset: 0x48,
  flagOffsets: [0x4c, 0xe8, 0x178],
};

/**
 * CSME 13: the same facts 0x18 further in — the mask at +0x40, the record's source at
 * +0x60, and the flags byte at +0x64, +0x150 and +0x22C.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Layout/BootGuard.swift#BootGuardReader.iceLakeRecordLayout
 */
const ICE_LAKE_RECORD_LAYOUT: RecordLayout = {
  maskOffset: 0x40,
  maskWithoutACM: 0xc0cc,
  maskWithACM: 0xc0ff,
  sourceOffset: 0x60,
  flagOffsets: [0x64, 0x150, 0x22c],
};

/**
 * The profile a generation's UEP **record** names (CSME 12 to 14), or `undefined` where
 * this is not that generation's layout. The mask is what says the container is this
 * layout — `0xCC` where the ACM is not forced and `0xFF` where it is — and a mask that
 * disagrees with the flags' ACM bit means these offsets are not this image's layout.
 * An area never written points nowhere, and answers before its all-ones flags would read
 * as profile 5.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Layout/BootGuard.swift#BootGuardReader.profile
 */
export function bootGuardProfileInRecordUEPArea(
  uep: Uint8Array,
  major: number
): BootGuardProfile | undefined {
  const layout = major === 13 ? ICE_LAKE_RECORD_LAYOUT : EARLIER_RECORD_LAYOUT;
  const container = uepContainerOffset(uep);
  if (container === undefined) return undefined;
  const word = (offset: number): number | undefined => {
    const start = container + offset;
    if (start < 0 || start + 4 > uep.length) return undefined;
    return (
      ((uep[start] ?? 0) | ((uep[start + 1] ?? 0) << 8) | ((uep[start + 2] ?? 0) << 16)) +
      (uep[start + 3] ?? 0) * 0x100_0000
    );
  };
  const mask = word(layout.maskOffset);
  if (mask !== layout.maskWithoutACM && mask !== layout.maskWithACM) return undefined;
  const source = word(layout.sourceOffset);
  if (source === undefined || source === 0 || source === 0xffff_ffff) return undefined;
  const copies = layout.flagOffsets
    .map((offset) => container + offset)
    .filter((at) => at < uep.length)
    .map((at) => uep[at] ?? 0);
  if (copies.length !== layout.flagOffsets.length || new Set(copies).size !== 1) return undefined;
  const flags = copies[0] ?? 0;
  if ((mask === layout.maskWithACM) !== ((flags & 0x01) !== 0)) return undefined;
  return profileOfFlags(flags);
}

/**
 * The four settings a profile is made of, as one byte, to the profile they name — the
 * combination Intel's own `BootGuardProfiles` table holds. A combination the table does
 * not name is a layout this does not read, and never the nearest profile.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Layout/BootGuard.swift#BootGuardReader.profile
 */
function profileOfFlags(flags: number): BootGuardProfile | undefined {
  const acm = (flags & 0x01) !== 0;
  const verified = (flags & 0x20) !== 0;
  const measured = (flags & 0x10) !== 0;
  const protect = (flags & 0x08) !== 0;
  if (!acm && !verified && !measured && !protect) return "0"; // FBG ACM off, nothing verified
  if (!acm && verified && measured && protect) return "3"; // verified and measured
  if (acm && verified && !measured && protect) return "4"; // firmware verified
  if (acm && verified && measured && protect) return "5"; // verified and measured, ACM forced
  return undefined;
}

/**
 * Where a generation's key record sits in the area: how far into the container the
 * field starts, how long the hash is, and where the area keeps the copies of it.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Layout/BootGuard.swift#BootGuardReader.KeyRecord
 */
interface KeyRecord {
  readonly offset: number;
  readonly length: number;
  readonly copies: readonly number[];
}

/**
 * CSME 15 and later: a 48-byte SHA-384, 0xA0 bytes in and again 0x10A0 in.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Layout/BootGuard.swift#BootGuardReader.laterKeyRecord
 */
const LATER_KEY_RECORD: KeyRecord = { offset: 0xa0, length: 48, copies: [0, 0x1000] };

/**
 * CSME 12 to 14: a 32-byte SHA-256, 0x90 bytes in, followed by 16 bytes of assignment
 * bits that are *not* part of the hash. Read once.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Layout/BootGuard.swift#BootGuardReader.earlierKeyRecord
 */
const EARLIER_KEY_RECORD: KeyRecord = { offset: 0x90, length: 32, copies: [0] };

/**
 * The OEM public key hash the UEP area holds, and what its entry says where there is no
 * key to read. `major` is the ME generation, and it decides which of the two records is
 * read: the generations are told apart, not tried both, because a read of the wrong
 * length lands half inside the other's field.
 *
 * Where the field holds no key, what it holds is the finding: all zeros (signing
 * disabled), all `0xFF` (never written), or anything else — an area this reader does not
 * know how to walk. What it never does is print a neighbouring field as if it were the
 * key.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Layout/BootGuard.swift#BootGuardReader.oemPublicKeyHash
 */
export function oemPublicKeyHash(uep: Uint8Array, major: number): OEMKeyHash {
  const container = uepContainerOffset(uep);
  if (container === undefined) return { kind: "unrecognized" };
  // The generations between 12 and 14 keep the shorter record; everything else —
  // including an image the engine could not name — is read as the later one.
  const record = major >= 12 && major <= 14 ? EARLIER_KEY_RECORD : LATER_KEY_RECORD;
  const fields: OEMKeyHash[] = [];
  for (const copy of record.copies) {
    const at = container + copy + record.offset;
    if (at < 0 || at + record.length > uep.length) continue;
    const block = uep.subarray(at, at + record.length);
    if (block.every((byte) => byte === 0)) fields.push({ kind: "allZeros" });
    else if (block.every((byte) => byte === 0xff)) fields.push({ kind: "erased" });
    else if (isKeyMaterial(block)) fields.push({ kind: "hash", hex: hexOf(block) });
    else fields.push({ kind: "unrecognized" });
  }
  const first = fields[0];
  if (first === undefined) return { kind: "unrecognized" };
  // A key wherever it is: an area whose second half alone was written still holds one.
  // Two copies with different keys mean the offsets are not this image's layout.
  const keys = fields.flatMap((field) => (field.kind === "hash" ? [field.hex] : []));
  if (new Set(keys).size > 1) return { kind: "unrecognized" };
  const key = keys[0];
  if (key !== undefined) return { kind: "hash", hex: key };
  return first;
}

const UEPC = ascii("$UEPC");
const UEP = ascii("$UEP");

/**
 * Where the ASCII container that opens the UEP area begins, counted from the area's
 * first byte. `$UEPC` preferred (it is `$UEP` plus its revision letter), and the bare
 * `$UEP` the older dumps use. `undefined` when the bytes carry no such area.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Layout/BootGuard.swift#BootGuardReader.containerOffset
 */
export function uepContainerOffset(uep: Uint8Array): number | undefined {
  const preferred = indexOf(uep, UEPC);
  if (preferred >= 0) return preferred;
  let from = 0;
  for (;;) {
    const at = indexOf(uep, UEP, from);
    if (at < 0) return undefined;
    const after = at + UEP.length;
    if (after >= uep.length || uep[after] !== 0x43) return at;
    from = after;
  }
}

/**
 * High-entropy and not periodic: a key rather than a fill pattern, a pointer padded with
 * zeros, or a record's own header. Neither end may be a run of one byte either: an
 * entry's field is surrounded by the area's padding, and a hash has eight equal bytes at
 * one end with probability 2⁻⁵⁶.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Layout/BootGuard.swift#BootGuardReader.isKeyMaterial
 */
function isKeyMaterial(block: Uint8Array): boolean {
  if (new Set(block).size < 16) return false;
  const half = Math.floor(block.length / 2);
  const first = block.subarray(0, half);
  const rest = block.subarray(half);
  if (first.length === rest.length && first.every((byte, index) => byte === rest[index])) {
    return false;
  }
  return (
    new Set(block.subarray(0, 8)).size > 1 && new Set(block.subarray(block.length - 8)).size > 1
  );
}

/** @upstream Packages/MEFirmware/Sources/MEFirmware/Layout/BootGuard.swift#BootGuardReader.hex */
const hexOf = (bytes: Uint8Array): string =>
  [...bytes].map((byte) => byte.toString(16).toUpperCase().padStart(2, "0")).join("");
