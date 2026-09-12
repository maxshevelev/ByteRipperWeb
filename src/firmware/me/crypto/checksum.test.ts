import { describe, expect, it } from "vitest";
import { crc16_14, crc32, crc32FromZero } from "@/firmware/me/crypto/checksum";

/** Upstream's `ChecksumTests`, which these are checked against. */

const bytes = (...values: number[]) => Uint8Array.from(values);
const ascii = (text: string) => Uint8Array.from(text, (one) => one.charCodeAt(0));

describe("crc32", () => {
  it("gives the standard check value", () => {
    // CRC-32("123456789") == 0xCBF43926 — what zlib and crccheck give, so a
    // synthetic `$CPD` fixture built with this validates against a real parser.
    expect(crc32(ascii("123456789"))).toBe(0xcbf4_3926);
  });

  it("is zero for nothing", () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it("differs on a bit flip", () => {
    expect(crc32(bytes(0x00, 0x01, 0x02))).not.toBe(crc32(bytes(0x00, 0x01, 0x03)));
  });

  it("agrees with itself across the slice-by-8 boundary", () => {
    // The wide loop handles whole groups of eight and the tail goes a byte at a
    // time, so every length from nothing to past two groups has to agree with
    // the plain walk. This is the one thing the fast table can get wrong
    // without any known vector noticing.
    const plain = (data: Uint8Array) => {
      let value = 0xffff_ffff;
      for (const byte of data) {
        value = (value ^ byte) >>> 0;
        for (let bit = 0; bit < 8; bit++) {
          value = ((value & 1) !== 0 ? 0xedb8_8320 ^ (value >>> 1) : value >>> 1) >>> 0;
        }
      }
      return (value ^ 0xffff_ffff) >>> 0;
    };
    for (let length = 0; length <= 20; length++) {
      const data = Uint8Array.from({ length }, (_, index) => (index * 37 + 11) & 0xff);
      expect(crc32(data)).toBe(plain(data));
    }
  });

  it("matches the FITC header span of a real region", () => {
    // Bytes [0x00:0x04] + a zeroed HeaderChecksum + [0x08:0x0C] of a CSME
    // 15.0.30 FITC region equal its stored HeaderChecksum 0x6856049C.
    const span = bytes(0x01, 0, 0, 0, 0, 0, 0, 0, 0x7b, 0x2b, 0, 0);
    expect(crc32(span)).toBe(0x6856_049c);
  });
});

describe("crc32FromZero", () => {
  it("matches the EFS System Page header of a real region", () => {
    // The header span (Unknown0 … DictRevision) of a CSME 15.0.30 EFS region
    // equals the stored 0xF4D864F7 — which the standard spelling does *not*
    // give, which is why there are two of them.
    const span = bytes(0x01, 0x00, 0x0a, 0x00, 0x01, 0x00, 0x00, 0x00, 0x02, 0x0a, 0x04, 0x01);
    expect(crc32FromZero(span)).toBe(0xf4d8_64f7);
    expect(crc32(span)).not.toBe(0xf4d8_64f7);
  });
});

describe("crc16_14", () => {
  it("gives the vector the MFS fixtures are built on", () => {
    // The constant a System Page stores for chunk 0, since the index is kept
    // as `transform(running) ^ value` and the running value starts at zero.
    expect(crc16_14(0)).toBe(0x0b5b);
  });

  it("keeps the running value to fourteen bits", () => {
    // The top two bits are the format's own: 0xC000 marks an unused entry, and
    // a transform that reached into them could not be told from one.
    for (let value = 0; value <= 0xffff; value += 7) {
      expect(crc16_14(value)).toBeLessThanOrEqual(0x3fff);
    }
  });

  it("reaches every value of that space", () => {
    // A transform that collapsed the space would obfuscate two chunk indexes
    // to the same stored value more often than the space itself requires.
    const seen = new Set<number>();
    for (let value = 0; value <= 0xffff; value++) seen.add(crc16_14(value));
    expect(seen.size).toBe(0x4000);
  });
});
