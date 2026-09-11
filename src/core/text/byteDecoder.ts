/**
 * Maps raw bytes to the characters shown in the decoded-text column.
 *
 * Ported from `TextDecoder.swift` and `TextDecoderRegistry.swift`, and named
 * `byteDecoder` rather than `textDecoder` because the browser already has a
 * global called `TextDecoder` that does something else entirely (it decodes
 * UTF-8 byte *streams*). One display cell per byte is this decoder's whole
 * contract; multi-byte decoding is out of scope for it.
 *
 * The tables are built once, at construction, into a forward array of 256 and
 * an inverse map — so decoding a byte is an array index, which is what a
 * repaint needs it to be.
 */

export interface ByteDecoderDescriptor {
  /** Stable identifier, for persistence — e.g. `cp1252`. */
  readonly identifier: string;
  /** What a menu shows — e.g. `Windows-1252`. */
  readonly displayName: string;
}

/** The character shown for a byte with no displayable mapping. */
export const DEFAULT_PLACEHOLDER = ".";

export class ByteDecoder {
  readonly identifier: string;
  readonly displayName: string;
  readonly placeholder: string;

  /** Index = byte value, value = the character to draw. */
  private readonly forward: string[];
  /** The character a person typed, back to the byte it produces. */
  private readonly inverse: Map<string, number>;
  private readonly displayable: boolean[];

  /**
   * @param scalars 256 code points, one per byte; `undefined` where the code
   * page has no mapping for that byte.
   */
  constructor(
    descriptor: ByteDecoderDescriptor,
    scalars: readonly (number | undefined)[],
    placeholder: string = DEFAULT_PLACEHOLDER
  ) {
    if (scalars.length !== 256) throw new Error("a byte decoder table has exactly 256 entries");

    this.identifier = descriptor.identifier;
    this.displayName = descriptor.displayName;
    this.placeholder = placeholder;
    this.forward = new Array<string>(256);
    this.displayable = new Array<boolean>(256);
    this.inverse = new Map<string, number>();

    for (let byte = 0; byte < 256; byte++) {
      const scalar = scalars[byte];
      if (scalar === undefined || !isDisplayableScalar(scalar)) {
        this.forward[byte] = placeholder;
        this.displayable[byte] = false;
        continue;
      }

      // NO-BREAK SPACE draws as an ordinary space; a column of invisible
      // not-quite-spaces is worse than useless.
      const character = scalar === 0x00a0 ? " " : String.fromCodePoint(scalar);
      this.forward[byte] = character;
      this.displayable[byte] = true;
      // First byte wins where two map to the same character (0x20 and 0xA0
      // both draw as a space), so typing a space produces 0x20.
      if (!this.inverse.has(character)) this.inverse.set(character, byte);
    }
  }

  /** The character for a byte, or the placeholder. */
  decode(byte: number): string {
    return this.forward[byte & 0xff] ?? this.placeholder;
  }

  /** Whether the byte maps to a real character, so the view can dim the rest. */
  isDisplayable(byte: number): boolean {
    return this.displayable[byte & 0xff] ?? false;
  }

  /** The byte typing `character` produces, or `undefined` if it has none. */
  encode(character: string): number | undefined {
    return this.inverse.get(character);
  }

  /** A row of bytes as a string — the text column of one hex row. */
  decodeAll(bytes: Uint8Array): string {
    let out = "";
    for (const byte of bytes) out += this.decode(byte);
    return out;
  }
}

/**
 * Whether a code point should be drawn at all.
 *
 * C0 and C1 controls and DEL are out, and so is anything Unicode calls a format
 * character — U+00AD SOFT HYPHEN is the one that matters here, because
 * ISO-8859-1 and Windows-1252 both map a byte to it and it would draw as
 * nothing at all.
 *
 * Upstream asks Unicode for the general category. There is no such table in
 * JavaScript's standard library, but there is a regular expression that carries
 * one: `\p{Cf}` with the `u` flag.
 */
const FORMAT_CHARACTER = /\p{Cf}/u;

function isDisplayableScalar(scalar: number): boolean {
  if (scalar <= 0x1f || (scalar >= 0x7f && scalar <= 0x9f)) return false;
  return !FORMAT_CHARACTER.test(String.fromCodePoint(scalar));
}
