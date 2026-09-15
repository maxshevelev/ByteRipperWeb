import { describe, expect, it } from "vitest";
import { addressSignificantFrom, byteInk } from "@/render/hexGrid/byteStyle";

/** Ported from `ByteSignificanceTests.swift` and upstream's address split. */

describe("the significance accent", () => {
  // @upstream ByteRipperTests/ByteSignificanceTests.swift#ByteSignificanceTests.testFillBytesAreMuted
  it("mutes the fill bytes", () => {
    expect(byteInk(0x00, false)).toBe("mutedByte");
    expect(byteInk(0xff, false)).toBe("mutedByte");
  });

  // @upstream ByteRipperTests/ByteSignificanceTests.swift#ByteSignificanceTests.testOtherBytesKeepFullContrast
  it("leaves every other byte at full contrast", () => {
    for (const byte of [0x01, 0x7f, 0x80, 0xfe]) {
      expect(byteInk(byte, false), `0x${byte.toString(16)}`).toBe("byte");
    }
  });

  it("lets an unsaved edit outrank it", () => {
    // A modified byte stays red even when its value is a fill byte.
    for (const byte of [0x00, 0xff, 0x41]) {
      expect(byteInk(byte, true), `0x${byte.toString(16)}`).toBe("modified");
    }
  });
});

describe("the address split", () => {
  // @upstream ByteRipperTests/OffsetColumnAddressTests.swift#OffsetColumnAddressTests.testLeadingZerosAreMutedAndTheSignificantPartIsFullInk
  it("mutes the leading zeros and keeps the rest", () => {
    expect(addressSignificantFrom("0000DEAD")).toBe(4);
    expect(addressSignificantFrom("00000001")).toBe(7);
    expect(addressSignificantFrom("DEADBEEF")).toBe(0);
  });

  // @upstream ByteRipperTests/OffsetColumnAddressTests.swift#OffsetColumnAddressTests.testAnAllZeroAddressIsMutedInFull
  it("mutes an all-zero address in full", () => {
    // Row 0. Nothing in it is significant, which is what makes every other
    // address's significant part stand out.
    expect(addressSignificantFrom("00000000")).toBe(8);
  });
});
