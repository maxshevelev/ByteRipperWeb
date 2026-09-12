/**
 * The CRC-32 spellings Intel ME firmware uses, and the 14-bit obfuscation
 * transform its MFS System Pages use.
 *
 * Ported from `Packages/MEFirmware/Crypto/Checksum.swift`.
 */

/**
 * Slice-by-8 CRC-32 tables, flattened: slice `k` occupies
 * `[k * 256, (k + 1) * 256)` and holds the contribution of a byte `k` positions
 * further back in the stream. Eight input bytes then cost eight independent
 * table lookups instead of eight dependent register updates — the byte-at-a-time
 * walk was about half of a whole firmware parse upstream, because a region-wide
 * CRC-32 runs over the entire image. Same polynomial (0xEDB88320, reflected), so
 * the same answer.
 */
const SLICES: Uint32Array = (() => {
  const slices = new Uint32Array(8 * 256);
  for (let n = 0; n < 256; n++) {
    let value = n;
    for (let step = 0; step < 8; step++) {
      value = (value & 1) !== 0 ? 0xedb8_8320 ^ (value >>> 1) : value >>> 1;
    }
    slices[n] = value >>> 0;
  }
  for (let k = 1; k < 8; k++) {
    for (let n = 0; n < 256; n++) {
      const previous = slices[(k - 1) * 256 + n] ?? 0;
      slices[k * 256 + n] = ((previous >>> 8) ^ (slices[previous & 0xff] ?? 0)) >>> 0;
    }
  }
  return slices;
})();

/**
 * The standard reflected CRC-32 — poly 0xEDB88320, initial and final xor
 * 0xFFFFFFFF — bit for bit what Python's `zlib.crc32` gives, and what upstream
 * MEA.py's `crccheck.crc.Crc32` gives. The `$CPD` directory CRC and a module
 * body's CRC are this one.
 */
export function crc32(bytes: Uint8Array): number {
  return (register(bytes, 0xffff_ffff) ^ 0xffff_ffff) >>> 0;
}

/**
 * CRC-32 run from a zero initial register with *no* final xor — the raw
 * register value.
 *
 * This is what MEA.py's `efs_anl` computes as
 * `~Crc32.calc(data, initvalue=0) & 0xFFFFFFFF`: crccheck finalises a zeroed
 * register by xoring with 0xFFFFFFFF, and the outer `~` inverts that back. The
 * EFS System Page header, its index area and a Data Page's header and footer
 * all compare their stored value against *this* one, and the standard spelling
 * above does not match them.
 */
export function crc32FromZero(bytes: Uint8Array): number {
  return register(bytes, 0);
}

/**
 * The table walk both spellings share, slice-by-8: a whole region or a module
 * body goes through here, and a byte at a time is the frame that dominates a
 * parse.
 */
function register(bytes: Uint8Array, initial: number): number {
  let crc = initial >>> 0;
  const count = bytes.length;
  const blockEnd = count - (count % 8);
  let offset = 0;
  while (offset < blockEnd) {
    // The running register is folded into the first four bytes; the next four
    // ride the higher slices.
    const folded =
      (crc ^
        ((bytes[offset] ?? 0) |
          ((bytes[offset + 1] ?? 0) << 8) |
          ((bytes[offset + 2] ?? 0) << 16) |
          ((bytes[offset + 3] ?? 0) << 24))) >>>
      0;
    const high =
      ((bytes[offset + 4] ?? 0) |
        ((bytes[offset + 5] ?? 0) << 8) |
        ((bytes[offset + 6] ?? 0) << 16) |
        ((bytes[offset + 7] ?? 0) << 24)) >>>
      0;
    crc =
      ((SLICES[1792 + (folded & 0xff)] ?? 0) ^
        (SLICES[1536 + ((folded >>> 8) & 0xff)] ?? 0) ^
        (SLICES[1280 + ((folded >>> 16) & 0xff)] ?? 0) ^
        (SLICES[1024 + ((folded >>> 24) & 0xff)] ?? 0) ^
        (SLICES[768 + (high & 0xff)] ?? 0) ^
        (SLICES[512 + ((high >>> 8) & 0xff)] ?? 0) ^
        (SLICES[256 + ((high >>> 16) & 0xff)] ?? 0) ^
        (SLICES[(high >>> 24) & 0xff] ?? 0)) >>>
      0;
    offset += 8;
  }
  while (offset < count) {
    crc = ((SLICES[(crc ^ (bytes[offset] ?? 0)) & 0xff] ?? 0) ^ (crc >>> 8)) >>> 0;
    offset++;
  }
  return crc;
}

/** The CCITT-16 table (poly 0x1021) the transform below walks. */
const CCITT: Uint16Array = (() => {
  const table = new Uint16Array(256);
  for (let index = 0; index < 256; index++) {
    let value = index << 8;
    for (let step = 0; step < 8; step++) {
      value = (value & 0x8000) !== 0 ? ((value << 1) ^ 0x1021) & 0xffff : (value << 1) & 0xffff;
    }
    table[index] = value;
  }
  return table;
})();

/**
 * Upstream's `Crc16_14` — the reverse de-obfuscation primitive for MFS System
 * Page chunk indexes.
 *
 * A CCITT-16 table walks the two little-endian bytes of `value`, but the running
 * CRC is kept to fourteen bits: initial 0x3FFF, masked to 0x3FFF *after* each
 * byte rather than during it, which is what makes this a transform of its own
 * rather than a truncated CCITT-16. The top two bits are left for the format's
 * own markers — 0xC000 is an unused System Page entry.
 *
 * Upstream's comment calls the fourteen bits "no bits 0 and 1", which reads as a
 * claim that 0 and 1 are never produced. They are: eight inputs give each. The
 * mechanism below is what matters and is what the format's own vector
 * (`transform(0) == 0x0B5B`) pins down.
 */
export function crc16_14(value: number): number {
  let crc = 0x3fff;
  for (const byte of [value & 0xff, (value >>> 8) & 0xff]) {
    const index = (byte ^ ((crc >>> 8) & 0xff)) & 0xff;
    crc = (((CCITT[index] ?? 0) ^ (crc << 8)) & 0x3fff) >>> 0;
  }
  return crc & 0xffff;
}
