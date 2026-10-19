import { describe, expect, it } from "vitest";
import { BlobByteSource, type BlobReader } from "@/workers/blobByteSource";

/**
 * Bytes held in memory, as a `Blob` and the reader of one, which can be told to
 * fail — the one interesting thing about the adapter is what it does when a read
 * throws. Node has no synchronous way to read a real `Blob`, so the blob is a
 * stand-in whose slices say which bytes they are.
 */
function stub(
  bytes: ArrayLike<number>,
  fails = false,
  reads: [number, number][] = []
): BlobByteSource {
  type Slice = { readonly start: number; readonly end: number };
  const blob = {
    size: bytes.length,
    slice: (start: number, end: number): Slice => ({ start, end }),
  } as unknown as Blob;
  const reader: BlobReader = {
    readAsArrayBuffer(part) {
      if (fails) throw new DOMException("The file could not be read.", "NotReadableError");
      const { start, end } = part as unknown as Slice;
      reads.push([start, end]);
      return new Uint8Array(Array.prototype.slice.call(bytes, start, end)).buffer;
    },
  };
  return new BlobByteSource(blob, reader);
}

/**
 * @upstream Packages/UEFIContentSource/Tests/UEFIContentSourceTests/ToolContentByteSourceTests.swift#ToolContentByteSourceTests
 */
describe("the Blob a tree is read from", () => {
  // The parser asks the adapter how big the file is, and the answer has to be
  // the file's own size.
  // @upstream Packages/UEFIContentSource/Tests/UEFIContentSourceTests/ToolContentByteSourceTests.swift#ToolContentByteSourceTests.testByteCountIsTheReadersSize
  it("is as big as the file", () => {
    expect(stub([1, 2, 3, 4]).byteCount).toBe(4);
  });

  // [1, 3) is two bytes at offset 1 — the conversion from a half-open range to
  // a slice is the whole job.
  // @upstream Packages/UEFIContentSource/Tests/UEFIContentSourceTests/ToolContentByteSourceTests.swift#ToolContentByteSourceTests.testAHalfOpenRangeReadsThoseBytes
  it("reads the bytes of a half-open range", () => {
    expect([...stub([0xaa, 0xbb, 0xcc, 0xdd]).bytes(1, 3)]).toEqual([0xbb, 0xcc]);
  });

  // A `File` gone stale under a changed file fails its reads, and the request
  // it was part of fails and says so: a tree read off zeros the file never held
  // would be a confident answer about nothing.
  // @upstream Packages/UEFIContentSource/Tests/UEFIContentSourceTests/ToolContentByteSourceTests.swift#ToolContentByteSourceTests.testAFailedReadYieldsZerosOfTheRightLength
  // @upstream-differs a failed read throws rather than yielding zeros of the length asked for
  it("lets a failed read fail", () => {
    expect(() => stub([1, 2, 3, 4], true).bytes(0, 3)).toThrow("could not be read");
  });

  // A parse reads thousands of fields a few bytes long; each is a call into the browser, so the
  // chunk around one is read once and the fields beside it come from that. A long read is read
  // whole and kept by nobody.
  // @web-only upstream reads a document already in memory
  it("reads a chunk once for the small reads inside it, and a long read whole", () => {
    const bytes = new Uint8Array(1024 * 1024).map((_, index) => index % 251);
    const reads: [number, number][] = [];
    const source = stub(bytes, false, reads);
    expect([...source.bytes(10, 14)]).toEqual([10, 11, 12, 13]);
    expect(source.word(100, 2)).toBe(100 + 101 * 256);
    expect([...source.bytes(65534, 65538)]).toEqual([...bytes.slice(65534, 65538)]);
    expect(reads).toEqual([
      [0, 65536],
      [65536, 131072],
    ]);
    reads.length = 0;
    expect(source.bytes(0, 512 * 1024)).toEqual(bytes.slice(0, 512 * 1024));
    expect(reads).toEqual([[0, 512 * 1024]]);
    expect(source.bytes(1024 * 1024 - 2, 1024 * 1024 + 8).length).toBe(2);
  });
});
