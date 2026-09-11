/**
 * A validated half-open byte range `[start, end)` (D13), used by selection and
 * by the navigation dialogs.
 *
 * Ported from `BlockRange.swift`. Construction is failable: a range whose start
 * is past the file size, whose end precedes its start, or whose end exceeds the
 * file size is rejected. A length-based range is clamped to the file size
 * rather than rejected when it simply overshoots EOF, which is how a hex editor
 * treats "jump to offset X".
 */
export interface BlockRange {
  readonly start: number;
  /** Exclusive end — half-open `[start, end)`. */
  readonly end: number;
  /** The file size the range was validated against. */
  readonly fileSize: number;
}

/** A range from two offsets, or `undefined` if it does not describe one. */
export function blockRange(start: number, end: number, fileSize: number): BlockRange | undefined {
  if (!(start <= end && end <= fileSize)) return undefined;
  return { start, end, fileSize };
}

/** A range from an offset and a length, clamped at EOF rather than rejected. */
export function blockRangeOfLength(
  start: number,
  length: number,
  fileSize: number
): BlockRange | undefined {
  if (start > fileSize) return undefined;
  return { start, end: start + Math.min(length, fileSize - start), fileSize };
}

export const rangeCount = (range: BlockRange): number => range.end - range.start;
export const rangeIsEmpty = (range: BlockRange): boolean => range.start === range.end;
