import { describe, expect, it } from "vitest";
import {
  DecompressionError,
  type DecompressionFailure,
  decompressLzma,
  decompressLzmaX86,
  decompressTiano,
  LZMA_PROPERTIES_SIZE,
  TIANO_HEADER_SIZE,
} from "@/firmware/compression/firmwareDecompression";
import {
  fixtureBytes,
  LZMA_SAMPLE_STREAM,
  LZMA_X86_SAMPLE_STREAM,
  lzmaSample,
} from "@/firmware/compression/testing/lzmaFixtures";
import {
  EFI11_SAMPLE_STREAM,
  TIANO_SAMPLE_STREAM,
  tianoSample,
} from "@/firmware/compression/testing/tianoFixtures";
import { x86BranchConvert } from "@/firmware/compression/x86BranchConverter";

/**
 * LZMA and LZMA with the x86 filter. Ported from upstream's `LZMATests`, over
 * streams encoded once in the layout EDK2 uses.
 */

const LIMIT = 16 * 1024 * 1024;

function failure(body: () => unknown): DecompressionFailure | undefined {
  try {
    body();
    return undefined;
  } catch (error) {
    if (error instanceof DecompressionError) return error.failure;
    throw error;
  }
}

const equalBytes = (one: Uint8Array, two: Uint8Array) =>
  one.length === two.length && one.every((byte, index) => byte === two[index]);

describe("decompressLzma", () => {
  // @upstream Packages/FirmwareCompression/Tests/FirmwareCompressionTests/LZMATests.swift#LZMATests.testAStreamDecodesToWhatWentIn
  it("decodes a stream to what went in", () => {
    const decoded = decompressLzma(fixtureBytes(LZMA_SAMPLE_STREAM), LIMIT);
    expect(equalBytes(decoded.bytes, lzmaSample())).toBe(true);
    expect(decoded.variant).toBe("LZMA");
    expect(decoded.dictionarySize).toBe(1 << 16);
  });

  // @upstream Packages/FirmwareCompression/Tests/FirmwareCompressionTests/LZMATests.swift#LZMATests.testTheIntelLegacyPrefixIsSkipped
  it("skips the Intel legacy prefix", () => {
    const stream = fixtureBytes(LZMA_SAMPLE_STREAM);
    const prefixed = new Uint8Array(4 + stream.length);
    prefixed.set([0xde, 0xad, 0xbe, 0xef]);
    prefixed.set(stream, 4);
    const decoded = decompressLzma(prefixed, LIMIT);
    expect(equalBytes(decoded.bytes, lzmaSample())).toBe(true);
    expect(decoded.variant).toBe("LZMA (Intel legacy)");
    expect(decoded.dictionarySize).toBe(1 << 16);
  });

  // @upstream Packages/FirmwareCompression/Tests/FirmwareCompressionTests/LZMATests.swift#LZMATests.testAStreamThatStopsEarlyIsTruncated
  it("calls a stream that stops early truncated", () => {
    const stream = fixtureBytes(LZMA_SAMPLE_STREAM);
    expect(failure(() => decompressLzma(stream.subarray(0, stream.length / 2), LIMIT))).toEqual({
      kind: "truncated",
    });
  });

  // @upstream Packages/FirmwareCompression/Tests/FirmwareCompressionTests/LZMATests.swift#LZMATests.testLessThanAHeaderIsTruncated
  it("calls less than a header truncated", () => {
    expect(
      failure(() => decompressLzma(Uint8Array.of(0x5d, 0x00, 0x00, 0x01, 0x00), LIMIT))
    ).toEqual({
      kind: "truncated",
    });
    expect(failure(() => decompressLzmaX86(new Uint8Array(0), LIMIT))).toEqual({
      kind: "truncated",
    });
  });

  // @upstream Packages/FirmwareCompression/Tests/FirmwareCompressionTests/LZMATests.swift#LZMATests.testASizeOverTheLimitIsRefused
  it("refuses a size over the limit before allocating anything", () => {
    const stream = fixtureBytes(LZMA_SAMPLE_STREAM);
    expect(failure(() => decompressLzma(stream, 1000))).toEqual({
      kind: "tooLarge",
      declared: 70_000,
    });
    expect(failure(() => decompressLzmaX86(stream, 1000))).toEqual({
      kind: "tooLarge",
      declared: 70_000,
    });
  });

  // @upstream Packages/FirmwareCompression/Tests/FirmwareCompressionTests/LZMATests.swift#LZMATests.testImpossiblePropertiesAreCorrupt
  it("calls impossible properties corrupt", () => {
    const stream = fixtureBytes(LZMA_SAMPLE_STREAM);
    stream[0] = 0xff;
    expect(failure(() => decompressLzma(stream, LIMIT))).toEqual({ kind: "corrupt" });
  });

  // @upstream Packages/FirmwareCompression/Tests/FirmwareCompressionTests/LZMATests.swift#LZMATests.testADeclaredSizeBeyondTheStreamIsAFailure
  it("fails a declared size beyond the stream", () => {
    const stream = fixtureBytes(LZMA_SAMPLE_STREAM);
    stream[LZMA_PROPERTIES_SIZE] = ((stream[LZMA_PROPERTIES_SIZE] ?? 0) + 100) & 0xff;
    expect(failure(() => decompressLzma(stream, LIMIT))).toBeDefined();
  });

  // @upstream Packages/FirmwareCompression/Tests/FirmwareCompressionTests/LZMATests.swift#LZMATests.testNoUsableHeaderEitherWayIsCorrupt
  it("calls data with no usable header either way corrupt", () => {
    expect(failure(() => decompressLzma(new Uint8Array(64).fill(0xff), LIMIT))).toEqual({
      kind: "corrupt",
    });
  });
});

describe("decompressLzmaX86", () => {
  // @upstream Packages/FirmwareCompression/Tests/FirmwareCompressionTests/LZMATests.swift#LZMATests.testTheX86FilterIsUndoneAfterDecoding
  it("undoes the filter after decoding", () => {
    const original = lzmaSample();
    const stream = fixtureBytes(LZMA_X86_SAMPLE_STREAM);

    expect(equalBytes(decompressLzmaX86(stream, LIMIT).bytes, original)).toBe(true);
    // Plain LZMA leaves the converted bytes as they were stored.
    const filtered = decompressLzma(stream, LIMIT).bytes;
    expect(equalBytes(filtered, original)).toBe(false);
    x86BranchConvert(filtered, false);
    expect(equalBytes(filtered, original)).toBe(true);
  });

  it("round-trips the converter", () => {
    const original = lzmaSample(4096);
    const copy = Uint8Array.from(original);
    x86BranchConvert(copy, true);
    expect(equalBytes(copy, original)).toBe(false);
    x86BranchConvert(copy, false);
    expect(equalBytes(copy, original)).toBe(true);
  });
});

/**
 * Tiano and EFI 1.1, over buffers EDK2's own compressor wrote. Ported from
 * upstream's `TianoTests`.
 */
describe("decompressTiano", () => {
  const tianoStream = () => fixtureBytes(TIANO_SAMPLE_STREAM);
  const efi11Stream = () => fixtureBytes(EFI11_SAMPLE_STREAM);

  // @upstream Packages/FirmwareCompression/Tests/FirmwareCompressionTests/TianoTests.swift#TianoTests.testTianoAndEFI11EachDecodeToWhatWentIn
  it("decodes each algorithm to what went in", () => {
    const original = tianoSample();

    const tiano = decompressTiano(tianoStream(), LIMIT);
    expect(tiano.tiano && equalBytes(tiano.tiano, original)).toBe(true);
    expect(tiano.efi11 !== undefined && equalBytes(tiano.efi11, original)).toBe(false);

    const efi11 = decompressTiano(efi11Stream(), LIMIT);
    expect(efi11.efi11 && equalBytes(efi11.efi11, original)).toBe(true);
    expect(efi11.tiano !== undefined && equalBytes(efi11.tiano, original)).toBe(false);
  });

  // @upstream Packages/FirmwareCompression/Tests/FirmwareCompressionTests/TianoTests.swift#TianoTests.testLessThanTheHeaderSaysIsTruncated
  it("calls less than the header says truncated", () => {
    const stream = tianoStream();
    expect(failure(() => decompressTiano(stream.subarray(0, stream.length - 1), LIMIT))).toEqual({
      kind: "truncated",
    });
    expect(failure(() => decompressTiano(Uint8Array.of(1, 2, 3), LIMIT))).toEqual({
      kind: "truncated",
    });
  });

  // @upstream Packages/FirmwareCompression/Tests/FirmwareCompressionTests/TianoTests.swift#TianoTests.testMoreThanTheHeaderSaysIsCorrupt
  it("calls more than the header says corrupt", () => {
    const stream = tianoStream();
    const padded = new Uint8Array(stream.length + 4);
    padded.set(stream);
    expect(failure(() => decompressTiano(padded, LIMIT))).toEqual({ kind: "corrupt" });
  });

  // @upstream Packages/FirmwareCompression/Tests/FirmwareCompressionTests/TianoTests.swift#TianoTests.testAnOriginalSizeOverTheLimitIsRefused
  it("refuses an original size over the limit", () => {
    expect(failure(() => decompressTiano(efi11Stream(), 1000))).toEqual({
      kind: "tooLarge",
      declared: 8000,
    });
  });

  // @upstream Packages/FirmwareCompression/Tests/FirmwareCompressionTests/TianoTests.swift#TianoTests.testAStreamNeitherAlgorithmReadsIsCorrupt
  it("calls a stream neither algorithm reads corrupt", () => {
    const stream = tianoStream();
    stream.fill(0xff, TIANO_HEADER_SIZE);
    expect(failure(() => decompressTiano(stream, LIMIT))).toEqual({ kind: "corrupt" });
  });
});
