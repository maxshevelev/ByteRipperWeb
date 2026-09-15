import { describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import { ImageReader } from "@/firmware/imageReader";
import { OverlayByteSource } from "@/firmware/overlayByteSource";

/**
 * Reading an image as the transaction about to be applied will leave it —
 * upstream's `OverlayByteSourceTests`.
 */

const base = () => sourceOver(new Uint8Array(0x40).fill(0xaa));

const read = (source: OverlayByteSource, start: number, end: number) => [
  ...source.bytes(start, end),
];

describe("OverlayByteSource", () => {
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/OverlayByteSourceTests.swift#OverlayByteSourceTests.testAReadThatMissesEveryPatchIsTheImage
  it("reads the base where no patch reaches", () => {
    const source = new OverlayByteSource(base(), [
      { offset: 0x20, bytes: Uint8Array.of(1, 2, 3, 4) },
    ]);

    expect(read(source, 0, 4)).toEqual([0xaa, 0xaa, 0xaa, 0xaa]);
    expect(source.byteCount).toBe(0x40);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/OverlayByteSourceTests.swift#OverlayByteSourceTests.testAPatchIsSeenWhereItLies
  it("reads a patch where one covers the read whole", () => {
    const source = new OverlayByteSource(base(), [
      { offset: 0x10, bytes: Uint8Array.of(1, 2, 3, 4) },
    ]);

    expect(read(source, 0x10, 0x14)).toEqual([1, 2, 3, 4]);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/OverlayByteSourceTests.swift#OverlayByteSourceTests.testAReadThatStraddlesAPatchGetsBothSides
  it("joins a patch to the base where the read straddles its edge", () => {
    const source = new OverlayByteSource(base(), [
      { offset: 0x10, bytes: Uint8Array.of(1, 2, 3, 4) },
    ]);

    // Two bytes before it, the patch, and two after.
    expect(read(source, 0x0e, 0x16)).toEqual([0xaa, 0xaa, 1, 2, 3, 4, 0xaa, 0xaa]);
    // And a read starting inside the patch and running out of it.
    expect(read(source, 0x12, 0x16)).toEqual([3, 4, 0xaa, 0xaa]);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/OverlayByteSourceTests.swift#OverlayByteSourceTests.testTheLastPatchWins
  it("lets a later patch win where two cover the same byte", () => {
    // A repair is patched over a write the transaction is already making, and
    // the repair is the one that counts.
    const source = new OverlayByteSource(base(), [
      { offset: 0x10, bytes: Uint8Array.of(1, 1, 1, 1) },
      { offset: 0x12, bytes: Uint8Array.of(9, 9) },
    ]);

    expect(read(source, 0x10, 0x14)).toEqual([1, 1, 9, 9]);
  });

  it("reads through a reader the same way", () => {
    // The point of it: a checksum computed over what the transaction will
    // leave, through the ordinary reader every other sum is computed through.
    const reader = new ImageReader(
      new OverlayByteSource(base(), [
        { offset: 0x04, bytes: Uint8Array.of(0x78, 0x56, 0x34, 0x12) },
      ])
    );

    expect(reader.uint32(0x04)).toBe(0x1234_5678);
    expect(reader.uint32(0x00)).toBe(0xaaaa_aaaa);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/OverlayByteSourceTests.swift#OverlayByteSourceTests.testSeveralPatchesAllShow
  it("shows every one of several patches", () => {
    const counting = sourceOver(Uint8Array.from({ length: 32 }, (_, index) => index));
    const reader = new ImageReader(
      new OverlayByteSource(counting, [
        { offset: 0, bytes: Uint8Array.of(0xf0) },
        { offset: 31, bytes: Uint8Array.of(0xf1) },
      ])
    );

    expect(reader.uint8(0)).toBe(0xf0);
    expect(reader.uint8(31)).toBe(0xf1);
    expect(reader.uint8(15)).toBe(15);
  });

  it("gives nothing for an empty read", () => {
    const source = new OverlayByteSource(base(), [{ offset: 0, bytes: Uint8Array.of(1, 2, 3, 4) }]);

    expect(read(source, 0x10, 0x10)).toEqual([]);
  });
});
