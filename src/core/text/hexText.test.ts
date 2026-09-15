import { describe, expect, it } from "vitest";
import { asArray } from "@/core/testing/support";
import { formatHex, parseHex } from "@/core/text/hexText";

describe("formatting bytes as hex text", () => {
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/ClipboardCodecTests.swift#ClipboardCodecTests.testHexTextFormatting
  it("writes uppercase pairs, sixteen to a line", () => {
    expect(formatHex(new Uint8Array([0x00, 0x0f, 0xff]))).toBe("00 0F FF");
    const twenty = new Uint8Array(20).map((_, i) => i);
    expect(formatHex(twenty).split("\n")).toEqual([
      "00 01 02 03 04 05 06 07 08 09 0A 0B 0C 0D 0E 0F",
      "10 11 12 13",
    ]);
  });

  it("writes nothing for nothing", () => {
    expect(formatHex(new Uint8Array(0))).toBe("");
  });
});

// @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/ClipboardCodecTests.swift#ClipboardCodecTests.testParseHexText
describe("parsing hex text", () => {
  // What arrives on a clipboard came from somewhere else and was formatted by
  // somebody else's tool, so the parser is generous about separators.
  const accepted: [text: string, bytes: number[]][] = [
    ["00 0F FF", [0x00, 0x0f, 0xff]],
    ["000FFF", [0x00, 0x0f, 0xff]],
    ["00,0f,ff", [0x00, 0x0f, 0xff]],
    ["0x00 0x0F 0xFF", [0x00, 0x0f, 0xff]],
    ["00 0F\nFF\t", [0x00, 0x0f, 0xff]],
    ["  DEADBEEF  ", [0xde, 0xad, 0xbe, 0xef]],
  ];

  for (const [text, bytes] of accepted) {
    it(`accepts ${JSON.stringify(text)}`, () => {
      expect(asArray(parseHex(text) ?? new Uint8Array(0))).toEqual(bytes);
    });
  }

  it("refuses an odd number of digits rather than guessing", () => {
    // A missing nibble means the paste was truncated, and picking a half for it
    // would write a byte nobody copied.
    expect(parseHex("00 0F F")).toBeUndefined();
    expect(parseHex("A")).toBeUndefined();
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/ClipboardCodecTests.swift#ClipboardCodecTests.testRejectInvalidHexText
  it("refuses text that is not hex at all", () => {
    expect(parseHex("")).toBeUndefined();
    expect(parseHex("hello world")).toBeUndefined();
    expect(parseHex("   ")).toBeUndefined();
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/ClipboardCodecTests.swift#ClipboardCodecTests.testHexTextRoundtrip
  it("round-trips what it formatted", () => {
    const bytes = new Uint8Array(64).map((_, i) => (i * 37) & 0xff);
    expect(asArray(parseHex(formatHex(bytes)) ?? new Uint8Array(0))).toEqual(asArray(bytes));
  });
});
