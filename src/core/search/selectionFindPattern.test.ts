import { describe, expect, it } from "vitest";
import { forBytes, forText, readableUTF8 } from "@/core/search/selectionFindPattern";

/**
 * Ported from `SelectionFindPatternTests.swift` — §11 Use Selection for Find:
 * what a selection becomes when it is put into the Find bar's pattern.
 */

const bytes = (...values: number[]) => new Uint8Array(values);

/**
 * A string's UTF-8 bytes where every character is ASCII, so the two are the
 * same bytes and the case states them directly.
 */
const ascii = (text: string) => new Uint8Array(Array.from(text, (c) => c.charCodeAt(0)));

describe("the hex column", () => {
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SelectionFindPatternTests.swift#SelectionFindPatternTests.testHexRegionTakesTheBytesAsADumpPrintsThem
  it("takes the bytes as a dump prints them", () => {
    const pattern = forBytes(bytes(0xde, 0xad, 0xbe, 0xef));
    expect(pattern.text).toBe("DE AD BE EF");
    expect(pattern.encoding).toBe("hex");
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SelectionFindPatternTests.swift#SelectionFindPatternTests.testHexRegionPadsASingleByte
  it("pads a single byte", () => {
    expect(forBytes(bytes(0x0f)).text).toBe("0F");
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SelectionFindPatternTests.swift#SelectionFindPatternTests.testHexRegionDoesNotBecomeTextEvenWhenItCould
  it("does not become text even when it could", () => {
    const pattern = forBytes(ascii("AB"));
    expect(pattern.text).toBe("41 42");
    expect(pattern.encoding).toBe("hex");
  });
});

describe("the decoded-text column", () => {
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SelectionFindPatternTests.swift#SelectionFindPatternTests.testTextRegionTakesASCIIAsUTF8Text
  it("takes ASCII as UTF-8 text", () => {
    const pattern = forText(ascii("$IBIOSI$"));
    expect(pattern.text).toBe("$IBIOSI$");
    expect(pattern.encoding).toBe("utf8");
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SelectionFindPatternTests.swift#SelectionFindPatternTests.testTextRegionDecodesMultiByteUTF8
  it("decodes multi-byte UTF-8", () => {
    const pattern = forText(bytes(0x47, 0x72, 0xc3, 0xb6, 0xc3, 0x9f, 0x65)); // "Größe"
    expect(pattern.text).toBe("Größe");
    expect(pattern.encoding).toBe("utf8");
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SelectionFindPatternTests.swift#SelectionFindPatternTests.testTextRegionFallsBackToBytesWhenTheyAreNotUTF8
  it("falls back to the bytes when they are not UTF-8", () => {
    const pattern = forText(bytes(0xff, 0xfe, 0x80));
    expect(pattern.text).toBe("FF FE 80");
    expect(pattern.encoding).toBe("hex");
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SelectionFindPatternTests.swift#SelectionFindPatternTests.testTextRegionFallsBackOnAPartialCharacter
  it("falls back on a partial character", () => {
    // `Größe` is 47 72 C3 B6 C3 9F 65; three bytes of it cut the `ö` in half,
    // which is exactly what a selection ending mid-character is.
    const pattern = forText(bytes(0x47, 0x72, 0xc3));
    expect(pattern.encoding).toBe("hex");
    expect(pattern.text).toBe("47 72 C3");
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SelectionFindPatternTests.swift#SelectionFindPatternTests.testTextRegionFallsBackOnControlCharacters
  it("falls back on control characters", () => {
    expect(forText(ascii("AB\0")).encoding).toBe("hex");
    expect(forText(ascii("AB\n")).encoding).toBe("hex");
    expect(forText(bytes(0x7f)).encoding).toBe("hex"); // DEL
    expect(
      forText(bytes(0x41, 0xc2, 0x85)).encoding, // "A\u{0085}"
      "a C1 control decodes and is still not readable"
    ).toBe("hex");
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SelectionFindPatternTests.swift#SelectionFindPatternTests.testTextRegionKeepsSpacesAndPunctuation
  it("keeps spaces and punctuation", () => {
    const pattern = forText(ascii("AMI BIOS (C)"));
    expect(pattern.text).toBe("AMI BIOS (C)");
    expect(pattern.encoding).toBe("utf8");
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SelectionFindPatternTests.swift#SelectionFindPatternTests.testEmptyBytesAreNoPattern
  it("makes no pattern out of nothing", () => {
    expect(readableUTF8(new Uint8Array(0))).toBeUndefined();
    expect(forBytes(new Uint8Array(0)).text).toBe("");
  });
});
