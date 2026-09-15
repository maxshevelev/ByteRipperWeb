/**
 * What to look for, and how letters compare while looking.
 *
 * Ported from the pattern half of `SearchEngine.swift`.
 */

/**
 * How the text in the find field becomes bytes.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SearchEngine.swift#SearchEncoding
 */
export type SearchEncoding = "hex" | "ascii" | "utf8" | "utf16LE" | "utf16BE";

export const SEARCH_ENCODINGS: readonly SearchEncoding[] = [
  "hex",
  "ascii",
  "utf8",
  "utf16LE",
  "utf16BE",
];

/**
 * What a menu calls each one.
 *
 * @upstream ByteRipperApp/Search/SearchEncodingNaming.swift#SearchEncoding
 * @upstream ByteRipperApp/Search/SearchEncodingNaming.swift#SearchEncoding.displayName
 */
export const encodingTitle = (encoding: SearchEncoding): string =>
  ({
    hex: "Hex bytes",
    ascii: "ASCII",
    utf8: "UTF-8",
    utf16LE: "UTF-16 LE",
    utf16BE: "UTF-16 BE",
  })[encoding];

/**
 * How a scan compares letters.
 *
 * Folding is what makes a case-insensitive search possible without a second
 * pass over the file: fold both the pattern and the data, and the fast search
 * does the rest. What *may* be folded depends on the encoding, which is why
 * this is a type rather than a boolean.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SearchEngine.swift#CaseFolding
 */
export type CaseFolding =
  /** Byte for byte. Hex is always this, and so is any encoding when the user asks. */
  | { readonly kind: "exact" }
  /** Fold ASCII letter bytes wherever they sit — right for ASCII and UTF-8. */
  | { readonly kind: "asciiBytes" }
  /**
   * Compare UTF-16 *code units*, folding one only when it encodes an ASCII
   * letter — that is, when its other byte is zero.
   *
   * A byte-wise fold cannot do this: it would fold the high byte of `U+6100`
   * (`00 61` little-endian) as if it were the letter `a` and match `U+4100`,
   * which is a different character.
   */
  | { readonly kind: "utf16"; readonly littleEndian: boolean };

export const EXACT: CaseFolding = { kind: "exact" };

/**
 * The rule for an encoding and the user's choice.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SearchEngine.swift#CaseFolding.init
 */
export function foldingFor(encoding: SearchEncoding, caseSensitive: boolean): CaseFolding {
  if (caseSensitive) return EXACT;
  switch (encoding) {
    // Hex input is bytes, and bytes have no case. (The *parser* accepts `de ad`
    // and `DE AD` alike — that is the input, not the comparison.)
    case "hex":
      return EXACT;
    case "ascii":
    case "utf8":
      return { kind: "asciiBytes" };
    case "utf16LE":
      return { kind: "utf16", littleEndian: true };
    case "utf16BE":
      return { kind: "utf16", littleEndian: false };
  }
}

export const sameFolding = (a: CaseFolding, b: CaseFolding): boolean =>
  a.kind === b.kind &&
  (a.kind !== "utf16" || b.kind !== "utf16" || a.littleEndian === b.littleEndian);

/** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SearchEngine.swift#SearchError */
export type SearchFailure =
  /** The pattern resolved to no bytes — empty input, or empty hex. */
  | "emptyPattern"
  /** Hex input was malformed: non-hex characters, or an odd number of digits. */
  | "invalidHexPattern"
  /** The text cannot be written in the requested encoding. */
  | "undecodableText";

/**
 * A resolved pattern: the exact bytes to find, and the encoding they came from.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SearchEngine.swift#SearchPattern
 */
export interface SearchPattern {
  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SearchEngine.swift#SearchPattern.bytes */
  readonly bytes: Uint8Array;
  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SearchEngine.swift#SearchPattern.encoding */
  readonly encoding: SearchEncoding;
}

export type ParseResult =
  | { readonly ok: true; readonly pattern: SearchPattern }
  | { readonly ok: false; readonly reason: SearchFailure };

/**
 * The bytes written the way a hex dump writes them: uppercase pairs, one space
 * between.
 *
 * The parser accepts more forms than a dump prints — `deadbeef`, `DE AD BE EF`,
 * `0xDE 0xAD` — so this is the one form to show back: text a reader can compare,
 * byte for byte, against the dump beside it. Derived from the *bytes*, so
 * whatever was typed comes back meaning exactly what was searched for.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SearchEngine.swift#SearchPattern.hexText
 */
export const patternHexText = (pattern: SearchPattern): string =>
  Array.from(pattern.bytes, (byte) => byte.toString(16).toUpperCase().padStart(2, "0")).join(" ");

/**
 * Resolves the text in the find field to bytes.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SearchEngine.swift#SearchEngine.parsePattern
 */
export function parsePattern(text: string, encoding: SearchEncoding): ParseResult {
  const bytes = encodePattern(text, encoding);
  if (bytes === "invalidHex") return { ok: false, reason: "invalidHexPattern" };
  if (bytes === "undecodable") return { ok: false, reason: "undecodableText" };
  if (bytes.length === 0) return { ok: false, reason: "emptyPattern" };
  return { ok: true, pattern: { bytes, encoding } };
}

function encodePattern(
  text: string,
  encoding: SearchEncoding
): Uint8Array | "invalidHex" | "undecodable" {
  switch (encoding) {
    case "hex":
      return parseHexPattern(text);
    case "ascii": {
      const bytes = new Uint8Array(text.length);
      for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        // ASCII is the narrower claim, so a character outside it is refused
        // rather than silently coerced into something else.
        if (code > 0x7f) return "undecodable";
        bytes[i] = code;
      }
      return bytes;
    }
    case "utf8":
      return encodeUtf8(text);
    case "utf16LE":
    case "utf16BE": {
      const little = encoding === "utf16LE";
      // The string's own UTF-16 code units, which is what a dump stores — so a
      // surrogate pair goes across as the two units it is.
      const bytes = new Uint8Array(text.length * 2);
      for (let i = 0; i < text.length; i++) {
        const unit = text.charCodeAt(i);
        bytes[i * 2 + (little ? 0 : 1)] = unit & 0xff;
        bytes[i * 2 + (little ? 1 : 0)] = unit >> 8;
      }
      return bytes;
    }
  }
}

/**
 * Hex input as bytes.
 *
 * Accepts `DEADBEEF`, `DE AD BE EF` and `0xDE 0xAD`, case-insensitive. Refuses
 * non-hex characters and an odd number of digits — a missing nibble means the
 * pattern is not the one the user meant, and guessing a half would search for
 * bytes nobody asked for.
 */
function parseHexPattern(text: string): Uint8Array | "invalidHex" {
  let digits = "";
  for (const token of text.split(/[\s,;|]+/)) {
    if (token.length === 0) continue;
    const body = /^0[xX]/.test(token) ? token.slice(2) : token;
    if (body.length === 0 || !/^[0-9a-fA-F]+$/.test(body)) return "invalidHex";
    digits += body;
  }
  if (digits.length === 0) return new Uint8Array(0);
  if (digits.length % 2 !== 0) return "invalidHex";

  const bytes = new Uint8Array(digits.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(digits.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * UTF-8, by hand.
 *
 * `TextEncoder` would do this, and is a DOM global — which `src/core` may not
 * reach (D1), and the no-DOM typecheck says so. Twenty lines is a small price
 * for a domain layer that compiles without a browser, and the rules are the
 * ones every UTF-8 encoder follows.
 */
function encodeUtf8(text: string): Uint8Array {
  // Four bytes is the most any code point takes.
  const bytes = new Uint8Array(text.length * 4);
  let at = 0;

  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x80) {
      bytes[at++] = code;
    } else if (code < 0x800) {
      bytes[at++] = 0xc0 | (code >> 6);
      bytes[at++] = 0x80 | (code & 0x3f);
    } else if (code < 0x10000) {
      bytes[at++] = 0xe0 | (code >> 12);
      bytes[at++] = 0x80 | ((code >> 6) & 0x3f);
      bytes[at++] = 0x80 | (code & 0x3f);
    } else {
      bytes[at++] = 0xf0 | (code >> 18);
      bytes[at++] = 0x80 | ((code >> 12) & 0x3f);
      bytes[at++] = 0x80 | ((code >> 6) & 0x3f);
      bytes[at++] = 0x80 | (code & 0x3f);
    }
  }
  return bytes.slice(0, at);
}
