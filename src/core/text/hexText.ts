/**
 * Bytes as hex text, and back.
 *
 * Ported from `ClipboardCodec.swift`. Hex text is what travels: it pastes into
 * a forum post, a bug report, a terminal, and back into this application. The
 * parser is deliberately generous about what it accepts — space-separated,
 * run-together, `0x`-prefixed, with or without line breaks — because what
 * arrives on a clipboard came from somewhere else and was formatted by
 * somebody else's tool.
 */

/**
 * Bytes as uppercase pairs separated by spaces, wrapped every 16.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/ClipboardCodec.swift#ClipboardCodec.hexText
 */
export function formatHex(bytes: Uint8Array, perLine = 16): string {
  const lines: string[] = [];
  for (let at = 0; at < bytes.length; at += perLine) {
    const line: string[] = [];
    for (let i = at; i < Math.min(at + perLine, bytes.length); i++) {
      line.push((bytes[i] ?? 0).toString(16).toUpperCase().padStart(2, "0"));
    }
    lines.push(line.join(" "));
  }
  return lines.join("\n");
}

/**
 * Hex text as bytes, or `undefined` when the text does not unambiguously read
 * as one.
 *
 * Strict, as upstream's is, and for a reason worth stating: a generous parser
 * that simply kept every hex digit would read "hello world" as `ED` and paste
 * a byte into somebody's firmware. Whitespace and list punctuation separate
 * tokens; each token must be hex digits through and through, after an optional
 * `0x`. An odd number of digits is refused rather than guessed at —
 * a missing nibble means the paste was truncated.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/ClipboardCodec.swift#ClipboardCodec.bytes
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/ClipboardCodec.swift#ClipboardCodec.CodecError
 * @upstream-differs answers undefined for text that is not hex, rather than throwing invalidHexText
 */
export function parseHex(text: string): Uint8Array | undefined {
  let digits = "";
  // Whitespace and list punctuation separate; upstream splits on whitespace
  // alone, but `0x00, 0x0F, 0xFF` is what a C array puts on a clipboard and
  // refusing it would be strictness without a purpose.
  for (const token of text.split(/[\s,;|]+/)) {
    if (token.length === 0) continue;
    // A per-token `0x` prefix, as a disassembler writes it.
    const body = /^0[xX]/.test(token) ? token.slice(2) : token;
    if (body.length === 0 || !/^[0-9a-fA-F]+$/.test(body)) return undefined;
    digits += body;
  }
  if (digits.length === 0 || digits.length % 2 !== 0) return undefined;

  const bytes = new Uint8Array(digits.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(digits.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * An address, as the offset column writes it.
 *
 * Eight upper-case digits, zero-padded, with no `0x` — upstream's
 * `bareAddress`. One place decides it, so the column, the menus that name an
 * offset, the bookmark list and the status bar all spell an address the same
 * way, and a reader can compare two of them at a glance.
 *
 * @upstream ByteRipperApp/Hex/HexView.swift#UInt64.bareAddress
 * @upstream ByteRipperApp/Hex/HexView.swift#UInt64.hexAddress
 */
export function hexAddress(offset: number): string {
  return offset.toString(16).toUpperCase().padStart(8, "0");
}
