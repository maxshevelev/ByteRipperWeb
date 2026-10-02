import { describe, expect, it } from "vitest";
import { decodeUtf8, decodeUtf16le, encodeUtf8 } from "@/core/text/utf";

describe("UTF-8", () => {
  it("round-trips ASCII, two, three and four byte characters", () => {
    for (const text of ["EVSA", "é", "€", "𝄞", "Secure Boot ✓"]) {
      expect(decodeUtf8(encodeUtf8(text))).toBe(text);
    }
    expect([...encodeUtf8("€")]).toEqual([0xe2, 0x82, 0xac]);
  });

  it("reads each malformed byte as U+FFFD", () => {
    expect(decodeUtf8(Uint8Array.of(0x41, 0xff, 0x42))).toBe("A�B");
    expect(decodeUtf8(Uint8Array.of(0xe2, 0x82))).toBe("��");
  });
});

describe("UTF-16LE", () => {
  it("reads units and surrogate pairs", () => {
    expect(decodeUtf16le(Uint8Array.of(0x41, 0x00, 0xac, 0x20))).toBe("A€");
    expect(decodeUtf16le(Uint8Array.of(0x34, 0xd8, 0x1e, 0xdd))).toBe("𝄞");
  });

  it("reads an unpaired surrogate and a stray byte as U+FFFD", () => {
    expect(decodeUtf16le(Uint8Array.of(0x34, 0xd8, 0x41, 0x00))).toBe("�A");
    expect(decodeUtf16le(Uint8Array.of(0x41, 0x00, 0x42))).toBe("A�");
  });
});
