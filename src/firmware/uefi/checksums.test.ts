import { describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import { ImageReader } from "@/firmware/imageReader";
import {
  alignUp,
  checksum8,
  checksum16,
  checksumText,
  crc32,
  sum8,
  sum8Of,
  sum16,
  sum32Of,
} from "@/firmware/uefi/checksums";

/**
 * Ported from `ChecksumTests.swift`.
 *
 * All of these are built so that the structure including its own checksum field
 * sums to zero — which is why verifying and computing are one operation.
 */

const bytes = (...values: number[]) => new Uint8Array(values);
const reader = (...values: number[]) => new ImageReader(sourceOver(bytes(...values)));

describe("a checksum", () => {
  const four = bytes(0x10, 0x20, 0x30, 0x41);

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/ChecksumTests.swift#ChecksumTests.testTheEightBitChecksumMakesTheSumZero
  it("makes the eight-bit sum come out at zero", () => {
    expect(sum8([...four, checksum8(four)])).toBe(0);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/ChecksumTests.swift#ChecksumTests.testTheSixteenBitChecksumMakesTheSumZero
  it("makes the sixteen-bit sum come out at zero", () => {
    expect(checksum16(four)).toBe(0x9ec0);
    expect(sum16(bytes(...four, 0xc0, 0x9e))).toBe(0);
  });

  // An FV header length that is odd cannot be summed in 16-bit words, and the
  // length is the thing worth reporting — not a checksum rounded to fit.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/ChecksumTests.swift#ChecksumTests.testAnOddLengthHasNoSixteenBitSum
  it("has no sixteen-bit answer for an odd length", () => {
    expect(sum16(bytes(0x01, 0x02, 0x03))).toBeUndefined();
    expect(checksum16(bytes(0x01))).toBeUndefined();
  });
});

describe("summing a range of the image", () => {
  // The body of an FFS file can be megabytes, so the sum reads in chunks — and
  // has to come out the same as summing it all at once.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/ChecksumTests.swift#ChecksumTests.testTheChunkedByteSumMatchesTheDirectOne
  it("comes out the same chunked as direct", () => {
    const long = new Uint8Array(70_000).map((_, index) => (index * 7) & 0xff);
    const image = new ImageReader(sourceOver(long));

    expect(sum8Of(image.all, image)).toBe(sum8(long));
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/ChecksumTests.swift#ChecksumTests.testTheChunkedSumsRefuseARangeOutsideTheImage
  it("refuses a range outside the image", () => {
    const image = reader(1, 2, 3, 4);

    expect(sum8Of({ start: 0, end: 5 }, image)).toBeUndefined();
    expect(sum32Of({ start: 0, end: 8 }, image)).toBeUndefined();
  });

  // Intel microcode checks out when every dword of it sums to zero.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/ChecksumTests.swift#ChecksumTests.testTheDwordSumIsLittleEndianAndCancels
  it("sums dwords little-endian, and they cancel", () => {
    const image = reader(0x01, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0xff);

    expect(sum32Of({ start: 0, end: 4 }, image)).toBe(1);
    expect(sum32Of({ start: 0, end: 8 }, image)).toBe(0);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/ChecksumTests.swift#ChecksumTests.testTheDwordSumNeedsWholeWords
  it("needs whole dwords", () => {
    expect(sum32Of({ start: 0, end: 6 }, reader(1, 2, 3, 4, 5, 6))).toBeUndefined();
  });
});

// The one checksum in this format that is not a "sum to zero": a stored value
// is compared against a computed one.
describe("CRC-32", () => {
  it("is the IEEE 802.3 variant", () => {
    // "123456789", the check value every CRC-32 implementation quotes.
    const check = Uint8Array.from("123456789", (digit) => digit.charCodeAt(0));
    expect(crc32(check)).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

/**
 * The one spelling of a checksum that carries a validity bit: the value in hex,
 * and whether the structure says it counts, in words. Shared, so the panels
 * read it the same.
 */
describe("how a checksum reads", () => {
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/ChecksumTests.swift#ChecksumTests.testTheChecksumWithValidityReadsAsOneLine
  it("is one line of value and validity", () => {
    expect(checksumText({ value: 0x5c, valid: true })).toBe("0x5C (Valid)");
    expect(checksumText({ value: 0x5c, valid: false })).toBe("0x5C (Invalid)");
    // A narrow value is padded to the field's width, not left ragged.
    expect(checksumText({ value: 0, valid: false })).toBe("0x00 (Invalid)");
    expect(checksumText({ value: 1, valid: true, digits: 4 })).toBe("0x0001 (Valid)");
  });

  // The point of showing the value at all is that a reader can write it back,
  // so leaving it a mystery would say half of the story.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/ChecksumTests.swift#ChecksumTests.testAnInvalidChecksumSaysWhatItShouldBe
  it("says what an invalid one should be", () => {
    expect(checksumText({ value: 0x5c, valid: false, expected: 0x5a })).toBe(
      "0x5C (Invalid), should be 0x5A"
    );
    expect(checksumText({ value: 0x0c, valid: false, expected: 0x05, digits: 4 })).toBe(
      "0x000C (Invalid), should be 0x0005"
    );
    // A valid checksum is already what it should be, so the words never add the
    // should-be — there is nothing to correct, even when told.
    expect(checksumText({ value: 0x5a, valid: true, expected: 0x5a })).toBe("0x5A (Valid)");
  });
});

describe("aligning up", () => {
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/ChecksumTests.swift#ChecksumTests.testAligningUp
  it("rounds to the next multiple", () => {
    expect(alignUp(0x11, 8)).toBe(0x18);
    expect(alignUp(0x18, 8)).toBe(0x18);
    expect(alignUp(0, 8)).toBe(0);
    expect(alignUp(1, 0)).toBeUndefined();
  });

  // The value being aligned is usually `offset + size`, both read out of a
  // corrupt image — so the alignment itself can be what leaves the range.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/ChecksumTests.swift#ChecksumTests.testAligningPastTheEndOfTheNumberIsNil
  it("has no answer past the last exact integer", () => {
    expect(alignUp(Number.MAX_SAFE_INTEGER - 2, 8)).toBeUndefined();
  });
});
