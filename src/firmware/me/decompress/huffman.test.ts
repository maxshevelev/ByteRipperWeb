import { describe, expect, it } from "vitest";
import {
  decompressHuffman,
  dictionaryVersion,
  type HuffmanDictionary,
  type HuffmanSymbolTable,
  parseHuffmanDictionaries,
  symbolAt,
} from "@/firmware/me/decompress/huffman";

/**
 * The `Huffman.dat` grammar and the chunked decoder — upstream's
 * `HuffmanTests`.
 *
 * The code tables here are deliberately trivial: one eight-bit codeword per
 * byte, so a "compressed" body is byte for byte its decompressed content. That
 * isolates the chunk directory, the bit buffer and the dictionary machinery from
 * any question about a real Huffman table's encoding.
 */

/**
 * A dictionary whose `code` and `data` tables are the same eight-bit identity
 * code: codeword `v` decodes to the single byte `v`.
 */
function identityDictionary(unknown: readonly number[] = []): HuffmanDictionary {
  const symbols: Uint8Array[] = [];
  for (let codeword = 255; codeword >= 0; codeword--) symbols.push(Uint8Array.of(codeword));
  const unknownFlags = new Array<boolean>(symbols.length).fill(false);
  for (const codeword of unknown) {
    symbols[255 - codeword] = Uint8Array.of(0x7f);
    unknownFlags[255 - codeword] = true;
  }
  // Rows are indexed by codeword length, so lengths 0–7 are empty here.
  const table: HuffmanSymbolTable = {
    symbolsByLength: [...Array.from({ length: 8 }, () => []), symbols],
    unknownByLength: [...Array.from({ length: 8 }, () => []), unknownFlags],
  };
  return {
    shape: [{ length: 8, threshold: 0, maxCodeword: 255 }],
    code: table,
    data: table,
  };
}

/** A module whose directory declares each chunk's start offset and dictionary. */
function moduleOf(
  chunks: readonly { readonly flag: number; readonly offset: number }[],
  bodies: readonly Uint8Array[]
): Uint8Array {
  const bodySize = bodies.reduce((total, one) => total + one.length, 0);
  const bytes = new Uint8Array(chunks.length * 4 + bodySize);
  const view = new DataView(bytes.buffer);
  chunks.forEach((chunk, index) => {
    view.setUint32(index * 4, ((chunk.flag << 25) | chunk.offset) >>> 0, true);
  });
  let at = chunks.length * 4;
  for (const body of bodies) {
    bytes.set(body, at);
    at += body.length;
  }
  return bytes;
}

const content = (length: number, seed = 0x00) =>
  Uint8Array.from({ length }, (_, index) => (index & 0xff) ^ seed);

const list = (bytes: Uint8Array) => [...bytes];

describe("parseHuffmanDictionaries", () => {
  it("builds the shape, the symbols and the unknowns", () => {
    // code: length 1 codeword 0 is 'A'; length 2 codewords 0 and 3 are 'a' and
    // 'b', and codewords 1 and 2 are gaps.
    const parsed = parseHuffmanDictionaries(
      '{"12": {"code": {"0": "41", "00": "61", "11": "62"}, "data": {"0": "42"}}}'
    );
    const twelve = parsed.version12;
    if (twelve === undefined) throw new Error("version 12 should have parsed");
    expect(parsed.version11).toBeUndefined();

    expect(twelve.shape.map((one) => one.length)).toEqual([1, 2]); // ascending
    expect(twelve.shape[0]?.threshold).toBe(0);
    expect(twelve.shape[0]?.maxCodeword).toBe(0);
    expect(twelve.shape[1]?.maxCodeword).toBe(3);

    // The length-2 symbols are indexed by `max - codeword`: 3 is 'b', 2 and 1
    // are gaps, 0 is 'a'.
    expect(list(symbolAt(twelve.code, 2, 0).bytes)).toEqual([0x62]);
    expect(list(symbolAt(twelve.code, 2, 1).bytes)).toEqual([0x7f]);
    expect(list(symbolAt(twelve.code, 2, 2).bytes)).toEqual([0x7f]);
    expect(list(symbolAt(twelve.code, 2, 3).bytes)).toEqual([0x61]);
    // The gaps are the unknown ones, flagged index for index with the symbols.
    expect(twelve.code.unknownByLength[2]).toEqual([false, true, true, false]);
    expect(list(symbolAt(twelve.code, 1, 0).bytes)).toEqual([0x41]);
    // The data table is built from its own mapping under the *code* shape.
    expect(list(symbolAt(twelve.data, 1, 0).bytes)).toEqual([0x42]);
  });

  it("refuses a version with no code table", () => {
    expect(() => parseHuffmanDictionaries('{"12": {"data": {}}}')).toThrow();
  });

  it("refuses what is not JSON at all", () => {
    expect(() => parseHuffmanDictionaries("not json")).toThrow();
  });
});

describe("dictionaryVersion", () => {
  it("picks the version upstream picks", () => {
    expect(dictionaryVersion("CSME", 11, 0)).toBe(11);
    expect(dictionaryVersion("CSME", 12, 0)).toBe(12);
    expect(dictionaryVersion("CSME", 14, 5)).toBe(11);
    expect(dictionaryVersion("CSME", 15, 30)).toBe(12);
    expect(dictionaryVersion("CSSPS", 4, 0)).toBe(11);
    expect(dictionaryVersion("CSSPS", 1, 0)).toBeUndefined();
    expect(dictionaryVersion("PMC", 1, 0)).toBeUndefined();
    expect(dictionaryVersion("CSTXEC", 1, 0)).toBeUndefined();
  });
});

describe("decompressHuffman", () => {
  it("decodes a single chunk", () => {
    const dictionary = identityDictionary();
    const body = content(0x1000);
    const result = decompressHuffman({
      module: moduleOf([{ flag: 0x20, offset: 0 }], [body]),
      compressedSize: 4 + 0x1000,
      decompressedSize: 0x1000,
      dictionary,
    });

    expect(list(result.output)).toEqual(list(body));
    expect(result.clean).toBe(true);
  });

  it("gives each chunk its own dictionary and its own start offset", () => {
    // Chunk 0 uses the code table and chunk 1 the data table; the second
    // directory entry points at its own start inside the stream.
    const dictionary = identityDictionary();
    const first = content(0x1000, 0x11);
    const second = content(0x1000, 0xee);
    const result = decompressHuffman({
      module: moduleOf(
        [
          { flag: 0x20, offset: 0 },
          { flag: 0x60, offset: 0x1000 },
        ],
        [first, second]
      ),
      compressedSize: 8 + 0x2000,
      decompressedSize: 0x2000,
      dictionary,
    });

    expect(list(result.output)).toEqual([...list(first), ...list(second)]);
    expect(result.clean).toBe(true);
  });

  it("fills everything when the module is shorter than its own directory", () => {
    // The size implies two chunks and so an eight-byte directory, but the module
    // is four bytes: the directory cannot even be read. That is a fill and an
    // unclean verdict, never a read past the end.
    const result = decompressHuffman({
      module: new Uint8Array(4).fill(0xff),
      compressedSize: 4,
      decompressedSize: 0x2000,
      dictionary: identityDictionary(),
    });

    expect(result.output.length).toBe(0x2000);
    expect(result.output.every((byte) => byte === 0x7f)).toBe(true);
    expect(result.clean).toBe(false);
  });

  it("fills a truncated chunk and carries on into the next", () => {
    // Chunk 0's stream is only its four-byte head, since chunk 1 begins right
    // after it — so chunk 0 runs dry after four symbols and is filled to its
    // boundary, and the *second* chunk still decodes its own body.
    const dictionary = identityDictionary();
    const head = content(4);
    const second = content(0x1000, 0x5a);
    const result = decompressHuffman({
      module: moduleOf(
        [
          { flag: 0x20, offset: 0 },
          { flag: 0x20, offset: 4 },
        ],
        [head, second]
      ),
      compressedSize: 8 + 4 + 0x1000,
      decompressedSize: 0x2000,
      dictionary,
    });

    expect(result.output.length).toBe(0x2000);
    expect(list(result.output.subarray(0, 4))).toEqual(list(head));
    expect(result.output.subarray(4, 0x1000).every((byte) => byte === 0x7f)).toBe(true);
    expect(list(result.output.subarray(0x1000))).toEqual(list(second));
    expect(result.clean).toBe(false);
  });

  it("flags an unknown codeword but keeps emitting", () => {
    // The run is flagged and decoding continues past it, so the output's length
    // is unaffected — which is what lets a later chunk still be read.
    const dictionary = identityDictionary([0x41]);
    const body = new Uint8Array(0x1000).fill(0xaa);
    body[10] = 0x41;
    const result = decompressHuffman({
      module: moduleOf([{ flag: 0x20, offset: 0 }], [body]),
      compressedSize: 4 + 0x1000,
      decompressedSize: 0x1000,
      dictionary,
    });

    expect(result.output.length).toBe(0x1000);
    expect(result.output[10]).toBe(0x7f); // the placeholder came through
    expect(result.output[11]).toBe(0xaa); // and decoding continued past it
    expect(result.clean).toBe(false);
  });

  it("gives nothing for a zero decompressed size", () => {
    const result = decompressHuffman({
      module: new Uint8Array(0),
      compressedSize: 0,
      decompressedSize: 0,
      dictionary: identityDictionary(),
    });

    expect(result.output.length).toBe(0);
    expect(result.clean).toBe(false);
  });
});
