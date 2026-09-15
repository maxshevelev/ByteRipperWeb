/**
 * A validated half-open byte range `[start, end)` (D13), used by selection and
 * by the navigation dialogs.
 *
 * Ported from `BlockRange.swift`. Construction is failable: a range whose start
 * is past the file size, whose end precedes its start, or whose end exceeds the
 * file size is rejected. A length-based range is clamped to the file size
 * rather than rejected when it simply overshoots EOF, which is how a hex editor
 * treats "jump to offset X".
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/BlockRange.swift#BlockRange
 */
export interface BlockRange {
  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/BlockRange.swift#BlockRange.start */
  readonly start: number;
  /**
   * Exclusive end — half-open `[start, end)`.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/BlockRange.swift#BlockRange.end
   */
  readonly end: number;
  /**
   * The file size the range was validated against.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/BlockRange.swift#BlockRange.fileSize
   */
  readonly fileSize: number;
}

/**
 * A range from two offsets, or `undefined` if it does not describe one.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/BlockRange.swift#BlockRange.init
 */
export function blockRange(start: number, end: number, fileSize: number): BlockRange | undefined {
  if (!(start <= end && end <= fileSize)) return undefined;
  return { start, end, fileSize };
}

/**
 * A range from an offset and a length, clamped at EOF rather than rejected.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/BlockRange.swift#BlockRange.init
 */
export function blockRangeOfLength(
  start: number,
  length: number,
  fileSize: number
): BlockRange | undefined {
  if (start > fileSize) return undefined;
  return { start, end: start + Math.min(length, fileSize - start), fileSize };
}

/** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/BlockRange.swift#BlockRange.count */
export const rangeCount = (range: BlockRange): number => range.end - range.start;
/** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/BlockRange.swift#BlockRange.isEmpty */
export const rangeIsEmpty = (range: BlockRange): boolean => range.start === range.end;
