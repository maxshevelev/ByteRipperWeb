import type { ImageRange, ImageReader } from "@/firmware/imageReader";

/**
 * The arithmetic every layer of this format checks itself with.
 *
 * One idea underneath all of it: the checksum field is chosen so that the sum
 * of the structure *including* the field is zero. So verifying and computing
 * are the same operation, and a tool that rewrites a field can put the
 * structure back in order by summing what it wrote — which is exactly what the
 * FIT and FFS update procedures ask for.
 */

/** Sum of the bytes, modulo 256. */
export function sum8(bytes: Iterable<number>): number {
  let sum = 0;
  for (const byte of bytes) sum = (sum + byte) & 0xff;
  return sum;
}

/** The value that makes the byte sum come out at zero. */
export function checksum8(bytes: Iterable<number>): number {
  return (0x100 - sum8(bytes)) & 0xff;
}

/**
 * Sum of the little-endian 16-bit words, modulo 65536.
 *
 * An odd length has no answer rather than a rounded one: the FV header length
 * that produced it is itself the corruption worth reporting.
 */
export function sum16(bytes: Uint8Array): number | undefined {
  if (bytes.length % 2 !== 0) return undefined;
  let sum = 0;
  for (let index = 0; index < bytes.length; index += 2) {
    sum = (sum + ((bytes[index] ?? 0) | ((bytes[index + 1] ?? 0) << 8))) & 0xffff;
  }
  return sum;
}

export function checksum16(bytes: Uint8Array): number | undefined {
  const sum = sum16(bytes);
  return sum === undefined ? undefined : (0x1_0000 - sum) & 0xffff;
}

/**
 * Sum of the bytes of `range`, read in chunks so that a file body of any size
 * costs one buffer. Nothing when the range is not inside the image.
 */
export function sum8Of(range: ImageRange, reader: ImageReader): number | undefined {
  if (!reader.has(range)) return undefined;
  let sum = 0;
  reader.forEachChunk(range, (chunk) => {
    sum = (sum + sum8(chunk)) & 0xff;
    return true;
  });
  return sum;
}

/**
 * Sum of the little-endian 32-bit words of `range` — how an Intel microcode
 * image checks out: the sum of every dword is zero. The length must be a
 * multiple of four, and the chunking keeps it so.
 */
export function sum32Of(range: ImageRange, reader: ImageReader): number | undefined {
  if (!reader.has(range) || (range.end - range.start) % 4 !== 0) return undefined;
  let sum = 0;
  reader.forEachChunk(range, (chunk) => {
    for (let index = 0; index < chunk.length; index += 4) {
      const word =
        ((chunk[index] ?? 0) |
          ((chunk[index + 1] ?? 0) << 8) |
          ((chunk[index + 2] ?? 0) << 16) |
          ((chunk[index + 3] ?? 0) << 24)) >>>
        0;
      sum = (sum + word) >>> 0;
    }
    return true;
  });
  return sum;
}

/**
 * CRC-32, the IEEE 802.3 / zlib variant: reflected polynomial `0xEDB88320`,
 * init and final xor `0xFFFFFFFF`.
 *
 * The FTW header, the Apple SysF store and the Apple `DataCrc32` field all
 * check themselves with it, and it is the one checksum in this format that is
 * not a "sum to zero" — a stored value is compared against a computed one.
 */
export function crc32(bytes: Iterable<number>): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) {
    crc = ((crc >>> 8) ^ (CRC32_TABLE[(crc ^ byte) & 0xff] ?? 0)) >>> 0;
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

/** The reflected CRC-32 table, built once from the polynomial. */
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) {
      value = (value & 1) !== 0 ? (value >>> 1) ^ 0xedb8_8320 : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

/**
 * How a checksum and whether the structure says it counts read together: the
 * value in hex, and the validity in words — `0x5C (Valid)` or `0x5C (Invalid)`.
 *
 * An invalid one whose correct value is known says what it should be, so a
 * reader can write it back by hand as well as by Fix: `0x5C (Invalid), should
 * be 0x5A`. One spelling of it, so a checksum that carries a validity bit reads
 * the same in every panel that shows it.
 */
export function checksumText(options: {
  readonly value: number;
  readonly valid: boolean;
  readonly expected?: number | undefined;
  readonly digits?: number;
}): string {
  const digits = options.digits ?? 2;
  const padded = hex(options.value, digits);
  if (options.valid) return `${padded} (Valid)`;
  if (options.expected !== undefined) {
    return `${padded} (Invalid), should be ${hex(options.expected, digits)}`;
  }
  return `${padded} (Invalid)`;
}

/** A hex value padded to a field's width — `0x0005` for four digits. */
function hex(value: number, digits: number): string {
  return `0x${value.toString(16).toUpperCase().padStart(digits, "0")}`;
}

/**
 * Rounds `value` up to the next multiple of `alignment`, or nothing when that
 * would leave the range of exact integers — which is not a theoretical worry
 * here, since the value being aligned is usually `offset + size` with both
 * fields read out of a corrupt image.
 */
export function alignUp(value: number, alignment: number): number | undefined {
  if (alignment <= 0 || !Number.isSafeInteger(value)) return undefined;
  const remainder = value % alignment;
  if (remainder === 0) return value;
  const aligned = value + (alignment - remainder);
  return Number.isSafeInteger(aligned) ? aligned : undefined;
}
