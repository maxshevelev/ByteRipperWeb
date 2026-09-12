/**
 * The little readers the ME parsers share.
 *
 * Every ME structure is little-endian and every offset in this half is a plain
 * index into one region's bytes, so these take an array rather than a reader:
 * the ME analysis works over a region already in memory, where the UEFI side
 * streams a whole flash image through an `ImageReader`. That is the difference
 * the two halves actually have, and it is worth one module rather than a cast
 * at every call.
 *
 * Every one of these answers *something* for an out-of-range read — zero, or an
 * empty slice — because upstream's own readers do, and a parser that threw on a
 * short region would refuse to say anything about an image that is merely
 * truncated. Whether the read was in range is a question the callers that care
 * ask separately, with `has`.
 */

export const u8 = (bytes: Uint8Array, at: number): number => bytes[at] ?? 0;

export const u16 = (bytes: Uint8Array, at: number): number =>
  ((bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8)) >>> 0;

export const u24 = (bytes: Uint8Array, at: number): number =>
  ((bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8) | ((bytes[at + 2] ?? 0) << 16)) >>> 0;

export const u32 = (bytes: Uint8Array, at: number): number =>
  ((bytes[at] ?? 0) |
    ((bytes[at + 1] ?? 0) << 8) |
    ((bytes[at + 2] ?? 0) << 16) |
    ((bytes[at + 3] ?? 0) << 24)) >>>
  0;

/**
 * Two little-endian words as one number. Exact to 2^53, which is every offset a
 * flash image can hold — see D3, which is the same argument the rest of this
 * application makes about offsets.
 */
export const u64 = (bytes: Uint8Array, at: number): number =>
  u32(bytes, at) + u32(bytes, at + 4) * 2 ** 32;

/** Whether `count` bytes from `at` are actually there. */
export const has = (bytes: Uint8Array, at: number, count: number): boolean =>
  at >= 0 && count >= 0 && at + count <= bytes.length;

/** A slice, or nothing when it is not wholly in range. */
export function slice(bytes: Uint8Array, at: number, count: number): Uint8Array | undefined {
  return has(bytes, at, count) ? bytes.subarray(at, at + count) : undefined;
}

/**
 * A four-character tag like `$FPT`, read as ASCII with trailing NULs trimmed.
 *
 * Erased names come back with high bytes in them, and zeroed ones come back
 * with NULs: upstream trims the NULs and lets the rest through, so a name that
 * is nonsense reads as nonsense rather than as absent — which is what tells a
 * reader the count field was wrong.
 */
export function tag(bytes: Uint8Array, at: number, count = 4): string {
  const read = slice(bytes, at, count);
  if (read === undefined) return "";
  let text = "";
  for (const byte of read) text += String.fromCharCode(byte);
  return text.replace(/\0+$/, "");
}

/** Whether every byte of a range equals `value`. A range out of bounds is not. */
export function filledWith(bytes: Uint8Array, at: number, count: number, value: number): boolean {
  if (!has(bytes, at, count)) return false;
  for (let index = at; index < at + count; index++) {
    if (bytes[index] !== value) return false;
  }
  return true;
}

/** Where `needle` first appears in `bytes[from, to)`, or -1. */
export function find(bytes: Uint8Array, needle: Uint8Array, from: number, to: number): number {
  const first = needle[0];
  if (first === undefined) return -1;
  const limit = Math.min(to, bytes.length) - needle.length;
  for (let at = bytes.indexOf(first, Math.max(0, from)); at >= 0 && at <= limit; ) {
    let matches = true;
    for (let index = 1; index < needle.length; index++) {
      if (bytes[at + index] !== needle[index]) {
        matches = false;
        break;
      }
    }
    if (matches) return at;
    at = bytes.indexOf(first, at + 1);
  }
  return -1;
}

/** A tag's bytes, for the scans that look for one. */
export const tagBytes = (text: string): Uint8Array =>
  Uint8Array.from(text, (one) => one.charCodeAt(0));
