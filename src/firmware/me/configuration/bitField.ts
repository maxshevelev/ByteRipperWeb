/**
 * A field of up to 64 bits, read little-endian from `bytes` starting at `at`, beginning
 * `bit` bits into that byte and `count` bits wide — the read every one of the tools'
 * layouts states. Read through `BigInt` so a field that runs past the 32-bit word it
 * starts in keeps its bits; a value past 2^53 is not exact as a number, and the callers
 * whose fields can be that wide say what they do about it. Nothing where the bytes the
 * field's last bit touches are not all there.
 *
 * @web-only upstream reads the same bytes into a `UInt64` at each of its readers
 */
export function bitField(
  bytes: Uint8Array,
  at: number,
  bit: number,
  count: number
): bigint | undefined {
  if (count <= 0 || count > 64 || bit < 0 || at < 0) return undefined;
  // The bytes the field's last bit touches, no more: an offset near the end still reads
  // where the field fits.
  const touched = Math.ceil((bit + count) / 8);
  if (touched > 9 || at + touched > bytes.length) return undefined;
  let word = 0n;
  for (let index = 0; index < touched; index++) {
    word |= BigInt(bytes[at + index] ?? 0) << BigInt(8 * index);
  }
  return (word >> BigInt(bit)) & ((1n << BigInt(count)) - 1n);
}
