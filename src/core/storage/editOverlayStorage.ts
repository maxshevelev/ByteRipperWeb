import { assertRepresentableSize } from "@/core/limits";
import type {
  ByteSource,
  ByteStorage,
  Bytes,
  EditableByteStorage,
} from "@/core/storage/byteStorage";
import { ChunkCache } from "@/core/storage/chunkCache";
import { FileBackedStorage } from "@/core/storage/fileBackedStorage";
import { type OffsetRange, PieceTable } from "@/core/storage/pieceTable";
import type { ScratchStore } from "@/core/storage/scratchStore";

/**
 * An editable byte stream layered over a read-only base.
 *
 * Ported from `EditOverlayStorage.swift`. The content is a {@link PieceTable}
 * over two immutable sources: the base the document was opened from, and an
 * append-only buffer holding the bytes editing has added. Every edit —
 * overwrite, insert, delete — is a change to the piece list, so it costs the
 * same wherever in the file it lands and whether the file is a kilobyte or
 * thirty-two megabytes.
 *
 * Two divergences from the Swift, both forced:
 *
 * **Reads are asynchronous.** Which means state can change between a read
 * starting and finishing. Upstream holds a lock; there is nothing to lock here,
 * so instead a read resolves its segments *synchronously* against the table as
 * it stands and then captures the base and the add buffer it is going to read
 * from. An edit arriving mid-read changes the next read, never this one. The
 * add buffer is append-only, so bytes a read has already been promised cannot
 * move under it.
 *
 * **Materialisation needs somewhere to write.** Upstream's valve — fold the
 * piece list into a fresh temporary file when an insert is oversized, the add
 * buffer outgrows its budget, or the piece count would start slowing reads —
 * writes a file. A browser cannot, from here: the origin-private file system
 * lives in `src/platform`. So the valve is expressed through
 * {@link ScratchStore} and is simply absent when none is supplied, which costs
 * read speed and nothing else. See M4.
 */

/**
 * When the piece table gives way to a fresh base. All three are amortised.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/EditOverlayStorage.swift#EditOverlayStorage.Budgets
 */
export interface OverlayBudgets {
  /**
   * An insert larger than this is materialised rather than held in the add
   * buffer, so a large Paste Insert does not sit in memory.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/EditOverlayStorage.swift#EditOverlayStorage.Budgets.maxInlineInsert
   */
  readonly maxInlineInsert: number;
  /**
   * Total size of the add buffer before it is folded into a new base.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/EditOverlayStorage.swift#EditOverlayStorage.Budgets.maxAddedBytes
   */
  readonly maxAddedBytes: number;
  /**
   * Piece count before the list is collapsed: reads binary-search it, and a
   * pathological edit pattern should not make them crawl.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/EditOverlayStorage.swift#EditOverlayStorage.Budgets.maxPieces
   */
  readonly maxPieces: number;
}

/** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/EditOverlayStorage.swift#EditOverlayStorage.Budgets.init */
export const DEFAULT_OVERLAY_BUDGETS: OverlayBudgets = {
  maxInlineInsert: 8 << 20,
  maxAddedBytes: 64 << 20,
  maxPieces: 100_000,
};

export interface EditOverlayOptions {
  readonly cache?: ChunkCache;
  readonly scratch?: ScratchStore;
  readonly budgets?: Partial<OverlayBudgets>;
}

/** How many bytes are written into a materialised base at a time. */
const MATERIALISE_CHUNK = 1024 * 1024;

/** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/EditOverlayStorage.swift#EditOverlayStorage */
export class EditOverlayStorage implements EditableByteStorage {
  private base: ByteStorage;
  private table: PieceTable;

  /**
   * Append-only: the bytes typed or pasted, referenced by the table's added
   * pieces. Never rewritten, so a piece's offsets stay valid for its life — and
   * so an in-flight read cannot have its bytes moved out from under it.
   */
  private added: Bytes = new Uint8Array(0);
  private addedLength = 0;

  private lengthChanged = false;
  /**
   * The lowest offset any insert or delete has moved bytes from, if one has.
   * Everything at or after it sits at a different offset than it did in the
   * file as opened, so it counts as changed even though editing never wrote
   * there — which is what makes a pane paint the whole tail of a file red after
   * one inserted byte.
   */
  private shiftedFrom: number | undefined;
  /**
   * Ranges overwritten before a materialisation folded them into the base.
   * Without this, collapsing the table would erase the record an in-place save
   * needs. Meaningful only while nothing has shifted, which is the only state
   * the save path reads it in.
   */
  private retainedChangedRanges: OffsetRange[] = [];

  private readonly cache: ChunkCache;
  private readonly scratch: ScratchStore | undefined;
  private readonly budgets: OverlayBudgets;

  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/EditOverlayStorage.swift#EditOverlayStorage.init */
  constructor(base: ByteStorage, options: EditOverlayOptions = {}) {
    this.base = base;
    this.table = new PieceTable(base.size);
    this.cache = options.cache ?? new ChunkCache();
    this.scratch = options.scratch;
    this.budgets = { ...DEFAULT_OVERLAY_BUDGETS, ...options.budgets };
  }

  // MARK: - ByteStorage

  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/EditOverlayStorage.swift#EditOverlayStorage.size */
  get size(): number {
    return this.table.size;
  }

  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/EditOverlayStorage.swift#EditOverlayStorage.read */
  async read(at: number, length: number): Promise<Bytes> {
    const plan = this.plan(at, length);
    if (plan === undefined) return new Uint8Array(0);

    const result = new Uint8Array(plan.count);
    let written = 0;
    for (const segment of plan.segments) {
      const wanted = segment.end - segment.start;
      if (segment.source === "added") {
        result.set(plan.added.subarray(segment.start, segment.end), written);
      } else {
        const bytes = await plan.base.read(segment.start, wanted);
        result.set(bytes, written);
        // The base is immutable, so a short read means the file was truncated
        // under us. The gap stays zero, so the bytes after it keep their
        // offsets instead of sliding left.
      }
      written += wanted;
    }
    return result;
  }

  peek(at: number, length: number): Bytes | undefined {
    const plan = this.plan(at, length);
    if (plan === undefined) return new Uint8Array(0);

    const result = new Uint8Array(plan.count);
    let written = 0;
    for (const segment of plan.segments) {
      const wanted = segment.end - segment.start;
      if (segment.source === "added") {
        result.set(plan.added.subarray(segment.start, segment.end), written);
      } else {
        const bytes = plan.base.peek(segment.start, wanted);
        if (bytes === undefined) return undefined;
        result.set(bytes, written);
      }
      written += wanted;
    }
    return result;
  }

  async prefetch(at: number, length: number): Promise<void> {
    const plan = this.plan(at, length);
    if (plan === undefined) return;
    await Promise.all(
      plan.segments
        .filter((segment) => segment.source === "base")
        .map((segment) => plan.base.prefetch(segment.start, segment.end - segment.start))
    );
  }

  /**
   * Everything a read needs, resolved before any awaiting: which source bytes
   * cover the window, and the base and add buffer they name. Capturing these
   * together is what makes an edit arriving mid-read change the *next* read
   * rather than this one.
   */
  private plan(at: number, length: number) {
    if (length <= 0 || at < 0 || at >= this.table.size) return undefined;
    const count = Math.min(length, this.table.size - at);
    return {
      count,
      segments: this.table.segments(at, at + count),
      base: this.base,
      added: this.added.subarray(0, this.addedLength),
    };
  }

  // MARK: - EditableByteStorage

  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/EditOverlayStorage.swift#EditOverlayStorage.overwrite */
  async overwrite(at: number, bytes: Uint8Array): Promise<void> {
    if (bytes.length === 0) return;
    // A write starting past EOF leaves a gap, and that gap has always read as
    // zeros. They go through the add buffer, so the gap is real content rather
    // than a hole in the table.
    if (at > this.table.size) {
      const gap = this.appendToAddBuffer(new Uint8Array(at - this.table.size));
      this.table.insert(this.table.size, gap.start, gap.end);
    }
    const end = assertRepresentableSize(at + bytes.length, "This edit");
    const added = this.appendToAddBuffer(bytes);
    this.table.replace(at, end, added.start, added.end);
    await this.materialiseIfNeeded(bytes.length);
  }

  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/EditOverlayStorage.swift#EditOverlayStorage.insert */
  async insert(at: number, bytes: Uint8Array): Promise<void> {
    if (bytes.length === 0) return;
    const offset = Math.min(Math.max(at, 0), this.table.size);
    assertRepresentableSize(this.table.size + bytes.length, "This edit");

    const added = this.appendToAddBuffer(bytes);
    this.table.insert(offset, added.start, added.end);
    this.lengthChanged = true;
    this.shiftedFrom = Math.min(this.shiftedFrom ?? offset, offset);
    await this.materialiseIfNeeded(bytes.length);
  }

  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/EditOverlayStorage.swift#EditOverlayStorage.delete */
  async delete(start: number, end: number): Promise<void> {
    const from = Math.min(Math.max(start, 0), this.table.size);
    const to = Math.min(Math.max(end, 0), this.table.size);
    if (to <= from) return;

    this.table.delete(from, to);
    this.lengthChanged = true;
    this.shiftedFrom = Math.min(this.shiftedFrom ?? from, from);
    await this.materialiseIfNeeded(0);
  }

  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/EditOverlayStorage.swift#EditOverlayStorage.append */
  async append(bytes: Uint8Array): Promise<void> {
    await this.overwrite(this.table.size, bytes);
  }

  // MARK: - Save support

  /**
   * True when the storage holds only overwrites, so saving can patch the
   * original file in place rather than rewriting it.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/EditOverlayStorage.swift#EditOverlayStorage.canPatchInPlace
   */
  get canPatchInPlace(): boolean {
    return !this.lengthChanged;
  }

  /**
   * True when the storage holds any unsaved edit.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/EditOverlayStorage.swift#EditOverlayStorage.isDirty
   */
  get isDirty(): boolean {
    return (
      this.lengthChanged ||
      this.table.addedRanges.length > 0 ||
      this.retainedChangedRanges.length > 0
    );
  }

  /**
   * The size of the base the table's offsets are written against.
   *
   * The save path compares it with the base file's size before writing: a base
   * that has shrunk since it was opened cannot be read any more, and a read
   * pads the missing bytes with zeros to keep the offsets after them in place —
   * so a save would write those zeros into the user's file and report success.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/EditOverlayStorage.swift#EditOverlayStorage.baseSize
   */
  get baseSize(): number {
    return this.base.size;
  }

  /**
   * Ranges whose bytes are not the bytes the base holds at those offsets.
   *
   * While nothing has shifted, that is exactly where editing wrote, and those
   * offsets are still the file's own — which is what lets a save patch them in
   * place. Once an insert or a delete has moved bytes, everything from that
   * offset on holds different content than the file did there, so the tail is
   * part of the answer. The save path does not use this in that state (it
   * rewrites), but the minimap does, to know where a modified byte can be.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/EditOverlayStorage.swift#EditOverlayStorage.changedRanges
   */
  get changedRanges(): OffsetRange[] {
    const ranges = [...this.retainedChangedRanges, ...this.table.addedRanges];
    if (this.shiftedFrom !== undefined && this.shiftedFrom < this.table.size) {
      ranges.push({ start: this.shiftedFrom, end: this.table.size });
    }
    return mergeRanges(ranges);
  }

  /**
   * How many pieces the content is described by — for tests and diagnostics.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/EditOverlayStorage.swift#EditOverlayStorage.pieceCount
   */
  get pieceCount(): number {
    return this.table.pieceCount;
  }

  /**
   * Starts again over a base that already holds the current content — what a
   * successful save leaves behind.
   *
   * The file on disk now *is* the document, so the piece table collapses to one
   * base piece, the add buffer empties, and nothing is a change any more. Until
   * this happens, `changedRanges` still names every edit and a second save
   * would write them all again over bytes that already hold them.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/EditOverlayStorage.swift#EditOverlayStorage.rebaseOriginalURL
   * @upstream-differs takes the new base storage, since a browser save leaves a new File rather than the same URL
   */
  rebase(base: ByteStorage): void {
    this.base = base;
    this.table = new PieceTable(base.size);
    this.added = new Uint8Array(0);
    this.addedLength = 0;
    this.lengthChanged = false;
    this.shiftedFrom = undefined;
    this.retainedChangedRanges = [];
  }

  /**
   * The content as it stands right now, as a source a second document can build
   * its own overlay on — what Duplicate needs.
   *
   * Upstream shares the piece list and the add buffer by value and clones the
   * base file with `clonefile(2)`, which on APFS is free until one side is
   * written. A browser has neither a value-typed array nor a copy-on-write
   * clone, and the base here is a `File` the *user's own save* replaces — after
   * which the copy would be reading a file that no longer holds what it was
   * copied from.
   *
   * So the content is written out once, to a private scratch file, and the copy
   * reads that. It costs the document's size in origin storage and a pass over
   * its bytes, paid once at the moment of copying rather than risked forever
   * afterwards.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/EditOverlayStorage.swift#EditOverlayStorage.contentSnapshot
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/ContentSnapshot.swift#ContentSnapshot
   * @upstream-differs the content is written once to a scratch file and read back, rather than sharing the piece list and a clonefile(2) copy of the base
   */
  async contentSnapshot(scratch: ScratchStore): Promise<ByteSource> {
    return await scratch.write(this.contentStream());
  }

  // MARK: - Internals

  /** Copies `bytes` into the add buffer and returns the range they occupy. */
  private appendToAddBuffer(bytes: Uint8Array): OffsetRange {
    const start = this.addedLength;
    const end = start + bytes.length;
    if (end > this.added.length) {
      const grown = new Uint8Array(Math.max(end, this.added.length * 2, 4096));
      grown.set(this.added.subarray(0, this.addedLength));
      this.added = grown;
    }
    this.added.set(bytes, start);
    this.addedLength = end;
    return { start, end };
  }

  /**
   * Folds the table into a fresh base when a budget is exceeded. This is
   * upstream's old per-edit cost, paid once per many edits — and only where a
   * scratch store exists to write into.
   */
  private async materialiseIfNeeded(lastAddedSize: number): Promise<void> {
    if (this.scratch === undefined) return;
    const over =
      lastAddedSize > this.budgets.maxInlineInsert ||
      this.addedLength > this.budgets.maxAddedBytes ||
      this.table.pieceCount > this.budgets.maxPieces;
    if (over) await this.materialise(this.scratch);
  }

  /**
   * Writes the current content into a fresh private source and makes it the
   * base, leaving the table with a single piece and the add buffer empty.
   */
  private async materialise(scratch: ScratchStore): Promise<void> {
    const content = this.contentStream();
    const source = await scratch.write(content);

    // The overwritten ranges are about to stop being visible in the table —
    // keep them, or an in-place save after a materialisation would find nothing
    // to patch.
    if (!this.lengthChanged) {
      this.retainedChangedRanges = mergeRanges([
        ...this.retainedChangedRanges,
        ...this.table.addedRanges,
      ]);
    }

    // A chunk cache is keyed by chunk index alone, so the new base gets a fresh
    // one with the same budget. Sharing would serve the old file's chunks for
    // the new file's offsets.
    this.base = new FileBackedStorage(source, this.cache.forSameBudget());
    this.added = new Uint8Array(0);
    this.addedLength = 0;
    this.table = new PieceTable(this.base.size);
    await scratch.releaseAllButLatest();
  }

  /** The whole content, a megabyte at a time, for materialisation. */
  private async *contentStream(): AsyncGenerator<Bytes> {
    const total = this.table.size;
    for (let offset = 0; offset < total; ) {
      const bytes = await this.read(offset, Math.min(MATERIALISE_CHUNK, total - offset));
      if (bytes.length === 0) break;
      yield bytes;
      offset += bytes.length;
    }
  }
}

/** Sorts ranges and merges those that touch or overlap. */
function mergeRanges(ranges: readonly OffsetRange[]): OffsetRange[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const out: OffsetRange[] = [];
  for (const range of sorted) {
    const last = out[out.length - 1];
    if (last !== undefined && range.start <= last.end) {
      out[out.length - 1] = { start: last.start, end: Math.max(last.end, range.end) };
    } else {
      out.push(range);
    }
  }
  return out;
}
