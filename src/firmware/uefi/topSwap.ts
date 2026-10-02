import type { ImageRange, ImageReader } from "@/firmware/imageReader";
import type { UEFIImage } from "@/firmware/uefi/uefiImage";

/**
 * The Top Swap backup of the block the FIT lives in (`UEFI_IMAGE_FORMAT.md` §11).
 *
 * A chipset with Top Swap set maps the block directly below the top block of the
 * BIOS region at the top of memory instead, so a board can start from a second
 * copy of its boot block while the first is being rewritten. Such an image
 * carries the top block twice — the same volumes, microcode and ACM, and a FIT of
 * its own at the same place in the block naming the same addresses.
 *
 * The block's size is a chipset strap whose place in the descriptor moves from
 * one PCH generation to the next, so the copy is recognised by what it has to
 * hold instead: the FIT pointer with the same value, and the `_FIT_` table at the
 * same distance below.
 *
 * Here rather than in the FIT tool-module because the structure panel names the
 * copy too; the module adds the editing.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/TopSwap.swift#TopSwapCopy
 */
export interface TopSwapCopy {
  /**
   * The top block, ending where the address space does.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/TopSwap.swift#TopSwapCopy.top
   */
  readonly top: ImageRange;
  /**
   * Its copy, directly below.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/TopSwap.swift#TopSwapCopy.backup
   */
  readonly backup: ImageRange;
}

/** @upstream Packages/UEFIImage/Sources/UEFIImage/TopSwap.swift#TopSwapCopy.size */
export const topSwapSize = (copy: TopSwapCopy): number => copy.top.end - copy.top.start;

/**
 * Where the FIT pointer is (`FIT_TABLE_FORMAT.md` §2).
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/TopSwap.swift#TopSwapCopy.fitPointerAddress
 */
const FIT_POINTER_ADDRESS = 0xffff_ffc0;
/**
 * `_FIT_   `, exact as eight bytes: JavaScript has no 64-bit integer.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/TopSwap.swift#TopSwapCopy.fitSignature
 */
const FIT_SIGNATURE = 0x2020_205f_5449_465fn;
/**
 * The sizes a Top Swap block comes in: a power of two from 64 KiB to 16 MiB.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/TopSwap.swift#TopSwapCopy.smallestBlock
 */
const SMALLEST_BLOCK = 0x1_0000;
/** @upstream Packages/UEFIImage/Sources/UEFIImage/TopSwap.swift#TopSwapCopy.largestBlock */
const LARGEST_BLOCK = 0x100_0000;

/**
 * The backup of the block holding the FIT, given where the pointer is, what it
 * says, and where the table it leads to lies — or nothing when the image has no
 * such copy.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/TopSwap.swift#TopSwapCopy.find
 */
export function findTopSwapCopy(
  where: {
    readonly pointerOffset: number;
    readonly pointerAddress: number;
    readonly table: ImageRange;
  },
  reader: ImageReader
): TopSwapCopy | undefined {
  const { pointerOffset, pointerAddress, table } = where;
  const topEnd = pointerOffset + (0x1_0000_0000 - FIT_POINTER_ADDRESS);
  for (let size = SMALLEST_BLOCK; size <= LARGEST_BLOCK && size * 2 <= topEnd; size *= 2) {
    const top = { start: topEnd - size, end: topEnd };
    if (
      top.start <= table.start &&
      table.end <= top.end &&
      reader.uint32(pointerOffset - size) === pointerAddress &&
      reader.uint64Bits(table.start - size) === FIT_SIGNATURE
    ) {
      return { top, backup: { start: top.start - size, end: top.start } };
    }
  }
  return undefined;
}

/**
 * The copy in `image`, found through its FIT, or nothing when the image has no
 * addresses yet, no FIT, or no copy.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/TopSwap.swift#TopSwapCopy.find
 */
export function findTopSwapCopyIn(image: UEFIImage, reader: ImageReader): TopSwapCopy | undefined {
  const pointer = image.offsetForAddress(FIT_POINTER_ADDRESS);
  const address = pointer === undefined ? undefined : reader.uint32(pointer);
  const table = address === undefined ? undefined : image.offsetForAddress(address);
  if (
    pointer === undefined ||
    address === undefined ||
    table === undefined ||
    reader.uint64Bits(table) !== FIT_SIGNATURE
  ) {
    return undefined;
  }
  return findTopSwapCopy(
    { pointerOffset: pointer, pointerAddress: address, table: { start: table, end: table + 16 } },
    reader
  );
}

/**
 * Where an offset is once the blocks trade places: a byte of either block is the
 * same byte of the other, and everything else stays put.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/TopSwap.swift#TopSwapCopy.swap
 */
export function topSwapped(copy: TopSwapCopy, offset: number): number {
  const size = topSwapSize(copy);
  if (copy.top.start <= offset && offset < copy.top.end) return offset - size;
  if (copy.backup.start <= offset && offset < copy.backup.end) return offset + size;
  return offset;
}

/**
 * Whether the two copies are the same bytes.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/TopSwap.swift#TopSwapCopy.copiesMatch
 */
export function topSwapCopiesMatch(copy: TopSwapCopy, reader: ImageReader): boolean {
  const size = topSwapSize(copy);
  const chunk = 0x1_0000;
  for (let offset = 0; offset < size; offset += chunk) {
    const count = Math.min(chunk, size - offset);
    const upper = reader.bytesAt(copy.top.start + offset, count);
    const lower = reader.bytesAt(copy.backup.start + offset, count);
    if (upper === undefined || lower === undefined || upper.length !== lower.length) return false;
    for (let index = 0; index < upper.length; index++) {
      if (upper[index] !== lower[index]) return false;
    }
  }
  return true;
}
