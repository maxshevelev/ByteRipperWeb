import { describe, expect, it } from "vitest";
import { type ByteSource, sourceOver, WindowedByteSource } from "@/firmware/byteSource";
import { ImageReader } from "@/firmware/imageReader";

/**
 * Ported from `ImageReaderTests.swift` and `WindowedByteSourceTests.swift`.
 *
 * This is the one place the firmware parsers bounds-check, which is why it is
 * worth pinning down here rather than in each of the fifty callers — and the
 * read window they put in front of their source, which exists because the
 * alternative was measured in seconds.
 */

const bytes = (...values: number[]) => new Uint8Array(values);
const counting = (image: Uint8Array): ByteSource & { reads: number } => {
  const inner = sourceOver(image);
  const source = {
    reads: 0,
    byteCount: inner.byteCount,
    bytes(start: number, end: number) {
      source.reads++;
      return inner.bytes(start, end);
    },
    word: (offset: number, count: number) => inner.word(offset, count),
  };
  return source;
};

describe("reading a field", () => {
  const reader = new ImageReader(
    sourceOver(bytes(0x78, 0x56, 0x34, 0x12, 0xef, 0xcd, 0xab, 0x89, 0xff, 0xff))
  );

  it("is little-endian, whatever its width", () => {
    expect(reader.uint8(0)).toBe(0x78);
    expect(reader.uint16(0)).toBe(0x5678);
    expect(reader.uint24(0)).toBe(0x345678);
    expect(reader.uint32(0)).toBe(0x12345678);
    expect(reader.uint64Bits(0)).toBe(0x89abcdef12345678n);
  });

  // JavaScript's bitwise operators are 32-bit, so a dword with its top bit set
  // comes back negative from a shift-and-or assembly.
  it("reads a dword with its top bit set as a positive number", () => {
    const top = new ImageReader(sourceOver(bytes(0x00, 0x00, 0x00, 0x80)));
    expect(top.uint32(0)).toBe(0x80000000);
  });

  it("is nothing when it runs off the end", () => {
    expect(reader.uint32(8)).toBeUndefined();
    expect(reader.uint64(3)).toBeUndefined();
    expect(reader.uint8(10)).toBeUndefined();
    expect(reader.bytesAt(9, 2)).toBeUndefined();
    expect(reader.guid(0)).toBeUndefined();
  });

  // The addition that overflows is not hypothetical: both terms come out of a
  // corrupt image, and unchecked it wraps into a range that passes every later
  // test. Here "overflow" is a number that has stopped being an integer.
  it("is nothing when the range would not be a range", () => {
    expect(reader.range(Number.MAX_SAFE_INTEGER - 2, 10)).toBeUndefined();
    expect(reader.range(4, Number.MAX_SAFE_INTEGER)).toBeUndefined();
    expect(reader.bytesAt(Number.MAX_SAFE_INTEGER, 1)).toBeUndefined();
    expect(reader.range(2 ** 53, 1)).toBeUndefined();
  });

  it("gives a range inside the image", () => {
    expect(reader.range(2, 4)).toEqual({ start: 2, end: 6 });
    expect(reader.range(10, 0)).toEqual({ start: 10, end: 10 });
    expect([...(reader.bytes({ start: 2, end: 4 }) ?? [])]).toEqual([0x34, 0x12]);
    expect([...(reader.bytes({ start: 4, end: 4 }) ?? [])]).toEqual([]);
  });
});

describe("a run of one byte", () => {
  const reader = new ImageReader(
    sourceOver(bytes(0x78, 0x56, 0x34, 0x12, 0xef, 0xcd, 0xab, 0x89, 0xff, 0xff))
  );

  it("is not filled when one byte is out of place", () => {
    expect(reader.isFilled({ start: 8, end: 10 }, 0xff)).toBe(true);
    expect(reader.isFilled({ start: 7, end: 10 }, 0xff)).toBe(false);
  });

  // Out of bounds is "no", not "vacuously yes" — free space is decided with
  // this, and a range past the end must never read as empty space.
  it("is not filled outside the image", () => {
    expect(reader.isFilled({ start: 8, end: 12 }, 0xff)).toBe(false);
  });

  it("says where it stops", () => {
    expect(reader.firstOffsetNotEqualTo({ start: 7, end: 10 }, 0xff)).toBe(7);
    expect(reader.firstOffsetNotEqualTo({ start: 8, end: 10 }, 0xff)).toBeUndefined();
  });
});

describe("walking a range in chunks", () => {
  const reader = new ImageReader(
    sourceOver(bytes(0x78, 0x56, 0x34, 0x12, 0xef, 0xcd, 0xab, 0x89, 0xff, 0xff))
  );

  it("covers it in order", () => {
    const seen: number[] = [];
    reader.forEachChunk(
      { start: 1, end: 7 },
      (chunk) => {
        seen.push(...chunk);
        return true;
      },
      4
    );

    expect(seen).toEqual([0x56, 0x34, 0x12, 0xef, 0xcd, 0xab]);
  });

  // Free space is routinely megabytes and the answer is usually decided by the
  // first chunk, so stopping early has to actually stop.
  it("stops when asked to", () => {
    let chunks = 0;
    reader.forEachChunk(
      { start: 0, end: 10 },
      () => {
        chunks++;
        return false;
      },
      2
    );

    expect(chunks).toBe(1);
  });

  it("is no chunks at all outside the image", () => {
    let chunks = 0;
    reader.forEachChunk(
      { start: 8, end: 12 },
      () => {
        chunks++;
        return true;
      },
      2
    );

    expect(chunks).toBe(0);
  });
});

describe("the read window", () => {
  const image = new Uint8Array(4 * 1024).map((_, index) => index & 0xff);

  it("answers what the source would", () => {
    const source = counting(image);
    const windowed = new WindowedByteSource(source, 256);
    const plain = sourceOver(image);

    for (let offset = 0; offset < image.length - 8; offset += 7) {
      expect([...windowed.bytes(offset, offset + 5)]).toEqual([
        ...image.subarray(offset, offset + 5),
      ]);
      expect(windowed.word(offset, 4)).toBe(plain.word(offset, 4));
    }
  });

  // The point of it: a run of small forward reads costs one read per window,
  // not one per field.
  it("costs one read per window, not one per field", () => {
    const source = counting(image);
    const windowed = new WindowedByteSource(source, 256);

    for (let offset = 0; offset < 200; offset++) windowed.word(offset, 4);

    expect(source.reads).toBeLessThanOrEqual(2);
  });

  // A caller already reading in bulk — a scan taking its next megabyte, a
  // free-space check walking a volume — would only evict the window.
  it("lets a bulk read straight through", () => {
    const source = counting(image);
    const windowed = new WindowedByteSource(source, 256);

    windowed.word(0, 4);
    const before = source.reads;
    expect([...windowed.bytes(0, 2048)]).toEqual([...image.subarray(0, 2048)]);
    expect(source.reads).toBe(before + 1);

    // And the window it did not touch still answers.
    windowed.word(8, 4);
    expect(source.reads).toBe(before + 1);
  });

  // A read the window cannot cover — one that would run past the end of the
  // source — falls through rather than answering short.
  it("falls through for a read past the end", () => {
    const source = counting(image);
    const windowed = new WindowedByteSource(source, 256);
    const last = image.length - 4;

    expect(windowed.word(last, 4)).toBe(sourceOver(image).word(last, 4));
  });
});
