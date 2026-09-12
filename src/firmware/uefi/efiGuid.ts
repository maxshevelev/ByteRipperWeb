/**
 * `EFI_GUID`: sixteen bytes, and the reason half of this format is a lookup
 * table.
 *
 * Held as the four 32-bit words of its raw bytes rather than as an array, so
 * that comparing one against a known GUID — which the parser does for every
 * volume, every file and every GUID-defined section, and at every byte in the
 * NVRAM walk — is four integer compares and no allocation. Upstream uses two
 * 64-bit halves for the same reason; JavaScript has no 64-bit integer that is
 * not a `bigint`, and a `bigint` per comparison is exactly the allocation this
 * shape exists to avoid.
 *
 * The textual form is the mixed-endian one everyone writes GUIDs in: the first
 * three fields are little-endian numbers, the last eight bytes are printed in
 * the order they are stored. That asymmetry is not ours to fix — a GUID copied
 * out of a specification has to match a GUID read out of an image.
 */

export interface EFIGUID {
  /** Bytes 0..4, little-endian. */
  readonly a: number;
  /** Bytes 4..8. */
  readonly b: number;
  /** Bytes 8..12. */
  readonly c: number;
  /** Bytes 12..16. */
  readonly d: number;
}

/** All sixteen bytes `0x00`, which is how an absent GUID is written. */
export const GUID_ZERO: EFIGUID = { a: 0, b: 0, c: 0, d: 0 };

export function guidEquals(left: EFIGUID, right: EFIGUID): boolean {
  return left.a === right.a && left.b === right.b && left.c === right.c && left.d === right.d;
}

const word = (bytes: Uint8Array, at: number): number =>
  ((bytes[at] ?? 0) |
    ((bytes[at + 1] ?? 0) << 8) |
    ((bytes[at + 2] ?? 0) << 16) |
    ((bytes[at + 3] ?? 0) << 24)) >>>
  0;

/** Sixteen bytes as they lie in the image, starting at `at`. */
export function guidFromBytes(bytes: Uint8Array, at = 0): EFIGUID {
  return {
    a: word(bytes, at),
    b: word(bytes, at + 4),
    c: word(bytes, at + 8),
    d: word(bytes, at + 12),
  };
}

/** The sixteen bytes, in image order. */
export function guidBytes(guid: EFIGUID): Uint8Array {
  const bytes = new Uint8Array(16);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, guid.a, true);
  view.setUint32(4, guid.b, true);
  view.setUint32(8, guid.c, true);
  view.setUint32(12, guid.d, true);
  return bytes;
}

const hex = (bytes: Uint8Array, from: number, to: number, reversed = false): string => {
  const slice = [...bytes.subarray(from, to)];
  if (reversed) slice.reverse();
  return slice.map((byte) => byte.toString(16).toUpperCase().padStart(2, "0")).join("");
};

/** `XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX`, upper case and unbraced. */
export function guidText(guid: EFIGUID): string {
  const bytes = guidBytes(guid);
  return [
    hex(bytes, 0, 4, true),
    hex(bytes, 4, 6, true),
    hex(bytes, 6, 8, true),
    hex(bytes, 8, 10),
    hex(bytes, 10, 16),
  ].join("-");
}

/**
 * Reads the form above, with or without braces, in any case — specifications
 * and vendors disagree about case, and a table typed from one has to match an
 * image written by the other.
 */
export function guidFromText(text: string): EFIGUID | undefined {
  let digits = text.trim();
  if (digits.startsWith("{") && digits.endsWith("}")) digits = digits.slice(1, -1);
  const fields = digits.split("-");
  const widths = [8, 4, 4, 4, 12];
  if (fields.length !== widths.length) return undefined;

  const bytes = new Uint8Array(16);
  let at = 0;
  for (let index = 0; index < fields.length; index++) {
    const field = fields[index] ?? "";
    if (field.length !== widths[index]) return undefined;
    if (!/^[0-9a-fA-F]+$/.test(field)) return undefined;
    for (let pair = 0; pair < field.length; pair += 2) {
      bytes[at++] = Number.parseInt(field.slice(pair, pair + 2), 16);
    }
  }
  // The first three fields are little-endian numbers; the rest is a byte
  // string. So only the first eight bytes are reversed, in three pieces.
  const reordered = new Uint8Array(16);
  reordered.set([...bytes.subarray(0, 4)].reverse(), 0);
  reordered.set([...bytes.subarray(4, 6)].reverse(), 4);
  reordered.set([...bytes.subarray(6, 8)].reverse(), 6);
  reordered.set(bytes.subarray(8, 16), 8);
  return guidFromBytes(reordered);
}

/**
 * A key for the lookup tables.
 *
 * The text form, because that is what the tables are written in and what a
 * miss has to be reported as. Never used on the hot path — a recogniser
 * comparing against a constant uses {@link guidEquals}, which allocates
 * nothing.
 */
export function guidKey(guid: EFIGUID): string {
  return guidText(guid);
}

/** A GUID written into source, for the tables. Throws on a typo, at load. */
export function guid(text: string): EFIGUID {
  const parsed = guidFromText(text);
  if (parsed === undefined) throw new Error(`"${text}" is not a GUID`);
  return parsed;
}
