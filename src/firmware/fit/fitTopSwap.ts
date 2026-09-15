import type { ByteSource } from "@/firmware/byteSource";
import { FIT, FIT_ENTRY_SIZE } from "@/firmware/fit/fitEntry";
import type { FITProblem } from "@/firmware/fit/fitProblem";
import {
  effectiveSize,
  type FITRow,
  type FITTable,
  type FITTarget,
  readFitTable,
} from "@/firmware/fit/fitTable";
import { type ImageRange, ImageReader } from "@/firmware/imageReader";
import { microcodeRange } from "@/firmware/uefi/microcodeParser";
import type { UEFIImage } from "@/firmware/uefi/uefiImage";

/**
 * The Top Swap backup of the block the FIT lives in.
 *
 * A chipset with Top Swap set maps the block directly below the top block of
 * the BIOS region at the top of memory instead, so a board can start from a
 * second copy of its boot block while the first is being rewritten. Such an
 * image carries the top block twice — the same volumes, microcode and ACM, and a
 * FIT of its own at the same place in the block naming the same addresses — and
 * a change to the table has to land in both. A change to one leaves the machine
 * starting, after a swap, from a copy that no longer agrees with the other.
 *
 * The block's size is a chipset strap whose place in the descriptor moves from
 * one PCH generation to the next, so the copy is recognised by what it has to
 * hold instead: the FIT pointer with the same value, and the `_FIT_` table at the
 * same distance below.
 *
 * @upstream Modules/FITTool/Sources/FITTool/FITTopSwap.swift#FITTopSwapBackup
 */
export interface FITTopSwapBackup {
  /**
   * The top block, ending where the address space does.
   *
   * @upstream Modules/FITTool/Sources/FITTool/FITTopSwap.swift#FITTopSwapBackup.top
   */
  readonly top: ImageRange;
  /**
   * Its copy, directly below.
   *
   * @upstream Modules/FITTool/Sources/FITTool/FITTopSwap.swift#FITTopSwapBackup.backup
   */
  readonly backup: ImageRange;
}

/** @upstream Modules/FITTool/Sources/FITTool/FITTopSwap.swift#FITTopSwapBackup.size */
export const topSwapSize = (copy: FITTopSwapBackup): number => copy.top.end - copy.top.start;

/**
 * The sizes a Top Swap block comes in: a power of two from 64 KiB to 16 MiB.
 *
 * @upstream Modules/FITTool/Sources/FITTool/FITTopSwap.swift#FITTopSwapBackup.smallestBlock
 */
const SMALLEST_BLOCK = 0x1_0000;
/** @upstream Modules/FITTool/Sources/FITTool/FITTopSwap.swift#FITTopSwapBackup.largestBlock */
const LARGEST_BLOCK = 0x100_0000;

/**
 * The backup of the block holding `table`, or nothing when the image has none.
 *
 * @upstream Modules/FITTool/Sources/FITTool/FITTopSwap.swift#FITTopSwapBackup.find
 */
export function findTopSwapBackup(
  table: FITTable,
  reader: ImageReader
): FITTopSwapBackup | undefined {
  const topEnd = table.pointerOffset + (0x1_0000_0000 - FIT.pointerAddress);
  for (let size = SMALLEST_BLOCK; size <= LARGEST_BLOCK && size * 2 <= topEnd; size *= 2) {
    const top = { start: topEnd - size, end: topEnd };
    if (
      top.start <= table.range.start &&
      table.range.end <= top.end &&
      reader.uint32(table.pointerOffset - size) === table.pointerAddress &&
      reader.uint64Bits(table.range.start - size) === FIT.signature
    ) {
      return { top, backup: { start: top.start - size, end: top.start } };
    }
  }
  return undefined;
}

/**
 * Where an offset is once the blocks trade places: a byte of either block is the
 * same byte of the other, and everything else stays put.
 *
 * @upstream Modules/FITTool/Sources/FITTool/FITTopSwap.swift#FITTopSwapBackup.swap
 */
export function topSwapped(copy: FITTopSwapBackup, offset: number): number {
  const size = topSwapSize(copy);
  if (copy.top.start <= offset && offset < copy.top.end) return offset - size;
  if (copy.backup.start <= offset && offset < copy.backup.end) return offset + size;
  return offset;
}

function sameBytes(left: Uint8Array | undefined, right: Uint8Array | undefined): boolean {
  if (left === undefined || right === undefined || left.length !== right.length) return false;
  for (let index = 0; index < left.length; index++) if (left[index] !== right[index]) return false;
  return true;
}

/**
 * Whether the two copies are the same bytes — the one state in which a change
 * worked out for the top block is right for the backup as well.
 *
 * @upstream Modules/FITTool/Sources/FITTool/FITTopSwap.swift#FITTopSwapBackup.copiesMatch
 */
export function topSwapCopiesMatch(copy: FITTopSwapBackup, reader: ImageReader): boolean {
  const size = topSwapSize(copy);
  const chunk = 0x1_0000;
  for (let offset = 0; offset < size; offset += chunk) {
    const count = Math.min(chunk, size - offset);
    const upper = reader.bytesAt(copy.top.start + offset, count);
    const lower = reader.bytesAt(copy.backup.start + offset, count);
    if (!sameBytes(upper, lower)) return false;
  }
  return true;
}

/**
 * The image as the chipset maps it with Top Swap set: the two blocks traded. The
 * backup's FIT reads through it with the same reader, at the same addresses, as
 * the top one reads through the image itself.
 *
 * @upstream Modules/FITTool/Sources/FITTool/FITTopSwap.swift#FITSwappedSource
 * @upstream Modules/FITTool/Sources/FITTool/FITTopSwap.swift#FITSwappedSource.base
 * @upstream Modules/FITTool/Sources/FITTool/FITTopSwap.swift#FITSwappedSource.copy
 */
export class FITSwappedSource implements ByteSource {
  private readonly base: ImageReader;
  private readonly copy: FITTopSwapBackup;

  constructor(base: ImageReader, copy: FITTopSwapBackup) {
    this.base = base;
    this.copy = copy;
  }

  /** @upstream Modules/FITTool/Sources/FITTool/FITTopSwap.swift#FITSwappedSource.byteCount */
  get byteCount(): number {
    return this.base.count;
  }

  /** @upstream Modules/FITTool/Sources/FITTool/FITTopSwap.swift#FITSwappedSource.bytes */
  bytes(start: number, end: number): Uint8Array {
    const bytes = new Uint8Array(Math.max(0, end - start));
    const { top, backup } = this.copy;
    let offset = start;
    while (offset < end) {
      // The run up to the next block edge maps as one piece.
      const edge =
        top.start <= offset && offset < top.end
          ? top.end
          : backup.start <= offset && offset < backup.end
            ? backup.end
            : offset < backup.start
              ? backup.start
              : end;
      const stop = Math.min(edge, end);
      const from = topSwapped(this.copy, offset);
      bytes.set(this.base.source.bytes(from, from + (stop - offset)), offset - start);
      offset = stop;
    }
    return bytes;
  }

  word(offset: number, count: number): number {
    const bytes = this.bytes(offset, offset + count);
    let value = 0;
    for (let index = bytes.length - 1; index >= 0; index--)
      value = value * 256 + (bytes[index] ?? 0);
    return value;
  }
}

/**
 * How the backup's table stands against the top block's.
 *
 * @upstream Modules/FITTool/Sources/FITTool/FITTopSwap.swift#FITBackupReading.Status
 */
export type FITBackupStatus =
  /** The two blocks are the same bytes. */
  | { readonly kind: "identical" }
  /** The tables and what they point at inside the block agree; other bytes of the block do not. */
  | { readonly kind: "otherBytesDiffer" }
  /**
   * The tables disagree: these rows, by index, differ in their own bytes or in
   * what they point at inside the block — or the table bytes do, when the list
   * is empty.
   */
  | { readonly kind: "tableDiffers"; readonly rows: readonly number[] }
  /** No table where the backup's pointer leads. */
  | { readonly kind: "noTable" };

/**
 * The Top Swap backup's FIT, read at its own offsets and set against the top
 * block's table.
 *
 * @upstream Modules/FITTool/Sources/FITTool/FITTopSwap.swift#FITBackupReading
 */
export interface FITBackupReading {
  /** @upstream Modules/FITTool/Sources/FITTool/FITTopSwap.swift#FITBackupReading.block */
  readonly block: FITTopSwapBackup;
  /**
   * The backup's table, at its own offsets in the file.
   *
   * @upstream Modules/FITTool/Sources/FITTool/FITTopSwap.swift#FITBackupReading.table
   */
  readonly table: FITTable | undefined;
  /** @upstream Modules/FITTool/Sources/FITTool/FITTopSwap.swift#FITBackupReading.status */
  readonly status: FITBackupStatus;
  /**
   * Whether the table's own bytes are the top one's — what a repair of the
   * table's checksum is copied on.
   *
   * @upstream Modules/FITTool/Sources/FITTool/FITTopSwap.swift#FITBackupReading.tableBytesMatch
   */
  readonly tableBytesMatch: boolean;
}

/**
 * The backup of the block `table` is in, read, compared, and what the comparison
 * has to say; nothing when the image keeps none.
 *
 * @upstream Modules/FITTool/Sources/FITTool/FITTopSwap.swift#FITBackupReading.read
 */
export function readTopSwapBackup(
  table: FITTable,
  reader: ImageReader,
  image: UEFIImage | undefined
): { readonly reading: FITBackupReading; readonly findings: FITProblem[] } | undefined {
  const copy = findTopSwapBackup(table, reader);
  if (copy === undefined) return undefined;
  const swapped = readFitTable(new ImageReader(new FITSwappedSource(reader, copy)), image, false);
  const own = swapped.problems.map(
    (problem): FITProblem => ({
      ...problem,
      offset: problem.offset === undefined ? undefined : topSwapped(copy, problem.offset),
      inBackup: true,
    })
  );
  if (swapped.table === undefined) {
    return {
      reading: {
        block: copy,
        table: undefined,
        status: { kind: "noTable" },
        tableBytesMatch: false,
      },
      findings: [
        {
          detail: { kind: "topSwapBackupHasNoTable", backupAt: copy.backup.start },
          offset: copy.backup.start,
        },
        ...own,
      ],
    };
  }
  const backupTable = swappingTable(swapped.table, copy);

  const tableBytesMatch = sameBytes(reader.bytes(table.range), reader.bytes(backupTable.range));
  const differing: number[] = [];
  table.rows.forEach((row, index) => {
    const other = backupTable.rows[index];
    if (other === undefined) {
      differing.push(index);
      return;
    }
    let same = sameBytes(
      reader.bytesAt(row.entry.offset, FIT_ENTRY_SIZE),
      reader.bytesAt(other.entry.offset, FIT_ENTRY_SIZE)
    );
    // What a row points at inside the block has a copy of its own; what it points
    // at outside both blocks is the one set of bytes both tables share.
    const range = componentRange(row);
    if (same && range !== undefined && copy.top.start <= range.start && range.end <= copy.top.end) {
      const size = topSwapSize(copy);
      same = sameBytes(
        reader.bytes(range),
        reader.bytes({ start: range.start - size, end: range.end - size })
      );
    }
    if (!same) differing.push(index);
  });
  for (let index = table.rows.length; index < backupTable.rows.length; index++) {
    differing.push(index);
  }

  let status: FITBackupStatus;
  const findings: FITProblem[] = [];
  if (!tableBytesMatch || differing.length > 0) {
    status = { kind: "tableDiffers", rows: differing };
    findings.push({
      detail: { kind: "topSwapTableDiffers", at: backupTable.range.start },
      offset: backupTable.range.start,
    });
    for (const index of differing) {
      const other = backupTable.rows[index];
      if (other === undefined) continue;
      findings.push({
        detail: { kind: "topSwapEntryDiffers" },
        entryIndex: index,
        offset: other.entry.offset,
        inBackup: true,
      });
    }
    findings.push(...own);
  } else if (!topSwapCopiesMatch(copy, reader)) {
    status = { kind: "otherBytesDiffer" };
    findings.push({
      detail: { kind: "topSwapBlockDiffers", backup: copy.backup },
      offset: copy.backup.start,
    });
  } else {
    status = { kind: "identical" };
  }
  return { reading: { block: copy, table: backupTable, status, tableBytesMatch }, findings };
}

/** The bytes a row stands for beyond its own sixteen, where they are known. */
function componentRange(row: FITRow): ImageRange | undefined {
  const target = row.target;
  switch (target.kind) {
    case "microcode":
      return microcodeRange(target.header);
    case "emptyMicrocodeSlot":
      return { start: target.offset, end: target.offset + 4 };
    case "bytes": {
      const size = effectiveSize(row);
      return size === undefined ? undefined : { start: target.offset, end: target.offset + size };
    }
    default:
      return undefined;
  }
}

/**
 * The table as read through `FITSwappedSource`, moved to where its bytes really are.
 *
 * @upstream Modules/FITTool/Sources/FITTool/FITTopSwap.swift#FITTable.swapping
 */
export function swappingTable(table: FITTable, copy: FITTopSwapBackup): FITTable {
  const start = topSwapped(copy, table.range.start);
  return {
    ...table,
    range: { start, end: start + (table.range.end - table.range.start) },
    pointerOffset: topSwapped(copy, table.pointerOffset),
    rows: table.rows.map((row) => ({
      ...row,
      entry: { ...row.entry, offset: topSwapped(copy, row.entry.offset) },
      target: swappingTarget(row.target, copy),
    })),
  };
}

/** @upstream Modules/FITTool/Sources/FITTool/FITTopSwap.swift#FITTarget.swapping */
function swappingTarget(target: FITTarget, copy: FITTopSwapBackup): FITTarget {
  switch (target.kind) {
    case "microcode": {
      const header = target.header;
      const extended = header.extendedTable;
      return {
        ...target,
        header: {
          ...header,
          offset: topSwapped(copy, header.offset),
          extendedTable:
            extended === undefined
              ? undefined
              : { ...extended, offset: topSwapped(copy, extended.offset) },
        },
      };
    }
    case "emptyMicrocodeSlot":
    case "bytes":
      return { ...target, offset: topSwapped(copy, target.offset) };
    default:
      return target;
  }
}
