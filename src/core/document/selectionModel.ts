import { type BlockRange, blockRange } from "@/core/document/blockRange";

/**
 * The current selection in a file, as an absolute half-open range `[start, end)`
 * always clamped to the file size.
 *
 * Ported from `SelectionModel.swift`. An empty selection (`start === end`) is a
 * caret position. Construction normalises direction (start ≤ end) and clamps
 * both edges, so a selection can never point outside the file — including after
 * the file shrank under it.
 */
export interface Selection {
  readonly start: number;
  readonly end: number;
  readonly fileSize: number;
}

/** A selection between two offsets, in whichever order they were given. */
export function selection(start: number, end: number, fileSize: number): Selection {
  const lower = Math.min(start, end);
  const upper = Math.max(start, end);
  return {
    start: Math.min(Math.max(lower, 0), fileSize),
    end: Math.min(Math.max(upper, 0), fileSize),
    fileSize,
  };
}

/** A selection of `length` bytes from `start`, clamped at EOF. */
export function selectionOfLength(start: number, length: number, fileSize: number): Selection {
  const from = Math.min(Math.max(start, 0), fileSize);
  return { start: from, end: from + Math.min(Math.max(length, 0), fileSize - from), fileSize };
}

/** A caret: an empty selection at `offset`. */
export function caretAt(offset: number, fileSize: number): Selection {
  return selection(offset, offset, fileSize);
}

export const selectionIsEmpty = (value: Selection): boolean => value.start === value.end;
export const selectionCount = (value: Selection): number => value.end - value.start;

/** The selection as a validated range, for the callers that need one. */
export const selectionRange = (value: Selection): BlockRange | undefined =>
  blockRange(value.start, value.end, value.fileSize);

/**
 * Re-clamps a selection to a new file size — after a size-changing edit, so it
 * never points past EOF.
 */
export const clampedSelection = (value: Selection, newSize: number): Selection =>
  selection(value.start, value.end, newSize);
