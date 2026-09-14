import { describe, expect, it } from "vitest";
import {
  fixtureBytes,
  LZMA_MODULE_BODY_STREAM,
  LZMA_MODULE_PADDED_STREAM,
  lzmaModuleBody,
} from "@/firmware/compression/testing/lzmaFixtures";
import { hex, sha256, sha384 } from "@/firmware/me/crypto/digest";
import {
  decompressLzmaModule,
  lzmaDecoderInput,
  lzmaHashMatches,
  reversedHex,
  STRAY_ZEROS_SIGNATURE,
} from "@/firmware/me/decompress/lzmaModule";

/** The CSE LZMA module check. Ported from upstream's `LZMAModuleTests`. */

const equalBytes = (one: Uint8Array | undefined, two: Uint8Array) =>
  one !== undefined && one.length === two.length && one.every((byte, index) => byte === two[index]);

describe("decompressLzmaModule", () => {
  it("decompresses a module to its body", () => {
    const body = lzmaModuleBody();
    expect(
      equalBytes(decompressLzmaModule(fixtureBytes(LZMA_MODULE_BODY_STREAM), body.length), body)
    ).toBe(true);
  });

  it("fills a short module with its own last byte", () => {
    const paddedLength = 3000 + 4;
    const output = decompressLzmaModule(fixtureBytes(LZMA_MODULE_PADDED_STREAM), paddedLength + 12);
    expect(output).toHaveLength(paddedLength + 12);
    expect([...(output?.subarray(-16) ?? [])]).toEqual(new Array(16).fill(0xff));
  });

  it("does not decompress bytes that are not LZMA", () => {
    expect(decompressLzmaModule(new Uint8Array(64).fill(0xa5), 64)).toBeUndefined();
  });
});

describe("lzmaDecoderInput", () => {
  it("removes the stray zeros only where the signature says so", () => {
    const head = [...STRAY_ZEROS_SIGNATURE, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const quirky = Uint8Array.from([...head, 0, 0, 0, 0xab, 0xcd]);
    expect([...lzmaDecoderInput(quirky)]).toEqual([...head, 0xab, 0xcd]);

    const otherStart = Uint8Array.from([0x5d, ...head.slice(1), 0, 0, 0, 0xab, 0xcd]);
    expect(lzmaDecoderInput(otherStart)).toBe(otherStart);

    const noZeros = Uint8Array.from([...head, 0, 1, 0, 0xab, 0xcd]);
    expect(lzmaDecoderInput(noZeros)).toBe(noZeros);
  });
});

describe("lzmaHashMatches", () => {
  it("covers the stored bytes or the decompressed ones", () => {
    const module = fixtureBytes(LZMA_MODULE_BODY_STREAM);
    const body = lzmaModuleBody();
    const decompressed = decompressLzmaModule(module, body.length) ?? new Uint8Array(0);
    const overStored = reversedHex(hex(sha256(module)));
    const overBody = reversedHex(hex(sha384(body)));

    expect(lzmaHashMatches(overStored, module, decompressed)).toBe(true);
    // SHA-384 by length, over what came out.
    expect(lzmaHashMatches(overBody, module, decompressed)).toBe(true);
    // The digest in the order it is printed is not the order it is stored.
    expect(lzmaHashMatches(hex(sha256(module)), module, decompressed)).toBe(false);
  });

  it("reverses hex by its bytes", () => {
    expect(reversedHex("0a1b2c")).toBe("2C1B0A");
    expect(reversedHex("ABC")).toBe("");
  });
});
