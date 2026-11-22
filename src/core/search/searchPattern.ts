/**
 * What to look for, and how letters compare while looking.
 *
 * Ported from the pattern half of `SearchEngine.swift`.
 */

import { L } from "@/core/localization/localization";
import {
  type MaskedPattern,
  MaskedPatternError,
  maskedPatternHasHoles,
  maskedPatternHexText,
  parseGuidPattern,
  parseHexPattern,
} from "@/core/search/maskedSearch";

/**
 * How the text in the find field becomes bytes.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SearchEngine.swift#SearchEncoding
 */
export type SearchEncoding = "hex" | "guid" | "ascii" | "utf8" | "utf16LE" | "utf16BE";

export const SEARCH_ENCODINGS: readonly SearchEncoding[] = [
  "hex",
  "guid",
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
    hex: L("Hex bytes"),
    guid: "GUID",
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
 * @upstream Packages/BytePattern/Sources/BytePattern/CaseFolding.swift#CaseFolding
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
    case "guid":
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

/**
 * Whether case-insensitive matching is meaningful for `encoding`: every text encoding, and not hex
 * or a GUID, whose input is bytes.
 *
 * @upstream ByteRipperApp/Search/PatternQueryControls.swift#PatternQueryControls.supportsCaseFolding
 */
export const supportsCaseFolding = (encoding: SearchEncoding): boolean =>
  encoding !== "hex" && encoding !== "guid";

export const sameFolding = (a: CaseFolding, b: CaseFolding): boolean =>
  a.kind === b.kind &&
  (a.kind !== "utf16" || b.kind !== "utf16" || a.littleEndian === b.littleEndian);

/** @upstream Packages/BytePattern/Sources/BytePattern/CaseFolding.swift#SearchError */
export type SearchFailure =
  /** The pattern resolved to no bytes — empty input, or empty hex. */
  | "emptyPattern"
  /** Hex input was malformed: non-hex characters, or an odd number of digits. */
  | "invalidHexPattern"
  /** GUID input was not a GUID: `8-4-4-4-12` hex digits, braces optional. */
  | "invalidGuidPattern"
  /** A `?` that is not half of a `??`: a hole is a whole byte, and half a byte cannot be masked. */
  | "partialByteMask"
  /** A hex pattern of `??` alone, which would match at every offset. */
  | "holesOnly"
  /** The text cannot be written in the requested encoding. */
  | "undecodableText";

/**
 * A resolved search pattern: the byte sequence to find, the bytes of it that match anything
 * (`??` in hex), and the encoding it came from (for display).
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SearchEngine.swift#SearchPattern
 */
export interface SearchPattern {
  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SearchEngine.swift#SearchPattern.bytes */
  readonly bytes: Uint8Array;
  /**
   * Where true, the byte is a hole: it matches any byte, and the value in `bytes` is not looked
   * at. All false for every pattern but a hex one with `??` in it.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SearchEngine.swift#SearchPattern.isWild
   */
  readonly isWild: readonly boolean[];
  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SearchEngine.swift#SearchPattern.encoding */
  readonly encoding: SearchEncoding;
}

/**
 * A pattern of these bytes, with holes where `isWild` says so (none by default). A hole per byte:
 * a shorter or longer mask is a caller's mistake, caught here rather than as a read past the end
 * inside a scan.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SearchEngine.swift#SearchPattern.init
 */
export function searchPattern(
  bytes: Uint8Array | readonly number[],
  encoding: SearchEncoding,
  isWild?: readonly boolean[]
): SearchPattern {
  const copy = Uint8Array.from(bytes);
  if (isWild !== undefined && isWild.length !== copy.length) {
    throw new RangeError("isWild must have one entry per byte");
  }
  return {
    bytes: copy,
    isWild: isWild ?? Array.from({ length: copy.length }, () => false),
    encoding,
  };
}

/**
 * Whether any byte of the pattern is a hole.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SearchEngine.swift#SearchPattern.hasHoles
 */
export const patternHasHoles = (pattern: SearchPattern): boolean => maskedPatternHasHoles(pattern);

/**
 * Why a pattern is not a search, in the words the field says it in.
 *
 * @upstream ByteRipperApp/Search/PatternQueryControls.swift#PatternQueryControls.errorText
 * @upstream-differs the web's own words for an empty pattern, bad hex and text no encoding holds,
 * which it said before #33; the two #33 added are upstream's
 */
export const searchFailureText = (failure: SearchFailure): string =>
  ({
    emptyPattern: L("Type something to look for."),
    invalidHexPattern: L("That is not a hexadecimal byte sequence."),
    invalidGuidPattern: L("Invalid GUID — write it as CDEA2BD3-FC25-4C1C-B97C-B31186064990."),
    partialByteMask: L("?? stands for a whole byte — half a byte cannot be masked."),
    holesOnly: L("A pattern of ?? alone matches everywhere — give at least one byte."),
    undecodableText: L("That text cannot be written in this encoding."),
  })[failure];

export type ParseResult =
  | { readonly ok: true; readonly pattern: SearchPattern }
  | { readonly ok: false; readonly reason: SearchFailure };

/**
 * The bytes written the way a hex dump writes them: uppercase pairs, one space
 * between, `??` for a hole.
 *
 * The parser accepts more forms than a dump prints — `deadbeef`, `DE AD BE EF`,
 * `0xDE 0xAD` — so this is the one form to show back: text a reader can compare,
 * byte for byte, against the dump beside it. Derived from the *bytes*, so
 * whatever was typed comes back meaning exactly what was searched for.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SearchEngine.swift#SearchPattern.hexText
 */
export const patternHexText = (pattern: SearchPattern): string => maskedPatternHexText(pattern);

/**
 * Resolves the text in the find field to bytes.
 *
 * Hex is `MaskedPattern.hex`'s reading, the one the agent's search makes too. `??` in it is a
 * hole only where the caller searches with one — `allowingHoles`: the find bar and the pattern
 * library do; a fill, which has to write every byte it names, does not, and is refused a pattern
 * with a hole as `invalidHexPattern`.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SearchEngine.swift#SearchEngine.parsePattern
 */
export function parsePattern(
  text: string,
  encoding: SearchEncoding,
  allowingHoles = false
): ParseResult {
  if (encoding === "hex") {
    let masked: MaskedPattern;
    try {
      masked = parseHexPattern(text);
    } catch (error) {
      if (error instanceof MaskedPatternError) return { ok: false, reason: error.reason };
      throw error;
    }
    if (!allowingHoles && maskedPatternHasHoles(masked)) {
      return { ok: false, reason: "invalidHexPattern" };
    }
    return { ok: true, pattern: { bytes: masked.bytes, isWild: masked.isWild, encoding } };
  }
  if (encoding === "guid") {
    try {
      return { ok: true, pattern: searchPattern(parseGuidPattern(text).bytes, encoding) };
    } catch (error) {
      if (error instanceof MaskedPatternError) return { ok: false, reason: error.reason };
      throw error;
    }
  }
  const bytes = encodePattern(text, encoding);
  if (bytes === "undecodable") return { ok: false, reason: "undecodableText" };
  if (bytes.length === 0) return { ok: false, reason: "emptyPattern" };
  return { ok: true, pattern: searchPattern(bytes, encoding) };
}

function encodePattern(
  text: string,
  encoding: Exclude<SearchEncoding, "hex" | "guid">
): Uint8Array | "undecodable" {
  switch (encoding) {
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
