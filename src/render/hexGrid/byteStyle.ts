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
  | "bookmarkAddress"
  /**
   * The leading zeros of an address standing on a mark — the mark's ink dimmed,
   * so the significant part of the address stands out there too.
   */
  | "mutedBookmarkAddress"
  /**
   * A byte on the find indicator's yellow plate: black in either theme, since
   * the plate is the same yellow in both.
   */
  | "indicator";

export const INK_ROLES: readonly InkRole[] = [
  "byte",
  "mutedByte",
  "modified",
  "address",
  "mutedAddress",
  "bookmarkAddress",
  "mutedBookmarkAddress",
  "indicator",
];

/**
 * The ink for one byte.
 *
 * A modified byte stays red even when its value is a fill byte: the
 * unsaved-change warning outranks the significance accent, because one says
 * "you have not saved this" and the other only says "this is padding".
 *
 * On the find indicator every byte is black, fill bytes too — a dimmed ink on
 * yellow is a smear — except an unsaved edit, which is data-integrity
 * information and stays red: red on yellow still reads as red.
 *
 * @upstream ByteRipperApp/Hex/HexView.swift#HexTheme.textColor
 * @upstream ByteRipperApp/Hex/HexView.swift#HexTheme.indicatorTextColor
 */
export function byteInk(byte: number, isModified: boolean, onIndicator = false): InkRole {
  if (isModified) return "modified";
  if (onIndicator) return "indicator";
  return byte === 0x00 || byte === 0xff ? "mutedByte" : "byte";
}

/**
 * Where an address's leading zeros stop.
 *
 * Returns the index of the first significant digit, so `0000DEAD` splits at 4
 * and draws `0000` muted with `DEAD` at full contrast. An address that is all
 * zeros — row 0 — is muted in full, which is what makes the significant part of
 * every other address stand out.
 *
 * @upstream ByteRipperApp/Hex/HexView.swift#HexView.offsetAddress
 */
export function addressSignificantFrom(text: string): number {
  const index = text.split("").findIndex((character) => character !== "0");
  return index === -1 ? text.length : index;
}

/**
 * The ink for one digit of an address.
 *
 * Two things decide it, and they are independent. The leading zeros stand back
 * — they say which row this is, but the eye is looking for the part that
 * changes — and a digit on a bookmark's mark is read against a filled shape
 * rather than against the paper, so it takes the mark's ink. Both at once: the
 * zeros of a marked address are dimmed *in the mark's ink* (§6, §20.4), which
 * is what keeps the significant part of the address findable on a purple bar as
 * well as on the page.
 *
 * @upstream ByteRipperApp/Hex/HexView.swift#HexView.offsetAddress
 */
export function addressDigitInk(index: number, significantFrom: number, marked: boolean): InkRole {
  const leading = index < significantFrom;
  if (marked) return leading ? "mutedBookmarkAddress" : "bookmarkAddress";
  return leading ? "mutedAddress" : "address";
}
