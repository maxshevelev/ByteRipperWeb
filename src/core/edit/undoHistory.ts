import type { Selection } from "@/core/document/selectionModel";
import { caretAt } from "@/core/document/selectionModel";

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
 */
export type UndoOperation =
  | {
      readonly kind: "overwrite";
      readonly at: number;
      readonly before: Uint8Array;
      readonly after: Uint8Array;
    }
  | { readonly kind: "insert"; readonly at: number; readonly bytes: Uint8Array }
  | { readonly kind: "delete"; readonly at: number; readonly bytes: Uint8Array };

/**
 * The operation that reverts this one, for applying a transaction in reverse:
 * an overwrite swaps its before and after, an insert becomes a delete of its
 * bytes, a delete re-inserts what it removed.
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
 */
export interface UndoTransaction {
  readonly ops: readonly UndoOperation[];
  readonly selectionBefore: Selection;
  /**
   * Set at record time from the edit's natural end, then refined by
   * {@link UndoHistory.noteSelectionAfterOnLast} once the command that made the
   * edit has left the selection where it wants it.
   */
  readonly selectionAfter: Selection;
  /**
   * The state this step was recorded under. A document-level act — a join —
   * captures it so undo and redo can recognise the transaction and re-attach or
   * detach the file.
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

  // The coalescing window for fast rollback.
  private lastUndoWasSeriesByte = false;
  private lastUndoSeriesId: number | undefined;

  get canUndo(): boolean {
    return this.undoSteps.length > 0;
  }

  get canRedo(): boolean {
    return this.redoSteps.length > 0;
  }

  /**
   * True when the current state differs from the last saved one, or when the
   * document holds never-saved content a cleared history no longer names.
   */
  get isDirty(): boolean {
    return this.dirtyAfterClear || this.currentSerial !== this.savedSerial;
  }

  /** Number of committed transactions. */
  get undoDepth(): number {
    return this.transactionCount;
  }

  /**
   * The serial of the newest committed transaction — the name of the state the
   * document is in. Zero with nothing committed: the file as it was opened.
   */
  private get currentSerial(): number {
    const step = this.undoSteps[this.undoSteps.length - 1];
    return step?.entries[step.entries.length - 1]?.serial ?? 0;
  }

  /**
   * The same, or `undefined` when nothing has been committed. A join captures
   * this right after its transaction commits, so undo and redo can recognise
   * that step.
   */
  get lastCommittedSerial(): number | undefined {
    const step = this.undoSteps[this.undoSteps.length - 1];
    return step?.entries[step.entries.length - 1]?.serial;
  }

  /** What the next undo would take back, when that step has a name. */
  get undoLabel(): string | undefined {
    return this.undoSteps[this.undoSteps.length - 1]?.label;
  }

  /** The same for the next redo. */
  get redoLabel(): string | undefined {
    return this.redoSteps[this.redoSteps.length - 1]?.label;
  }

  /**
   * Records a transaction of operations already applied to storage.
   *
   * Any undone steps are discarded, because the state has diverged. A new
   * record also breaks the fast-rollback window — a fresh edit is never batched
   * with a previous undo.
   */
  record(ops: readonly UndoOperation[], options: RecordOptions): void {
    if (ops.length === 0) return;

    this.redoSteps = [];
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
    this.lastUndoWasSeriesByte = false;
    this.lastUndoSeriesId = undefined;
  }

  /** Caret-only form, for edits with no selection to restore. */
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

  /** Marks the state the document is in as the saved one. */
  markSaved(): void {
    this.savedSerial = this.currentSerial;
    this.dirtyAfterClear = false;
  }

  /** Discards all history and the dirty checkpoint. */
  reset(): void {
    this.undoSteps = [];
    this.redoSteps = [];
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
   */
  clearKeepingDirty(): void {
    this.reset();
    this.dirtyAfterClear = true;
  }
}
