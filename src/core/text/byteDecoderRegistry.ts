import { ByteDecoder, type ByteDecoderDescriptor } from "@/core/text/byteDecoder";

/**
 * The built-in decoding tables.
 *
 * Ported from `TextDecoderRegistry.swift`. Windows-1252 is the default because
 * it is what the strings inside a firmware image are usually written in.
 */

export const BYTE_DECODERS: readonly ByteDecoderDescriptor[] = [
  { identifier: "cp1252", displayName: "Windows-1252" },
  { identifier: "isoLatin1", displayName: "ISO-8859-1" },
  { identifier: "strictASCII", displayName: "Strict ASCII" },
];

export const DEFAULT_DECODER_IDENTIFIER = "cp1252";

/** A 256-entry table with printable ASCII filled in and everything else empty. */
function asciiTable(): (number | undefined)[] {
  const table = new Array<number | undefined>(256).fill(undefined);
  for (let value = 0x20; value <= 0x7e; value++) table[value] = value;
  return table;
}

/**
 * Windows-1252. `0x00`–`0x7F` is ASCII with the C0 controls unmapped;
 * `0x80`–`0x9F` is the punctuation and currency cp1252 puts where ISO-8859-1
 * has C1 controls; `0xA0`–`0xFF` is ISO-8859-1's own mapping.
 *
 * `0xAD` maps to U+00AD SOFT HYPHEN, which the decoder's displayability rule
 * filters out — it is a format character and would draw as nothing.
 */
const CP1252 = (() => {
  const table = asciiTable();
  const specials: Record<number, number> = {
    128: 0x20ac, // € EURO SIGN
    130: 0x201a, // ‚ SINGLE LOW-9 QUOTATION MARK
    131: 0x0192, // ƒ LATIN SMALL F WITH HOOK
    132: 0x201e, // „ DOUBLE LOW-9 QUOTATION MARK
    133: 0x2026, // … HORIZONTAL ELLIPSIS
    134: 0x2020, // † DAGGER
    135: 0x2021, // ‡ DOUBLE DAGGER
    136: 0x02c6, // ˆ MODIFIER LETTER CIRCUMFLEX
    137: 0x2030, // ‰ PER MILLE SIGN
    138: 0x0160, // Š LATIN CAPITAL S WITH CARON
    139: 0x2039, // ‹ SINGLE LEFT-POINTING ANGLE QUOTE
    140: 0x0152, // Œ LATIN CAPITAL LIGATURE OE
    142: 0x017d, // Ž LATIN CAPITAL Z WITH CARON
    145: 0x2018, // ‘ LEFT SINGLE QUOTATION MARK
    146: 0x2019, // ’ RIGHT SINGLE QUOTATION MARK
    147: 0x201c, // “ LEFT DOUBLE QUOTATION MARK
    148: 0x201d, // ” RIGHT DOUBLE QUOTATION MARK
    149: 0x2022, // • BULLET
    150: 0x2013, // – EN DASH
    151: 0x2014, // — EM DASH
    152: 0x02dc, // ˜ SMALL TILDE
    153: 0x2122, // ™ TRADE MARK SIGN
    154: 0x0161, // š LATIN SMALL S WITH CARON
    155: 0x203a, // › SINGLE RIGHT-POINTING ANGLE QUOTE
    156: 0x0153, // œ LATIN SMALL LIGATURE OE
    158: 0x017e, // ž LATIN SMALL Z WITH CARON
    159: 0x0178, // Ÿ LATIN CAPITAL Y WITH DIAERESIS
  };
  // 0x81, 0x8D, 0x8F, 0x90 and 0x9D are undefined in cp1252 and stay so.
  for (const [byte, scalar] of Object.entries(specials)) table[Number(byte)] = scalar;
  for (let value = 0xa0; value <= 0xff; value++) table[value] = value;
  return table;
})();

/** ISO-8859-1: ASCII, then C1 controls left unmapped, then Latin-1 proper. */
const ISO_LATIN1 = (() => {
  const table = asciiTable();
  for (let value = 0xa0; value <= 0xff; value++) table[value] = value;
  return table;
})();

/** Strict ASCII: only `0x20`–`0x7E` is anything at all. */
const STRICT_ASCII = asciiTable();

/**
 * A decoder by identifier. An identifier that is not one of the built-ins falls
 * back to Windows-1252, as upstream's does — a persisted setting from a newer
 * version should leave the column readable rather than empty.
 */
export function makeByteDecoder(identifier: string, placeholder?: string): ByteDecoder {
  switch (identifier) {
    case "isoLatin1":
      return new ByteDecoder({ identifier, displayName: "ISO-8859-1" }, ISO_LATIN1, placeholder);
    case "strictASCII":
      return new ByteDecoder(
        { identifier, displayName: "Strict ASCII" },
        STRICT_ASCII,
        placeholder
      );
    default:
      return new ByteDecoder(
        { identifier: DEFAULT_DECODER_IDENTIFIER, displayName: "Windows-1252" },
        CP1252,
        placeholder
      );
  }
}
