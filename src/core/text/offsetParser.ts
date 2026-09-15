import { MAX_REPRESENTABLE_SIZE } from "@/core/limits";

/**
 * Parses the offsets and byte counts a person types into a dialog.
 *
 * Ported from `OffsetParser.swift`. Accepted forms:
 *
 * - `0x`/`0X` prefixed: hexadecimal, e.g. `0x1F`.
 * - Plain digits only: decimal, e.g. `4096`.
 * - Hex-digit text with no prefix: hexadecimal, e.g. `FF` = 255.
 *
 * Surrounding whitespace is ignored. Anything else — empty input, stray
 * characters, a minus sign — is invalid; a value too large is out of range.
 *
 * "Too large" means something different here than upstream. Swift parses into
 * `UInt64`; this application addresses bytes as numbers (D3), so the ceiling is
 * `Number.MAX_SAFE_INTEGER`. The digits are parsed as a `bigint` and compared
 * against it — the one place in the domain half where `bigint` earns its keep,
 * because a `Number()` conversion would silently round `0x20000000000001` down
 * to a different offset and report success.
 */

/** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/OffsetParser.swift#OffsetParser.ParseError */
export type OffsetParseFailure = "invalidInput" | "outOfRange";

export type OffsetParseResult =
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly reason: OffsetParseFailure };

const DECIMAL = /^[0-9]+$/;
const HEX = /^[0-9a-fA-F]+$/;

/** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/OffsetParser.swift#OffsetParser.parse */
export function parseOffset(text: string): OffsetParseResult {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { ok: false, reason: "invalidInput" };

  if (trimmed.startsWith("0x") || trimmed.startsWith("0X")) {
    const digits = trimmed.slice(2);
    if (!HEX.test(digits)) return { ok: false, reason: "invalidInput" };
    return fromBigInt(BigInt(`0x${digits}`));
  }

  if (DECIMAL.test(trimmed)) return fromBigInt(BigInt(trimmed));
  if (HEX.test(trimmed)) return fromBigInt(BigInt(`0x${trimmed}`));

  return { ok: false, reason: "invalidInput" };
}

function fromBigInt(value: bigint): OffsetParseResult {
  if (value > BigInt(MAX_REPRESENTABLE_SIZE)) return { ok: false, reason: "outOfRange" };
  return { ok: true, value: Number(value) };
}

/**
 * `value` as a lowercase hexadecimal string, with no prefix.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/OffsetParser.swift#OffsetParser.hexString
 */
export function hexString(value: number): string {
  return value.toString(16);
}

/** `value` as an address, zero-padded to `digits` — what the offset column shows. */
export function addressString(value: number, digits: number): string {
  return value.toString(16).toUpperCase().padStart(digits, "0");
}
