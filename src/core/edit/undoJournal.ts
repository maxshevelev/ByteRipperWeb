import { Sha256 } from "@/core/crypto/sha256";

/**
 * The bytes an undo operation carries, and the file they are kept in once the history has
 * recorded them (`Design/PERSISTENT_UNDO_PLAN.md` upstream, phase 1).
 *
 * An edit hands its bytes over in memory; the history moves them into its journal as it records
 * the edit, and from then on only where they lie is held. A 512 MB replace used to cost its size
 * twice in memory for as long as it could be undone.
 *
 * `src/core` reaches no file system, so a journal writes through a {@link JournalStore}: the
 * origin-private file system in a page (`src/platform/files/opfsJournalStore.ts`), memory in a
 * test or where a page has no such storage.
 */

/** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoJournal.swift#UndoBytes.Storage */
type Storage =
  | { readonly kind: "inline"; readonly bytes: Uint8Array }
  | {
      readonly kind: "stored";
      readonly journal: UndoJournal;
      readonly offset: number;
      readonly count: number;
    }
  /** `count` bytes of `pattern` repeated, from its first byte. */
  | { readonly kind: "pattern"; readonly pattern: Uint8Array; readonly count: number };

const EMPTY = new Uint8Array(0);

/**
 * The bytes an undo operation carries — what an overwrite had before and wrote, what an insert
 * added, what a delete removed: in memory, in a journal, or, for a fill, its pattern repeated over
 * the range — a few bytes for a fill of a gigabyte.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoJournal.swift#UndoBytes
 * @upstream-differs no `==`: the bytes in a journal are read asynchronously, so a test compares
 * what `load` gives
 */
export class UndoBytes {
  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoJournal.swift#UndoBytes.storage */
  readonly storage: Storage;

  private constructor(storage: Storage) {
    this.storage = storage;
  }

  /**
   * Bytes in memory, as an edit hands them over.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoJournal.swift#UndoBytes.init
   */
  static of(bytes: Uint8Array): UndoBytes {
    return new UndoBytes({ kind: "inline", bytes });
  }

  /**
   * `count` bytes of `pattern` repeated from its first byte; the last repetition is cut short
   * where the count ends.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoJournal.swift#UndoBytes.init
   */
  static pattern(pattern: Uint8Array, count: number): UndoBytes {
    return pattern.length === 0 || count === 0
      ? new UndoBytes({ kind: "inline", bytes: EMPTY })
      : new UndoBytes({ kind: "pattern", pattern, count });
  }

  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoJournal.swift#UndoBytes.init */
  static stored(journal: UndoJournal, offset: number, count: number): UndoBytes {
    return new UndoBytes({ kind: "stored", journal, offset, count });
  }

  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoJournal.swift#UndoBytes.count */
  get count(): number {
    return this.storage.kind === "inline" ? this.storage.bytes.length : this.storage.count;
  }

  /**
   * What keeping these bytes costs: all of them, or a pattern's own length.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoJournal.swift#UndoBytes.heldCount
   */
  get heldCount(): number {
    return this.storage.kind === "pattern" ? this.storage.pattern.length : this.count;
  }

  /**
   * The bytes, read from the journal when they are there.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoJournal.swift#UndoBytes.load
   */
  async load(): Promise<Uint8Array> {
    const storage = this.storage;
    switch (storage.kind) {
      case "inline":
        return storage.bytes;
      case "stored":
        return storage.journal.read(storage.offset, storage.count);
      case "pattern":
        return repeated(storage.pattern, storage.count);
    }
  }

  /**
   * A pattern and the count it is repeated to, when the bytes are one.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoJournal.swift#UndoBytes.patternForm
   */
  get patternForm(): { readonly pattern: Uint8Array; readonly count: number } | undefined {
    return this.storage.kind === "pattern" ? this.storage : undefined;
  }

  /**
   * The bytes in slices of at most `size`, read from the journal one slice at a time: what writes
   * them elsewhere without holding them whole.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoJournal.swift#UndoBytes.forEachSlice
   */
  async forEachSlice(
    body: (bytes: Uint8Array) => Promise<void>,
    size: number = COPY_SLICE
  ): Promise<void> {
    const storage = this.storage;
    if (storage.kind === "pattern") return body(await this.load());
    const count = this.count;
    for (let at = 0; at < count; at += size) {
      const slice = Math.min(size, count - at);
      await body(
        storage.kind === "inline"
          ? storage.bytes.subarray(at, at + slice)
          : await storage.journal.read(storage.offset + at, slice)
      );
    }
  }

  /**
   * The journal these bytes lie in; nothing while they are still in memory.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoJournal.swift#UndoBytes.journal
   */
  get journal(): UndoJournal | undefined {
    return this.storage.kind === "stored" ? this.storage.journal : undefined;
  }
}

/** `count` bytes of `pattern` repeated from its first byte. */
function repeated(pattern: Uint8Array, count: number): Uint8Array {
  const bytes = new Uint8Array(count);
  for (let at = 0; at < count; at += pattern.length) {
    bytes.set(pattern.subarray(0, Math.min(pattern.length, count - at)), at);
  }
  return bytes;
}

/**
 * How deep a document's undo history may grow (`Design/PERSISTENT_UNDO_PLAN.md` upstream,
 * "Bounds"). Past either bound, the oldest steps are dropped at the next edit. Absent is no bound.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoJournal.swift#UndoLimits
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoJournal.swift#UndoLimits.init
 */
export interface UndoLimits {
  /**
   * The bytes the operations carry, before and after alike.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoJournal.swift#UndoLimits.bytes
   */
  readonly bytes?: number | undefined;
  /**
   * Transactions; a typed byte is one.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoJournal.swift#UndoLimits.transactions
   */
  readonly transactions?: number | undefined;
}

/** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoJournal.swift#UndoLimits.unlimited */
export const UNLIMITED_UNDO: UndoLimits = {};

/** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoJournal.swift#UndoLimits.default */
export const DEFAULT_UNDO_LIMITS: UndoLimits = { bytes: 4 * 2 ** 30 };

let currentLimits: UndoLimits = DEFAULT_UNDO_LIMITS;

/**
 * The bounds every history without its own reads at each edit. Set by the app from its settings.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoJournal.swift#UndoLimits.current
 */
export const currentUndoLimits = (): UndoLimits => currentLimits;

/** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoJournal.swift#UndoLimits.current */
export function setCurrentUndoLimits(limits: UndoLimits): void {
  currentLimits = limits;
}

/**
 * Where a journal's bytes are written and read: a file of the origin-private file system, or
 * memory.
 *
 * @web-only upstream writes a file descriptor of its own; `src/core` reaches no file system, so
 * a journal is handed the store it writes through
 */
export interface JournalStore {
  /** Writes `bytes` at `at`, which is the end of what was written before. */
  write(at: number, bytes: Uint8Array): Promise<void>;
  read(at: number, count: number): Promise<Uint8Array>;
  /** Lets the file go; nothing reads or writes it after. */
  close(): void;
}

/**
 * A journal kept in memory: a test's, or a page's that has no origin-private file system.
 *
 * @web-only see {@link JournalStore}
 */
export class MemoryJournalStore implements JournalStore {
  private chunks: Uint8Array[] = [];
  private offsets: number[] = [];

  async write(at: number, bytes: Uint8Array): Promise<void> {
    this.offsets.push(at);
    this.chunks.push(bytes.slice());
  }

  async read(at: number, count: number): Promise<Uint8Array> {
    const out = new Uint8Array(count);
    this.chunks.forEach((chunk, index) => {
      const start = this.offsets[index] as number;
      const from = Math.max(at, start);
      const to = Math.min(at + count, start + chunk.length);
      if (from < to) out.set(chunk.subarray(from - start, to - start), from - at);
    });
    return out;
  }

  close(): void {
    this.chunks = [];
    this.offsets = [];
  }
}

/**
 * Makes the store a new journal writes through. Set by the app; a test, and a page with no
 * origin-private file system, keep the journal in memory.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoJournal.swift#UndoJournal.directoryProvider
 * @upstream-differs a store rather than a directory: there is no path to hand a journal
 */
let storeProvider: () => JournalStore = () => new MemoryJournalStore();

/** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoJournal.swift#UndoJournal.directoryProvider */
export function setJournalStoreProvider(provider: () => JournalStore): void {
  storeProvider = provider;
}

/** A run of the journal that is not written yet, and what reading it has to wait for. */
interface Pending {
  readonly offset: number;
  readonly count: number;
  /** The bytes, while they are held for the write; nothing for a copy still being read. */
  readonly bytes: Uint8Array | undefined;
  readonly written: Promise<void>;
}

/**
 * The file a document's undo history keeps its bytes in — and, when a workspace keeps the
 * document, the same file its log is (`Design/PERSISTENT_UNDO_PLAN.md` upstream, "One journal").
 *
 * Append-only, in framed records — the kind, the body's length (u64), the body, and the SHA-256
 * of the previous record's hash and this body (`HistoryLog`). An edit's bytes go in as a `BRB1`
 * record the moment the edit is recorded; a workspace's snapshot later adds the transaction
 * records that name them, without writing the bytes a second time. Never rewritten in place —
 * compacting means a new journal, so bytes still pointing into the old one stay readable for as
 * long as they live.
 *
 * Where upstream writes before it answers, this answers at once: the record is reserved at the
 * end, its bytes stay in memory until their write has landed, and a read of them meanwhile is
 * answered from memory. The records are written, and their hashes chained, in the order they were
 * reserved. A write that fails keeps the bytes in memory, so the edit stays undoable, and leaves
 * the journal unpinnable: its chain no longer holds.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoJournal.swift#UndoJournal
 * @upstream-differs writes are queued rather than made before the record returns: a page writes
 * its private file system asynchronously, and the history records synchronously
 */
export class UndoJournal {
  private readonly files: JournalStore;
  private end: number;
  /** The chained hash at the end of what the queue has written so far. */
  private chain: Uint8Array;
  private broken = false;
  private queue: Promise<void> = Promise.resolve();
  private readonly pending = new Map<number, Pending>();

  /**
   * A new, empty journal; or — given where a workspace pinned it — one taken up again: appending
   * goes on from `pinned.length`, chaining from `pinned.hash`.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoJournal.swift#UndoJournal.init
   */
  constructor(
    store: JournalStore = storeProvider(),
    pinned?: { readonly length: number; readonly hash: Uint8Array }
  ) {
    this.files = store;
    this.end = pinned?.length ?? 0;
    this.chain = pinned?.hash ?? EMPTY_HASH;
    released?.register(this, store);
  }

  /**
   * Bytes reserved so far: where the next record goes.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoJournal.swift#UndoJournal.length
   */
  get length(): number {
    return this.end;
  }

  /** Every write queued so far has landed, or failed. */
  settled(): Promise<void> {
    return this.queue;
  }

  /**
   * The length and the chained hash at it, together, once what is queued has landed: what a
   * workspace pins the journal by. Nothing when a write failed and the chain no longer holds.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoJournal.swift#UndoJournal.pin
   */
  pin(): Promise<{ readonly length: number; readonly hash: Uint8Array } | undefined> {
    const length = this.end;
    const pinned = this.queue.then(() =>
      this.broken ? undefined : { length, hash: this.chain.slice() }
    );
    this.queue = pinned.then(() => undefined);
    return pinned;
  }

  // MARK: - Records

  /**
   * Appends one framed record: `kind`, the body's length, the body — given in pieces through
   * `emit`, never whole — and the chained hash. Returns where the body starts, at once; the
   * record is written behind.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoJournal.swift#UndoJournal.appendRecord
   */
  appendRecord(
    kind: Uint8Array,
    bodyLength: number,
    body: (emit: (bytes: Uint8Array) => Promise<void>) => Promise<void> | void
  ): number {
    const start = this.end;
    const bodyStart = start + RECORD_HEAD;
    this.end = bodyStart + bodyLength + HASH_LENGTH;
    this.enqueue(async () => {
      if (this.broken) throw new Error("The journal's chain no longer holds.");
      await this.files.write(start, concat(kind, u64(bodyLength)));
      const hasher = new Sha256().update(this.chain);
      let at = bodyStart;
      await body(async (bytes) => {
        hasher.update(bytes);
        await this.files.write(at, bytes);
        at += bytes.length;
      });
      if (at - bodyStart !== bodyLength) throw new Error("A record's body is not its length.");
      const digest = hasher.digest();
      await this.files.write(at, digest);
      this.chain = digest;
    });
    return bodyStart;
  }

  /**
   * Appends `bytes` as a `BRB1` record, returning where they start.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoJournal.swift#UndoJournal.appendBlob
   */
  appendBlob(bytes: Uint8Array): number {
    const held = bytes.slice();
    const offset = this.appendRecord(BLOB_MAGIC, held.length, (emit) => emit(held));
    this.hold(offset, held.length, held);
    return offset;
  }

  /**
   * Appends `count` bytes read from `source` at `from`, in slices, as a `BRB1` record, returning
   * where they start: a run copied from another journal.
   */
  private appendCopy(source: UndoJournal, from: number, count: number): number {
    const offset = this.appendRecord(BLOB_MAGIC, count, async (emit) => {
      for (let copied = 0; copied < count; copied += COPY_SLICE) {
        await emit(await source.read(from + copied, Math.min(COPY_SLICE, count - copied)));
      }
    });
    this.hold(offset, count, undefined);
    return offset;
  }

  /** Keeps a run readable from memory, or waited for, until the queue has written it. */
  private hold(offset: number, count: number, bytes: Uint8Array | undefined): void {
    const written = this.queue;
    this.pending.set(offset, { offset, count, bytes, written });
    void written.then(() => {
      if (!this.broken) this.pending.delete(offset);
    });
  }

  private enqueue(task: () => Promise<void>): void {
    this.queue = this.queue.then(task).catch(() => {
      // Kept in memory: the runs held for it read from there for as long as they live.
      this.broken = true;
    });
  }

  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoJournal.swift#UndoJournal.read */
  async read(at: number, count: number): Promise<Uint8Array> {
    if (count <= 0) return EMPTY;
    for (const run of this.pending.values()) {
      if (at < run.offset || at + count > run.offset + run.count) continue;
      if (run.bytes !== undefined) return run.bytes.slice(at - run.offset, at - run.offset + count);
      await run.written;
      if (this.broken) throw new Error("The journal could not be written.");
      break;
    }
    return this.files.read(at, count);
  }

  /**
   * The bytes stored here, as bytes stored in this journal: appended when they are in memory or
   * in another journal, kept as they are when they already lie here. A large run is copied in
   * slices, never read whole.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoJournal.swift#UndoJournal.store
   */
  store(bytes: UndoBytes): UndoBytes {
    const storage = bytes.storage;
    switch (storage.kind) {
      case "inline":
        return storage.bytes.length === 0
          ? bytes
          : UndoBytes.stored(this, this.appendBlob(storage.bytes), storage.bytes.length);
      case "pattern":
        return bytes;
      case "stored":
        if (storage.journal === this) return bytes;
        return UndoBytes.stored(
          this,
          this.appendCopy(storage.journal, storage.offset, storage.count),
          storage.count
        );
    }
  }
}

/** The kind of a record, and the body's length: what comes before its body. */
const RECORD_HEAD = 4 + 8;
const HASH_LENGTH = 32;

/**
 * The hash a log starts its chain from.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/HistoryLog.swift#HistoryLog.emptyHash
 */
export const EMPTY_HASH = new Uint8Array(HASH_LENGTH);

const ascii = (text: string) => Uint8Array.from(text, (unit) => unit.charCodeAt(0));

/**
 * An edit's bytes, written the moment it was recorded; transaction records name them by where
 * they start.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/HistoryLog.swift#HistoryLog.blobMagic
 */
export const BLOB_MAGIC = ascii("BRB1");

/**
 * `value` as eight bytes, little-endian.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoJournal.swift#UndoJournal.u64
 */
export function u64(value: number): Uint8Array {
  const bytes = new Uint8Array(8);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, value >>> 0, true);
  view.setUint32(4, Math.floor(value / 2 ** 32), true);
  return bytes;
}

/** The pieces, one after another. */
export function concat(...pieces: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(pieces.reduce((sum, piece) => sum + piece.length, 0));
  let at = 0;
  for (const piece of pieces) {
    out.set(piece, at);
    at += piece.length;
  }
  return out;
}

/**
 * Lets a journal's file go when nothing holds the journal any more — the history let it go, and
 * no operation handed out still points into it.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoJournal.swift#UndoJournal.deinit
 */
const released =
  typeof FinalizationRegistry === "undefined"
    ? undefined
    : new FinalizationRegistry<JournalStore>((store) => store.close());

/**
 * The slice a copy reads and writes at a time.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoJournal.swift#UndoJournal.copySlice
 */
export const COPY_SLICE = 1 << 20;
