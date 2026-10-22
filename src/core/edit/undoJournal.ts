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
 * The file a document's undo history keeps its bytes in: append-only, never rewritten in place —
 * compacting means a new journal, so bytes still pointing into the old one stay readable for as
 * long as they live.
 *
 * Where upstream writes before it answers, this answers at once: the run is reserved at the end,
 * the bytes stay in memory until their write has landed, and a read of them meanwhile is
 * answered from memory. A write that fails keeps them there, so the edit stays undoable.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoJournal.swift#UndoJournal
 * @upstream-differs writes are queued rather than made before the record returns: a page writes
 * its private file system asynchronously, and the history records synchronously
 */
export class UndoJournal {
  private readonly files: JournalStore;
  private end = 0;
  private queue: Promise<void> = Promise.resolve();
  private readonly pending = new Map<number, Pending>();

  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoJournal.swift#UndoJournal.init */
  constructor(store: JournalStore = storeProvider()) {
    this.files = store;
    released?.register(this, store);
  }

  /**
   * Bytes reserved so far: where the next run goes.
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
   * Appends `bytes`, returning where they start.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoJournal.swift#UndoJournal.appendBlob
   */
  append(bytes: Uint8Array): number {
    const offset = this.end;
    this.end += bytes.length;
    const held = bytes.slice();
    const written = this.enqueue(offset, () => this.files.write(offset, held));
    this.pending.set(offset, { offset, count: held.length, bytes: held, written });
    return offset;
  }

  /**
   * Appends `count` bytes read from `source` at `offset`, in slices, returning where they start.
   * A run copied from another journal while it compacts.
   */
  private appendCopy(source: UndoJournal, from: number, count: number): number {
    const offset = this.end;
    this.end += count;
    const written = this.enqueue(offset, async () => {
      for (let copied = 0; copied < count; copied += COPY_SLICE) {
        const slice = Math.min(COPY_SLICE, count - copied);
        await this.files.write(offset + copied, await source.read(from + copied, slice));
      }
    });
    this.pending.set(offset, { offset, count, bytes: undefined, written });
    return offset;
  }

  private enqueue(offset: number, write: () => Promise<void>): Promise<void> {
    const written = this.queue.then(write).then(
      () => {
        // Landed: the bytes are the file's now, and memory lets them go.
        this.pending.delete(offset);
      },
      () => {
        // Kept in memory: the run reads from there for as long as it lives.
      }
    );
    this.queue = written;
    return written;
  }

  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoJournal.swift#UndoJournal.read */
  async read(at: number, count: number): Promise<Uint8Array> {
    if (count <= 0) return EMPTY;
    for (const run of this.pending.values()) {
      if (at < run.offset || at + count > run.offset + run.count) continue;
      if (run.bytes !== undefined) return run.bytes.slice(at - run.offset, at - run.offset + count);
      await run.written;
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
          : UndoBytes.stored(this, this.append(storage.bytes), storage.bytes.length);
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
