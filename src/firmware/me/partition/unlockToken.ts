/**
 * The Unlock Token Flags an unlock-token partition ends with — upstream
 * `UTFL_Header` (MEA.py 2038), read at the two places `ext_anl` looks for it
 * (6637 and 6650).
 *
 * A CSE image may carry a debug unlock token as an FPT partition named `UTOK`
 * or `STKN` (upstream's own pair, MEA.py 5558). The partition holds a signed
 * token — a manifest and its extensions, which the `$MN2`/`$CPD` decode already
 * reads — and *optionally* ends with a 0x20-byte flags structure whose first
 * four bytes are `UTFL`. Optional is upstream's word for it: a token without
 * one is not a defect, and the two read sites are exactly "token with a
 * manifest" and "flags without a token", neither of which errors when the tag
 * is absent.
 *
 * The structure itself is four bytes of tag, one byte of Delayed
 * Authentication Mode and 27 reserved bytes. Byte-verified upstream on two
 * dumps: `CSME 15.bin` (UTOK @0x460000, flags @0x461FE0) and `CSME 12.BIN`
 * (UTOK @0x6B000, flags @0x6CFE0) — both Delayed Authentication Mode 0 with
 * every reserved byte erased to 0xFF.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Partition/UnlockToken.swift#UnlockTokenParser
 */

import type { UnlockTokenFlags } from "@/firmware/me/models/firmwareFacts";
import { UNLOCK_TOKEN_FLAGS_SIZE } from "@/firmware/me/models/firmwareFacts";

/**
 * The names upstream treats as unlock-token partitions.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Partition/UnlockToken.swift#UnlockTokenParser.partitionNames
 */
export const UNLOCK_TOKEN_PARTITIONS = ["UTOK", "STKN"] as const;

/**
 * The tag that identifies the structure.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Partition/UnlockToken.swift#UnlockTokenParser.tag
 */
const TAG = "UTFL";

/**
 * The flags at the end of the partition occupying `bytes[offset, offset+size)`,
 * or nothing where the partition does not end with them.
 *
 * The structure is located by the partition's *end* and not by searching:
 * upstream reads `buffer[len - 0x20 : len - 0x1C]` and compares the tag, so a
 * `UTFL` appearing anywhere else in a token is not this structure.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Partition/UnlockToken.swift#UnlockTokenParser.flags
 */
export function unlockTokenFlags(options: {
  readonly bytes: Uint8Array;
  readonly offset: number;
  readonly size: number;
  readonly absoluteOffset: number;
  readonly partition: string;
}): UnlockTokenFlags | undefined {
  const { bytes, offset, size, absoluteOffset, partition } = options;
  if (offset < 0 || size < UNLOCK_TOKEN_FLAGS_SIZE || offset + size > bytes.length) {
    return undefined;
  }
  const start = offset + size - UNLOCK_TOKEN_FLAGS_SIZE;
  for (let index = 0; index < TAG.length; index++) {
    if (bytes[start + index] !== TAG.charCodeAt(index)) return undefined;
  }
  const reserved = bytes.subarray(start + 0x05, start + UNLOCK_TOKEN_FLAGS_SIZE);
  return {
    partition,
    offset: absoluteOffset + size - UNLOCK_TOKEN_FLAGS_SIZE,
    delayedAuthMode: bytes[start + 0x04] ?? 0,
    reservedHex: [...reserved]
      .map((byte) => byte.toString(16).toUpperCase().padStart(2, "0"))
      .join(""),
  };
}
