import { describe, expect, it } from "vitest";
import {
  bareHexNumber,
  decimalNumber,
  halfOpenHexText,
  hexDigitCount,
  hexExtent,
  hexNumber,
  lastByte,
} from "@/core/hexText/hexText";

/** Ported from `HexTextTests.swift`. */

const INT64_MIN = -(2n ** 63n);
const INT64_MAX = 2n ** 63n - 1n;
const UINT64_MAX = 2n ** 64n - 1n;

describe("a number in hex", () => {
  // Nothing past 32 bits is lost, and nothing is padded.
  // @upstream Packages/HexText/Tests/HexTextTests/HexTextTests.swift#HexTextTests.testANumberIsWrittenWhole
  it("is written whole", () => {
    expect(hexNumber(0x1_2345_6780)).toBe("0x123456780");
    expect(bareHexNumber(0x1_2345_6780)).toBe("123456780");
    expect(hexNumber(UINT64_MAX)).toBe("0xFFFFFFFFFFFFFFFF");
    expect(hexNumber(0)).toBe("0x0");
    expect(hexNumber(0x1fe028)).toBe("0x1FE028");
  });

  // Any integer: a size, a 32-bit field.
  // @upstream Packages/HexText/Tests/HexTextTests/HexTextTests.swift#HexTextTests.testOtherIntegerTypes
  it("takes any integer", () => {
    expect(hexNumber(0x1_0000_0000)).toBe("0x100000000");
    expect(hexNumber(0xdeadbeef, { width: 32 })).toBe("0xDEADBEEF");
    expect(bareHexNumber(0x0a, { width: 8 })).toBe("A");
  });

  // A negative value is its two's complement at its own width, never `0x-5`.
  // @upstream Packages/HexText/Tests/HexTextTests/HexTextTests.swift#HexTextTests.testANegativeValueIsTwosComplementAtItsOwnWidth
  it("writes a negative value as its two's complement at its own width", () => {
    expect(hexNumber(-5)).toBe("0xFFFFFFFFFFFFFFFB");
    expect(bareHexNumber(-1n)).toBe("FFFFFFFFFFFFFFFF");
    expect(hexNumber(-1, { width: 32 })).toBe("0xFFFFFFFF");
    expect(hexNumber(-2, { width: 16 })).toBe("0xFFFE");
    // A padded byte keeps its two digits.
    expect(hexNumber(-5, { digits: 2, width: 8 })).toBe("0xFB");
    expect(hexNumber(-(2 ** 31), { width: 32 })).toBe("0x80000000");
    expect(hexNumber(INT64_MIN)).not.toContain("-");
    expect(hexNumber(INT64_MIN)).toBe("0x8000000000000000");
  });

  // The decimal form names the same number as the hex beside it.
  // @upstream Packages/HexText/Tests/HexTextTests/HexTextTests.swift#HexTextTests.testTheDecimalIsTheSameNumber
  it("writes the same number in decimal", () => {
    expect(decimalNumber(-1, 32)).toBe("4294967295");
    expect(decimalNumber(-1)).toBe("18446744073709551615");
    expect(decimalNumber(0x100)).toBe("256");
    expect(decimalNumber(0x1_0000_0000)).toBe("4294967296");
  });

  // A type wider than 64 bits keeps all of its digits.
  // @upstream Packages/HexText/Tests/HexTextTests/HexTextTests.swift#HexTextTests.testAWideNegativeValueKeepsItsWidth
  it("keeps the width of a type wider than 64 bits", () => {
    expect(hexNumber(-1n, { width: 128 })).toBe(`0x${"F".repeat(32)}`);
    expect(bareHexNumber(-2n, { width: 128 }).slice(-2)).toBe("FE");
  });

  // A range by its first and last byte.
  // @upstream Packages/HexText/Tests/HexTextTests/HexTextTests.swift#HexTextTests.testARangeByItsFirstAndLastByte
  it("writes a range by its first and last byte", () => {
    expect(hexExtent(0x100, 0x140)).toBe("0x100–0x13F");
    expect(hexExtent(0x20, 0x21)).toBe("0x20"); // one byte
    expect(lastByte(0x100, 0x140)).toBe(0x13f);
    expect(lastByte(0, 0)).toBe(0); // an empty range gives its position
    expect(halfOpenHexText(0x100, 0x140)).toBe("[0x100, 0x140)"); // an agent's terms
    expect(hexExtent(0x20, 0x20)).toBe("0x20"); // empty: its position
    expect(hexExtent(0x1_0000_0000, 0x1_0000_1000)).toBe("0x100000000–0x100000FFF");
    // A signed range wider than the type's maximum.
    expect(hexExtent(INT64_MIN, INT64_MAX)).toBe("0x8000000000000000–0x7FFFFFFFFFFFFFFE");
    expect(hexExtent(-5n, INT64_MAX)).toBe("0xFFFFFFFFFFFFFFFB–0x7FFFFFFFFFFFFFFE");
  });

  // The digit count agrees with the digits written.
  // @upstream Packages/HexText/Tests/HexTextTests/HexTextTests.swift#HexTextTests.testTheDigitCountMatchesTheText
  it("counts the digits it writes", () => {
    for (const value of [0, 1, 0xf, 0x10, 0xffff_ffff, 0x1_0000_0000, Number.MAX_SAFE_INTEGER]) {
      expect(hexDigitCount(value), `${value}`).toBe(bareHexNumber(value).length);
    }
    expect(hexDigitCount(UINT64_MAX)).toBe(16);
    expect(hexDigitCount(-1, 32)).toBe(8);
    expect(hexDigitCount(0x1ff)).toBe(3);
  });

  // Padded to a field's width, and never cut short of it.
  // @upstream Packages/HexText/Tests/HexTextTests/HexTextTests.swift#HexTextTests.testPaddedToAWidth
  it("pads to a field's width and never cuts", () => {
    expect(hexNumber(5, { digits: 4 })).toBe("0x0005");
    expect(bareHexNumber(0x24, { digits: 8 })).toBe("00000024");
    expect(bareHexNumber(0x1_2345_6780, { digits: 8 })).toBe("123456780"); // wider than the field
    expect(hexNumber(0xab, { digits: 0 })).toBe("0xAB");
  });
});
