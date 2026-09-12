/**
 * CSE Huffman decompression.
 *
 * A faithful port of upstream `cse_huffman_decompress` and
 * `cse_huffman_dictionary_load`, themselves by IllegalArgument. The
 * dictionaries ship in `Huffman.dat`, which is fetched rather than snapshotted,
 * keyed by dictionary version ("11" or "12"); each version holds two canonical
 * codeword tables — `code` (dictionary type 0x20) and `data` (0x60) — mapping a
 * codeword's bit string to a hex symbol. Modules are compressed in 0x1000
 * chunks, and each chunk starts with a four-byte directory entry: a start offset
 * in bits 0–24 and the dictionary type in bits 25–31.
 *
 * Ported from `Packages/MEFirmware/Decompress/Huffman.swift`.
 */

/**
 * One entry of the canonical-code shape: codewords of `length` bits occupy the
 * integer range whose smallest value is `threshold >>> (32 - length)` — the
 * threshold is that minimum shifted up to the 32-bit top, because the decoder
 * compares it against a 32-bit window — and whose largest is `maxCodeword`.
 */
export interface HuffmanShape {
  readonly length: number;
  readonly threshold: number;
  readonly maxCodeword: number;
}

/**
 * Symbols for one dictionary type, grouped by codeword length.
 *
 * `symbolsByLength[L]` is indexed by `maxCodeword - codeword`, since the
 * codewords are stored descending. Plain arrays indexed by length rather than a
 * map keyed by it: the decoder resolves one of these per output symbol, and
 * hashing per symbol was the single most expensive thing in a CSME 11 or 12
 * parse upstream. Rows for lengths the dictionary does not use are empty.
 */
export interface HuffmanSymbolTable {
  readonly symbolsByLength: readonly (readonly Uint8Array[])[];
  /**
   * Index for index with the symbols: true where the symbol string was empty or
   * `??` — the placeholders upstream reports as *unknown* and flags.
   */
  readonly unknownByLength: readonly (readonly boolean[])[];
}

/** A missing codeword's symbol, which is what upstream fills a gap with. */
const PLACEHOLDER = Uint8Array.of(0x7f);

/**
 * The symbol for a codeword of `length`, and whether it is one of the unknown
 * placeholders. An out-of-range ask answers like a missing codeword.
 */
export function symbolAt(
  table: HuffmanSymbolTable,
  length: number,
  index: number
): { readonly bytes: Uint8Array; readonly unknown: boolean } {
  const row = table.symbolsByLength[length];
  if (row === undefined) return { bytes: PLACEHOLDER, unknown: true };
  const bytes = row[index];
  if (bytes === undefined) return { bytes: PLACEHOLDER, unknown: true };
  return { bytes, unknown: table.unknownByLength[length]?.[index] ?? true };
}

/**
 * One parsed dictionary version: the canonical shape — taken from the `code`
 * table, as upstream does, which warns and proceeds if `data` disagrees — and
 * the two symbol tables.
 */
export interface HuffmanDictionary {
  /** Ascending by codeword length. */
  readonly shape: readonly HuffmanShape[];
  /** Dictionary type 0x20. */
  readonly code: HuffmanSymbolTable;
  /** Dictionary type 0x60. */
  readonly data: HuffmanSymbolTable;
}

/**
 * The parsed contents of `Huffman.dat`, keyed by dictionary version.
 *
 * The file carries no per-module signal of its own: the right table is chosen
 * by the engine's variant, major and minor, exactly as upstream does.
 */
export interface HuffmanDictionaries {
  readonly version11: HuffmanDictionary | undefined;
  readonly version12: HuffmanDictionary | undefined;
}

export const NO_DICTIONARIES: HuffmanDictionaries = {
  version11: undefined,
  version12: undefined,
};

/**
 * The dictionary version for a variant and version, or nothing where no Huffman
 * dictionary is needed at all — the non-CSE engines, and CSSPS 1.
 */
export function dictionaryVersion(
  variant: string,
  major: number,
  minor: number
): 11 | 12 | undefined {
  if (
    variant.startsWith("CSTXE") ||
    variant.startsWith("PMC") ||
    variant.startsWith("PCHC") ||
    variant.startsWith("PHY") ||
    variant.startsWith("OROM") ||
    (variant === "CSSPS" && major === 1)
  ) {
    return undefined;
  }
  if (
    (variant === "CSME" && major === 11) ||
    (variant === "CSSPS" && major === 4) ||
    (variant === "CSME" && major === 14 && minor === 5)
  ) {
    return 11;
  }
  return 12;
}

/** The parsed dictionary for a variant and version, or nothing when none. */
export function dictionaryFor(
  dictionaries: HuffmanDictionaries,
  variant: string,
  major: number,
  minor: number
): HuffmanDictionary | undefined {
  switch (dictionaryVersion(variant, major, minor)) {
    case 11:
      return dictionaries.version11;
    case 12:
      return dictionaries.version12;
    default:
      return undefined;
  }
}

/** Why `Huffman.dat` could not be read. */
export class HuffmanFileError extends Error {
  constructor(detail: string) {
    super(`Huffman.dat ${detail}`);
    this.name = "HuffmanFileError";
  }
}

/**
 * Parses `Huffman.dat`: `{"<version>": {"code": {bits: hex}, "data": {…}}}`.
 */
export function parseHuffmanDictionaries(text: string): HuffmanDictionaries {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    throw new HuffmanFileError("is not JSON.");
  }
  if (typeof root !== "object" || root === null) {
    throw new HuffmanFileError("is not an object of dictionary versions.");
  }

  const parsed: { version11?: HuffmanDictionary; version12?: HuffmanDictionary } = {};
  for (const key of ["11", "12"] as const) {
    const version = (root as Record<string, unknown>)[key];
    if (typeof version !== "object" || version === null) continue;
    const code = (version as Record<string, unknown>).code;
    const data = (version as Record<string, unknown>).data;
    if (!isSymbolMap(code) || !isSymbolMap(data)) {
      throw new HuffmanFileError(`version ${key} has no code and data tables.`);
    }
    const shape = shapeOf(code);
    if (shape.length === 0) throw new HuffmanFileError(`version ${key} has no codewords.`);
    const dictionary: HuffmanDictionary = {
      shape,
      code: tableOf(code, shape),
      data: tableOf(data, shape),
    };
    if (key === "11") parsed.version11 = dictionary;
    else parsed.version12 = dictionary;
  }
  return { version11: parsed.version11, version12: parsed.version12 };
}

function isSymbolMap(value: unknown): value is Record<string, string> {
  if (typeof value !== "object" || value === null) return false;
  return Object.values(value).every((one) => typeof one === "string");
}

/**
 * The canonical shape of one mapping: the codewords grouped by bit length,
 * ascending, each length's used codewords occupying `[min, max]`.
 */
function shapeOf(mapping: Record<string, string>): HuffmanShape[] {
  const ranges = new Map<number, { min: number; max: number }>();
  for (const bits of Object.keys(mapping)) {
    if (!/^[01]+$/.test(bits)) continue;
    const value = Number.parseInt(bits, 2);
    const current = ranges.get(bits.length);
    ranges.set(bits.length, {
      min: Math.min(current?.min ?? value, value),
      max: Math.max(current?.max ?? -1, value),
    });
  }
  return [...ranges.keys()]
    .sort((left, right) => left - right)
    .filter((length) => length >= 1 && length <= 32)
    .map((length) => {
      const range = ranges.get(length) ?? { min: 0, max: -1 };
      // `min << (32 - length)`: min is below 2^length, so the shift fits.
      return {
        length,
        threshold: (range.min * 2 ** (32 - length)) >>> 0,
        maxCodeword: range.max,
      };
    });
}

/**
 * Symbols for one mapping, grouped by length.
 *
 * Upstream walks a length's codewords from max down to min, so the index is
 * `maxCodeword - codeword`; gaps — codewords absent from the mapping — become
 * unknown placeholders, recorded so the decoder can flag them.
 */
function tableOf(
  mapping: Record<string, string>,
  shape: readonly HuffmanShape[]
): HuffmanSymbolTable {
  const rows = Math.max(0, ...shape.map((one) => one.length)) + 1;
  const symbolsByLength: Uint8Array[][] = Array.from({ length: rows }, () => []);
  const unknownByLength: boolean[][] = Array.from({ length: rows }, () => []);

  for (const entry of shape) {
    const symbols: Uint8Array[] = [];
    const unknowns: boolean[] = [];
    for (let codeword = entry.maxCodeword; codeword >= 0; codeword--) {
      // Only codewords within [min, max] are used; the rest are padded with
      // placeholders so indexing by `max - codeword` stays dense.
      const bits = codeword.toString(2).padStart(entry.length, "0");
      const symbol = mapping[bits];
      if (symbol === undefined) {
        symbols.push(PLACEHOLDER);
        unknowns.push(true);
        continue;
      }
      symbols.push(symbolBytes(symbol));
      unknowns.push(symbol.trim().length === 0 || symbol.includes("??"));
    }
    symbolsByLength[entry.length] = symbols;
    unknownByLength[entry.length] = unknowns;
  }
  return { symbolsByLength, unknownByLength };
}

/**
 * A symbol string as bytes. An empty one, and one made of `??`, mean unknown
 * codewords and expand to placeholders — one per pair. Anything else is hex.
 */
function symbolBytes(symbol: string): Uint8Array {
  const trimmed = symbol.trim();
  if (trimmed.length === 0) return PLACEHOLDER;
  if (trimmed.length % 2 === 0 && trimmed.includes("??")) {
    return new Uint8Array(trimmed.length / 2).fill(0x7f);
  }
  const bytes: number[] = [];
  for (let index = 0; index < trimmed.length; index += 2) {
    const byte = Number.parseInt(trimmed.slice(index, index + 2), 16);
    if (!Number.isNaN(byte)) bytes.push(byte);
  }
  return Uint8Array.from(bytes);
}

// MARK: - Decompressing

export const HUFFMAN_CHUNK_SIZE = 0x1000;

/**
 * Decompresses a module.
 *
 * `module` is the raw module bytes, of which the first `chunkCount * 4` are the
 * chunk directory and `[headerSize, compressedSize)` the compressed stream.
 *
 * It always yields exactly `decompressedSize` bytes, as upstream does — it never
 * returns early. A chunk that runs out of stream, meets an overflowing codeword
 * or hits an unknown one is filled to its 0x1000 boundary with placeholders and
 * decoding carries on into the next chunk. `clean` is false when any chunk hit
 * one of those, which is upstream's `huff_error`.
 */
export function decompressHuffman(options: {
  readonly module: Uint8Array;
  readonly compressedSize: number;
  readonly decompressedSize: number;
  readonly dictionary: HuffmanDictionary;
}): { readonly output: Uint8Array; readonly clean: boolean } {
  const { module, compressedSize, decompressedSize, dictionary } = options;
  if (decompressedSize <= 0) return { output: new Uint8Array(0), clean: false };
  if (dictionary.shape.length === 0) return { output: module, clean: false };

  const chunkCount = Math.floor(decompressedSize / HUFFMAN_CHUNK_SIZE);
  const headerSize = chunkCount * 4;
  const bounded = Math.min(module.length, Math.max(0, compressedSize));
  if (headerSize > bounded) {
    return { output: new Uint8Array(decompressedSize).fill(0x7f), clean: false };
  }

  // The chunk directory: a start offset in the compressed stream, and which of
  // the two dictionary types the chunk was coded with.
  const startOffsets: number[] = [];
  const flags: number[] = [];
  for (let index = 0; index < chunkCount; index++) {
    const entry = readUint32(module, index * 4);
    startOffsets.push(entry & 0x1ff_ffff);
    flags.push((entry >>> 25) & 0x7f);
  }
  const endOffsets = [...startOffsets.slice(1), Math.max(0, bounded - headerSize)];

  const out = new Uint8Array(decompressedSize);
  let written = 0;
  let clean = true;

  for (let chunk = 0; chunk < chunkCount; chunk++) {
    const table = flags[chunk] === 0x60 ? dictionary.data : dictionary.code;
    const compressedStart = startOffsets[chunk] ?? 0;
    const compressedEnd = Math.min(endOffsets[chunk] ?? 0, bounded - headerSize);
    const decompressedEnd = (chunk + 1) * HUFFMAN_CHUNK_SIZE;

    let bitBuffer = 0;
    let availableBits = 0;
    let read = compressedStart;

    while (written < decompressedEnd) {
      // Top up the 32-bit window until a codeword is decidable.
      while (availableBits <= 24 && read < compressedEnd) {
        bitBuffer = (bitBuffer | ((module[headerSize + read] ?? 0) << (24 - availableBits))) >>> 0;
        read++;
        availableBits += 8;
      }
      // The shortest codeword length whose range the window tops out in.
      let length = 0;
      let baseCodeword = 0;
      for (const entry of dictionary.shape) {
        if (bitBuffer >= entry.threshold) {
          length = entry.length;
          baseCodeword = entry.maxCodeword;
          break;
        }
      }
      if (length === 0 || availableBits < length) {
        // The compressed stream ran out early: fill this chunk's tail and stop
        // it. Later chunks still decode — each has its own start offset.
        out.fill(0x7f, written, decompressedEnd);
        written = decompressedEnd;
        clean = false;
        break;
      }
      const codeword = bitBuffer >>> (32 - length);
      bitBuffer = (bitBuffer << length) >>> 0;
      availableBits -= length;

      const resolved = symbolAt(table, length, baseCodeword - codeword);
      if (decompressedEnd - written < resolved.bytes.length) {
        // An overflowing codeword: pad the tail and stop this chunk.
        out.fill(0x7f, written, decompressedEnd);
        written = decompressedEnd;
        clean = false;
        break;
      }
      if (resolved.unknown) clean = false;
      out.set(resolved.bytes, written);
      written += resolved.bytes.length;
    }
  }
  return { output: out.subarray(0, written), clean };
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) |
      ((bytes[offset + 1] ?? 0) << 8) |
      ((bytes[offset + 2] ?? 0) << 16) |
      ((bytes[offset + 3] ?? 0) << 24)) >>>
    0
  );
}
