import { describe, expect, it } from "vitest";
import { compress } from "@/firmware/compression/firmwareCompression";
import { DecompressionError } from "@/firmware/compression/firmwareDecompression";
import { adler32, zlibDecode, zlibEncode } from "@/firmware/compression/zlibCodec";

const LIMIT = 1 << 20;

/** ASCII only: the core build has no `TextEncoder`. */
const ascii = (text: string) => Uint8Array.from(text, (character) => character.charCodeAt(0));

const fromHex = (hex: string) =>
  Uint8Array.from({ length: hex.length / 2 }, (_, index) =>
    Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  );

/**
 * The same three lines through Python's `zlib.compress(…, 9)` — a stream this
 * package's encoder did not write.
 */
const STREAM = fromHex(
  "78da7374718977710df37476e5d4d0e48c4ece492c2eb6550a0d760ac82f2a518ae572a4501e0024761b6a"
);
const TEXT = ascii('ADD_DEVICE\t()\t[class="USBPort"]\n'.repeat(3));

function failure(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return error instanceof DecompressionError ? error.failure.kind : "other";
  }
  return undefined;
}

describe("zlib", () => {
  // @upstream Packages/FirmwareCompression/Tests/FirmwareCompressionTests/CompressionTests.swift#ZlibTests.testAStreamDecodesToItsText
  it("decodes a stream to its text", () => {
    expect(zlibDecode(STREAM, LIMIT)).toEqual(TEXT);
  });

  // @upstream Packages/FirmwareCompression/Tests/FirmwareCompressionTests/CompressionTests.swift#ZlibTests.testALongStreamComesBackWhole
  it("brings a long stream back whole", () => {
    let state = 1;
    const original = new Uint8Array(300_000).map(() => {
      state = (Math.imul(state, 1_103_515_245) + 12_345) >>> 0;
      return (state >>> 24) & 0x0f;
    });
    const stream = compress(original, { variant: "Zlib" });
    expect(zlibDecode(stream, LIMIT)).toEqual(original);
  });

  // @upstream Packages/FirmwareCompression/Tests/FirmwareCompressionTests/CompressionTests.swift#ZlibTests.testTheLimitIsKept
  it("keeps the limit", () => {
    expect(failure(() => zlibDecode(STREAM, 16))).toBe("tooLarge");
  });

  // @upstream Packages/FirmwareCompression/Tests/FirmwareCompressionTests/CompressionTests.swift#ZlibTests.testWhatFollowsTheEndMarkIsLeftAlone
  it("leaves what follows the end mark alone", () => {
    const longer = Uint8Array.from([...STREAM, 0xff, 0xff, 0xff]);
    expect(zlibDecode(longer, LIMIT)).toEqual(TEXT);
  });

  // @upstream Packages/FirmwareCompression/Tests/FirmwareCompressionTests/CompressionTests.swift#ZlibTests.testACutStreamIsTruncatedAndNoiseIsCorrupt
  it("calls a cut stream truncated and noise corrupt", () => {
    expect(failure(() => zlibDecode(STREAM.subarray(0, STREAM.length - 8), LIMIT))).toBe(
      "truncated"
    );
    expect(failure(() => zlibDecode(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]), LIMIT))).toBe(
      "corrupt"
    );
    expect(failure(() => zlibDecode(new Uint8Array(0), LIMIT))).toBe("truncated");
  });

  /** @web-only the encoder is ours, where upstream calls `compress2` */
  it("round-trips empty, short, repetitive and mixed data", () => {
    let seed = 12345;
    const random = new Uint8Array(70000).map(() => {
      seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
      return seed >> 16;
    });
    const mixed = new Uint8Array(200000).map((_, index) =>
      index % 7 === 0 ? (random[index % 70000] ?? 0) : index & 0xff
    );
    const repeated = ascii("abc".repeat(5000));
    for (const bytes of [new Uint8Array(0), new Uint8Array([97]), repeated, random, mixed]) {
      expect(zlibDecode(zlibEncode(bytes), bytes.length)).toEqual(bytes);
    }
  });

  /** @web-only the decoder is ours, so a checksum that disagrees is ours to refuse */
  it("calls a wrong checksum corrupt", () => {
    const stream = Uint8Array.from(STREAM);
    stream[stream.length - 1] = (stream[stream.length - 1] ?? 0) ^ 0xff;
    expect(failure(() => zlibDecode(stream, LIMIT))).toBe("corrupt");
  });

  /** @web-only */
  it("computes Adler-32 as RFC 1950 does", () => {
    expect(adler32(ascii("Wikipedia"))).toBe(0x11e60398);
  });
});
