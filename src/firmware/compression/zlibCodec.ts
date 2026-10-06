import { DecompressionError } from "@/firmware/compression/firmwareDecompression";

/**
 * zlib (RFC 1950) over DEFLATE (RFC 1951), in TypeScript: the decoder AMD's Zlib
 * sections are read with, and an encoder to put an edited buffer back with.
 *
 * Upstream calls the system's `libz`; the web has none, carries no dependency for a
 * format this small, and keeps all its compression in this directory. The browser's
 * own `DecompressionStream` is asynchronous, and the parser that opens a section is
 * not.
 *
 * @upstream Packages/FirmwareCompression/Sources/FirmwareCompression/Zlib.swift#FirmwareDecompression.zlib
 * @upstream Packages/FirmwareCompression/Sources/FirmwareCompression/Zlib.swift#FirmwareCompression.zlib
 * @upstream-differs a decoder and an encoder of our own, where upstream wraps
 * `libz`; the encoder writes one dynamic-Huffman block, which opens the same and is
 * a little longer than zlib's best level
 */

// MARK: - Decoding

/** Length codes 257…285: the base length, and the extra bits that add to it. */
const LENGTH_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131,
  163, 195, 227, 258,
];
const LENGTH_EXTRA = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
];
/** Distance codes 0…29. */
const DISTANCE_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049,
  3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
const DISTANCE_EXTRA = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13,
];
/** The order the code-length code's lengths come in. */
const CODE_LENGTH_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

const MAX_BITS = 15;

/** A canonical Huffman code, as the counts per length and the symbols in code order. */
interface Huffman {
  readonly counts: Uint16Array;
  readonly symbols: Uint16Array;
}

function huffman(lengths: ArrayLike<number>): Huffman | undefined {
  const counts = new Uint16Array(MAX_BITS + 1);
  for (let symbol = 0; symbol < lengths.length; symbol++) {
    const length = lengths[symbol] ?? 0;
    counts[length] = (counts[length] ?? 0) + 1;
  }
  counts[0] = 0;
  // An over-subscribed code is no code; an incomplete one is allowed (a block may use
  // one distance code, or none).
  let left = 1;
  for (let length = 1; length <= MAX_BITS; length++) {
    left = left * 2 - (counts[length] ?? 0);
    if (left < 0) return undefined;
  }
  const offsets = new Uint16Array(MAX_BITS + 2);
  for (let length = 1; length <= MAX_BITS; length++) {
    offsets[length + 1] = (offsets[length] ?? 0) + (counts[length] ?? 0);
  }
  const symbols = new Uint16Array(lengths.length);
  for (let symbol = 0; symbol < lengths.length; symbol++) {
    const length = lengths[symbol] ?? 0;
    if (length !== 0) {
      symbols[offsets[length] ?? 0] = symbol;
      offsets[length] = (offsets[length] ?? 0) + 1;
    }
  }
  return { counts, symbols };
}

const FIXED_LITERALS = (() => {
  const lengths = new Uint8Array(288);
  lengths.fill(8, 0, 144);
  lengths.fill(9, 144, 256);
  lengths.fill(7, 256, 280);
  lengths.fill(8, 280, 288);
  return huffman(lengths) as Huffman;
})();
const FIXED_DISTANCES = huffman(new Uint8Array(30).fill(5)) as Huffman;

/** Reads bits least significant first; running out is the reader's to say. */
class BitReader {
  private readonly data: Uint8Array;
  private position = 0;
  private bitBuffer = 0;
  private bitCount = 0;

  constructor(data: Uint8Array) {
    this.data = data;
  }

  /** The next `count` bits (up to 16), or nothing when the data ends first. */
  bits(count: number): number | undefined {
    while (this.bitCount < count) {
      const byte = this.data[this.position++];
      if (byte === undefined) return undefined;
      this.bitBuffer |= byte << this.bitCount;
      this.bitCount += 8;
    }
    const value = this.bitBuffer & ((1 << count) - 1);
    this.bitBuffer >>>= count;
    this.bitCount -= count;
    return value;
  }

  /** The next symbol of `code`, or nothing when the data ends first; -1 for no such code. */
  symbol(code: Huffman): number | undefined {
    let value = 0;
    let first = 0;
    let index = 0;
    for (let length = 1; length <= MAX_BITS; length++) {
      const bit = this.bits(1);
      if (bit === undefined) return undefined;
      value |= bit;
      const count = code.counts[length] ?? 0;
      if (value - count < first) return code.symbols[index + (value - first)] ?? -1;
      index += count;
      first = (first + count) << 1;
      value <<= 1;
    }
    return -1;
  }

  /** Throws the rest of the byte away. */
  align(): void {
    this.bitBuffer = 0;
    this.bitCount = 0;
  }

  /** The next whole byte, once aligned. */
  byte(): number | undefined {
    return this.data[this.position++];
  }

  get offset(): number {
    return this.position;
  }
}

/**
 * A zlib stream with its two-byte header, as AMD's Zlib section holds it after its own
 * 0x100-byte header — `inflateInit2(15)`, as the reference decodes it. Same contract as
 * the other decoders: the whole buffer or the reason there is none, under the caller's
 * limit.
 *
 * A stream that stops before its end mark is truncated, not short: a section read from
 * half a volume reports damage that is not there. What follows the end mark is not
 * looked at, as the reference does not.
 *
 * @upstream Packages/FirmwareCompression/Sources/FirmwareCompression/Zlib.swift#FirmwareDecompression.zlib
 */
export function zlibDecode(data: Uint8Array, limit: number): Uint8Array {
  if (data.length === 0) throw new DecompressionError({ kind: "truncated" });
  const reader = new BitReader(data);
  const cmf = reader.bits(8);
  const flg = reader.bits(8);
  if (cmf === undefined || flg === undefined) throw new DecompressionError({ kind: "truncated" });
  // Method 8 (deflate), a window up to 32 KiB, a header that checks, and no preset
  // dictionary.
  if ((cmf & 0x0f) !== 8 || cmf >> 4 > 7 || (cmf * 256 + flg) % 31 !== 0 || (flg & 0x20) !== 0) {
    throw new DecompressionError({ kind: "corrupt" });
  }

  let output = new Uint8Array(Math.min(Math.max(data.length * 4, 1024), limit + 1));
  let length = 0;
  const truncated = () => new DecompressionError({ kind: "truncated" });
  const corrupt = () => new DecompressionError({ kind: "corrupt" });
  const room = (extra: number): void => {
    if (length + extra > limit) {
      throw new DecompressionError({ kind: "tooLarge", declared: limit + 1 });
    }
    if (length + extra > output.length) {
      const grown = new Uint8Array(
        Math.min(Math.max(output.length * 2, length + extra), limit + 1)
      );
      grown.set(output.subarray(0, length));
      output = grown;
    }
  };

  let final = false;
  while (!final) {
    const header = reader.bits(3);
    if (header === undefined) throw truncated();
    final = (header & 1) === 1;
    const type = header >> 1;
    if (type === 0) {
      // Stored: the rest of the byte is thrown away, then a length and its complement.
      reader.align();
      const low = reader.byte();
      const high = reader.byte();
      const nlow = reader.byte();
      const nhigh = reader.byte();
      if (low === undefined || high === undefined || nlow === undefined || nhigh === undefined) {
        throw truncated();
      }
      const size = low | (high << 8);
      if (size !== (~(nlow | (nhigh << 8)) & 0xffff)) throw corrupt();
      room(size);
      for (let index = 0; index < size; index++) {
        const byte = reader.byte();
        if (byte === undefined) throw truncated();
        output[length++] = byte;
      }
      continue;
    }
    if (type === 3) throw corrupt();

    let literals = FIXED_LITERALS;
    let distances = FIXED_DISTANCES;
    if (type === 2) {
      const hlit = reader.bits(5);
      const hdist = reader.bits(5);
      const hclen = reader.bits(4);
      if (hlit === undefined || hdist === undefined || hclen === undefined) throw truncated();
      const literalCount = hlit + 257;
      const distanceCount = hdist + 1;
      if (literalCount > 286 || distanceCount > 30) throw corrupt();
      const lengthLengths = new Uint8Array(19);
      for (let index = 0; index < hclen + 4; index++) {
        const bits = reader.bits(3);
        if (bits === undefined) throw truncated();
        lengthLengths[CODE_LENGTH_ORDER[index] ?? 0] = bits;
      }
      const lengthCode = huffman(lengthLengths);
      if (lengthCode === undefined) throw corrupt();
      const lengths = new Uint8Array(literalCount + distanceCount);
      let at = 0;
      while (at < lengths.length) {
        const symbol = reader.symbol(lengthCode);
        if (symbol === undefined) throw truncated();
        if (symbol < 0) throw corrupt();
        if (symbol < 16) {
          lengths[at++] = symbol;
          continue;
        }
        let repeat: number | undefined;
        let value = 0;
        if (symbol === 16) {
          if (at === 0) throw corrupt();
          value = lengths[at - 1] ?? 0;
          const extra = reader.bits(2);
          repeat = extra === undefined ? undefined : 3 + extra;
        } else if (symbol === 17) {
          const extra = reader.bits(3);
          repeat = extra === undefined ? undefined : 3 + extra;
        } else {
          const extra = reader.bits(7);
          repeat = extra === undefined ? undefined : 11 + extra;
        }
        if (repeat === undefined) throw truncated();
        if (at + repeat > lengths.length) throw corrupt();
        lengths.fill(value, at, at + repeat);
        at += repeat;
      }
      // The end-of-block code must have a length.
      if ((lengths[256] ?? 0) === 0) throw corrupt();
      const literalCode = huffman(lengths.subarray(0, literalCount));
      const distanceCode = huffman(lengths.subarray(literalCount));
      if (literalCode === undefined || distanceCode === undefined) throw corrupt();
      literals = literalCode;
      distances = distanceCode;
    }

    for (;;) {
      const symbol = reader.symbol(literals);
      if (symbol === undefined) throw truncated();
      if (symbol < 0) throw corrupt();
      if (symbol < 256) {
        room(1);
        output[length++] = symbol;
        continue;
      }
      if (symbol === 256) break;
      const index = symbol - 257;
      if (index >= 29) throw corrupt();
      const extraBits = reader.bits(LENGTH_EXTRA[index] ?? 0);
      if (extraBits === undefined) throw truncated();
      const matchLength = (LENGTH_BASE[index] ?? 0) + extraBits;
      const distanceSymbol = reader.symbol(distances);
      if (distanceSymbol === undefined) throw truncated();
      if (distanceSymbol < 0 || distanceSymbol >= 30) throw corrupt();
      const distanceExtra = reader.bits(DISTANCE_EXTRA[distanceSymbol] ?? 0);
      if (distanceExtra === undefined) throw truncated();
      const distance = (DISTANCE_BASE[distanceSymbol] ?? 0) + distanceExtra;
      if (distance > length) throw corrupt();
      room(matchLength);
      for (let copied = 0; copied < matchLength; copied++) {
        output[length] = output[length - distance] ?? 0;
        length++;
      }
    }
  }

  // The end mark is the checksum after the last block: a stream without it stopped
  // early, and one that disagrees with it is damaged.
  reader.align();
  let adler = 0;
  for (let index = 0; index < 4; index++) {
    const byte = reader.byte();
    if (byte === undefined) throw truncated();
    adler = ((adler << 8) | byte) >>> 0;
  }
  if (adler !== adler32(output.subarray(0, length))) throw corrupt();
  return output.slice(0, length);
}

/** Adler-32 (RFC 1950): two sums modulo 65521. */
export function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let at = 0; at < bytes.length; ) {
    // 5552 is the most bytes that can be summed before the sums can overflow 32 bits.
    const end = Math.min(at + 5552, bytes.length);
    for (; at < end; at++) {
      a += bytes[at] ?? 0;
      b += a;
    }
    a %= 65521;
    b %= 65521;
  }
  return ((b << 16) | a) >>> 0;
}

// MARK: - Encoding

class BitWriter {
  private bytes = new Uint8Array(1024);
  private length = 0;
  private bitBuffer = 0;
  private bitCount = 0;

  /** `count` bits of `value`, least significant first. */
  bits(value: number, count: number): void {
    this.bitBuffer |= value << this.bitCount;
    this.bitCount += count;
    while (this.bitCount >= 8) {
      this.push(this.bitBuffer & 0xff);
      this.bitBuffer >>>= 8;
      this.bitCount -= 8;
    }
  }

  /** A Huffman code, which is written most significant bit first. */
  code(code: number, length: number): void {
    let reversed = 0;
    for (let bit = 0; bit < length; bit++) reversed |= ((code >> bit) & 1) << (length - 1 - bit);
    this.bits(reversed, length);
  }

  alignToByte(): void {
    if (this.bitCount > 0) this.bits(0, 8 - this.bitCount);
  }

  push(byte: number): void {
    if (this.length === this.bytes.length) {
      const grown = new Uint8Array(this.bytes.length * 2);
      grown.set(this.bytes);
      this.bytes = grown;
    }
    this.bytes[this.length++] = byte;
  }

  result(): Uint8Array {
    return this.bytes.slice(0, this.length);
  }
}

/** One symbol of the compressed block: a literal, or a length and a distance. */
interface Token {
  /** The byte, or the match's length when `distance` is non-zero. */
  readonly value: number;
  readonly distance: number;
}

const WINDOW = 32768;
const MIN_MATCH = 3;
const MAX_MATCH = 258;
const MAX_CHAIN = 4096;
const HASH_SIZE = 1 << 15;

/**
 * LZ77 over a hash chain of three-byte keys, with one step of lazy matching: a match is
 * dropped for the one after it when that one is longer.
 */
function tokenize(data: Uint8Array): Token[] {
  const tokens: Token[] = [];
  const head = new Int32Array(HASH_SIZE).fill(-1);
  const previous = new Int32Array(data.length).fill(-1);
  const hashAt = (at: number): number =>
    (((data[at] ?? 0) << 10) ^ ((data[at + 1] ?? 0) << 5) ^ (data[at + 2] ?? 0)) & (HASH_SIZE - 1);

  const insert = (at: number): void => {
    if (at + MIN_MATCH > data.length) return;
    const hash = hashAt(at);
    previous[at] = head[hash] ?? -1;
    head[hash] = at;
  };
  const longest = (at: number): { length: number; distance: number } => {
    let bestLength = MIN_MATCH - 1;
    let bestDistance = 0;
    if (at + MIN_MATCH > data.length) return { length: 0, distance: 0 };
    const limit = Math.min(MAX_MATCH, data.length - at);
    let candidate = head[hashAt(at)] ?? -1;
    let chain = MAX_CHAIN;
    while (candidate >= 0 && at - candidate <= WINDOW && chain-- > 0) {
      if (data[candidate + bestLength] === data[at + bestLength]) {
        let length = 0;
        while (length < limit && data[candidate + length] === data[at + length]) length++;
        if (length > bestLength) {
          bestLength = length;
          bestDistance = at - candidate;
          if (length === limit) break;
        }
      }
      candidate = previous[candidate] ?? -1;
    }
    return bestLength >= MIN_MATCH
      ? { length: bestLength, distance: bestDistance }
      : { length: 0, distance: 0 };
  };

  let at = 0;
  while (at < data.length) {
    const here = longest(at);
    if (here.length === 0) {
      tokens.push({ value: data[at] ?? 0, distance: 0 });
      insert(at);
      at++;
      continue;
    }
    insert(at);
    const next = longest(at + 1);
    if (next.length > here.length) {
      // The byte here goes out alone, and the longer match after it is taken.
      tokens.push({ value: data[at] ?? 0, distance: 0 });
      at++;
      continue;
    }
    tokens.push({ value: here.length, distance: here.distance });
    for (let skipped = 1; skipped < here.length; skipped++) insert(at + skipped);
    at += here.length;
  }
  return tokens;
}

/** The index of the last element of `base` that is at most `value`. */
function indexOfBase(base: readonly number[], value: number): number {
  let index = base.length - 1;
  while (index > 0 && (base[index] ?? 0) > value) index--;
  return index;
}

/**
 * Code lengths for `frequencies`, no longer than `limit`: a Huffman tree, with the
 * frequencies halved and the tree built again while it comes out deeper than the limit.
 * A symbol that never occurs has no code; one that is alone has a code of one bit.
 */
function codeLengths(frequencies: readonly number[], limit: number): Uint8Array {
  let counts = frequencies.map((count) => count);
  for (;;) {
    const lengths = new Uint8Array(counts.length);
    const used = counts.map((count, symbol) => ({ count, symbol })).filter((one) => one.count > 0);
    if (used.length === 0) return lengths;
    if (used.length === 1) {
      lengths[(used[0] as { symbol: number }).symbol] = 1;
      return lengths;
    }
    // Merge the two lightest until one is left, remembering each node's parent.
    interface Node {
      readonly weight: number;
      readonly symbol: number;
      parent: number;
    }
    const nodes: Node[] = used.map((one) => ({
      weight: one.count,
      symbol: one.symbol,
      parent: -1,
    }));
    let queue = nodes
      .map((_, index) => index)
      .sort((a, b) => (nodes[a] as Node).weight - (nodes[b] as Node).weight);
    while (queue.length > 1) {
      const a = queue.shift() as number;
      const b = queue.shift() as number;
      nodes.push({
        weight: (nodes[a] as Node).weight + (nodes[b] as Node).weight,
        symbol: -1,
        parent: -1,
      });
      const merged = nodes.length - 1;
      (nodes[a] as Node).parent = merged;
      (nodes[b] as Node).parent = merged;
      // Keep the queue ordered: the merged node goes before the first heavier one.
      let place = queue.findIndex(
        (index) => (nodes[index] as Node).weight > (nodes[merged] as Node).weight
      );
      if (place < 0) place = queue.length;
      queue.splice(place, 0, merged);
    }
    let deepest = 0;
    for (let index = 0; index < used.length; index++) {
      let depth = 0;
      for (
        let node = index;
        (nodes[node] as Node).parent >= 0;
        node = (nodes[node] as Node).parent
      ) {
        depth++;
      }
      lengths[(nodes[index] as Node).symbol] = depth;
      deepest = Math.max(deepest, depth);
    }
    if (deepest <= limit) return lengths;
    counts = counts.map((count) => (count > 0 ? (count + 1) >> 1 : 0));
    queue = [];
  }
}

/** The canonical codes of `lengths`, as RFC 1951 numbers them. */
function canonicalCodes(lengths: Uint8Array): Uint16Array {
  const counts = new Uint16Array(MAX_BITS + 1);
  for (const length of lengths) if (length > 0) counts[length] = (counts[length] ?? 0) + 1;
  const next = new Uint16Array(MAX_BITS + 2);
  let code = 0;
  for (let length = 1; length <= MAX_BITS; length++) {
    code = (code + (counts[length - 1] ?? 0)) << 1;
    next[length] = code;
  }
  const codes = new Uint16Array(lengths.length);
  for (let symbol = 0; symbol < lengths.length; symbol++) {
    const length = lengths[symbol] ?? 0;
    if (length > 0) {
      codes[symbol] = next[length] ?? 0;
      next[length] = (next[length] ?? 0) + 1;
    }
  }
  return codes;
}

/**
 * `bytes` as a zlib stream: the `78 DA` header AMD's streams carry, one dynamic-Huffman
 * block of an LZ77 pass over the whole buffer, and the Adler-32 after it. The caller
 * decodes it again to check it.
 *
 * @upstream Packages/FirmwareCompression/Sources/FirmwareCompression/Zlib.swift#FirmwareCompression.zlib
 */
export function zlibEncode(bytes: Uint8Array): Uint8Array {
  const tokens = tokenize(bytes);
  const literalFrequencies = new Array<number>(286).fill(0);
  const distanceFrequencies = new Array<number>(30).fill(0);
  literalFrequencies[256] = 1;
  for (const token of tokens) {
    if (token.distance === 0) {
      literalFrequencies[token.value] = (literalFrequencies[token.value] ?? 0) + 1;
    } else {
      const length = indexOfBase(LENGTH_BASE, token.value);
      literalFrequencies[257 + length] = (literalFrequencies[257 + length] ?? 0) + 1;
      const distance = indexOfBase(DISTANCE_BASE, token.distance);
      distanceFrequencies[distance] = (distanceFrequencies[distance] ?? 0) + 1;
    }
  }
  const literalLengths = codeLengths(literalFrequencies, MAX_BITS);
  let distanceLengths = codeLengths(distanceFrequencies, MAX_BITS);
  // A block with no match still names one distance code.
  if (distanceLengths.every((length) => length === 0)) {
    distanceLengths = new Uint8Array(30);
    distanceLengths[0] = 1;
  }
  const literalCodes = canonicalCodes(literalLengths);
  const distanceCodes = canonicalCodes(distanceLengths);

  // The two code-length tables as one run, trimmed of the symbols no block can use, and
  // squeezed with repeat codes.
  let literalCount = 286;
  while (literalCount > 257 && (literalLengths[literalCount - 1] ?? 0) === 0) literalCount--;
  let distanceCount = 30;
  while (distanceCount > 1 && (distanceLengths[distanceCount - 1] ?? 0) === 0) distanceCount--;
  const run = [
    ...literalLengths.subarray(0, literalCount),
    ...distanceLengths.subarray(0, distanceCount),
  ];
  const runSymbols: { symbol: number; extra: number; extraBits: number }[] = [];
  for (let at = 0; at < run.length; ) {
    const value = run[at] ?? 0;
    let same = 1;
    while (at + same < run.length && run[at + same] === value) same++;
    if (value === 0 && same >= 3) {
      const take = Math.min(same, 138);
      if (take >= 11) runSymbols.push({ symbol: 18, extra: take - 11, extraBits: 7 });
      else runSymbols.push({ symbol: 17, extra: take - 3, extraBits: 3 });
      at += take;
    } else if (value !== 0 && same >= 4) {
      runSymbols.push({ symbol: value, extra: 0, extraBits: 0 });
      let left = same - 1;
      at += 1;
      while (left >= 3) {
        const take = Math.min(left, 6);
        runSymbols.push({ symbol: 16, extra: take - 3, extraBits: 2 });
        left -= take;
        at += take;
      }
    } else {
      runSymbols.push({ symbol: value, extra: 0, extraBits: 0 });
      at += 1;
    }
  }
  const runFrequencies = new Array<number>(19).fill(0);
  for (const one of runSymbols) runFrequencies[one.symbol] = (runFrequencies[one.symbol] ?? 0) + 1;
  const runLengths = codeLengths(runFrequencies, 7);
  const runCodes = canonicalCodes(runLengths);
  let runCount = 19;
  while (runCount > 4 && (runLengths[CODE_LENGTH_ORDER[runCount - 1] ?? 0] ?? 0) === 0) runCount--;

  const out = new BitWriter();
  out.bits(0x78, 8);
  out.bits(0xda, 8);
  out.bits(1, 1); // the last block
  out.bits(2, 2); // dynamic Huffman
  out.bits(literalCount - 257, 5);
  out.bits(distanceCount - 1, 5);
  out.bits(runCount - 4, 4);
  for (let index = 0; index < runCount; index++) {
    out.bits(runLengths[CODE_LENGTH_ORDER[index] ?? 0] ?? 0, 3);
  }
  for (const one of runSymbols) {
    out.code(runCodes[one.symbol] ?? 0, runLengths[one.symbol] ?? 0);
    if (one.extraBits > 0) out.bits(one.extra, one.extraBits);
  }
  for (const token of tokens) {
    if (token.distance === 0) {
      out.code(literalCodes[token.value] ?? 0, literalLengths[token.value] ?? 0);
      continue;
    }
    const length = indexOfBase(LENGTH_BASE, token.value);
    out.code(literalCodes[257 + length] ?? 0, literalLengths[257 + length] ?? 0);
    const lengthExtra = LENGTH_EXTRA[length] ?? 0;
    if (lengthExtra > 0) out.bits(token.value - (LENGTH_BASE[length] ?? 0), lengthExtra);
    const distance = indexOfBase(DISTANCE_BASE, token.distance);
    out.code(distanceCodes[distance] ?? 0, distanceLengths[distance] ?? 0);
    const distanceExtra = DISTANCE_EXTRA[distance] ?? 0;
    if (distanceExtra > 0) out.bits(token.distance - (DISTANCE_BASE[distance] ?? 0), distanceExtra);
  }
  out.code(literalCodes[256] ?? 0, literalLengths[256] ?? 0);
  out.alignToByte();
  const checksum = adler32(bytes);
  for (const shift of [24, 16, 8, 0]) out.push((checksum >>> shift) & 0xff);
  return out.result();
}
