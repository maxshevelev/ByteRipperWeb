/**
 * A number in hex, as the app writes one in a message, a readout or an agent's
 * answer: upper-case digits, `0x1FE028`.
 *
 * One module for every number written in hex, so the status bar, the tools'
 * detail, the agent's answers and every alert spell a number — and a range — the
 * same way. A tool module may not see the app, so this lives in shared code.
 *
 * A negative value — a signed field read from a damaged structure, a size that
 * underflowed — is written as its two's complement at its own width:
 * `0xFFFFFFFF` for a 32-bit -1, `0xFB` for an 8-bit -5, sixteen digits only for
 * a 64-bit value. Never `0x-5`: that is no hex number a reader or a client can
 * parse. A JavaScript number carries no width of its own, so a caller with a
 * narrower field says which (`width`); without it a negative is a 64-bit one,
 * as upstream's `Int` is.
 *
 * Values are `number` (D3) or `bigint`, for the few that are 64-bit fields
 * read whole. A `number` past 2^53 is written as the double it is.
 */

/** The width of the integer type a value was read as. */
export type IntegerWidth = 8 | 16 | 32 | 64 | 128;

/** An integer the module writes: an offset or size (`number`), or a 64-bit field (`bigint`). */
export type HexInteger = number | bigint;

/** How a number is written: padded to a field's width, and at which integer width. */
export interface HexOptions {
  /** Pad with zeros to this many digits, never cutting a wider value. */
  readonly digits?: number;
  /** The width of the type the value was read as: where a negative's two's complement stops. */
  readonly width?: IntegerWidth;
}

/**
 * The bits as an unsigned number of the same width: a negative value's two's
 * complement, any other value itself.
 *
 * @upstream Packages/HexText/Sources/HexText/HexText.swift#FixedWidthInteger.asUnsigned
 * @upstream-differs the width is the caller's to name (`HexOptions.width`, 64 when none): a
 * JavaScript number has no type whose width it could be read from
 */
function asUnsigned(value: HexInteger, width: IntegerWidth): HexInteger {
  if (value >= 0) return value;
  return BigInt.asUintN(width, typeof value === "bigint" ? value : BigInt(value));
}

/**
 * `0x1FE028`, `0x0`; `0x0005` for `digits` 4 — padded with zeros to a field's
 * width, never cut: a value wider than the field shows every digit it has.
 *
 * @upstream Packages/HexText/Sources/HexText/HexText.swift#FixedWidthInteger.hexNumber
 */
export function hexNumber(value: HexInteger, options: HexOptions = {}): string {
  return `0x${bareHexNumber(value, options)}`;
}

/**
 * `1FE028` — `hexNumber` without its prefix, for a copy to the clipboard (every
 * offset field adds the `0x` on its own) or a sentence that writes the prefix
 * itself; `0005` for `digits` 4, the Offset column's eight digits.
 *
 * @upstream Packages/HexText/Sources/HexText/HexText.swift#FixedWidthInteger.bareHexNumber
 */
export function bareHexNumber(value: HexInteger, options: HexOptions = {}): string {
  const text = asUnsigned(value, options.width ?? 64)
    .toString(16)
    .toUpperCase();
  return options.digits === undefined ? text : text.padStart(options.digits, "0");
}

/**
 * The same number `hexNumber` writes, in decimal: `0xFFFFFFFF (4294967295)` for
 * a 32-bit -1, never `(-1)` beside it — the two halves of a size cell name one
 * number.
 *
 * @upstream Packages/HexText/Sources/HexText/HexText.swift#FixedWidthInteger.decimalNumber
 */
export function decimalNumber(value: HexInteger, width: IntegerWidth = 64): string {
  return asUnsigned(value, width).toString();
}

/**
 * How many digits `bareHexNumber` has, counted from the bits rather than by
 * writing the string: for a column width asked for on every row.
 *
 * @upstream Packages/HexText/Sources/HexText/HexText.swift#FixedWidthInteger.hexDigitCount
 */
export function hexDigitCount(value: HexInteger, width: IntegerWidth = 64): number {
  let rest = asUnsigned(value, width);
  let digits = 1;
  if (typeof rest === "number") {
    while (rest > 0xf) {
      rest = Math.floor(rest / 16);
      digits += 1;
    }
    return digits;
  }
  while (rest > 0xfn) {
    rest >>= 4n;
    digits += 1;
  }
  return digits;
}

/**
 * The last byte of the half-open range `[start, end)` — its inclusive end, for
 * a sentence that names that one end ("through 0x…"). An empty range has no last
 * byte, and gives its position rather than one before it. The only place the
 * half-open-to-inclusive conversion lives, with `hexExtent` built on it (§21.3).
 *
 * @upstream Packages/HexText/Sources/HexText/HexText.swift#Range.lastByte
 */
export function lastByte(start: number, end: number): number;
export function lastByte(start: bigint, end: bigint): bigint;
export function lastByte(start: HexInteger, end: HexInteger): HexInteger;
export function lastByte(start: HexInteger, end: HexInteger): HexInteger {
  if (!(start < end)) return start;
  return typeof end === "bigint" ? end - 1n : end - 1;
}

/**
 * `0x100–0x13F`: a stretch of bytes `[start, end)` by its first and its last
 * byte, the way the status bar, the segment list and every message write one —
 * not by the first byte after it, which belongs to the next stretch. One byte is
 * that byte's address alone; an empty range is its position.
 *
 * @upstream Packages/HexText/Sources/HexText/HexText.swift#Range.hexExtent
 */
export function hexExtent(start: HexInteger, end: HexInteger, options: HexOptions = {}): string {
  // Compared, not subtracted: a signed range wider than the type's maximum
  // would overflow the subtraction.
  const one = typeof start === "bigint" ? start + 1n : start + 1;
  if (!(start < end && one < end)) return hexNumber(start, options);
  return `${hexNumber(start, options)}–${hexNumber(lastByte(start, end), options)}`;
}

/**
 * `[0x100, 0x140)`: a range in an agent's own terms, end exclusive, as its
 * protocol and its arguments give one. Written as an interval so it is never
 * read as the person's `0x100–0x13F`.
 *
 * @upstream Packages/HexText/Sources/HexText/HexText.swift#Range.halfOpenHexText
 */
export function halfOpenHexText(start: HexInteger, end: HexInteger): string {
  return `[${hexNumber(start)}, ${hexNumber(end)})`;
}
