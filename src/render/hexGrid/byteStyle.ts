/**
 * How a byte and an address are inked.
 *
 * Ported from upstream's `HexTheme.textColor(for:)` and `offsetAddress(_:…)`.
 * Both are pure decisions about which role a piece of text takes, kept apart
 * from the drawing so they can be tested without a canvas — and so the rules
 * themselves are stated once rather than spread through a paint routine.
 *
 * The roles resolve to colours in `src/ui/theme/theme.css`, which is where the
 * palette ported from `AppPalette` lives.
 */

/** Which ink a glyph is drawn in. */
export type InkRole =
  /** An ordinary byte, at full contrast. */
  | "byte"
  /** A fill byte — `0x00` or `0xFF` — dimmed so the bytes around it read. */
  | "mutedByte"
  /** An unsaved edit. Red foreground, never a fill. */
  | "modified"
  /** The significant digits of an address. */
  | "address"
  /** An address's leading zeros. */
  | "mutedAddress"
  /** An address standing on a bookmark's mark, which is a filled shape. */
  | "bookmarkAddress";

export const INK_ROLES: readonly InkRole[] = [
  "byte",
  "mutedByte",
  "modified",
  "address",
  "mutedAddress",
  "bookmarkAddress",
];

/**
 * The ink for one byte.
 *
 * A modified byte stays red even when its value is a fill byte: the
 * unsaved-change warning outranks the significance accent, because one says
 * "you have not saved this" and the other only says "this is padding".
 */
export function byteInk(byte: number, isModified: boolean): InkRole {
  if (isModified) return "modified";
  return byte === 0x00 || byte === 0xff ? "mutedByte" : "byte";
}

/**
 * Where an address's leading zeros stop.
 *
 * Returns the index of the first significant digit, so `0000DEAD` splits at 4
 * and draws `0000` muted with `DEAD` at full contrast. An address that is all
 * zeros — row 0 — is muted in full, which is what makes the significant part of
 * every other address stand out.
 */
export function addressSignificantFrom(text: string): number {
  const index = text.split("").findIndex((character) => character !== "0");
  return index === -1 ? text.length : index;
}
