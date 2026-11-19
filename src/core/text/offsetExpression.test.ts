import { describe, expect, it } from "vitest";
import { hexNumber } from "@/core/hexText/hexText";
import {
  expressionHexText,
  isSum,
  type OffsetExpression,
  type OffsetExpressionFailure,
  parseOffsetExpression,
} from "@/core/text/offsetExpression";

/** Ported from `OffsetExpressionTests.swift`. */

function parsed(text: string): OffsetExpression {
  const result = parseOffsetExpression(text);
  if (!result.ok) throw new Error(`"${text}" did not parse: ${result.reason}`);
  return result.expression;
}

const UINT64_MAX = (1n << 64n) - 1n;

// @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/OffsetExpressionTests.swift#OffsetExpressionTests.testHexAddressAndDecimalLength
it("adds a length known in decimal to an address in hex (issue #9)", () => {
  expect(parsed("0x1FE000 + 4096").value).toBe(0x1ff000n);
  expect(parsed("0x2C0000 - 1024").value).toBe(0x2bfc00n);
  expect(parsed("196608 - 0x200").value).toBe(0x2fe00n);
});

// @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/OffsetExpressionTests.swift#OffsetExpressionTests.testValues
describe("what a sum comes to", () => {
  const cases: [input: string, expected: bigint][] = [
    // One number is an expression of one term, read as the field always read it.
    ["0", 0n],
    ["4096", 4096n],
    ["0x10", 16n],
    ["FF", 255n],
    ["  0x1F  ", 31n],
    // Each term by the same rule: `beef` is hex, `10` is decimal.
    ["beef + 10", 0xbeefn + 10n],
    ["10 + 10", 20n],
    ["0x10 + 0X10", 32n],
    // Left to right, any number of terms, spacing free.
    ["0x100-0x10+1", 0xf1n],
    ["\t1 +\t2  -  3 ", 0n],
    ["1+2+3+4", 10n],
    // Below zero on the way is not below zero at the end.
    ["0x100 - 0x200 + 0x200", 0x100n],
    // Past 64 bits on the way is not past 64 bits at the end.
    ["0xFFFFFFFFFFFFFFFF + 1 - 1", UINT64_MAX],
    ["0xFFFFFFFFFFFFFFFF + 0xFFFFFFFFFFFFFFFF - 0xFFFFFFFFFFFFFFFF", UINT64_MAX],
    ["5 - 5", 0n],
  ];
  for (const [input, expected] of cases) {
    it(`"${input}"`, () => expect(parsed(input).value).toBe(expected));
  }
});

// @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/OffsetExpressionTests.swift#OffsetExpressionTests.testErrors
describe("why a text comes to no offset", () => {
  const cases: [input: string, expected: OffsetExpressionFailure][] = [
    // Nothing typed, or only the prefix the field opens with.
    ["", "invalidInput"],
    ["   ", "invalidInput"],
    ["0x", "invalidInput"],
    ["0X", "invalidInput"],
    // Still being typed: wait for the rest.
    ["0x1FE000 +", "incomplete"],
    ["0x1FE000 -  ", "incomplete"],
    ["0x1FE000 + 0x", "incomplete"],
    ["0x1FE000 + 0X", "incomplete"],
    // A sign in front is kept free, not guessed at.
    ["+5", "invalidInput"],
    ["-1", "invalidInput"],
    ["+", "invalidInput"],
    ["-", "invalidInput"],
    // Two operators in a row, in the middle or at the end.
    ["1 + + 2", "invalidInput"],
    ["1 - - 2", "invalidInput"],
    ["1 + -", "invalidInput"],
    // A prefix with no digits is unfinished only where the typing is.
    ["0x + 1", "invalidInput"],
    // Not numbers.
    ["1 + G", "invalidInput"],
    ["1 * 2", "invalidInput"],
    ["(1 + 2)", "invalidInput"],
    ["1.5 + 1", "invalidInput"],
    ["0x1F E0 + 1", "invalidInput"],
    // The sum itself.
    ["1 - 2", "negative"],
    ["0x100 - 0x200 + 0xFF", "negative"],
    ["0xFFFFFFFFFFFFFFFF + 1", "outOfRange"],
    ["0xFFFFFFFFFFFFFFFF + 0xFFFFFFFFFFFFFFFF - 0xFFFFFFFFFFFFFFFF + 1", "outOfRange"],
    // A term too large is a bad term, not a result past 64 bits.
    ["0x10000000000000000 + 1", "invalidInput"],
    ["1 + 99999999999999999999", "invalidInput"],
    ["0x10000000000000000", "invalidInput"],
  ];
  for (const [input, expected] of cases) {
    it(`"${input}"`, () =>
      expect(parseOffsetExpression(input)).toEqual({ ok: false, reason: expected }));
  }
});

// @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/OffsetExpressionTests.swift#OffsetExpressionTests.testHexText
it("reads the sum back with every term in hex", () => {
  const sum = parsed("0x1fe000+40");
  expect(expressionHexText(sum)).toBe("0x1FE000 + 0x28");
  expect(hexNumber(sum.value)).toBe("0x1FE028");
  expect(isSum(sum)).toBe(true);
  expect(sum.terms).toEqual([
    { isSubtracted: false, value: 0x1fe000n },
    { isSubtracted: false, value: 40n },
  ]);

  expect(expressionHexText(parsed("beef - 10 + 0x1"))).toBe("0xBEEF - 0xA + 0x1");

  const number = parsed("4096");
  expect(isSum(number)).toBe(false);
  expect(expressionHexText(number)).toBe("0x1000");
  expect(hexNumber(number.value)).toBe("0x1000");
});
