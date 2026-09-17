import { describe, expect, it } from "vitest";
import {
  CompressionError,
  type CompressionFailure,
  compress,
  compressLike,
  DEFAULT_DICTIONARY_SIZE,
  ENCODED_SHARE,
} from "@/firmware/compression/firmwareCompression";
import {
  decompressLzma,
  decompressLzmaX86,
  decompressTiano,
} from "@/firmware/compression/firmwareDecompression";

/**
 * Compressing again, for putting an edited buffer back into its section: every
 * variant the decoders read, written so that the decoder reads it back. Ported
 * from upstream's `CompressionTests`.
 */

const LIMIT = 16 * 1024 * 1024;

/**
 * Code-like bytes: runs of a pattern with x86 `call rel32` in them, so the
 * encoder has something to squeeze and the filter something to convert.
 *
 * @upstream Packages/FirmwareCompression/Tests/FirmwareCompressionTests/CompressionTests.swift#CompressionTests.sample
 */
function sample(count = 60_000, seed = 0): Uint8Array {
  const bytes: number[] = [];
  while (bytes.length < count) {
    bytes.push(0xe8, 0x10, 0x00, 0x00, 0x00);
    const at = bytes.length;
    for (let index = 0; index < 27; index++) {
      bytes.push((index * 7 + Math.floor(at / 64) + seed) & 0xff);
    }
  }
  return Uint8Array.from(bytes.slice(0, count));
}

const equal = (one: Uint8Array | undefined, two: Uint8Array) =>
  one !== undefined && one.length === two.length && one.every((byte, index) => byte === two[index]);

function failure(body: () => unknown): CompressionFailure | undefined {
  try {
    body();
    return undefined;
  } catch (error) {
    if (error instanceof CompressionError) return error.failure;
    throw error;
  }
}

describe("compress", () => {
  // @upstream Packages/FirmwareCompression/Tests/FirmwareCompressionTests/CompressionTests.swift#CompressionTests.testEveryVariantComesBackAsWhatWentIn
  it("gives every variant back as what went in", () => {
    const original = sample();

    const lzma = compress(original, { variant: "LZMA" });
    expect(equal(decompressLzma(lzma, LIMIT).bytes, original)).toBe(true);
    // It compresses.
    expect(lzma.length).toBeLessThan(original.length);

    const x86 = compress(original, { variant: "LZMA with x86 filter" });
    expect(equal(decompressLzmaX86(x86, LIMIT).bytes, original)).toBe(true);

    const tiano = compress(original, { variant: "Tiano" });
    expect(equal(decompressTiano(tiano, LIMIT).tiano, original)).toBe(true);

    const efi11 = compress(original, { variant: "EFI 1.1" });
    expect(equal(decompressTiano(efi11, LIMIT).efi11, original)).toBe(true);
  });

  /**
   * Both levels write a stream that comes back byte for byte, and on data full
   * of matches far back the maximum level's is the shorter one.
   *
   * @upstream Packages/FirmwareCompression/Tests/FirmwareCompressionTests/CompressionTests.swift#CompressionTests.testBothLevelsRoundTripAndTheMaximumFindsMore
   */
  it("round-trips both levels, and the maximum finds more", () => {
    let state = 4;
    const next = () => {
      state = (Math.imul(state, 1_103_515_245) + 12345) >>> 0;
      return state >>> 8;
    };
    const data: number[] = Array.from({ length: 512 }, () => next() & 0xff);
    while (data.length < 0x8000) {
      const from = next() % Math.max(1, data.length - 64);
      const end = Math.min(data.length, from + 16 + (next() % 200));
      data.push(...data.slice(from, end));
      const extra = next() % 6;
      for (let index = 0; index < extra; index++) data.push(next() & 0xff);
    }
    const bytes = Uint8Array.from(data.slice(0, 0x8000));

    const normal = compress(bytes, { variant: "LZMA", effort: "normal" });
    const maximum = compress(bytes, { variant: "LZMA", effort: "maximum" });

    expect(equal(decompressLzma(normal, 1 << 24).bytes, bytes)).toBe(true);
    expect(equal(decompressLzma(maximum, 1 << 24).bytes, bytes)).toBe(true);
    expect(maximum.length + 256).toBeLessThan(normal.length);
  });

  // @upstream Packages/FirmwareCompression/Tests/FirmwareCompressionTests/CompressionTests.swift#CompressionTests.testTheDictionarySizeAskedForIsTheOneWritten
  it("writes the dictionary size it was asked for", () => {
    const stream = compress(sample(), { variant: "LZMA", dictionarySize: 1 << 20 });
    expect(decompressLzma(stream, LIMIT).dictionarySize).toBe(1 << 20);
  });

  /**
   * The four bytes of an Intel legacy stream are the original's: they are not
   * the encoder's to make up.
   *
   * @upstream Packages/FirmwareCompression/Tests/FirmwareCompressionTests/CompressionTests.swift#CompressionTests.testALegacyStreamKeepsItsFourBytes
   */
  it("keeps a legacy stream's four bytes", () => {
    const prefix = Uint8Array.of(0xde, 0xad, 0xbe, 0xef);
    const stream = compress(sample(), { variant: "LZMA (Intel legacy)", legacyPrefix: prefix });

    expect([...stream.subarray(0, 4)]).toEqual([...prefix]);
    const decoded = decompressLzma(stream, LIMIT);
    expect(decoded.variant).toBe("LZMA (Intel legacy)");
    expect(equal(decoded.bytes, sample())).toBe(true);

    expect(failure(() => compress(sample(), { variant: "LZMA (Intel legacy)" }))).toEqual({
      kind: "missingLegacyPrefix",
    });
  });

  /**
   * What Update in Parent does: an edited buffer compressed the way the stream
   * it came out of was.
   *
   * @upstream Packages/FirmwareCompression/Tests/FirmwareCompressionTests/CompressionTests.swift#CompressionTests.testAnEditedBufferIsCompressedTheWayItsOriginalWas
   */
  it("compresses an edited buffer the way its original was", () => {
    const original = compress(sample(), {
      variant: "LZMA with x86 filter",
      dictionarySize: 1 << 21,
    });
    const decoded = decompressLzmaX86(original, LIMIT);
    const edited = Uint8Array.from(decoded.bytes);
    edited[100] = (edited[100] ?? 0) ^ 0xff;

    const stream = compressLike(edited, decoded, original);

    const again = decompressLzmaX86(stream, LIMIT);
    expect(equal(again.bytes, edited)).toBe(true);
    expect(again.variant).toBe("LZMA with x86 filter");
    expect(again.dictionarySize).toBe(1 << 21);
  });

  // @upstream Packages/FirmwareCompression/Tests/FirmwareCompressionTests/CompressionTests.swift#CompressionTests.testALegacyOriginalGivesItsPrefixToTheNewStream
  it("gives a legacy original's prefix to the new stream", () => {
    const prefix = Uint8Array.of(0x01, 0x02, 0x03, 0x04);
    const original = compress(sample(), {
      variant: "LZMA (Intel legacy)",
      dictionarySize: 1 << 18,
      legacyPrefix: prefix,
    });
    const decoded = decompressLzma(original, LIMIT);

    const stream = compressLike(sample(60_000, 3), decoded, original);

    expect([...stream.subarray(0, 4)]).toEqual([...prefix]);
    expect(equal(decompressLzma(stream, LIMIT).bytes, sample(60_000, 3))).toBe(true);
  });

  // @upstream Packages/FirmwareCompression/Tests/FirmwareCompressionTests/CompressionTests.swift#CompressionTests.testNothingCompressesToAStreamOfNothing
  it("still writes a header for nothing", () => {
    for (const variant of ["LZMA", "LZMA with x86 filter", "Tiano", "EFI 1.1"] as const) {
      expect(compress(new Uint8Array(0), { variant }).length).toBeGreaterThan(0);
    }
  });

  /**
   * An encode says how far it has got: forward only, the encoder's share first,
   * and all the way when the check is done.
   *
   * @upstream Packages/FirmwareCompression/Tests/FirmwareCompressionTests/CompressionTests.swift#CompressionTests.testAnEncodeReportsItsProgress
   */
  it("reports its progress", () => {
    const fractions: number[] = [];
    compress(sample(400_000), { variant: "LZMA", onProgress: (one) => fractions.push(one) });

    expect(fractions[0]).toBe(0);
    expect(fractions.at(-1)).toBe(1);
    expect(fractions).toEqual([...fractions].sort((a, b) => a - b));
    expect(fractions.some((one) => one > 0 && one < ENCODED_SHARE)).toBe(true);
  });

  /**
   * The default dictionary is the one a caller with none of its own gets.
   *
   * @upstream Packages/FirmwareCompression/Sources/FirmwareCompression/FirmwareCompression.swift#FirmwareCompression.defaultDictionarySize
   */
  it("writes the default dictionary when none is asked for", () => {
    const stream = compress(sample(1000), { variant: "LZMA" });
    expect(decompressLzma(stream, LIMIT).dictionarySize).toBe(DEFAULT_DICTIONARY_SIZE);
  });
});
