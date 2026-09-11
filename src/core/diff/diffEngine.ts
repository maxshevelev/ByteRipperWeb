import { DiffBlockBuilder, type DiffBlockIndex, type DiffKind } from "@/core/diff/diffBlock";
import type { UndoOperation } from "@/core/edit/undoHistory";
import type { ByteStorage } from "@/core/storage/byteStorage";

/**
 * Comparing two byte streams, strictly by absolute offset.
 *
 * Ported from `DiffEngine.swift`. Everything that walks a whole file is chunked
 * and takes a cancellation check and a progress report, so a full scan runs in
 * a worker without blocking a frame.
 *
 * The comparison loop is the one piece where the port had to find its own way.
 * Upstream reads eight bytes at a time through an unaligned `UInt64` load and
 * short-circuits a whole chunk with `memcmp`. JavaScript has neither: an
 * unaligned load is a `DataView` call, and there is no `memcmp` at all. What it
 * does have is `Uint32Array`, which reads four bytes as one number when the
 * offset is four-aligned — so the scan aligns itself first (at most three
 * bytes) and then moves a word at a time. The zero-byte trick that finds a
 * matching byte inside a differing run is the same, at 32 bits.
 *
 * The measurement upstream recorded is why this matters at all: a byte-at-a-time
 * loop ran at about 16 MB/s, so a 16 MB pair took two seconds while *reading*
 * the same bytes took two milliseconds — and every inserted byte then cost a
 * two-second rescan of the file's tail.
 */

/** A single edit to one side of a comparison, for updating an index. */
export type DiffEdit =
  /** `[start, end)` now holds new bytes. Offsets do not move. */
  | { readonly kind: "overwrite"; readonly start: number; readonly end: number }
  /** `length` bytes were inserted at `at`. Everything after it moved. */
  | { readonly kind: "insert"; readonly at: number; readonly length: number }
  /** `[start, end)` was removed. Everything after it moved. */
  | { readonly kind: "delete"; readonly start: number; readonly end: number };

/** The offset from which the comparison is no longer trustworthy. */
export function earliestAffectedOffset(edit: DiffEdit): number {
  return edit.kind === "insert" ? edit.at : edit.start;
}

/** Whether the edit moves the offsets after it. */
export function shiftsOffsets(edit: DiffEdit): boolean {
  return edit.kind !== "overwrite";
}

/**
 * Reduces a batch of edits to the fewest that describe the same damage.
 *
 * {@link applyEdit} rescans against current bytes, so what matters is only
 * which offsets an edit invalidates, never what it did there. A shifting edit
 * invalidates from its offset to the end, so a batch containing one needs no
 * other edit at or after that offset — ten inserted bytes rescanned the file's
 * tail ten times where one pass would do. Overwrites before the shift point
 * survive, because nothing else rescans their offsets, and are merged where
 * they touch, which is what a run of typing produces.
 */
export function collapseEdits(edits: readonly DiffEdit[]): DiffEdit[] {
  if (edits.length <= 1) return [...edits];

  let shift: DiffEdit | undefined;
  for (const edit of edits) {
    if (!shiftsOffsets(edit)) continue;
    if (shift === undefined || earliestAffectedOffset(edit) < earliestAffectedOffset(shift)) {
      shift = edit;
    }
  }
  const cut = shift === undefined ? Number.POSITIVE_INFINITY : earliestAffectedOffset(shift);

  const overwrites: { start: number; end: number }[] = [];
  for (const edit of edits) {
    if (edit.kind !== "overwrite" || edit.start >= edit.end) continue;
    if (edit.start >= cut) continue; // rescanned by the shift anyway
    overwrites.push({ start: edit.start, end: Math.min(edit.end, cut) });
  }
  overwrites.sort((a, b) => a.start - b.start);

  const merged: { start: number; end: number }[] = [];
  for (const range of overwrites) {
    const last = merged[merged.length - 1];
    if (last !== undefined && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }

  const result: DiffEdit[] = merged.map((range) => ({
    kind: "overwrite",
    start: range.start,
    end: range.end,
  }));
  if (shift !== undefined) result.push(shift);
  return result;
}

/**
 * The single net edit an undo or redo transaction produces, given the
 * operations in the order they mutate storage.
 *
 * {@link applyEdit} is self-correcting — it rescans against current bytes — so
 * the edit only has to cover every offset the transaction could have changed. A
 * length-changing transaction says insert or delete from the earliest
 * *pre-shift* offset, which rescans from there to EOF; a length-preserving one
 * says overwrite over its bounding window.
 *
 * The bounds must be pre-shift: an overwrite rewrites bytes in place, so a
 * later insert landing after the overwritten range does not move them, and
 * shifting the window would put it past the bytes that actually changed.
 */
export function netDiffEdit(ops: readonly UndoOperation[]): DiffEdit | undefined {
  if (ops.length === 0) return undefined;

  let from = Number.POSITIVE_INFINITY;
  let maxEnd = 0;
  let netDelta = 0;

  for (const op of ops) {
    switch (op.kind) {
      case "overwrite":
        from = Math.min(from, op.at);
        maxEnd = Math.max(maxEnd, op.at + op.after.length);
        break;
      case "insert":
        from = Math.min(from, op.at);
        maxEnd = Math.max(maxEnd, op.at + op.bytes.length);
        netDelta += op.bytes.length;
        break;
      case "delete":
        from = Math.min(from, op.at);
        maxEnd = Math.max(maxEnd, op.at + op.bytes.length);
        netDelta -= op.bytes.length;
        break;
    }
  }

  if (netDelta > 0) return { kind: "insert", at: from, length: netDelta };
  if (netDelta < 0) return { kind: "delete", start: from, end: from - netDelta };
  return { kind: "overwrite", start: from, end: maxEnd };
}

/** A scan that was cancelled between chunks. */
export class DiffCancelled extends Error {
  constructor() {
    super("The comparison was cancelled.");
    this.name = "DiffCancelled";
  }
}

export interface ScanOptions {
  readonly chunkSize?: number;
  readonly shouldCancel?: () => boolean;
  readonly onProgress?: (fraction: number) => void;
}

export const DEFAULT_DIFF_CHUNK_SIZE = 1024 * 1024;

/**
 * The block list for two byte arrays, compared one byte at a time.
 *
 * This is the **reference implementation**, and it is written the obvious way
 * on purpose: {@link scanDiff}'s word stepping is checked against it, so the
 * two must not share the code being checked. Also the convenient form for
 * small inputs.
 */
export function diffBytes(left: Uint8Array, right: Uint8Array): DiffBlockIndex {
  const builder = new DiffBlockBuilder();
  const common = Math.min(left.length, right.length);

  let runStart = 0;
  let runKind: DiffKind | undefined;
  for (let i = 0; i < common; i++) {
    const kind: DiffKind = left[i] === right[i] ? "same" : "different";
    if (runKind === undefined) {
      runKind = kind;
      runStart = i;
    } else if (runKind !== kind) {
      builder.appendRun(runKind, runStart, i);
      runKind = kind;
      runStart = i;
    }
  }
  if (runKind !== undefined) builder.appendRun(runKind, runStart, common);

  // The bytes only the longer file has fold into a different block.
  if (left.length !== right.length) {
    builder.appendRun("different", common, Math.max(left.length, right.length));
  }
  return builder.finish(left.length, right.length);
}

/**
 * Builds a full index by chunked scan, comparing both streams at the same
 * absolute offsets.
 *
 * @throws {DiffCancelled} when `shouldCancel` says so between chunks.
 */
export async function scanDiff(
  left: ByteStorage,
  right: ByteStorage,
  options: ScanOptions = {}
): Promise<DiffBlockIndex> {
  const builder = new DiffBlockBuilder();
  await scanRange(builder, left, right, 0, Math.max(left.size, right.size), options);
  return builder.finish(left.size, right.size);
}

/**
 * Applies an edit to an index, rebuilding only what it invalidates.
 *
 * An overwrite recomputes just its own window and splices it back between the
 * bytes on either side. An insert or a delete drops everything from the
 * earliest affected offset and rescans to the new EOF, because every offset
 * after it now means something different.
 */
export async function applyEdit(
  edit: DiffEdit,
  index: DiffBlockIndex,
  left: ByteStorage,
  right: ByteStorage,
  options: ScanOptions = {}
): Promise<DiffBlockIndex> {
  const newMax = Math.max(left.size, right.size);
  const builder = new DiffBlockBuilder();

  if (edit.kind === "overwrite") {
    const start = edit.start;
    const end = Math.min(edit.end, newMax);

    // Bytes strictly before the edit keep their old state.
    appendPrefix(builder, index, start);

    // An edit landing past the previous extent leaves the bytes between the old
    // extent and it present in one file only.
    if (start > index.maxSize) builder.appendRun("different", index.maxSize, start);

    await scanRange(builder, left, right, start, end, options);

    // And the bytes at or after the edit keep theirs.
    for (let i = 0; i < index.blockCount; i++) {
      const block = index.block(i);
      if (block === undefined) continue;
      if (block.start >= end) builder.append(block);
      else if (block.end > end) builder.appendRun(block.kind, end, block.end);
    }
    return builder.finish(left.size, right.size);
  }

  const from = earliestAffectedOffset(edit);
  appendPrefix(builder, index, from);
  await scanRange(builder, left, right, from, newMax, options);
  return builder.finish(left.size, right.size);
}

/**
 * Copies the blocks that end at or before `from`, trimming the one containing
 * it. Everything at or after `from` is left to a fresh scan.
 */
function appendPrefix(builder: DiffBlockBuilder, index: DiffBlockIndex, from: number): void {
  for (let i = 0; i < index.blockCount; i++) {
    const block = index.block(i);
    if (block === undefined) continue;
    if (block.end <= from) builder.append(block);
    else if (block.start < from) builder.appendRun(block.kind, block.start, from);
    else break;
  }
}

/**
 * Scans `[from, to)`, folding the tail only the longer file has into a
 * different block.
 */
async function scanRange(
  builder: DiffBlockBuilder,
  left: ByteStorage,
  right: ByteStorage,
  from: number,
  to: number,
  options: ScanOptions
): Promise<void> {
  const chunkSize = options.chunkSize ?? DEFAULT_DIFF_CHUNK_SIZE;
  const shouldCancel = options.shouldCancel;
  const onProgress = options.onProgress;

  const common = Math.min(left.size, right.size);
  const comparedEnd = Math.min(to, common);
  const total = to > from ? to - from : 0;

  let offset = from;
  let processed = 0;
  while (offset < comparedEnd) {
    if (shouldCancel?.() === true) throw new DiffCancelled();

    const length = Math.min(chunkSize, comparedEnd - offset);
    // Both sides at once: the reads are independent and a worker waiting on
    // them one after the other waits twice.
    const [a, b] = await Promise.all([left.read(offset, length), right.read(offset, length)]);
    const count = Math.min(a.length, b.length);
    if (count === 0) break;

    appendRuns(builder, a, b, count, offset);
    offset += count;
    processed += count;
    if (total > 0) onProgress?.(processed / total);
  }

  const tailStart = Math.max(from, common);
  if (to > tailStart) builder.appendRun("different", tailStart, to);
  if (total > 0) onProgress?.(1);
}

/**
 * Appends the same and different runs of `count` byte pairs, starting at the
 * absolute offset `offset`.
 *
 * Two reads of the same chip match over their whole length, so the chunk is
 * tested whole first: the common case becomes one pass and one run.
 */
function appendRuns(
  builder: DiffBlockBuilder,
  a: Uint8Array,
  b: Uint8Array,
  count: number,
  offset: number
): void {
  const words = wordViews(a, b, count);

  if (equalThroughout(a, b, count, words)) {
    builder.appendRun("same", offset, offset + count);
    return;
  }

  let i = 0;
  while (i < count) {
    const same = a[i] === b[i];
    const end = same ? firstDifference(a, b, i, count, words) : firstMatch(a, b, i, count, words);
    builder.appendRun(same ? "same" : "different", offset + i, offset + end);
    i = end;
  }
}

/**
 * Four-byte views of both buffers, when both are aligned for one.
 *
 * A `Uint8Array` from a read is its buffer's whole extent, so this normally
 * succeeds; a `subarray` at an odd offset is the case it does not, and the
 * scan falls back to bytes rather than to a `DataView`, which is slower than
 * either.
 */
function wordViews(
  a: Uint8Array,
  b: Uint8Array,
  count: number
): { a: Uint32Array; b: Uint32Array } | undefined {
  if (a.byteOffset % 4 !== 0 || b.byteOffset % 4 !== 0) return undefined;
  const words = count >> 2;
  if (words === 0) return undefined;
  return {
    a: new Uint32Array(a.buffer, a.byteOffset, words),
    b: new Uint32Array(b.buffer, b.byteOffset, words),
  };
}

type Words = { a: Uint32Array; b: Uint32Array } | undefined;

/** Whether the whole chunk matches — JavaScript's stand-in for one `memcmp`. */
function equalThroughout(a: Uint8Array, b: Uint8Array, count: number, words: Words): boolean {
  let i = 0;
  if (words !== undefined) {
    const wordCount = words.a.length;
    for (let w = 0; w < wordCount; w++) {
      if (words.a[w] !== words.b[w]) return false;
    }
    i = wordCount << 2;
  }
  for (; i < count; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** The index of the first differing byte at or after `from`, or `count`. */
function firstDifference(
  a: Uint8Array,
  b: Uint8Array,
  from: number,
  count: number,
  words: Words
): number {
  let i = from;
  // Align, so the word scan can index a Uint32Array rather than read unaligned.
  while (i < count && (i & 3) !== 0) {
    if (a[i] !== b[i]) return i;
    i++;
  }
  // `i < count` is not redundant: the loop above also exits by running out of
  // bytes, and then `i` is *not* aligned — `w << 2` would round it down and
  // hand back an offset before the one asked for, which is a scan that never
  // advances and never ends.
  if (words !== undefined && i < count) {
    const limit = words.a.length;
    let w = i >> 2;
    while (w < limit && words.a[w] === words.b[w]) w++;
    i = w << 2;
  }
  while (i < count && a[i] === b[i]) i++;
  return i;
}

/** The index of the first matching byte at or after `from`, or `count`. */
function firstMatch(
  a: Uint8Array,
  b: Uint8Array,
  from: number,
  count: number,
  words: Words
): number {
  let i = from;
  while (i < count && (i & 3) !== 0) {
    if (a[i] === b[i]) return i;
    i++;
  }
  // Aligned only when there are bytes left — see firstDifference.
  if (words !== undefined && i < count) {
    const limit = words.a.length;
    let w = i >> 2;
    // A zero byte in the XOR is a byte that matches, so a word without one is
    // four differing bytes and can be skipped whole.
    while (w < limit && !containsZeroByte(((words.a[w] ?? 0) ^ (words.b[w] ?? 0)) >>> 0)) w++;
    i = w << 2;
  }
  while (i < count && a[i] !== b[i]) i++;
  return i;
}

/**
 * Whether any of a word's four bytes is zero — the standard bit trick:
 * subtracting one from a zero byte borrows into its high bit, which `~v` keeps
 * only where the byte was zero to begin with.
 */
function containsZeroByte(v: number): boolean {
  return ((v - 0x01010101) & ~v & 0x80808080) !== 0;
}
