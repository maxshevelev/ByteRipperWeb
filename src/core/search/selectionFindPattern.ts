import { patternHexText, type SearchEncoding } from "@/core/search/searchPattern";

/**
 * What a selection becomes when it is used as a find pattern — the text the
 * Find bar's field holds and the encoding its popup names (§11, Use Selection
 * for Find).
 *
 * The pair travels together because either half alone is a lie: `41 42` under
 * UTF-8 searches for the four characters `4`, `1`, `4`, `2`, and `AB` under
 * hex does not parse at all.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SelectionFindPattern.swift#SelectionFindPattern
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SelectionFindPattern.swift#SelectionFindPattern.text
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SelectionFindPattern.swift#SelectionFindPattern.encoding
 * @upstream-differs an interface and functions rather than a struct: there is nothing to construct, and the pair is an object literal (see the `init` entry in the module map)
 */
export interface SelectionFindPattern {
  readonly text: string;
  readonly encoding: SearchEncoding;
}

/**
 * A selection made in the **hex** column: the bytes, written the way a dump
 * writes them (`DE AD BE EF`) and searched as bytes.
 *
 * The same form `SearchPattern.hexText` shows back after a search, so a pattern
 * taken from the dump and one typed into the field are the same text — and the
 * history, which records what the field holds, keeps one form rather than two.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SelectionFindPattern.swift#SelectionFindPattern.forBytes
 */
export function forBytes(bytes: Uint8Array): SelectionFindPattern {
  return { text: patternHexText({ bytes, encoding: "hex" }), encoding: "hex" };
}

/**
 * A selection made in the **decoded-text** column: the bytes read as UTF-8
 * where that is what they are, and the bytes themselves where it is not.
 *
 * The fallback is the whole point of the rule. A pattern is a thing to search
 * *with*, so it has to say what was selected: bytes that do not decode — a
 * selection starting mid-character, a run of `FF` fill, a stretch of code —
 * would become replacement characters, and a search for those finds nothing
 * that is in the file. Bytes always find themselves, so that is what they
 * become, and the caller can see the fallback happened by the encoding it gets
 * back.
 *
 * The column is drawn through a single-byte decoder, which is not UTF-8: over
 * ASCII the two agree, and a high byte the code page draws as a letter is not
 * UTF-8 by itself, so it comes back as its byte. That is the honest reading — a
 * search for the *character* would have to guess which of the encodings the
 * file uses, and the bar's own Smart Search is where that guess belongs.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SelectionFindPattern.swift#SelectionFindPattern.forText
 */
export function forText(bytes: Uint8Array): SelectionFindPattern {
  const text = readableUTF8(bytes);
  return text === undefined ? forBytes(bytes) : { text, encoding: "utf8" };
}

/**
 * `bytes` as UTF-8 text a reader can see and retype, or undefined when they are
 * not that.
 *
 * Strict on both counts: the whole selection must decode (a partial decode
 * would silently shorten the pattern), and every scalar must be printable.
 * Controls are excluded because a pattern carrying them cannot be read back off
 * the field, corrected or kept — `NUL` is invisible and a newline does not
 * survive a single-line field at all — so bytes like those are better searched
 * for as bytes.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SelectionFindPattern.swift#SelectionFindPattern.readableUTF8
 */
export function readableUTF8(bytes: Uint8Array): string | undefined {
  if (bytes.length === 0) return undefined;
  const text = decodeUtf8Strict(bytes);
  if (text === undefined) return undefined;
  for (const character of text) {
    if (!isPrintable(character.codePointAt(0) ?? 0)) return undefined;
  }
  return text;
}

/**
 * Whether a scalar is one the field can show: not a C0 control, not `DEL`, not
 * a C1 control. Everything else — letters, digits, punctuation, spaces, and the
 * whole of Unicode above them — is text.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SelectionFindPattern.swift#SelectionFindPattern.isPrintable
 */
function isPrintable(scalar: number): boolean {
  if (scalar >= 0x00 && scalar <= 0x1f) return false;
  if (scalar === 0x7f) return false;
  if (scalar >= 0x80 && scalar <= 0x9f) return false;
  return true;
}

/**
 * UTF-8, by hand, and **strictly**.
 *
 * `TextDecoder` would do this, and is a DOM global — which `src/core` may not
 * reach (D1), the same reason `encodeUtf8` is written out in `searchPattern.ts`.
 * The decoding is strict where the file system's reader (`utf8Lossy`) is not:
 * `String(decoding:as:)` substitutes U+FFFD for what it cannot read, and a
 * pattern made of replacement characters would search for something that is not
 * in the file. An over-long form, a surrogate, a truncated sequence and a
 * continuation byte out of place are all refusals here, which is what makes
 * `readableUTF8` able to say "these bytes are not text".
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SelectionFindPattern.swift#SelectionFindPattern.readableUTF8
 * @upstream-differs written out rather than delegated to the platform's decoder, which `src/core` may not reach (D1)
 */
function decodeUtf8Strict(bytes: Uint8Array): string | undefined {
  const scalars: number[] = [];
  let at = 0;
  while (at < bytes.length) {
    const first = bytes[at] ?? 0;
    let scalar: number;
    let length: number;
    if (first < 0x80) {
      scalar = first;
      length = 1;
    } else if (first >= 0xc2 && first <= 0xdf) {
      scalar = first & 0x1f;
      length = 2;
    } else if (first >= 0xe0 && first <= 0xef) {
      scalar = first & 0x0f;
      length = 3;
    } else if (first >= 0xf0 && first <= 0xf4) {
      scalar = first & 0x07;
      length = 4;
    } else {
      // A continuation byte where a lead belongs (0x80…0xBF), the over-long
      // two-byte leads (0xC0, 0xC1), and 0xF5 and up, which are past U+10FFFF.
      return undefined;
    }
    if (at + length > bytes.length) return undefined;
    for (let i = 1; i < length; i++) {
      const continuation = bytes[at + i] ?? 0;
      if (continuation < 0x80 || continuation > 0xbf) return undefined;
      scalar = (scalar << 6) | (continuation & 0x3f);
    }
    // A code point written in a longer form than it needs is not the same text
    // read twice, and is refused. No two-byte form can be over-long: the leads
    // that would make one — `C0` and `C1` — are refused above.
    if (length === 3 && scalar < 0x800) return undefined;
    if (length === 4 && scalar < 0x10000) return undefined;
    // UTF-16 cannot hold a surrogate, and UTF-8 may not carry one.
    if (scalar >= 0xd800 && scalar <= 0xdfff) return undefined;
    if (scalar > 0x10ffff) return undefined;
    scalars.push(scalar);
    at += length;
  }
  // In chunks: a spread of a whole large selection would be as many arguments
  // as it has characters, and an argument list has a limit.
  let text = "";
  for (let i = 0; i < scalars.length; i += CODEPOINT_CHUNK) {
    text += String.fromCodePoint(...scalars.slice(i, i + CODEPOINT_CHUNK));
  }
  return text;
}

/** How many code points go to `String.fromCodePoint` at once. */
const CODEPOINT_CHUNK = 4096;
