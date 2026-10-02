import { describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import { BinaryWriter, file, volume, volumeTopFile } from "@/firmware/testing/testImage";
import { guid } from "@/firmware/uefi/efiGuid";
import { topSwapped } from "@/firmware/uefi/topSwap";
import { parseUefiImage } from "@/firmware/uefi/uefiImage";

/**
 * Ported from `TopSwapTests.swift`: the Top Swap copy of the boot block, found
 * through the FIT and read with the protected ranges (`UEFI_IMAGE_FORMAT.md` §11).
 */

const BLOCK = 0x1_0000;
const FIT_GUID = guid("FD000000-0000-4000-8000-0000000000F1");

/**
 * One block: a volume holding a file for the FIT and ending in the Volume Top
 * File, the FIT in that file and the pointer at `0xFFFFFFC0`, for an image
 * `imageSize` bytes long whose last block this is.
 */
function block(imageSize: number): Uint8Array {
  const bytes = volume({
    length: BLOCK,
    files: [file({ guid: FIT_GUID, body: new Uint8Array(0x100).fill(0xff) })],
    lastFile: volumeTopFile({ size: 0x100 }),
  });
  const fit = parseUefiImage(sourceOver(bytes), { readsProtectedRanges: false }).allNodes.find(
    (node) =>
      node.kind === "file" &&
      node.guid !== undefined &&
      node.guid.a === FIT_GUID.a &&
      node.guid.b === FIT_GUID.b
  )?.body.start as number;
  const addressDiff = 0x1_0000_0000 - imageSize;
  const table = new BinaryWriter()
    .u32(0x5449_465f) // `_FIT_   `, low and high dword
    .u32(0x2020_205f)
    .u24(1)
    .u8(0)
    .u16(0x0100)
    .u8(0)
    .u8(0).bytes;
  bytes.set(table, fit);
  bytes.set(new BinaryWriter().u32(imageSize - BLOCK + fit + addressDiff).bytes, BLOCK - 0x40);
  return bytes;
}

const twoBlocks = () => Uint8Array.from([...block(2 * BLOCK), ...block(2 * BLOCK)]);
const rangesOf = (bytes: Uint8Array) => parseUefiImage(sourceOver(bytes)).protectedRanges;

describe("the Top Swap copy", () => {
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/TopSwapTests.swift#TopSwapTests.testTheCopyBelowTheTopBlockIsFoundAndCompared
  it("is found below the top block and compared", () => {
    const ranges = rangesOf(twoBlocks());
    expect(ranges?.topSwap).toEqual({
      top: { start: 0x1_0000, end: 0x2_0000 },
      backup: { start: 0, end: 0x1_0000 },
    });
    expect(ranges?.topSwapCopiesMatch).toBe(true);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/TopSwapTests.swift#TopSwapTests.testCopiesThatDifferSaySo
  it("says so when the copies differ", () => {
    const bytes = twoBlocks();
    bytes[0x200] = (bytes[0x200] ?? 0) ^ 0xff;
    const ranges = rangesOf(bytes);
    expect(ranges?.topSwap).toBeDefined();
    expect(ranges?.topSwapCopiesMatch).toBe(false);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/TopSwapTests.swift#TopSwapTests.testOneBlockHasNoCopy
  it("is absent with one block", () => {
    expect(rangesOf(block(BLOCK))?.topSwap).toBeUndefined();
  });

  // Bytes below the top block that hold no FIT of their own are not a copy.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/TopSwapTests.swift#TopSwapTests.testABlockBelowWithoutItsOwnFITIsNoCopy
  it("is absent when the block below holds no FIT of its own", () => {
    const bytes = Uint8Array.from([...new Uint8Array(BLOCK).fill(0xff), ...block(2 * BLOCK)]);
    expect(rangesOf(bytes)?.topSwap).toBeUndefined();
  });

  // A block swapped in is the other block's byte; anything else stays.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/TopSwapTests.swift#TopSwapTests.testSwapTradesTheBlocks
  it("trades the blocks when swapped", () => {
    const copy = {
      top: { start: 0x2_0000, end: 0x3_0000 },
      backup: { start: 0x1_0000, end: 0x2_0000 },
    };
    expect(topSwapped(copy, 0x2_0010)).toBe(0x1_0010);
    expect(topSwapped(copy, 0x1_0010)).toBe(0x2_0010);
    expect(topSwapped(copy, 0x10)).toBe(0x10);
  });
});
