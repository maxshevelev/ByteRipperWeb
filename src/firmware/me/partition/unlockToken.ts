/**
 * The Unlock Token Flags an unlock-token partition ends with — upstream
 * `UTFL_Header` (MEA.py 2038), read at the two places `ext_anl` looks for it
 * (6637 and 6650).
 *
 * A CSE image may carry a debug unlock token as an FPT partition named `UTOK`
 * or `STKN` (upstream's own pair, MEA.py 5558). The partition holds a signed
 * token — a manifest and its extensions, which the `$MN2`/`$CPD` decode
 * already reads — and *optionally* ends with a 0x20-byte flags structure whose
 * first four bytes are `UTFL`. Optional is upstream's word for it: a token
 * without one is not a defect, and the two read sites are exactly "token with a
 * manifest" and "flags without a token", neither of which errors when the tag
 * is absent.
 *
 * The structure itself is four bytes of tag, one byte of Delayed Authentication
 * Mode and 27 reserved bytes. Byte-verified on two dumps: `CSME 15.bin` (UTOK
 * @0x460000, flags @0x461FE0) and `CSME 12.BIN` (UTOK @0x6B000, flags @0x6CFE0)
 * — both Delayed Authentication Mode 0 with every reserved byte erased to 0xFF.
 *
 * Ported from `Packages/MEFirmware/Partition/UnlockToken.swift`.
 */

/**
 * The flags a debug unlock token ends with — upstream `UTFL_Header`
 * (MEA.py 2038).
 *
 * An FPT partition named `UTOK` or `STKN` carries a signed unlock token, and
 * may end with a 0x20-byte structure tagged `UTFL`. One per such partition that
 * has one; a token without the structure is listed nowhere, which is upstream's
 * reading too — it calls the structure optional and says nothing when the tag
 * is absent.
 *
 * `delayedAuthMode` is kept as the raw byte it is. Upstream words 0 and 1 as No
 * and Yes and anything else as "Unknown (n)", which is the panel's job: the
 * model says what the byte held. `reservedHex` is the 27 trailing bytes in
 * storage order (upstream prints the same bytes as one little-endian value).
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#UnlockTokenFlags
 */
export interface UnlockTokenFlags {
  /**
   * The partition the flags sit at the end of — `UTOK` or `STKN`.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#UnlockTokenFlags.partition
   */
  readonly partition: string;
  /**
   * Where the 0x20-byte structure starts in the image — not the partition's own
   * offset.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#UnlockTokenFlags.offset
   */
  readonly offset: number;
  /**
   * `DelayedAuthMode`, raw.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#UnlockTokenFlags.delayedAuthMode
   */
  readonly delayedAuthMode: number;
  /**
   * The 27 reserved bytes, uppercase hex in storage order. Erased (all 0xFF) is
   * what every dump seen so far carries.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#UnlockTokenFlags.reservedHex
   */
  readonly reservedHex: string;
}

/**
 * `UTFL_Header`'s fixed length — what `offset` points at is this many bytes, and
 * a reader showing the structure needs to say so.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#UnlockTokenFlags.size
 */
export const UNLOCK_TOKEN_FLAGS_SIZE = 0x20;

/**
 * The names upstream treats as unlock-token partitions.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Partition/UnlockToken.swift#UnlockTokenParser.partitionNames
 */
export const UNLOCK_TOKEN_PARTITION_NAMES = ["UTOK", "STKN"];

/**
 * The tag that identifies the structure.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Partition/UnlockToken.swift#UnlockTokenParser.tag
 */
const TAG = "UTFL";

/**
 * The flags at the end of the partition occupying `region[offset, offset+size)`,
 * or `undefined` where the partition does not end with them.
 *
 * The structure is located by the partition's *end* and not by searching:
 * upstream reads `buffer[len - 0x20 : len - 0x1C]` and compares the tag, so a
 * `UTFL` appearing anywhere else in a token is not this structure.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Partition/UnlockToken.swift#UnlockTokenParser.flags
 */
export function unlockTokenFlags(options: {
  readonly region: Uint8Array;
  readonly offset: number;
  readonly size: number;
  readonly absoluteOffset: number;
  readonly partition: string;
}): UnlockTokenFlags | undefined {
  const { region, offset, size, absoluteOffset, partition } = options;
  if (offset < 0 || size < UNLOCK_TOKEN_FLAGS_SIZE || offset + size > region.length) {
    return undefined;
  }
  const start = offset + size - UNLOCK_TOKEN_FLAGS_SIZE;
  if (readTag(region, start) !== TAG) return undefined;
  const reserved: string[] = [];
  for (let at = start + 0x05; at < start + UNLOCK_TOKEN_FLAGS_SIZE; at++) {
    reserved.push((region[at] ?? 0).toString(16).toUpperCase().padStart(2, "0"));
  }
  return {
    partition,
    offset: absoluteOffset + size - UNLOCK_TOKEN_FLAGS_SIZE,
    delayedAuthMode: region[start + 0x04] ?? 0,
    reservedHex: reserved.join(""),
  };
}

/** Four bytes at `at`, as an ASCII tag, or a string that cannot match one. */
function readTag(region: Uint8Array, at: number): string {
  if (at < 0 || at + 4 > region.length) return "";
  return String.fromCharCode(
    region[at] ?? 0,
    region[at + 1] ?? 0,
    region[at + 2] ?? 0,
    region[at + 3] ?? 0
  );
}
