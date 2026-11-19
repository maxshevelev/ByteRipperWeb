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
  const value = readOffsetDigits(text);
  if (value === undefined) return { ok: false, reason: "invalidInput" };
  return fromBigInt(value);
}

/**
 * The number `text` spells by `parseOffset`'s rules, before any ceiling — or
 * `undefined` when it spells none. Shared with the sums (`offsetExpression.ts`),
 * whose terms are read exactly as a lone number is but against upstream's
 * 64-bit ceiling rather than this application's.
 *
 * @web-only the half of `parseOffset` a sum's term needs: the reading without the ceiling
 */
export function readOffsetDigits(text: string): bigint | undefined {
  const trimmed = text.trim();
  if (trimmed.length === 0) return undefined;

  if (trimmed.startsWith("0x") || trimmed.startsWith("0X")) {
    const digits = trimmed.slice(2);
    return HEX.test(digits) ? BigInt(`0x${digits}`) : undefined;
  }

  if (DECIMAL.test(trimmed)) return BigInt(trimmed);
  if (HEX.test(trimmed)) return BigInt(`0x${trimmed}`);
  return undefined;
}

function fromBigInt(value: bigint): OffsetParseResult {
  if (value > BigInt(MAX_REPRESENTABLE_SIZE)) return { ok: false, reason: "outOfRange" };
  return { ok: true, value: Number(value) };
}
