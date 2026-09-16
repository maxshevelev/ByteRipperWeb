import { describe, expect, it } from "vitest";
import {
  addressDigitInk,
  addressSignificantFrom,
  byteInk,
  INK_ROLES,
} from "@/render/hexGrid/byteStyle";

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

describe("the find indicator's ink", () => {
  it("is black for every byte on the plate, fill bytes included", () => {
    for (const byte of [0x00, 0xff, 0x41]) {
      expect(byteInk(byte, false, true), `0x${byte.toString(16)}`).toBe("indicator");
    }
  });

  it("keeps an unsaved edit red on the plate", () => {
    expect(byteInk(0x41, true, true)).toBe("modified");
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

describe("the ink of an address's digits", () => {
  // @upstream ByteRipperTests/OffsetColumnAddressTests.swift#OffsetColumnAddressTests.testLeadingZerosAreMutedAndTheSignificantPartIsFullInk
  it("mutes the leading zeros and keeps the rest", () => {
    const ink = (index: number) => addressDigitInk(index, 4, false);
    expect(ink(0)).toBe("mutedAddress");
    expect(ink(3)).toBe("mutedAddress");
    expect(ink(4)).toBe("address");
    expect(ink(7)).toBe("address");
  });

  it("keeps the two roles apart for an unmarked address", () => {
    for (const index of [0, 3, 4, 7]) {
      expect(addressDigitInk(index, 4, false)).not.toBe("mutedBookmarkAddress");
      expect(addressDigitInk(index, 4, false)).not.toBe("bookmarkAddress");
    }
  });

  // @web-only upstream has no test for the marked address's ink: its HexView.offsetAddress test covers the plain column, and HexTheme.mutedBookmarkText is exercised only through the drawing
  it("inverts both halves on a mark, and dims the zeros in the mark's own ink", () => {
    // A mark fills its row's address, so a digit there is read against the
    // mark rather than the paper — and the zeros are dimmed in *that* ink, so
    // the significant part still stands out where a purple bar is the ground.
    const ink = (index: number) => addressDigitInk(index, 4, true);
    expect(ink(0)).toBe("mutedBookmarkAddress");
    expect(ink(3)).toBe("mutedBookmarkAddress");
    expect(ink(4)).toBe("bookmarkAddress");
    expect(ink(7)).toBe("bookmarkAddress");
  });

  it("mutes an all-zero address in full on a mark too", () => {
    // Row 0, marked: every digit is a leading zero, so every digit is dimmed —
    // the same split `addressSignificantFrom` asks for.
    for (let index = 0; index < 8; index++) {
      expect(addressDigitInk(index, 8, true)).toBe("mutedBookmarkAddress");
    }
  });

  it("gives every role an atlas tile to be drawn from", () => {
    // The renderer looks a tile up by role; a role missing from the list is a
    // glyph that never gets built.
    for (const role of [
      addressDigitInk(0, 4, false),
      addressDigitInk(4, 4, false),
      addressDigitInk(0, 4, true),
      addressDigitInk(4, 4, true),
    ]) {
      expect(INK_ROLES).toContain(role);
    }
  });
});
