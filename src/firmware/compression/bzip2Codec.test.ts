import { describe, expect, it } from "vitest";
import { bzip2Decode } from "@/firmware/compression/bzip2Codec";
import { DecompressionError } from "@/firmware/compression/firmwareDecompression";

/**
 * bzip2 against streams Python's `bz2` wrote, none of them this decoder's own.
 */

const fromHex = (hex: string) =>
  Uint8Array.from(hex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
const ascii = (text: string) => Uint8Array.from(text, (character) => character.charCodeAt(0));
const failure = (action: () => unknown) => {
  try {
    action();
  } catch (error) {
    return error instanceof DecompressionError ? error.failure : undefined;
  }
  return undefined;
};

/** Three lines of `ADD_DEVICE\t()\t[class="USBPort"]`. */
const STREAM = fromHex(
  "425a68393141592653597e93e73100000d5f800030106000023e204b0aa8049c002000419ffaaa0d001a68190a00000c9919a0e5828831518a2e1abb45156e9cba4926eb17be78f9ea6926a3f1772453850907e93e7310"
);
const TEXT = ascii('ADD_DEVICE\t()\t[class="USBPort"]\n'.repeat(3));

describe("bzip2", () => {
  // @upstream Packages/FirmwareCompression/Tests/FirmwareCompressionTests/CompressionTests.swift#BZip2Tests.testAStreamDecodesToItsText
  it("decodes a stream to its text", () => {
    expect(Array.from(bzip2Decode(STREAM, 1 << 20))).toEqual(Array.from(TEXT));
  });

  // @upstream Packages/FirmwareCompression/Tests/FirmwareCompressionTests/CompressionTests.swift#BZip2Tests.testTheLimitIsKept
  it("keeps the caller's limit", () => {
    expect(failure(() => bzip2Decode(STREAM, 16))?.kind).toBe("tooLarge");
  });

  // @upstream Packages/FirmwareCompression/Tests/FirmwareCompressionTests/CompressionTests.swift#BZip2Tests.testACutStreamIsTruncatedAndNoiseIsCorrupt
  it("says a cut stream is truncated and noise is corrupt", () => {
    expect(failure(() => bzip2Decode(STREAM.subarray(0, STREAM.length - 8), 1 << 20))).toEqual({
      kind: "truncated",
    });
    expect(failure(() => bzip2Decode(Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8), 1 << 20))).toEqual({
      kind: "corrupt",
    });
    expect(failure(() => bzip2Decode(new Uint8Array(), 1 << 20))).toEqual({ kind: "truncated" });
  });

  it("refuses a stream whose checksum does not agree", () => {
    const damaged = STREAM.slice();
    damaged[damaged.length - 3] = (damaged[damaged.length - 3] ?? 0) ^ 0x10;
    expect(failure(() => bzip2Decode(damaged, 1 << 20))?.kind).toBe("corrupt");
  });

  it("decodes the runs of the first stage and an empty stream", () => {
    const runs = fromHex(
      "425a68313141592653597b73fe8e000003d100e00000203c0000082000310c0823436a68c2aa4c4d41743c5dc914e14241edcffa38"
    );
    expect(bzip2Decode(runs, 1 << 20).length).toBeGreaterThan(0);
    expect(bzip2Decode(fromHex("425a683917724538509000000000"), 16)).toEqual(new Uint8Array());
  });

  it("decodes a stream of several blocks", () => {
    const stream = fromHex(
      "425a6831314159265359c0ef3b01004292410078003e004001fc0001064c41064c41064c40525265536a7e1e1fe1fc3f0e8e8e8e8e8e8e8e8e8e8eaa906b9c2a15d5520c62a15d5520c62a15f4a50631415d49418c10af9052a74fc6318ca4830c63fc7f1f8e9215f1e3874e170c74c7e414a98f8c6319490618c78f1e3a4857c78e18e9870c3a7e414a9c3e318c62a49f64aa9ae9e3a5d142b878e1d385c31e31faaa92a7c70c6318d050618c78f1e3a40af8f1c3a70b863a63f2a8aaf8c7c655155c3a7128aae1e3c70c6319490618c70e9e3a10aff98a0ac9329acdbbfe568003e52a0803c001f002000dc740220c98820c988135453d2a9b50292a00fd3d57fa7f4fd3a74e3a74e9d3a71d3a4a26562a12e92898c5425ca51319284b9244c64512e2952d61293952a88e8f8d6b5a809932b1fe7f3f38912f9e6b9aad6398fc5052b1f31958c2a89931ed63cf38912fabcd657326b0e7e28295af98c630aa27ce79d2e0896bcd756ab595e63f1414af9ac6318c08adc4255a631e79e75092f65735ae6ab58eac7e1254f98f9824a9ae6949536bcf358c630aa2618c6b9e75484fc5dc914e14240da86f34c0"
    );
    const decoded = bzip2Decode(stream, 1 << 22);
    expect(decoded.length).toBe(250_000);
    for (const index of [0, 6, 7, 999, 1000, 99_999, 100_000, 100_001, 249_999]) {
      expect(decoded[index]).toBe(97 + ((Math.floor(index / 7) + Math.floor(index / 1000)) % 5));
    }
    // Every byte, since a block boundary is where a decoder goes wrong.
    let wrong = 0;
    for (let index = 0; index < decoded.length; index++) {
      if (decoded[index] !== 97 + ((Math.floor(index / 7) + Math.floor(index / 1000)) % 5)) wrong++;
    }
    expect(wrong).toBe(0);
  });
});
