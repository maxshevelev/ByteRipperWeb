import { DecompressionError } from "@/firmware/compression/firmwareDecompression";

/**
 * bzip2, in TypeScript: the decoder the device overrides of an Apple system-flags store are
 * read with (`AppleOverrides`).
 *
 * Upstream wraps the system's `libbz2`; the web has none, carries no dependency for a format
 * this small, and keeps all its compression in this directory. A stream is blocks of at most
 * 900 000 bytes, each the output of a Burrows–Wheeler transform, move-to-front coding, run
 * coding of the zeros and a Huffman code of up to six tables switched every 50 symbols; the
 * bytes of a block are then run-length decoded and their CRC is checked.
 *
 * Randomised blocks — a feature of bzip2 0.9.0 and before, which nothing has written for two
 * decades — are refused as corrupt.
 *
 * @upstream Packages/FirmwareCompression/Sources/FirmwareCompression/BZip2.swift#FirmwareDecompression.bzip2
 * @upstream-differs a decoder of our own, where upstream wraps `libbz2`; it decodes the one
 * stream it is given, and the whole of it or nothing, as upstream's buffer-to-buffer call does
 */

const BLOCK_MAGIC_HIGH = 0x3141;
const BLOCK_MAGIC_MIDDLE = 0x5926;
const BLOCK_MAGIC_LOW = 0x5359;
const END_MAGIC_HIGH = 0x1772;
const END_MAGIC_MIDDLE = 0x4538;
const END_MAGIC_LOW = 0x5090;

const MAX_CODE_LENGTH = 20;
const GROUP_SIZE = 50;
const MAX_SELECTORS = 18002;
const RUN_A = 0;
const RUN_B = 1;

/** The CRC bzip2 uses: the usual polynomial, most significant bit first. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index++) {
    let value = index << 24;
    for (let bit = 0; bit < 8; bit++) {
      value = (value & 0x8000_0000) !== 0 ? (value << 1) ^ 0x04c1_1db7 : value << 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

const truncated = () => new DecompressionError({ kind: "truncated" });
const corrupt = () => new DecompressionError({ kind: "corrupt" });

/** Most significant bit first, which is how bzip2 packs everything. */
class BitReader {
  private readonly data: Uint8Array;
  private position = 0;
  private buffer = 0;
  private count = 0;

  constructor(data: Uint8Array) {
    this.data = data;
  }

  /** The next `width` bits, at most 24. */
  bits(width: number): number {
    while (this.count < width) {
      const byte = this.data[this.position];
      if (byte === undefined) throw truncated();
      this.position += 1;
      this.buffer = ((this.buffer << 8) | byte) >>> 0;
      this.count += 8;
    }
    this.count -= width;
    const value = (this.buffer >>> this.count) & ((1 << width) - 1);
    this.buffer &= (1 << this.count) - 1;
    return value;
  }

  bit(): number {
    return this.bits(1);
  }
}

/** The output, grown as it is written and never past the caller's limit. */
class Output {
  bytes: Uint8Array;
  length = 0;
  private readonly limit: number;

  constructor(limit: number, hint: number) {
    this.limit = limit;
    this.bytes = new Uint8Array(Math.min(Math.max(hint, 256), limit));
  }

  ensure(extra: number): void {
    const needed = this.length + extra;
    if (needed <= this.bytes.length) return;
    if (needed > this.limit) throw new DecompressionError({ kind: "tooLarge", declared: needed });
    const grown = new Uint8Array(Math.min(Math.max(needed, this.bytes.length * 2), this.limit));
    grown.set(this.bytes.subarray(0, this.length));
    this.bytes = grown;
  }
}

/** A Huffman table in libbz2's form: where each length's codes start, and the symbols in order. */
interface Table {
  readonly limit: Int32Array;
  readonly base: Int32Array;
  readonly permutation: Int32Array;
  readonly minLength: number;
}

function makeTable(lengths: Uint8Array, alphabetSize: number): Table {
  let minLength = 32;
  let maxLength = 0;
  for (let symbol = 0; symbol < alphabetSize; symbol++) {
    const length = lengths[symbol] ?? 0;
    if (length > maxLength) maxLength = length;
    if (length < minLength) minLength = length;
  }
  const permutation = new Int32Array(alphabetSize);
  let at = 0;
  for (let length = minLength; length <= maxLength; length++) {
    for (let symbol = 0; symbol < alphabetSize; symbol++) {
      if (lengths[symbol] === length) permutation[at++] = symbol;
    }
  }
  const base = new Int32Array(MAX_CODE_LENGTH + 2);
  for (let symbol = 0; symbol < alphabetSize; symbol++) {
    const length = (lengths[symbol] ?? 0) + 1;
    base[length] = (base[length] ?? 0) + 1;
  }
  for (let length = 1; length < base.length; length++) {
    base[length] = (base[length] ?? 0) + (base[length - 1] ?? 0);
  }
  const limit = new Int32Array(MAX_CODE_LENGTH + 2);
  let code = 0;
  for (let length = minLength; length <= maxLength; length++) {
    code += (base[length + 1] ?? 0) - (base[length] ?? 0);
    limit[length] = code - 1;
    code <<= 1;
  }
  for (let length = minLength + 1; length <= maxLength; length++) {
    base[length] = (((limit[length - 1] ?? 0) + 1) << 1) - (base[length] ?? 0);
  }
  return { limit, base, permutation, minLength };
}

function nextSymbol(bits: BitReader, table: Table): number {
  let length = table.minLength;
  let code = bits.bits(length);
  while (code > (table.limit[length] ?? -1)) {
    length += 1;
    if (length > MAX_CODE_LENGTH) throw corrupt();
    code = (code << 1) | bits.bit();
  }
  const index = code - (table.base[length] ?? 0);
  const symbol = table.permutation[index];
  if (index < 0 || symbol === undefined) throw corrupt();
  return symbol;
}

/**
 * The bytes of one bzip2 stream, `BZh1`…`BZh9` through its end marker, or why there are none:
 * `truncated` where the stream stops short, `corrupt` where it is not one or a checksum does
 * not agree, `tooLarge` where it would unpack past `limit`.
 *
 * bzip2 does not say its size, so the output grows until the stream ends or the limit is
 * reached.
 *
 * @upstream Packages/FirmwareCompression/Sources/FirmwareCompression/BZip2.swift#FirmwareDecompression.bzip2
 */
export function bzip2Decode(data: Uint8Array, limit: number): Uint8Array {
  if (data.length === 0) throw truncated();
  const bits = new BitReader(data);
  if (bits.bits(8) !== 0x42 || bits.bits(8) !== 0x5a || bits.bits(8) !== 0x68) throw corrupt();
  const level = bits.bits(8) - 0x30;
  if (level < 1 || level > 9) throw corrupt();
  const blockLimit = level * 100_000;

  const out = new Output(limit, data.length * 4);
  const block = new Uint32Array(blockLimit);
  let combined = 0;

  for (;;) {
    const high = bits.bits(16);
    const middle = bits.bits(16);
    const low = bits.bits(16);
    if (high === END_MAGIC_HIGH && middle === END_MAGIC_MIDDLE && low === END_MAGIC_LOW) {
      const stored = ((bits.bits(16) << 16) | bits.bits(16)) >>> 0;
      if (stored !== combined) throw corrupt();
      return out.bytes.slice(0, out.length);
    }
    if (high !== BLOCK_MAGIC_HIGH || middle !== BLOCK_MAGIC_MIDDLE || low !== BLOCK_MAGIC_LOW) {
      throw corrupt();
    }
    const storedCRC = ((bits.bits(16) << 16) | bits.bits(16)) >>> 0;
    const crc = decodeBlock(bits, block, blockLimit, out);
    if (crc !== storedCRC) throw corrupt();
    combined = (((combined << 1) | (combined >>> 31)) ^ crc) >>> 0;
  }
}

/** One block, appended to `out`; the CRC of what it decoded to. */
function decodeBlock(bits: BitReader, block: Uint32Array, blockLimit: number, out: Output): number {
  if (bits.bit() !== 0) throw corrupt();
  const origPointer = bits.bits(24);

  // Which byte values the block uses: sixteen ranges, then the values in each range present.
  const used = bits.bits(16);
  const symbols: number[] = [];
  for (let range = 0; range < 16; range++) {
    if ((used & (0x8000 >> range)) === 0) continue;
    const inRange = bits.bits(16);
    for (let value = 0; value < 16; value++) {
      if ((inRange & (0x8000 >> value)) !== 0) symbols.push(range * 16 + value);
    }
  }
  if (symbols.length === 0) throw corrupt();
  const alphabetSize = symbols.length + 2;
  const endOfBlock = symbols.length + 1;

  // Which Huffman table codes each run of fifty symbols, move-to-front coded.
  const tableCount = bits.bits(3);
  if (tableCount < 2 || tableCount > 6) throw corrupt();
  const selectorCount = bits.bits(15);
  if (selectorCount < 1) throw corrupt();
  const order = Array.from({ length: tableCount }, (_, index) => index);
  const selectors = new Uint8Array(Math.min(selectorCount, MAX_SELECTORS));
  for (let index = 0; index < selectorCount; index++) {
    let position = 0;
    while (bits.bit() === 1) {
      position += 1;
      if (position >= tableCount) throw corrupt();
    }
    const chosen = order[position] ?? 0;
    order.splice(position, 1);
    order.unshift(chosen);
    // A stream may name more selectors than a block can use; the extras are read and dropped.
    if (index < MAX_SELECTORS) selectors[index] = chosen;
  }

  // The tables, each as the lengths of its codes, delta coded.
  const tables: Table[] = [];
  for (let group = 0; group < tableCount; group++) {
    const lengths = new Uint8Array(alphabetSize);
    let length = bits.bits(5);
    for (let symbol = 0; symbol < alphabetSize; symbol++) {
      for (;;) {
        if (length < 1 || length > MAX_CODE_LENGTH) throw corrupt();
        if (bits.bit() === 0) break;
        length += bits.bit() === 0 ? 1 : -1;
      }
      lengths[symbol] = length;
    }
    tables.push(makeTable(lengths, alphabetSize));
  }

  // The symbols: runs of the first byte as RUNA/RUNB digits, the rest as move-to-front indices.
  const front = Uint8Array.from({ length: symbols.length }, (_, index) => index);
  const counts = new Int32Array(256);
  let length = 0;
  let selector = 0;
  let remaining = 0;
  let table = tables[0] as Table;
  const next = (): number => {
    if (remaining === 0) {
      const chosen = selectors[selector++];
      if (chosen === undefined) throw corrupt();
      table = tables[chosen] as Table;
      remaining = GROUP_SIZE;
    }
    remaining -= 1;
    return nextSymbol(bits, table);
  };

  let symbol = next();
  while (symbol !== endOfBlock) {
    if (symbol === RUN_A || symbol === RUN_B) {
      let run = 0;
      let weight = 1;
      do {
        run += symbol === RUN_A ? weight : weight * 2;
        weight *= 2;
        if (run > blockLimit) throw corrupt();
        symbol = next();
      } while (symbol === RUN_A || symbol === RUN_B);
      const value = symbols[front[0] ?? 0] ?? 0;
      if (length + run > blockLimit) throw corrupt();
      counts[value] = (counts[value] ?? 0) + run;
      block.fill(value, length, length + run);
      length += run;
      continue;
    }
    const index = symbol - 1;
    if (index >= symbols.length || length >= blockLimit) throw corrupt();
    const moved = front[index] ?? 0;
    front.copyWithin(1, 0, index);
    front[0] = moved;
    const value = symbols[moved] ?? 0;
    counts[value] = (counts[value] ?? 0) + 1;
    block[length++] = value;
    symbol = next();
  }
  if (origPointer >= length) throw corrupt();

  // Undo the Burrows–Wheeler transform: link each byte to the one that follows it.
  const starts = new Int32Array(256);
  let sum = 0;
  for (let value = 0; value < 256; value++) {
    starts[value] = sum;
    sum += counts[value] ?? 0;
  }
  for (let index = 0; index < length; index++) {
    const value = (block[index] ?? 0) & 0xff;
    const slot = starts[value] ?? 0;
    starts[value] = slot + 1;
    block[slot] = (block[slot] ?? 0) | (index << 8);
  }

  // Walk the links, undoing the run-length coding of the first stage as the bytes come:
  // four equal bytes are followed by how many more of them there are.
  let crc = 0xffff_ffff;
  let position = (block[origPointer] ?? 0) >>> 8;
  let previous = -1;
  let run = 0;
  const put = (byte: number, times: number) => {
    out.ensure(times);
    for (let copy = 0; copy < times; copy++) {
      out.bytes[out.length++] = byte;
      crc = ((crc << 8) ^ (CRC_TABLE[((crc >>> 24) ^ byte) & 0xff] ?? 0)) >>> 0;
    }
  };
  for (let step = 0; step < length; step++) {
    const entry = block[position] ?? 0;
    const byte = entry & 0xff;
    position = entry >>> 8;
    if (run === 4) {
      put(previous, byte);
      run = 0;
      previous = -1;
      continue;
    }
    run = byte === previous ? run + 1 : 1;
    previous = byte;
    put(byte, 1);
  }
  return ~crc >>> 0;
}
