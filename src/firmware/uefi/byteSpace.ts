/**
 * Which bytes a node's ranges are in.
 *
 * Almost every node is a place in the open file. A node found inside a
 * compressed section is not: its offsets are into the buffer that section
 * decompresses to, and put next to file offsets they are wrong in the worst way
 * — plausible. A lookup by file offset would descend into a driver whose buffer
 * offset happens to match the caret; a zone would draw over unrelated bytes of
 * the dump. So every node says which space its ranges are in, and ranges are
 * only ever compared within one space.
 *
 * Ported from `Packages/UEFIImage/Sources/UEFIImage/ByteSpace.swift`.
 */

/**
 * The compressed sections on the way in, each named by where its header is —
 * the first in the file, each next one inside the buffer before it. The file
 * itself is the empty chain.
 *
 * A section is named by its offset rather than by `NodeID` so that the name
 * survives the tree being cut back and grown again: the offsets are all a
 * decode needs, and the nodes it built may be long gone.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/ByteSpace.swift#ByteSpace
 * @upstream-differs the chain itself, with the file as the empty one, where
 * upstream has an enum of two cases — the same shape `NodeID` already has here,
 * and one that is a value TypeScript can compare and key a map by
 */
export type ByteSpace = readonly number[];

/** The open file. @upstream Packages/UEFIImage/Sources/UEFIImage/ByteSpace.swift#ByteSpace.file */
export const FILE_SPACE: ByteSpace = [];

/** Whether these ranges are the file's own bytes. */
export const isFileSpace = (space: ByteSpace): boolean => space.length === 0;

/**
 * The space of what a compressed section at `offset` — in this space —
 * decompresses to.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/ByteSpace.swift#ByteSpace.inside
 */
export const insideSection = (space: ByteSpace, offset: number): ByteSpace => [...space, offset];

/**
 * The header offset, in the file, of the outermost compressed section this
 * space is inside — the bytes of the file that actually hold a node in it.
 * Nothing for the file itself.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/ByteSpace.swift#ByteSpace.outermostSection
 */
export const outermostSection = (space: ByteSpace): number | undefined => space[0];

/**
 * @upstream Packages/UEFIImage/Sources/UEFIImage/ByteSpace.swift#ByteSpace
 * @upstream-differs Swift's `Hashable` gives upstream both of these for
 * nothing; here equality is written out, and the key is what a Map is keyed by
 */
export const sameSpace = (one: ByteSpace, two: ByteSpace): boolean =>
  one.length === two.length && one.every((offset, index) => offset === two[index]);

/** The key a space is held under, an offset chain being no key of its own. */
export const spaceKey = (space: ByteSpace): string => space.join(".");
