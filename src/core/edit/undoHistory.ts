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
    const serial = this.nextSerial++;
    const entry: Entry = {
      serial,
      transaction: {
        ops,
        selectionBefore: options.selectionBefore,
        selectionAfter: options.selectionAfter,
        serial,
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
    const fresh = new UndoJournal();
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
    // `nextSerial` deliberately keeps counting: the history is empty, so the
    // current state is 0 again, and no future serial can collide with one a
    // caller still remembers.
    this.savedSerial = 0;
    this.dirtyAfterClear = false;
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
    this.dirtyAfterClear = true;
  }
}
