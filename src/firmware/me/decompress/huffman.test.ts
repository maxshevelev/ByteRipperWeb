import { describe, expect, it } from "vitest";
import { hex, sha256 } from "@/firmware/me/crypto/digest";
import {
  decompressHuffman,
  dictionaryVersion,
  type HuffmanDictionary,
  type HuffmanSymbolTable,
  NO_DICTIONARIES,
  parseHuffmanDictionaries,
  symbolAt,
} from "@/firmware/me/decompress/huffman";
import {
  huffmanSlices,
  huffmanValidationIssues,
  unmatchedMetadataHashes,
} from "@/firmware/me/engine/analyzer";
import type { CodePartition, CPDModuleRow } from "@/firmware/me/models/firmwareAnalysis";

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
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/HuffmanTests.swift#HuffmanTests.testParseBuildsShapeSymbolsAndUnknowns
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

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/HuffmanTests.swift#HuffmanTests.testParseRejectsMissingCodeTable
  it("refuses a version with no code table", () => {
    expect(() => parseHuffmanDictionaries('{"12": {"data": {}}}')).toThrow();
  });

  it("refuses what is not JSON at all", () => {
    expect(() => parseHuffmanDictionaries("not json")).toThrow();
  });
});

describe("dictionaryVersion", () => {
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/HuffmanTests.swift#HuffmanTests.testDictionaryVersionSelection
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
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/HuffmanTests.swift#HuffmanTests.testDecodeSingleChunkIdentity
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

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/HuffmanTests.swift#HuffmanTests.testDecodeTwoChunksWithIndependentDictionariesAndOffsets
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

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/HuffmanTests.swift#HuffmanTests.testDecodeModuleShorterThanItsDirectoryFillsAll
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

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/HuffmanTests.swift#HuffmanTests.testDecodeTruncatedStreamFillsAndContinuesToNextChunk
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

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/HuffmanTests.swift#HuffmanTests.testDecodeUnknownCodewordFlagsCleanButStillEmits
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

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/HuffmanTests.swift#HuffmanTests.testDecodeEmptyDecompressedSizeYieldsEmpty
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

// MARK: The module check, with a dictionary at hand

const IDENTITY = { variant: "CSME", major: 15, minor: 0 };

function join(parts: readonly Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(parts.reduce((total, one) => total + one.length, 0));
  let at = 0;
  for (const part of parts) {
    bytes.set(part, at);
    at += part.length;
  }
  return bytes;
}

/**
 * A `$CPD` with one Huffman module "kernel" at 0x100 — `body` behind a one-chunk
 * directory — and its `.met`, whose Module Attributes declare the compressed and
 * uncompressed sizes; and a region holding it, cut to `regionSize` when given.
 */
function huffmanPartition(body: Uint8Array, regionSize?: number) {
  const stream = moduleOf([{ flag: 0x20, offset: 0 }], [body]);
  const partition: CodePartition = {
    name: "FTPR",
    offset: 0,
    headerVersion: 2,
    headerLength: 0x14,
    numModules: 2,
    checksumValid: true,
    extensions: [],
    modules: [
      { name: "kernel", offset: 0x100, isHuffman: true, size: body.length },
      {
        name: "kernel.met",
        offset: 0x80,
        isHuffman: false,
        size: 0x60,
        extensions: [
          {
            tag: 0x0a,
            size: 0x60,
            offset: 0x80,
            moduleAttributes: {
              compression: 1,
              encryption: 0,
              uncompressedSize: body.length,
              compressedSize: stream.length,
              deviceID: 0,
              vendorID: 0x8086,
              moduleHash: "",
            },
          },
        ],
      },
    ],
  };
  const region = join([new Uint8Array(0x100), stream]);
  return { partition, region: regionSize === undefined ? region : region.subarray(0, regionSize) };
}

const huffmanIssues = (
  partition: CodePartition,
  region: Uint8Array,
  dictionary: HuffmanDictionary | undefined
) =>
  huffmanValidationIssues(
    partition,
    region,
    0,
    IDENTITY,
    dictionary === undefined ? undefined : { ...NO_DICTIONARIES, version12: dictionary }
  );

describe("the module check, with a dictionary at hand", () => {
  // A module the dictionary decodes cleanly to its declared size says nothing.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/HuffmanTests.swift#HuffmanTests.testTheModuleCheckPassesACleanModule
  it("passes a clean module", () => {
    const { partition, region } = huffmanPartition(content(0x1000));
    expect(huffmanIssues(partition, region, identityDictionary())).toEqual([]);
  });

  // A codeword the dictionary does not know is an issue 7 that names the module
  // it is in.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/HuffmanTests.swift#HuffmanTests.testTheModuleCheckNamesAModuleWithUnknownCodewords
  it("names a module with unknown codewords", () => {
    const body = new Uint8Array(0x1000).fill(0xaa);
    body[10] = 0x41;
    const { partition, region } = huffmanPartition(body);

    const issues = huffmanIssues(partition, region, identityDictionary([0x41]));

    expect(issues).toHaveLength(1);
    expect(issues[0]?.id).toBe(7);
    expect(issues[0]?.module).toBe("kernel");
    expect(issues[0]?.message).toContain("unknown codewords");
  });

  // A module whose compressed bytes run past the region cannot be checked, and
  // says which module that is.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/HuffmanTests.swift#HuffmanTests.testTheModuleCheckNamesAModuleCutShortByTheRegion
  it("names a module cut short by the region", () => {
    const { partition, region } = huffmanPartition(content(0x1000), 0x800);

    const issue = huffmanIssues(partition, region, identityDictionary())[0];
    expect(issue?.id).toBe(7);
    expect(issue?.module).toBe("kernel");
    expect(issue?.message).toContain("extends past the end");
  });

  // With no dictionary at hand there is nothing to check a module against, so
  // there is no issue either.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/HuffmanTests.swift#HuffmanTests.testTheModuleCheckNeedsADictionary
  it("needs a dictionary", () => {
    const body = new Uint8Array(0x1000).fill(0xaa);
    body[10] = 0x41;
    const { partition, region } = huffmanPartition(body);
    expect(huffmanIssues(partition, region, undefined)).toEqual([]);
  });
});

// MARK: A module with no metadata (MEA.py ext_anl Stage 3, mod_anl)

/**
 * A dictionary with a 4-bit codeword per byte value 0x0–0xF — one that really
 * compresses, two bytes of such values to one of stream, as a module without
 * metadata needs (a stream longer than the module it decompresses to is a size
 * upstream does not believe).
 */
function nibbleDictionary(): HuffmanDictionary {
  const symbols = Array.from({ length: 16 }, (_, index) => Uint8Array.of(15 - index));
  const table: HuffmanSymbolTable = {
    symbolsByLength: [...Array.from({ length: 4 }, () => []), symbols],
    unknownByLength: [...Array.from({ length: 4 }, () => []), new Array<boolean>(16).fill(false)],
  };
  return { shape: [{ length: 4, threshold: 0, maxCodeword: 15 }], code: table, data: table };
}

/**
 * `length` bytes of values 0x0–0xF, and the stream the nibble dictionary reads
 * them from: codewords most significant bit first.
 */
function nibbleBody(length: number) {
  const body = Uint8Array.from({ length }, (_, index) => (index * 7) & 0x0f);
  const packed = new Uint8Array(length / 2);
  for (let index = 0; index < length; index += 2) {
    packed[index / 2] = ((body[index] ?? 0) << 4) | (body[index + 1] ?? 0);
  }
  return { body, packed };
}

/**
 * A `$CPD` whose Huffman module "kernel" at 0x100 has no `.met`: only its
 * uncompressed size is in the directory. `next` is another module's row and bytes
 * right after the stream, `trailing` bytes after that.
 */
function partitionWithoutMetadata(options: {
  readonly body: Uint8Array;
  readonly packed?: Uint8Array;
  readonly next?: { readonly name: string; readonly bytes: Uint8Array };
  readonly partitionSize?: number;
  readonly trailing?: Uint8Array;
  readonly extra?: readonly CPDModuleRow[];
}) {
  const stream = moduleOf([{ flag: 0x20, offset: 0 }], [options.packed ?? options.body]);
  const modules: CPDModuleRow[] = [
    { name: "kernel", offset: 0x100, isHuffman: true, size: options.body.length },
  ];
  const parts = [new Uint8Array(0x100), stream];
  if (options.next !== undefined) {
    modules.push({
      name: options.next.name,
      offset: 0x100 + stream.length,
      isHuffman: false,
      size: options.next.bytes.length,
    });
    parts.push(options.next.bytes);
  }
  if (options.trailing !== undefined) parts.push(options.trailing);
  modules.push(...(options.extra ?? []));
  const partitionSize = options.partitionSize;
  const partition: CodePartition = {
    name: "FTPR",
    offset: 0,
    headerVersion: 2,
    headerLength: 0x14,
    numModules: modules.length,
    checksumValid: true,
    modules,
    extensions:
      partitionSize === undefined
        ? []
        : [
            {
              tag: 0x03,
              size: 0x48,
              offset: 0,
              partitionInfo: {
                partitionName: "FTPR",
                partitionSize,
                vcn: undefined,
                versionMajor: 0,
                versionMinor: 0,
                dataFormatMajor: 0,
                dataFormatMinor: 0,
                instanceID: 0,
                flags: 0,
                hash: "",
              },
            },
          ],
  };
  return { partition, region: join(parts), stream };
}

const kernelSlice = (partition: CodePartition, region: Uint8Array) =>
  huffmanSlices(partition, region, 0).find((one) => one.module.name === "kernel");

describe("a Huffman module with no metadata", () => {
  // The compressed size is where the next module starts.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/HuffmanTests.swift#HuffmanTests.testAModuleWithoutMetadataEndsWhereTheNextBegins
  it("ends where the next module begins", () => {
    const { body, packed } = nibbleBody(0x1000);
    const { partition, region, stream } = partitionWithoutMetadata({
      body,
      packed,
      next: { name: "intl.cfg", bytes: new Uint8Array(0x10).fill(0x11) },
    });

    const slice = kernelSlice(partition, region);
    expect(slice?.offset).toBe(0x100);
    expect(slice?.compressedSize).toBe(stream.length);
    expect(slice?.compressedSize).toBe(0x804);
    expect(slice?.uncompressedSize).toBe(0x1000);
    // No metadata, so no hash of its own.
    expect(slice?.hash).toBeUndefined();
  });

  // The last module ends where the partition does, when the manifest says how
  // long the partition is — and at the erased padding when it does not.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/HuffmanTests.swift#HuffmanTests.testTheLastModuleEndsAtThePartitionOrThePadding
  it("ends, when it is the last, at the partition or at the padding", () => {
    const { body, packed } = nibbleBody(0x1000);
    const sized = partitionWithoutMetadata({ body, packed, partitionSize: 0x100 + 0x804 });
    expect(kernelSlice(sized.partition, sized.region)?.compressedSize).toBe(0x804);

    const padded = partitionWithoutMetadata({
      body,
      packed,
      trailing: new Uint8Array(0x40).fill(0xff),
    });
    expect(kernelSlice(padded.partition, padded.region)?.compressedSize).toBe(0x804);
  });

  // An adjustment past the uncompressed size is not believed, and a FIT
  // configured partition is not adjusted at all: the directory size stands.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/HuffmanTests.swift#HuffmanTests.testAnAdjustmentThatCannotBeRightKeepsTheDirectorySize
  it("keeps the directory size where an adjustment cannot be right", () => {
    const { body, packed } = nibbleBody(0x1000);
    const far = partitionWithoutMetadata({
      body,
      packed,
      next: { name: "intl.cfg", bytes: new Uint8Array(0x10).fill(0x11) },
      extra: [{ name: "far", offset: 0x8000, isHuffman: false, size: 0x10 }],
    });
    // "far" lies past the region, so it is empty; intl.cfg is next either way.
    expect(kernelSlice(far.partition, far.region)?.compressedSize).toBe(0x804);

    const tooFar = partitionWithoutMetadata({
      body: new Uint8Array(0x10).fill(0xaa),
      next: { name: "intl.cfg", bytes: new Uint8Array(0x10).fill(0x11) },
    });
    // Four bytes of directory and sixteen of body is more than the sixteen the
    // module says it holds: not believed.
    expect(kernelSlice(tooFar.partition, tooFar.region)?.compressedSize).toBe(0x10);

    const configured = partitionWithoutMetadata({
      body,
      packed,
      next: { name: "fitc.cfg", bytes: new Uint8Array(0x10).fill(0x22) },
    });
    // A FIT-configured partition's sizes are taken as they are.
    expect(kernelSlice(configured.partition, configured.region)?.compressedSize).toBe(0x1000);
  });

  // With no metadata the decompressed module is checked against the hashes the
  // metadata tables list: one they list passes, one they do not is an issue 7
  // that names the module, and no table checks nothing.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/HuffmanTests.swift#HuffmanTests.testAModuleWithoutMetadataIsCheckedAgainstTheMetadataTable
  it("is checked against the metadata table", () => {
    const { body, packed } = nibbleBody(0x1000);
    const { partition, region } = partitionWithoutMetadata({
      body,
      packed,
      next: { name: "intl.cfg", bytes: new Uint8Array(0x10).fill(0x11) },
    });
    const dictionaries = { ...NO_DICTIONARIES, version12: nibbleDictionary() };
    const issues = (hashes: readonly string[]) =>
      huffmanValidationIssues(partition, region, 0, IDENTITY, dictionaries, hashes);

    expect(issues([hex(sha256(body))])).toEqual([]);
    // Nothing to check a module without metadata against.
    expect(issues([])).toEqual([]);

    const wrong = issues(["0".repeat(64)])[0];
    expect(wrong?.id).toBe(7);
    expect(wrong?.module).toBe("kernel");
    expect(wrong?.message).toContain("Hash");
  });

  // What the tables list that no module hashes to: a Huffman module is hashed
  // decompressed, an uncompressed one as it is stored, and a hash no module has
  // is what is left — in table order, each once.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/HuffmanTests.swift#HuffmanTests.testTheHashesNoModuleAccountsForAreLeftOver
  it("leaves over the hashes no module accounts for", () => {
    const { body, packed } = nibbleBody(0x1000);
    const data = new Uint8Array(0x10).fill(0x11);
    const { partition, region } = partitionWithoutMetadata({
      body,
      packed,
      next: { name: "data", bytes: data },
    });
    const gone = hex(sha256(Uint8Array.from("encrypted", (character) => character.charCodeAt(0))));
    const tables = [hex(sha256(data)), gone, hex(sha256(body)), gone];

    expect(unmatchedMetadataHashes(tables, [partition], region, 0, nibbleDictionary())).toEqual([
      gone,
    ]);
    expect(unmatchedMetadataHashes([], [partition], region, 0, undefined)).toEqual([]);
  });
});
