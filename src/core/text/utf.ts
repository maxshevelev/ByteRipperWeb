/**
 * UTF-8 and UTF-16LE, by hand.
 *
 * `TextEncoder` and `TextDecoder` are DOM globals, which `src/core` and
 * `src/firmware` may not reach (D1), and the no-DOM typecheck says so. The rules are
 * the ones every codec follows; a malformed sequence reads as U+FFFD, as the platform's
 * decoder reads it and as Swift's `String(decoding:as:)` does.
 *
 * @web-only upstream has Foundation's string codecs
 */

/** The text of UTF-8 bytes, every malformed sequence read as U+FFFD. */
export function decodeUtf8(bytes: Uint8Array): string {
  let text = "";
  let index = 0;
  while (index < bytes.length) {
    const lead = bytes[index] ?? 0;
    const width =
      lead < 0x80
        ? 1
        : lead >= 0xc2 && lead < 0xe0
          ? 2
          : lead >= 0xe0 && lead < 0xf0
            ? 3
            : lead >= 0xf0 && lead < 0xf5
              ? 4
              : 0;
    let codePoint =
      width === 1 ? lead : width === 2 ? lead & 0x1f : width === 3 ? lead & 0x0f : lead & 0x07;
    let valid = width > 0 && index + width <= bytes.length;
    for (let next = 1; valid && next < width; next++) {
      const byte = bytes[index + next] ?? 0;
      if ((byte & 0xc0) !== 0x80) valid = false;
      else codePoint = (codePoint << 6) | (byte & 0x3f);
    }
    const minimum = width === 3 ? 0x800 : width === 4 ? 0x10000 : 0;
    if (
      valid &&
      codePoint >= minimum &&
      codePoint <= 0x10ffff &&
      !(codePoint >= 0xd800 && codePoint <= 0xdfff)
    ) {
      text += String.fromCodePoint(codePoint);
      index += width;
    } else {
      text += "�";
      index++;
    }
  }
  return text;
}

/** The text of UTF-16LE bytes; an unpaired surrogate and a stray last byte read as U+FFFD. */
export function decodeUtf16le(bytes: Uint8Array): string {
  let text = "";
  for (let at = 0; at + 1 < bytes.length; at += 2) {
    const unit = (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8);
    if (unit >= 0xd800 && unit < 0xdc00 && at + 3 < bytes.length) {
      const next = (bytes[at + 2] ?? 0) | ((bytes[at + 3] ?? 0) << 8);
      if (next >= 0xdc00 && next < 0xe000) {
        text += String.fromCharCode(unit, next);
        at += 2;
        continue;
      }
    }
    text += unit >= 0xd800 && unit < 0xe000 ? "�" : String.fromCharCode(unit);
  }
  return bytes.length % 2 === 1 ? `${text}�` : text;
}

/** The UTF-8 bytes of a text. */
export function encodeUtf8(text: string): Uint8Array {
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
