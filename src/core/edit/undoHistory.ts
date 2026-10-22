import type { Selection } from "@/core/document/selectionModel";
import { caretAt } from "@/core/document/selectionModel";
import {
  currentUndoLimits,
  type UndoBytes,
  UndoJournal,
  type UndoLimits,
} from "@/core/edit/undoJournal";

/**
 * Linear undo and redo, with a dirty checkpoint.
 *
 * Ported from `UndoHistory.swift`. Two ideas in it are worth keeping in mind,
 * because both were arrived at by getting them wrong first:
 *
 * **Dirty is a state, not a count.** Every recorded transaction gets a serial
 * that is handed out once and never reused, and the newest committed serial
 * names the state the document is in. Counting edits instead makes two
 * different states with the same number of edits look identical: undo one edit,
 * make a different one, and the document claims to match the file on disk —
 * after which closing it discards the change with no prompt.
 *
 * **A step is one undo gesture, not one edit.** A typing series records one
 * step per byte; a fast repeat of `Cmd/Ctrl+Z` inside the coalescing window
 * takes back the rest of the series as a single batch. A redo unfolds that
 * batch again, so byte-by-byte rollback is available afterwards.
 *
 * Confined to the document it belongs to, and to one thread.
 */

/**
 * A single reversible byte mutation.
 *
 * Each carries everything needed to apply and revert it without re-reading the
 * storage: an overwrite carries the bytes before and after (a fill is an
 * overwrite with a repeated pattern), an insert is reverted by deleting its
 * bytes, and a delete by re-inserting them.
 *
 * An overwrite that extended past EOF is never one operation: the document
 * splits it into an overwrite of the existing bytes plus an insert of the new
 * tail, so every stored operation is length-preserving and reverts without a
 * truncate.
 *
 * The bytes are {@link UndoBytes}: in memory as an edit hands them over, in the
 * history's journal once it has recorded them.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoHistory.swift#UndoOperation
 */
export type UndoOperation =
  | {
      readonly kind: "overwrite";
      readonly at: number;
      readonly before: UndoBytes;
      readonly after: UndoBytes;
    }
  | { readonly kind: "insert"; readonly at: number; readonly bytes: UndoBytes }
  | { readonly kind: "delete"; readonly at: number; readonly bytes: UndoBytes };

/**
 * The operation that reverts this one, for applying a transaction in reverse:
 * an overwrite swaps its before and after, an insert becomes a delete of its
 * bytes, a delete re-inserts what it removed.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoHistory.swift#UndoOperation.inverted
 */
export function invertOperation(operation: UndoOperation): UndoOperation {
  switch (operation.kind) {
    case "overwrite":
      return {
        kind: "overwrite",
        at: operation.at,
        before: operation.after,
        after: operation.before,
      };
    case "insert":
      return { kind: "delete", at: operation.at, bytes: operation.bytes };
    case "delete":
      return { kind: "insert", at: operation.at, bytes: operation.bytes };
  }
}

/**
 * A committed undo step: the operations applied as a unit, plus the selections
 * that bracket it — what was selected when the edit started (restored by undo)
 * and what the edit left selected (restored by redo).
 *
 * The whole selection is stored, not just the caret: typing into a selection
 * consumes it byte by byte, and an undo that dropped the selection would make
 * the two directions asymmetric — undo would return to a state the editing
 * never passed through.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoHistory.swift#UndoTransaction
 */
/**
 * How many bytes the operation covers in the document: what an overwrite wrote, what an insert
 * added, what a delete removed.
 */
export function operationLength(operation: UndoOperation): number {
  return operation.kind === "overwrite" ? operation.after.count : operation.bytes.count;
}

/**
 * The bytes the operation carries, before and after alike — what it costs the history to keep
 * ({@link UndoLimits.bytes}). A fill's bytes count as its pattern.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoHistory.swift#UndoOperation.heldBytes
 */
function heldBytesOf(operation: UndoOperation): number {
  return operation.kind === "overwrite"
    ? operation.before.heldCount + operation.after.heldCount
    : operation.bytes.heldCount;
}

/**
 * The same operation with its bytes in `journal`.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoHistory.swift#UndoOperation.stored
 */
function storedIn(operation: UndoOperation, journal: UndoJournal): UndoOperation {
  return operation.kind === "overwrite"
    ? {
        ...operation,
        before: journal.store(operation.before),
        after: journal.store(operation.after),
      }
    : { ...operation, bytes: journal.store(operation.bytes) };
}

/**
 * How many of the operation's bytes lie in `journal`.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoHistory.swift#UndoOperation.bytes
 */
function bytesIn(operation: UndoOperation, journal: UndoJournal): number {
  const count = (bytes: UndoBytes) => (bytes.journal === journal ? bytes.count : 0);
  return operation.kind === "overwrite"
    ? count(operation.before) + count(operation.after)
    : count(operation.bytes);
}

export interface UndoTransaction {
  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoHistory.swift#UndoTransaction.ops */
  readonly ops: readonly UndoOperation[];
  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoHistory.swift#UndoTransaction.selectionBefore */
  readonly selectionBefore: Selection;
  /**
   * Set at record time from the edit's natural end, then refined by
   * {@link UndoHistory.noteSelectionAfterOnLast} once the command that made the
   * edit has left the selection where it wants it.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoHistory.swift#UndoTransaction.selectionAfter
   */
  readonly selectionAfter: Selection;
  /**
   * The state this step was recorded under. A document-level act — a join —
   * captures it so undo and redo can recognise the transaction and re-attach or
   * detach the file.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoHistory.swift#UndoTransaction.serial
   */
  readonly serial: number;
  /**
   * The state this transaction was applied to: the serial the document stood at when it was
   * recorded. Every state has a serial of its own, so the states form a tree, and a kept history
   * finds its way from the state it wrote down to any other by these.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoHistory.swift#UndoTransaction.parent
   */
  readonly parent: number;
}

/**
 * A transaction as a kept history writes it down: the transaction, and the two things about it its
 * step knows — the typing series it belongs to and the name the menu gives it.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/HistoryLog.swift#KeptTransaction
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/HistoryLog.swift#KeptTransaction.init
 */
export interface KeptTransaction {
  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/HistoryLog.swift#KeptTransaction.transaction */
  readonly transaction: UndoTransaction;
  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/HistoryLog.swift#KeptTransaction.seriesID */
  readonly seriesId: number | undefined;
  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/HistoryLog.swift#KeptTransaction.label */
  readonly label: string | undefined;
  /**
   * What the pane paired with the transaction, read back from the log: the segments before it
   * (while it was on the undo side) and after it (while it was on the redo side), in the app's own
   * encoding.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/HistoryLog.swift#KeptTransaction.segmentsBefore
   */
  readonly segmentsBefore?: Uint8Array | undefined;
  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/HistoryLog.swift#KeptTransaction.segmentsAfter */
  readonly segmentsAfter?: Uint8Array | undefined;
}

export interface RecordOptions {
  readonly selectionBefore: Selection;
  readonly selectionAfter: Selection;
  /** Links the steps of one typing series; absent outside a series. */
  readonly seriesId?: number;
  /**
   * What the user would call this step — "Add Microcode". Absent for the
   * ordinary editing that needs no name, which is most of it; set only by an
   * edit made on the user's behalf by something with a name of its own, which
   * today means a tool module's transaction.
   */
  readonly label?: string;
}

/** A transaction and the state it produced. */
interface Entry {
  transaction: UndoTransaction;
  readonly serial: number;
}

/**
 * One undo gesture: a transaction (a normal edit, or one entered byte) or a
 * batch of them (the rest of a series taken back by one fast press).
 */
interface Step {
  readonly label: string | undefined;
  /** In recording order, first to last. */
  entries: Entry[];
  readonly seriesId: number | undefined;
}

/** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoHistory.swift#UndoHistory.Step.bytes */
const stepBytesIn = (step: Step, journal: UndoJournal): number =>
  step.entries.reduce(
    (sum, entry) => sum + entry.transaction.ops.reduce((one, op) => one + bytesIn(op, journal), 0),
    0
  );

/** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoHistory.swift#UndoHistory */
export class UndoHistory {
  private undoSteps: Step[] = [];
  private redoSteps: Step[] = [];

  /**
   * Handed out on every record, never reused — not even after a reset, so a
   * serial can never name two different states in one document's lifetime.
   */
  private nextSerial = 1;
  /** The serial {@link markSaved} checkpointed; 0 means "the file as opened". */
  private savedSerial = 0;
  /**
   * True after the history was cleared while the document stayed dirty — a
   * join produces never-saved content that cannot be undone (there is no prior
   * state to return to) but must not be silently discarded on close.
   */
  private dirtyAfterClear = false;
  private transactionCount = 0;

  /**
   * The bounds this history keeps to; absent reads {@link currentUndoLimits} at each edit, which
   * is what a document does — the settings can change while it is open.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoHistory.swift#UndoHistory.limits
   */
  limits: UndoLimits | undefined;
  /**
   * The file the operations' bytes live in, made at the first edit that has any.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoHistory.swift#UndoHistory.journal
   */
  private journal: UndoJournal | undefined;
  private held = 0;
  /**
   * How many of the held bytes lie in the current journal; the rest of its length is dead —
   * steps dropped, redo sides cut, groups cancelled.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoHistory.swift#UndoHistory.liveJournalBytes
   */
  private liveJournalBytes = 0;
  /**
   * Dead bytes the journal may hold before it is compacted, at the least; beyond that, it is
   * compacted once they outweigh the live ones.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoHistory.swift#UndoHistory.compactionFloor
   */
  compactionFloor = 64 * 2 ** 20;
  private base = 0;
  /**
   * How many times the history was emptied (`reset`, `clearKeepingDirty`) or put back from a kept
   * one: the content then jumped with no transaction to say how.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoHistory.swift#UndoHistory.epoch
   */
  private epoch = 0;

  // The coalescing window for fast rollback.
  private lastUndoWasSeriesByte = false;
  private lastUndoSeriesId: number | undefined;

  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoHistory.swift#UndoHistory.canUndo */
  get canUndo(): boolean {
    return this.undoSteps.length > 0;
  }

  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoHistory.swift#UndoHistory.canRedo */
  get canRedo(): boolean {
    return this.redoSteps.length > 0;
  }

  /**
   * True when the current state differs from the last saved one, or when the
   * document holds never-saved content a cleared history no longer names.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoHistory.swift#UndoHistory.isDirty
   */
  get isDirty(): boolean {
    return this.dirtyAfterClear || this.currentSerial !== this.savedSerial;
  }

  /**
   * Number of committed transactions.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoHistory.swift#UndoHistory.undoDepth
   */
  get undoDepth(): number {
    return this.transactionCount;
  }

  /**
   * The state the content is in, as far as the history can name it: what lets bytes kept
   * elsewhere — a workspace's — be rewritten only when they changed.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoHistory.swift#UndoHistory.version
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoHistory.swift#UndoHistory.Version
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoHistory.swift#UndoHistory.Version.epoch
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoHistory.swift#UndoHistory.Version.serial
   * @upstream-differs the version is a plain object the getter makes, not a type of its own
   */
  get version(): { readonly epoch: number; readonly serial: number } {
    return { epoch: this.epoch, serial: this.currentSerial };
  }

  /**
   * The bytes every recorded operation carries, undo and redo side together.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoHistory.swift#UndoHistory.heldBytes
   */
  get heldBytes(): number {
    return this.held;
  }

  /**
   * The state an empty undo side stands for: 0 for the file as opened, the serial of the newest
   * dropped transaction once the bounds have dropped any. Undoing everything that is left lands
   * there, not on 0.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoHistory.swift#UndoHistory.baseSerial
   */
  get baseSerial(): number {
    return this.base;
  }

  /**
   * The serial of the newest committed transaction — the name of the state the
   * document is in. With nothing to undo, the state the undo side starts from:
   * the file as it was opened (0), or the newest step the bounds dropped.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoHistory.swift#UndoHistory.currentSerial
   */
  private get currentSerial(): number {
    const step = this.undoSteps[this.undoSteps.length - 1];
    return step?.entries[step.entries.length - 1]?.serial ?? this.base;
  }

  /**
   * The same, or `undefined` when nothing has been committed. A join captures
   * this right after its transaction commits, so undo and redo can recognise
   * that step.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoHistory.swift#UndoHistory.lastCommittedSerial
   */
  get lastCommittedSerial(): number | undefined {
    const step = this.undoSteps[this.undoSteps.length - 1];
    return step?.entries[step.entries.length - 1]?.serial;
  }

  /**
   * What the next undo would take back, when that step has a name.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoHistory.swift#UndoHistory.undoLabel
   */
  get undoLabel(): string | undefined {
    return this.undoSteps[this.undoSteps.length - 1]?.label;
  }

  /**
   * The same for the next redo.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoHistory.swift#UndoHistory.redoLabel
   */
  get redoLabel(): string | undefined {
    return this.redoSteps[this.redoSteps.length - 1]?.label;
  }

  /**
   * Records a transaction of operations already applied to storage.
   *
   * Any undone steps are discarded, because the state has diverged. A new
   * record also breaks the fast-rollback window — a fresh edit is never batched
   * with a previous undo.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoHistory.swift#UndoHistory.record
   */
  record(recorded: readonly UndoOperation[], options: RecordOptions): void {
    if (recorded.length === 0) return;

    this.discardRedo();
    const ops = this.stored(recorded);
    const parent = this.currentSerial;
    const serial = this.nextSerial++;
    const entry: Entry = {
      serial,
      transaction: {
        ops,
        selectionBefore: options.selectionBefore,
        selectionAfter: options.selectionAfter,
        serial,
        parent,
      },
    };
    this.undoSteps.push({
      label: options.label,
      entries: [entry],
      seriesId: options.seriesId,
    });
    this.transactionCount++;
    this.account(ops, 1);
    this.lastUndoWasSeriesByte = false;
    this.lastUndoSeriesId = undefined;
    this.dropBeyondLimits();
    this.compactIfNeeded();
  }

  /**
   * `ops` with their bytes in the journal — what an edit group does with the operations it
   * collects, so a long group (a join, a streamed replace) does not hold its bytes in memory until
   * it closes.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoHistory.swift#UndoHistory.stored
   */
  stored(ops: readonly UndoOperation[]): UndoOperation[] {
    if (this.journal === undefined) {
      if (!ops.some((op) => heldBytesOf(op) > 0)) return [...ops];
      this.journal = new UndoJournal();
    }
    const journal = this.journal;
    return ops.map((op) => storedIn(op, journal));
  }

  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoHistory.swift#UndoHistory.account */
  private account(ops: readonly UndoOperation[], sign: 1 | -1): void {
    for (const op of ops) {
      const held = heldBytesOf(op);
      const live = this.journal === undefined ? 0 : bytesIn(op, this.journal);
      if (sign > 0) {
        this.held += held;
        this.liveJournalBytes += live;
      } else {
        this.held -= Math.min(held, this.held);
        this.liveJournalBytes -= Math.min(live, this.liveJournalBytes);
      }
    }
  }

  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoHistory.swift#UndoHistory.discardRedo */
  private discardRedo(): void {
    for (const step of this.redoSteps) {
      for (const entry of step.entries) this.account(entry.transaction.ops, -1);
    }
    this.redoSteps = [];
  }

  /**
   * Drops the oldest steps until the history is within its bounds — never the newest: one edit
   * larger than the bound is still undoable once. Runs right after a record, when the redo side
   * is empty.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoHistory.swift#UndoHistory.dropBeyondLimits
   */
  private dropBeyondLimits(): void {
    const limits = this.limits ?? currentUndoLimits();
    const over = () =>
      (limits.bytes !== undefined && this.held > limits.bytes) ||
      (limits.transactions !== undefined && this.transactionCount > limits.transactions);
    while (this.undoSteps.length > 1 && over()) {
      const step = this.undoSteps.shift() as Step;
      for (const entry of step.entries) this.account(entry.transaction.ops, -1);
      this.transactionCount -= step.entries.length;
      const serial = step.entries[step.entries.length - 1]?.serial;
      if (serial !== undefined) this.base = serial;
    }
  }

  /**
   * Moves the live bytes into a new journal once the dead ones outweigh them. The old journal is
   * let go, not rewritten: bytes handed out from it stay readable while anything holds them.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoHistory.swift#UndoHistory.compactIfNeeded
   */
  private compactIfNeeded(): void {
    const old = this.journal;
    if (old === undefined) return;
    const dead = old.length - Math.min(this.liveJournalBytes, old.length);
    if (dead <= this.compactionFloor || dead <= this.liveJournalBytes) return;
    this.moveJournal();
  }

  /**
   * Moves every operation's bytes into a new journal: what compacting does, and what puts a
   * document's journal into the workspace that keeps it when it was made elsewhere.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoHistory.swift#UndoHistory.moveJournal
   */
  moveJournal(fresh: UndoJournal = new UndoJournal()): void {
    const move = (steps: readonly Step[]) => {
      for (const step of steps) {
        for (const entry of step.entries) {
          entry.transaction = {
            ...entry.transaction,
            ops: entry.transaction.ops.map((op) => storedIn(op, fresh)),
          };
        }
      }
    };
    move(this.undoSteps);
    move(this.redoSteps);
    this.journal = fresh;
    this.liveJournalBytes = [...this.undoSteps, ...this.redoSteps].reduce(
      (sum, step) => sum + stepBytesIn(step, fresh),
      0
    );
  }

  /**
   * Lets go of every operation's bytes: the journal goes with them.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoHistory.swift#UndoHistory.dropAll
   */
  private dropAll(): void {
    this.undoSteps = [];
    this.redoSteps = [];
    this.journal = undefined;
    this.held = 0;
    this.liveJournalBytes = 0;
    this.base = 0;
  }

  /**
   * Caret-only form, for edits with no selection to restore.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoHistory.swift#UndoHistory.record
   */
  recordAtCaret(
    ops: readonly UndoOperation[],
    caretBefore: number,
    caretAfter: number,
    fileSize: number,
    options: { seriesId?: number; label?: string } = {}
  ): void {
    this.record(ops, {
      selectionBefore: caretAt(caretBefore, fileSize),
      selectionAfter: caretAt(caretAfter, fileSize),
      ...options,
    });
  }

  /**
   * Refines the last recorded transaction's post-edit selection, so redo
   * restores what the editing command left on screen rather than the bare end
   * of the byte range it wrote.
   *
   * Ignored unless the last transaction is the current one — nothing has been
   * undone since it was recorded.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoHistory.swift#UndoHistory.noteSelectionAfterOnLast
   */
  noteSelectionAfterOnLast(selection: Selection): void {
    if (this.redoSteps.length > 0) return;
    const step = this.undoSteps[this.undoSteps.length - 1];
    const entry = step?.entries[step.entries.length - 1];
    if (entry === undefined) return;
    entry.transaction = { ...entry.transaction, selectionAfter: selection };
  }

  /**
   * Reverts the most recent step, returning its transactions in recording order
   * for the caller to apply in reverse.
   *
   * With `batch`, a fast repeat of a series-byte undo takes back the rest of
   * that series as one step instead. Returns `undefined` if there is nothing to
   * undo.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoHistory.swift#UndoHistory.undo
   */
  undo(batch = false): UndoTransaction[] | undefined {
    const last = this.undoSteps.pop();
    if (last === undefined) return undefined;

    const collected = [last];
    if (
      batch &&
      last.seriesId !== undefined &&
      last.seriesId === this.lastUndoSeriesId &&
      this.lastUndoWasSeriesByte
    ) {
      while (this.undoSteps[this.undoSteps.length - 1]?.seriesId === last.seriesId) {
        const next = this.undoSteps.pop();
        if (next === undefined) break;
        collected.push(next);
      }
    }

    // Back into recording order: the steps came off the stack newest first.
    const ordered = collected.reverse().flatMap((step) => step.entries);
    this.transactionCount -= ordered.length;
    // The name goes onto the redo stack with the step, so a step undone and
    // offered back is still the same act by the same name.
    this.redoSteps.push({ label: last.label, entries: ordered, seriesId: last.seriesId });
    this.lastUndoWasSeriesByte = collected.length === 1 && last.seriesId !== undefined;
    this.lastUndoSeriesId = last.seriesId;
    return ordered.map((entry) => entry.transaction);
  }

  /**
   * Reapplies the next undone step, returning its transactions in recording
   * order for the caller to apply in order.
   *
   * A batch step is unfolded back into individual byte steps on the undo stack,
   * restoring the series' byte-by-byte structure.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoHistory.swift#UndoHistory.redo
   */
  redo(): UndoTransaction[] | undefined {
    const step = this.redoSteps.pop();
    if (step === undefined) return undefined;

    // Each transaction goes back with the serial it was recorded under, so a
    // redo that lands on the saved state is recognised as clean again.
    for (const entry of step.entries) {
      this.undoSteps.push({ label: step.label, entries: [entry], seriesId: step.seriesId });
    }
    this.transactionCount += step.entries.length;
    this.lastUndoWasSeriesByte = false;
    this.lastUndoSeriesId = undefined;
    return step.entries.map((entry) => entry.transaction);
  }

  /**
   * Marks the state the document is in as the saved one.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoHistory.swift#UndoHistory.markSaved
   */
  markSaved(): void {
    this.savedSerial = this.currentSerial;
    this.dirtyAfterClear = false;
  }

  /**
   * Discards all history and the dirty checkpoint.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoHistory.swift#UndoHistory.reset
   */
  reset(): void {
    this.dropAll();
    // The content is not the state any serial named so far, so it gets a serial of its own — the
    // one future edits name as their parent. A reset document is its file as saved, so that serial
    // is also the saved one.
    this.base = this.takeSerial();
    this.savedSerial = this.base;
    this.dirtyAfterClear = false;
    this.epoch += 1;
    this.transactionCount = 0;
    this.lastUndoWasSeriesByte = false;
    this.lastUndoSeriesId = undefined;
  }

  /**
   * Clears the history but keeps the document marked as holding unsaved
   * content.
   *
   * A join produces never-saved content that cannot be undone — there is no
   * prior state to return to — yet must not be silently discarded on close, so
   * the dirty flag survives the clear. A later save or reset clears it; edits
   * made after the clear undo as usual and never reach the cleared work.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoHistory.swift#UndoHistory.clearKeepingDirty
   */
  clearKeepingDirty(): void {
    this.reset();
    this.savedSerial = 0;
    this.dirtyAfterClear = true;
  }

  /**
   * Hands out a serial no state has had.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoHistory.swift#UndoHistory.takeSerial
   */
  private takeSerial(): number {
    return this.nextSerial++;
  }

  // MARK: - Kept beside a workspace

  /**
   * The file the operations' bytes live in — and, for a document a workspace keeps, its log.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoHistory.swift#UndoHistory.journal
   */
  get currentJournal(): UndoJournal | undefined {
    return this.journal;
  }

  /**
   * The serial of the state the document is in.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoHistory.swift#UndoHistory.headSerial
   */
  get headSerial(): number {
    return this.currentSerial;
  }

  /**
   * The serial of the state last saved: what the file on disk holds while the document is not
   * dirty.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoHistory.swift#UndoHistory.savedStateSerial
   */
  get savedStateSerial(): number {
    return this.savedSerial;
  }

  /**
   * The next serial `record` will hand out — what a kept history goes on counting from, so a
   * restored document never names two states alike.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoHistory.swift#UndoHistory.upcomingSerial
   */
  get upcomingSerial(): number {
    return this.nextSerial;
  }

  /**
   * Every transaction the history holds, undo side and redo side, oldest serial first: what a kept
   * history writes down, parents before children.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoHistory.swift#UndoHistory.heldTransactions
   */
  get heldTransactions(): KeptTransaction[] {
    return [...this.undoSteps, ...this.redoSteps]
      .flatMap((step) => step.entries.map((entry) => keptOf(step, entry)))
      .sort((one, other) => one.transaction.serial - other.transaction.serial);
  }

  /**
   * The transactions recorded after the one `serial` names, oldest first — what a kept history
   * has not written yet. Serials only grow, so the undo side is read from its newest end only as
   * far as it is new: a snapshot costs what changed, not how long the history is.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoHistory.swift#UndoHistory.heldTransactions
   */
  heldTransactionsAfter(serial: number): KeptTransaction[] {
    const found: KeptTransaction[] = [];
    outer: for (const step of [...this.undoSteps].reverse()) {
      for (const entry of [...step.entries].reverse()) {
        if (entry.serial <= serial) break outer;
        found.push(keptOf(step, entry));
      }
    }
    for (const step of this.redoSteps) {
      for (const entry of step.entries) if (entry.serial > serial) found.push(keptOf(step, entry));
    }
    return found.sort((one, other) => one.transaction.serial - other.transaction.serial);
  }

  /**
   * The transaction the next undo would take back first — the only one a command can still refine
   * the selection after.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoHistory.swift#UndoHistory.newestTransaction
   */
  get newestTransaction(): UndoTransaction | undefined {
    const step = this.undoSteps[this.undoSteps.length - 1];
    return step?.entries[step.entries.length - 1]?.transaction;
  }

  /**
   * The serial of the undo side's transaction `k` places from its newest end — what a pane's
   * segment snapshots are paired with, read from the end that moves.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoHistory.swift#UndoHistory.undoSideSerial
   */
  undoSideSerial(fromNewest: number): number | undefined {
    return sideSerial(this.undoSteps, fromNewest);
  }

  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoHistory.swift#UndoHistory.redoSideSerial */
  redoSideSerial(fromNewest: number): number | undefined {
    return sideSerial(this.redoSteps, fromNewest);
  }

  /**
   * The serials of the undo side, oldest first — what a pane pairs its segment snapshots with.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoHistory.swift#UndoHistory.undoSideSerials
   */
  get undoSideSerials(): number[] {
    return this.undoSteps.flatMap((step) => step.entries.map((entry) => entry.serial));
  }

  /**
   * The serials of the redo side, from the one redone last to the next to redo, each step's in
   * recording order — the order a pane stacks the segments after them.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoHistory.swift#UndoHistory.redoSideSerials
   */
  get redoSideSerials(): number[] {
    return this.redoSteps.flatMap((step) => step.entries.map((entry) => entry.serial));
  }

  /**
   * The state an empty undo side stands for: where undoing all that is left lands.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoHistory.swift#UndoHistory.undoBaseSerial
   */
  get undoBaseSerial(): number {
    return this.base;
  }

  /**
   * Whether the document stays dirty whatever state it is in — content nobody saved, with no
   * earlier state to undo to ({@link clearKeepingDirty}).
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoHistory.swift#UndoHistory.isDirtyRegardless
   */
  get isDirtyRegardless(): boolean {
    return this.dirtyAfterClear;
  }

  /**
   * The newest state the redo side leads to: the redo side is the way from the state the document
   * is in down to it. Nothing with nothing to redo.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoHistory.swift#UndoHistory.redoTipSerial
   */
  get redoTipSerial(): number | undefined {
    const step = this.redoSteps[0];
    return step?.entries[step.entries.length - 1]?.serial;
  }

  /**
   * How many transactions each redo step holds, the next to redo first — a fast undo of a typing
   * series is one step of many.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoHistory.swift#UndoHistory.redoStepSizes
   */
  get redoStepSizes(): number[] {
    return [...this.redoSteps].reverse().map((step) => step.entries.length);
  }

  /**
   * Goes on from a document kept beside a workspace: its content is the state `head` names,
   * serials continue from `nextSerial`, and the file on disk — for a document that has one —
   * holds the state `saved` names. `dirty` keeps a document dirty that has no saved state to
   * compare with: an untitled one nobody saved.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoHistory.swift#UndoHistory.resume
   */
  resume(options: {
    readonly head: number;
    readonly nextSerial: number;
    readonly saved: number | undefined;
    readonly dirty: boolean;
    readonly journal?: UndoJournal | undefined;
  }): void {
    this.restore({
      undo: [],
      redo: [],
      base: options.head,
      nextSerial: options.nextSerial,
      saved: options.saved ?? options.head,
      dirtyRegardless: options.dirty && options.saved === undefined,
      journal: options.journal,
    });
  }

  /**
   * Puts back a history kept beside a workspace: `undo`, oldest first, is the way from `base` to
   * the state the document is in; `redo`, the next to redo first, the steps from there on. The
   * operations' bytes stay where they are — in the kept log — until a compaction moves them into
   * this history's own journal. Serials go on from `nextSerial`; `saved` names the saved state, and
   * `dirtyRegardless` keeps a document dirty in any state.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoHistory.swift#UndoHistory.restore
   */
  restore(options: {
    readonly undo: readonly KeptTransaction[];
    readonly redo: readonly (readonly KeptTransaction[])[];
    readonly base: number;
    readonly nextSerial: number;
    readonly saved: number;
    readonly dirtyRegardless: boolean;
    readonly journal?: UndoJournal | undefined;
  }): void {
    this.dropAll();
    // The kept log, taken up again: the operations' bytes are in it, and the edits from here on go
    // on writing it.
    this.journal = options.journal;
    this.base = options.base;
    const step = (kept: readonly KeptTransaction[]): Step => ({
      label: kept[0]?.label,
      entries: kept.map((one) => ({
        transaction: one.transaction,
        serial: one.transaction.serial,
      })),
      seriesId: kept[0]?.seriesId,
    });
    this.undoSteps = options.undo.map((one) => step([one]));
    this.redoSteps = [...options.redo].reverse().map(step);
    const all = [...options.undo, ...options.redo.flat()];
    for (const kept of all) this.account(kept.transaction.ops, 1);
    const newest = all.reduce((max, kept) => Math.max(max, kept.transaction.serial), 0);
    this.nextSerial = Math.max(options.nextSerial, newest + 1, options.base + 1);
    this.savedSerial = options.saved;
    this.dirtyAfterClear = options.dirtyRegardless;
    this.transactionCount = options.undo.length;
    this.lastUndoWasSeriesByte = false;
    this.lastUndoSeriesId = undefined;
    this.epoch += 1;
  }
}

/** A step's entry as a kept history writes it down. */
const keptOf = (step: Step, entry: Entry): KeptTransaction => ({
  transaction: entry.transaction,
  seriesId: step.seriesId,
  label: step.label,
});

/** The serial `k` places from the newest end of `steps`. */
function sideSerial(steps: readonly Step[], k: number): number | undefined {
  let left = k;
  for (const step of [...steps].reverse()) {
    if (left < step.entries.length) return step.entries[step.entries.length - 1 - left]?.serial;
    left -= step.entries.length;
  }
  return undefined;
}
