import { describe, expect, it } from "vitest";
import { MAX_REPRESENTABLE_SIZE } from "@/core/limits";
import { addressString, hexString, parseOffset } from "@/core/text/offsetParser";

/** Ported from `OffsetParserTests.swift`. */

describe("every form the Go To field accepts", () => {
  // A bare hex string with no prefix is the interesting one: `10` is decimal
  // ten, but `1F` and `beef` are hex, in either case.
  const accepted: [input: string, value: number][] = [
    // Decimal.
    ["0", 0],
    ["10", 10],
    ["4096", 4096],
    // Hex with a prefix, either case, prefix and digits alike.
    ["0x10", 16],
    ["0X10", 16],
    ["0xFF", 255],
    ["0xff", 255],
    // Hex without a prefix.
    ["FF", 255],
    ["ff", 255],
    ["1F", 31],
    ["beef", 0xbeef],
    // Surrounding whitespace is trimmed.
    ["  0x1F  ", 31],
    ["\t4096\n", 4096],
    // The largest offset this application can address exactly (D3).
    ["9007199254740991", MAX_REPRESENTABLE_SIZE],
    ["0x1fffffffffffff", MAX_REPRESENTABLE_SIZE],
  ];

  for (const [input, value] of accepted) {
    it(`accepts "${input}"`, () => {
      expect(parseOffset(input)).toEqual({ ok: true, value });
    });
  }
});

describe("and every way it can be refused", () => {
  const refused: [input: string, reason: string][] = [
    // Upstream's ceiling is UInt64.max; ours is Number.MAX_SAFE_INTEGER,
    // because an offset here is a number (D3). These three parse cleanly on
    // the desktop and are out of range in the browser — which is the decision
    // showing, not a bug.
    ["9007199254740992", "outOfRange"],
    ["18446744073709551615", "outOfRange"],
    ["0xffffffffffffffff", "outOfRange"],
    ["0x10000000000000000", "outOfRange"],
    ["99999999999999999999", "outOfRange"],
    // Not a number at all.
    ["", "invalidInput"],
    ["  ", "invalidInput"],
    ["0x", "invalidInput"],
    ["0X", "invalidInput"],
    ["12G", "invalidInput"],
    ["-1", "invalidInput"],
    ["+5", "invalidInput"],
    ["1.5", "invalidInput"],
    ["1_000", "invalidInput"],
    ["0x1G", "invalidInput"],
    ["٤", "invalidInput"], // an Arabic-Indic digit is not a digit here
  ];

  for (const [input, reason] of refused) {
    it(`refuses "${input}" as ${reason}`, () => {
      expect(parseOffset(input)).toEqual({ ok: false, reason });
    });
  }

  it("does not round a too-large value into a plausible one", () => {
    // The reason the parser goes through a bigint: Number("0x20000000000001")
    // is 0x20000000000000, a different offset, and reporting that as success
    // would send the caret somewhere the user never asked for.
    expect(parseOffset("0x20000000000001")).toEqual({ ok: false, reason: "outOfRange" });
  });
});

describe("formatting", () => {
  it("writes hex the way upstream does", () => {
    expect(hexString(0)).toBe("0");
    expect(hexString(255)).toBe("ff");
    expect(hexString(0xdead)).toBe("dead");
  });

  it("pads an address to the column width", () => {
    expect(addressString(0, 8)).toBe("00000000");
    expect(addressString(0xdead, 8)).toBe("0000DEAD");
    // Past the column width the address grows rather than being truncated.
    expect(addressString(0x1_0000_0000, 8)).toBe("100000000");
  });
});
