/**
 * The overview's picture of one file: how much of each cell is real content,
 * and which cells hold an unsaved edit or a difference.
 *
 * This cannot be pulled per repaint the way the detail map pulls its window —
 * every row is on screen at once, so an 8 MB dump would be read on every draw.
 * It is built once in the background and handed over.
 *
 * Ported from `MainViewController.overviewRows`. It takes a row range rather
 * than always walking the file, which is what makes an edit cost the one or two
 * rows it lands in; the cold build is the same function over every row.
 *
 * Reads are awaited, which upstream's synchronous storage does not have to do
 * (`Blob.slice()` is a promise here). That is also what keeps a cold build off
 * the frame: the pass yields at every row it reads.
 */

import type { DiffBlock } from "@/core/diff/diffBlock";
import type { ByteStorage } from "@/core/storage/byteStorage";
import { MINIMAP_COLUMNS, OverviewBinning, type RowRange } from "@/render/minimap/overviewBinning";

/** A half-open byte range. */
export interface ByteRange {
  readonly start: number;
  readonly end: number;
}

/**
 * What the picture is built from.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.overviewSource
 */
export interface OverviewSource {
  /** This file's own length, which is not the extent when two are open. */
  readonly size: number;
  readonly storage: ByteStorage | undefined;
  /** The file as last saved, for the modified mask. Absent for a new file. */
  readonly saved?: ByteStorage | undefined;
  /** A document that has never been on disk: nothing in it counts as modified. */
  readonly isUntitled?: boolean;
  /** Where the edit buffer supplied bytes — the rows an edit can have reached. */
  readonly edited?: readonly ByteRange[];
  /** The comparison's blocks overlapping a byte window. */
  readonly differences?: ((start: number, end: number) => readonly DiffBlock[]) | undefined;
}

export interface OverviewRows {
  /** `rows × 16` values, row-major: the share of the cell that is content. */
  readonly density: Uint8Array;
  /** Per row, a bit per column holding at least one modified byte. */
  readonly modified: Uint16Array;
  /** Per row, a bit per column holding at least one differing byte. */
  readonly different: Uint16Array;
}

export interface OverviewOptions {
  readonly shouldCancel?: () => boolean;
  /** Called with how many rows have just been finished. */
  readonly onRows?: (done: number) => void;
  /**
   * Whether to compute the density picture, which is the half that reads the
   * whole file. False recomputes only the masks — what an edit or a new
   * comparison changes — over a density the caller already has.
   */
  readonly density?: boolean;
}

/** Thrown when a build is abandoned because its inputs moved. */
export class OverviewCancelled extends Error {
  constructor() {
    super("The minimap build was cancelled.");
    this.name = "OverviewCancelled";
  }
}

/** How many rows a pass finishes between progress reports. */
const ROWS_PER_REPORT = 64;

/**
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.overviewRows
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.fillByteFlags
 */
export async function buildOverviewRows(
  source: OverviewSource,
  extent: number,
  rowCount: number,
  rows: RowRange,
  options: OverviewOptions = {}
): Promise<OverviewRows | undefined> {
  if (rowCount <= 0 || extent <= 0 || rows.from < 0 || rows.to > rowCount || rows.from >= rows.to) {
    return undefined;
  }

  const count = rows.to - rows.from;
  const density = new Uint8Array(count * MINIMAP_COLUMNS);
  const modified = new Uint16Array(count);
  const different = new Uint16Array(count);
  const storage = source.storage;
  if (storage === undefined) return { density, modified, different };

  // One mapping, shared with the search's match overlay: the two must land on
  // the same cells or the map contradicts itself.
  const binning = new OverviewBinning(extent, rowCount);
  const cancelled = options.shouldCancel ?? (() => false);
  const stop = () => {
    if (cancelled()) throw new OverviewCancelled();
  };

  /** The bytes of a row's slice, or undefined where the row holds none. */
  const readRow = async (
    row: number
  ): Promise<{ bytes: Uint8Array; start: number } | undefined> => {
    const rowStart = binning.startOfRow(row);
    const rowEnd = binning.startOfRow(row + 1);
    // A row whose slice is thinner than a byte still stands for the byte its
    // position falls in — read that one, rather than leaving the row blank.
    const readEnd = Math.min(Math.max(rowEnd, rowStart + 1), source.size);
    if (rowStart >= readEnd) return undefined;
    const bytes = await storage.read(rowStart, readEnd - rowStart);
    return bytes.length === 0 ? undefined : { bytes, start: rowStart };
  };

  // Density: one read per row, counting the bytes that are not a fill.
  let reported = rows.from;
  for (let row = rows.from; options.density !== false && row < rows.to; row++) {
    stop();
    if (row - reported >= ROWS_PER_REPORT) {
      options.onRows?.(row - reported);
      reported = row;
    }
    const read = await readRow(row);
    if (read === undefined) continue;

    const rowStart = binning.startOfRow(row);
    const span = binning.startOfRow(row + 1) - rowStart;
    const base = (row - rows.from) * MINIMAP_COLUMNS;
    const bytes = read.bytes;

    if (span < MINIMAP_COLUMNS) {
      // Fewer bytes than cells: each byte fills the cells it covers, so the row
      // reads as a coarse picture of those bytes instead of one inked cell at
      // its right edge.
      const limit = Math.min(bytes.length, Math.max(span, 1));
      for (let index = 0; index < limit; index++) {
        if (significantByteCount(bytes, index, index + 1) === 0) continue;
        const [first, last] = binning.stretchedColumns(index, span);
        for (let column = first; column <= last; column++) density[base + column] = 255;
      }
      continue;
    }

    for (let column = 0; column < MINIMAP_COLUMNS; column++) {
      const from = Math.floor((span * column) / MINIMAP_COLUMNS);
      const to = Math.min(Math.floor((span * (column + 1)) / MINIMAP_COLUMNS), bytes.length);
      if (from >= to) continue;
      const significant = significantByteCount(bytes, from, to);
      if (significant === 0) continue;
      density[base + column] = Math.min(
        255,
        Math.max(1, Math.floor((significant * 255) / (to - from)))
      );
    }
  }
  options.onRows?.(rows.to - reported);

  // Modified: where the byte differs from the saved copy — the same rule the
  // panes paint by — inside the rows an edit can have reached.
  //
  // Cell by cell rather than byte by byte: an insert or a delete shifts every
  // byte after it, so the edited ranges cover the file's whole tail. Bytes
  // outside them cannot differ from the saved copy, so comparing a cell whole
  // is safe — the untouched part of it compares equal and contributes nothing.
  const edited = source.edited ?? [];
  if (source.isUntitled !== true && edited.length > 0) {
    const savedSize = source.saved?.size ?? 0;
    for (let row = rows.from; row < rows.to; row++) {
      stop();
      const rowStart = binning.startOfRow(row);
      const rowEnd = binning.startOfRow(row + 1);
      const span = rowEnd - rowStart;
      const readEnd = Math.min(Math.max(rowEnd, rowStart + 1), source.size);
      if (rowStart >= readEnd) continue;
      // Rows no edit can have reached are skipped, so a clean file costs
      // nothing here and a small edit costs one row.
      if (!edited.some((range) => range.start < readEnd && range.end > rowStart)) continue;

      const read = await readRow(row);
      if (read === undefined) continue;
      const bytes = read.bytes;
      const saved =
        source.saved === undefined
          ? new Uint8Array(0)
          : await source.saved
              .read(rowStart, Math.min(readEnd, savedSize) - rowStart)
              .catch(() => new Uint8Array(0));
      const index = row - rows.from;

      if (span < MINIMAP_COLUMNS) {
        // Fewer bytes than cells: compare the handful of bytes and stretch each
        // one over the cells it covers.
        for (let offsetInRow = 0; offsetInRow < bytes.length; offsetInRow++) {
          const absolute = rowStart + offsetInRow;
          const changed =
            absolute >= savedSize ||
            offsetInRow >= saved.length ||
            saved[offsetInRow] !== bytes[offsetInRow];
          if (!changed) continue;
          const [first, last] = binning.stretchedColumns(offsetInRow, span);
          let word = modified[index] ?? 0;
          for (let column = first; column <= last; column++) word |= 1 << column;
          modified[index] = word;
        }
        continue;
      }

      for (let column = 0; column < MINIMAP_COLUMNS; column++) {
        const from = Math.floor((span * column) / MINIMAP_COLUMNS);
        const to = Math.min(Math.floor((span * (column + 1)) / MINIMAP_COLUMNS), bytes.length);
        if (from >= to) continue;
        // Bytes past the saved file's end are new by definition.
        if (rowStart + to > savedSize || saved.length < to) {
          modified[index] = (modified[index] ?? 0) | (1 << column);
          continue;
        }
        for (let at = from; at < to; at++) {
          if (saved[at] !== bytes[at]) {
            modified[index] = (modified[index] ?? 0) | (1 << column);
            break;
          }
        }
      }
    }
  }

  // Differences: the index's differing blocks that touch these rows, asked for
  // by window rather than flattened. A block spanning whole rows marks every
  // column of them.
  const windowStart = binning.startOfRow(rows.from);
  const windowEnd = binning.startOfRow(rows.to);
  for (const block of source.differences?.(windowStart, windowEnd) ?? []) {
    stop();
    if (block.kind !== "different") continue;
    binning.mark(block.start, block.end, rows, different);
  }

  // A cell past this file's own end holds none of its bytes, so it can neither
  // differ nor be modified — whatever the comparison index says. The index is
  // built over the *union* of the two files, so every byte past the shorter
  // file's end counts as a difference there; drawn as such it painted the
  // shorter map's empty tail solid. The tail is empty, exactly as it is in
  // detail mode.
  for (let row = rows.from; row < rows.to; row++) {
    const slot = row - rows.from;
    if (modified[slot] === 0 && different[slot] === 0) continue;
    const rowStart = binning.startOfRow(row);
    const span = binning.startOfRow(row + 1) - rowStart;
    let covered = 0;
    for (let column = 0; column < MINIMAP_COLUMNS; column++) {
      if (rowStart + Math.floor((span * column) / MINIMAP_COLUMNS) < source.size) {
        covered |= 1 << column;
      }
    }
    modified[slot] = (modified[slot] ?? 0) & covered;
    different[slot] = (different[slot] ?? 0) & covered;
  }

  return { density, modified, different };
}

/**
 * How many of `bytes[from..<to)` are not a 0x00/0xFF fill.
 *
 * Upstream loads eight bytes at a time and counts the fill bytes with a bit
 * trick. The same trick in JS would need a DataView read per word and lose to
 * the plain loop, which the engine's own bounds-check elision already makes
 * fast — so this is the naive version on purpose.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.significantByteCount
 */
export function significantByteCount(bytes: Uint8Array, from: number, to: number): number {
  let count = 0;
  for (let index = from; index < to; index++) {
    const byte = bytes[index];
    if (byte !== 0x00 && byte !== 0xff) count++;
  }
  return count;
}
