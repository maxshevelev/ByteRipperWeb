import { describe, expect, it } from "vitest";
import {
  DecompressionError,
  type DecompressionFailure,
  decompressLzma,
  decompressLzmaX86,
  LZMA_PROPERTIES_SIZE,
} from "@/firmware/compression/firmwareDecompression";
import {
  fixtureBytes,
  LZMA_SAMPLE_STREAM,
  LZMA_X86_SAMPLE_STREAM,
  lzmaSample,
} from "@/firmware/compression/testing/lzmaFixtures";
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
  it("decodes a stream to what went in", () => {
    const decoded = decompressLzma(fixtureBytes(LZMA_SAMPLE_STREAM), LIMIT);
    expect(equalBytes(decoded.bytes, lzmaSample())).toBe(true);
    expect(decoded.variant).toBe("LZMA");
    expect(decoded.dictionarySize).toBe(1 << 16);
  });

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

  it("calls a stream that stops early truncated", () => {
    const stream = fixtureBytes(LZMA_SAMPLE_STREAM);
    expect(failure(() => decompressLzma(stream.subarray(0, stream.length / 2), LIMIT))).toEqual({
      kind: "truncated",
    });
  });

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

  it("calls impossible properties corrupt", () => {
    const stream = fixtureBytes(LZMA_SAMPLE_STREAM);
    stream[0] = 0xff;
    expect(failure(() => decompressLzma(stream, LIMIT))).toEqual({ kind: "corrupt" });
  });

  it("fails a declared size beyond the stream", () => {
    const stream = fixtureBytes(LZMA_SAMPLE_STREAM);
    stream[LZMA_PROPERTIES_SIZE] = ((stream[LZMA_PROPERTIES_SIZE] ?? 0) + 100) & 0xff;
    expect(failure(() => decompressLzma(stream, LIMIT))).toBeDefined();
  });

  it("calls data with no usable header either way corrupt", () => {
    expect(failure(() => decompressLzma(new Uint8Array(64).fill(0xff), LIMIT))).toEqual({
      kind: "corrupt",
    });
  });
});

describe("decompressLzmaX86", () => {
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
