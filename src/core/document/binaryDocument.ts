import {
  caretAt,
  clampedSelection,
  type Selection,
  selectionIsEmpty,
} from "@/core/document/selectionModel";
import { invertOperation, UndoHistory, type UndoOperation } from "@/core/edit/undoHistory";
import type { Bytes, EditableByteStorage } from "@/core/storage/byteStorage";

/**
 * One open binary file: its editable storage, its undo history, and its
 * selection.
 *
 * Ported from `BinaryDocument.swift`, and deliberately narrower than it at this
 * milestone. Upstream's document also knows its URL, its read-only state, how
 * to save itself, how to join another file into itself and how to duplicate
 * itself. Every one of those needs something the domain half may not reach —
 * a file handle, a writable stream, a scratch copy — and they arrive with the
 * milestones that build those: saving in M4, joining in M7, duplicating with
 * the snapshot path in M4. What is here is what the plan asks for at M1: the
 * storage, the length, the edit operations, dirty state, and the events the UI
 * listens to.
 *
 * Every mutation applies to the storage and records an undo operation, and the
 * history's checkpoint drives dirty state — never a count of edits. Mutations
 * are permitted on a read-only file, because they live in the overlay and not
 * on disk; only saving to the original is refused, and that is M4's business.
 */

/** What changed, for the listeners that have to react to it. */
export interface DocumentContentChange {
  /** The operations applied, in the order they were applied. */
  readonly ops: readonly UndoOperation[];
  /** True when this came from an undo or a redo rather than a fresh edit. */
  readonly restoring: boolean;
}

type Unsubscribe = () => void;

export class BinaryDocument {
  readonly undoHistory = new UndoHistory();

  private storageValue: EditableByteStorage;
  private selectionValue: Selection;

  private groupDepth = 0;
  private pendingGroupOps: UndoOperation[] = [];
  /**
   * The selection the open edit group began with — undo of a coalesced typing
   * session returns to it.
   */
  private groupStartSelection: Selection | undefined;
  /** The name the open group's step will carry, if it has one. */
  private groupLabel: string | undefined;
  /**
   * True between recording a transaction and {@link noteSelectionAfterEdit}, so
   * a note cannot attach the selection to an older transaction.
   */
  private transactionAwaitingSelection = false;
  /**
   * The typing series currently open, stamped onto every transaction recorded
   * while it lasts, so a fast undo can roll the series back in one batch.
   */
  private currentSeriesId: number | undefined;

  private readonly contentListeners = new Set<(change: DocumentContentChange) => void>();
  private readonly selectionListeners = new Set<(selection: Selection) => void>();
  private readonly commitListeners = new Set<() => void>();

  constructor(storage: EditableByteStorage) {
    this.storageValue = storage;
    this.selectionValue = caretAt(0, storage.size);
  }

  // MARK: - Reading

  get storage(): EditableByteStorage {
    return this.storageValue;
  }

  get size(): number {
    return this.storageValue.size;
  }

  read(at: number, length: number): Promise<Bytes> {
    return this.storageValue.read(at, length);
  }

  /** The synchronous path, for a renderer inside a frame. */
  peek(at: number, length: number): Bytes | undefined {
    return this.storageValue.peek(at, length);
  }

  prefetch(at: number, length: number): Promise<void> {
    return this.storageValue.prefetch(at, length);
  }

  // MARK: - Events

  /**
   * Fires for every change to the bytes — a fresh edit, an undo, a redo — with
   * the operations that were applied. What the renderer invalidates from, and
   * from M3 what a comparison updates from instead of re-scanning.
   */
  onContentChanged(listener: (change: DocumentContentChange) => void): Unsubscribe {
    this.contentListeners.add(listener);
    return () => this.contentListeners.delete(listener);
  }

  onSelectionChanged(listener: (selection: Selection) => void): Unsubscribe {
    this.selectionListeners.add(listener);
    return () => this.selectionListeners.delete(listener);
  }

  /**
   * Fires exactly when a transaction is committed to the undo history — a
   * forward edit, or the close of a coalesced typing group. Not for undo or
   * redo, which restore rather than record, and not for a cancelled group.
   */
  onTransactionCommitted(listener: () => void): Unsubscribe {
    this.commitListeners.add(listener);
    return () => this.commitListeners.delete(listener);
  }

  // MARK: - Mutations, each recording an undo operation

  /** Overwrites `bytes` at `at`, extending past EOF when needed. */
  async overwrite(at: number, bytes: Uint8Array): Promise<void> {
    this.record(await this.applyOverwrite(at, bytes));
    this.clampSelection();
  }

  /** Inserts `bytes` at `at`, clamped to EOF, shifting what follows. */
  async insert(at: number, bytes: Uint8Array): Promise<void> {
    if (bytes.length === 0) return;
    const offset = Math.min(Math.max(at, 0), this.storageValue.size);
    await this.storageValue.insert(offset, bytes);
    this.record([{ kind: "insert", at: offset, bytes }]);
    this.clampSelection();
  }

  /** Removes `[start, end)`, shifting what follows. */
  async delete(start: number, end: number): Promise<void> {
    const from = Math.min(Math.max(start, 0), this.storageValue.size);
    const to = Math.min(Math.max(end, 0), this.storageValue.size);
    if (to <= from) return;

    const removed = await this.storageValue.read(from, to - from);
    await this.storageValue.delete(from, to);
    this.record([{ kind: "delete", at: from, bytes: removed }]);
    this.clampSelection();
  }

  /** Overwrites `[start, end)` with zero bytes — what Delete and Backspace do. */
  fillZero(start: number, end: number, caretAfter?: number): Promise<void> {
    return this.fill(new Uint8Array([0]), start, end, caretAfter);
  }

  /**
   * Overwrites `[start, end)` by repeating `pattern` to cover it.
   *
   * The final repetition is truncated when the length is not a multiple of the
   * pattern; a pattern longer than the range writes only its prefix. Recorded
   * as an overwrite, so undo restores the original bytes.
   *
   * `caretAfter` overrides what redo restores — a fill leaves the caret at the
   * range start, not at its end.
   */
  async fill(pattern: Uint8Array, start: number, end: number, caretAfter?: number): Promise<void> {
    if (pattern.length === 0) return;
    const from = Math.min(Math.max(start, 0), this.storageValue.size);
    const to = Math.min(Math.max(end, 0), this.storageValue.size);
    if (to <= from) return;

    const count = to - from;
    const before = await this.storageValue.read(from, count);
    const after = new Uint8Array(count);
    for (let i = 0; i < count; i++) after[i] = pattern[i % pattern.length] ?? 0;

    await this.storageValue.overwrite(from, after);
    this.record([{ kind: "overwrite", at: from, before, after }], caretAfter);
    this.clampSelection();
  }

  /**
   * Replaces `[start, end)` with `bytes`: writes from the range start, then
   * deletes the leftover tail when `bytes` is shorter. This is what "typed text
   * overwrites a selection" needs.
   */
  async replace(start: number, end: number, bytes: Uint8Array): Promise<void> {
    const ops = await this.applyOverwrite(start, bytes);
    const writtenEnd = start + bytes.length;
    const leftoverEnd = Math.min(end, this.storageValue.size);

    if (leftoverEnd > writtenEnd) {
      const removed = await this.storageValue.read(writtenEnd, leftoverEnd - writtenEnd);
      await this.storageValue.delete(writtenEnd, leftoverEnd);
      ops.push({ kind: "delete", at: writtenEnd, bytes: removed });
    }
    this.record(ops);
    this.clampSelection();
  }

  // MARK: - Undo and redo

  /**
   * Reverts the most recent undo step: applies the inverse of every operation
   * in the gesture — transactions in reverse recording order, each transaction's
   * operations in reverse — and restores the selection the gesture's first edit
   * started from.
   *
   * `batch` asks the history to take back the rest of the current typing series
   * as one step. Returns the operations that were applied, which is what a
   * comparison will need in M3 to update incrementally rather than re-scan, or
   * `undefined` when there was nothing to undo.
   */
  async undo(batch = false): Promise<UndoOperation[] | undefined> {
    const transactions = this.undoHistory.undo(batch);
    if (transactions === undefined) return undefined;

    const applied: UndoOperation[] = [];
    for (const transaction of [...transactions].reverse()) {
      applied.push(...[...transaction.ops].reverse().map(invertOperation));
    }
    for (const operation of applied) await this.applyForward(operation);

    const first = transactions[0];
    if (first !== undefined) {
      this.setSelectionInternal(clampedSelection(first.selectionBefore, this.storageValue.size));
    }
    this.transactionAwaitingSelection = false;
    this.emitContent({ ops: applied, restoring: true });
    return applied;
  }

  /**
   * Reapplies the next undone step in its original order — all of a batch's
   * transactions, in recording order — and restores the selection the gesture's
   * last edit left.
   */
  async redo(): Promise<UndoOperation[] | undefined> {
    const transactions = this.undoHistory.redo();
    if (transactions === undefined) return undefined;

    const applied: UndoOperation[] = [];
    for (const transaction of transactions) applied.push(...transaction.ops);
    for (const operation of applied) await this.applyForward(operation);

    const last = transactions[transactions.length - 1];
    if (last !== undefined) {
      this.setSelectionInternal(clampedSelection(last.selectionAfter, this.storageValue.size));
    }
    this.transactionAwaitingSelection = false;
    this.emitContent({ ops: applied, restoring: true });
    return applied;
  }

  /**
   * Records the selection as the state the last edit left behind, so redo
   * returns to it.
   *
   * Called by the editing command once it has placed the selection: the
   * document cannot know whether a command collapses the selection (a fill
   * does) or keeps consuming what is left of it (typing does). A no-op unless
   * an edit was recorded since the last call.
   */
  noteSelectionAfterEdit(): void {
    if (!this.transactionAwaitingSelection) return;
    this.transactionAwaitingSelection = false;
    this.undoHistory.noteSelectionAfterOnLast(this.selectionValue);
  }

  // MARK: - Dirty state

  get isDirty(): boolean {
    return this.undoHistory.isDirty;
  }

  get canUndo(): boolean {
    return this.undoHistory.canUndo;
  }

  get canRedo(): boolean {
    return this.undoHistory.canRedo;
  }

  /** Marks the current state as the saved one. Called by the save path (M4). */
  markSaved(): void {
    this.undoHistory.markSaved();
  }

  /**
   * Discards every in-memory edit and starts again over `storage`.
   *
   * Upstream's `revert()` reopens the file itself; here the reopening is the
   * platform's job and the reopened storage is handed in, which keeps the
   * document free of file handles and makes the whole thing testable.
   */
  revert(storage: EditableByteStorage): void {
    this.storageValue = storage;
    this.undoHistory.reset();
    this.currentSeriesId = undefined;
    this.transactionAwaitingSelection = false;
    this.groupDepth = 0;
    this.pendingGroupOps = [];
    this.groupStartSelection = undefined;
    this.groupLabel = undefined;
    this.setSelectionInternal(caretAt(0, storage.size));
    this.emitContent({ ops: [], restoring: true });
  }

  // MARK: - Edit grouping, so a typing session is one undo

  /**
   * Opens an edit group: everything recorded until the matching
   * {@link endEditGroup} becomes one undo step.
   *
   * `label` names that step for the menu — "Undo Add Microcode" — and is what
   * an edit made on the user's behalf by something with a name of its own
   * passes in. Ordinary editing leaves it out: typing has no name worth saying.
   */
  beginEditGroup(label?: string): void {
    if (this.groupDepth === 0) {
      this.groupStartSelection = this.selectionValue;
      this.groupLabel = label;
    }
    this.groupDepth++;
  }

  endEditGroup(): void {
    this.groupDepth--;
    if (this.groupDepth > 0 || this.pendingGroupOps.length === 0) {
      if (this.groupDepth <= 0) this.clearGroupState();
      return;
    }

    const ops = this.pendingGroupOps;
    this.undoHistory.record(ops, {
      selectionBefore: this.groupStartSelection ?? this.selectionValue,
      selectionAfter: caretAt(this.naturalCaretAfter(ops), this.storageValue.size),
      ...(this.currentSeriesId === undefined ? {} : { seriesId: this.currentSeriesId }),
      ...(this.groupLabel === undefined ? {} : { label: this.groupLabel }),
    });
    this.transactionAwaitingSelection = true;
    this.clearGroupState();
    for (const listener of this.commitListeners) listener();
  }

  /**
   * Cancels the open edit group: reverts the operations collected so far, in
   * reverse, and records no transaction at all.
   *
   * The selection returns to the one the group began with. This is how a
   * half-typed insert-mode byte is rolled back as if it never happened — the
   * byte disappears, the tail shifts back, and nothing is left on the undo
   * stack.
   */
  async cancelEditGroup(): Promise<void> {
    if (this.groupDepth === 0) return;
    const reverted = [...this.pendingGroupOps].reverse().map(invertOperation);
    for (const operation of reverted) await this.applyForward(operation);

    const restored = this.groupStartSelection ?? this.selectionValue;
    this.pendingGroupOps = [];
    this.groupDepth = 0;
    this.groupStartSelection = undefined;
    this.groupLabel = undefined;
    this.setSelectionInternal(clampedSelection(restored, this.storageValue.size));
    this.emitContent({ ops: reverted, restoring: true });
  }

  // MARK: - Typing series

  /**
   * Opens a typing series: transactions recorded until {@link endSeries} share
   * `id`, so a fast undo can roll the series back in one batch.
   */
  beginSeries(id: number): void {
    this.currentSeriesId = id;
  }

  /** Closes the series — a breaker fired, or the input simply ended. */
  endSeries(): void {
    this.currentSeriesId = undefined;
  }

  // MARK: - Selection

  get selection(): Selection {
    return this.selectionValue;
  }

  setSelection(selection: Selection): void {
    this.setSelectionInternal(clampedSelection(selection, this.storageValue.size));
  }

  /** Where the caret is: an empty selection's offset, or a selection's start. */
  get caret(): number {
    return this.selectionValue.start;
  }

  get hasSelection(): boolean {
    return !selectionIsEmpty(this.selectionValue);
  }

  // MARK: - Internals

  private clearGroupState(): void {
    this.pendingGroupOps = [];
    this.groupStartSelection = undefined;
    this.groupLabel = undefined;
  }

  /**
   * Records operations as one transaction, capturing the selection pair:
   * before is the current selection (mutations never move it before recording),
   * after is the override or the natural post-edit caret of the final
   * operation, until the command refines it.
   */
  private record(ops: UndoOperation[], caretAfter?: number): void {
    if (ops.length === 0) return;

    if (this.groupDepth > 0) {
      this.pendingGroupOps.push(...ops);
      this.emitContent({ ops, restoring: false });
      return;
    }

    this.undoHistory.record(ops, {
      selectionBefore: this.selectionValue,
      selectionAfter: caretAt(caretAfter ?? this.naturalCaretAfter(ops), this.storageValue.size),
      ...(this.currentSeriesId === undefined ? {} : { seriesId: this.currentSeriesId }),
    });
    this.transactionAwaitingSelection = true;
    this.emitContent({ ops, restoring: false });
    for (const listener of this.commitListeners) listener();
  }

  /**
   * Where the final operation of a transaction naturally leaves the caret: an
   * overwrite or fill at the end of its range, an insert past what it inserted,
   * a delete at the start of the hole it left.
   */
  private naturalCaretAfter(ops: readonly UndoOperation[]): number {
    const last = ops[ops.length - 1];
    if (last === undefined) return this.selectionValue.start;
    switch (last.kind) {
      case "overwrite":
        return last.at + last.after.length;
      case "insert":
        return last.at + last.bytes.length;
      case "delete":
        return last.at;
    }
  }

  private clampSelection(): void {
    this.setSelectionInternal(clampedSelection(this.selectionValue, this.storageValue.size));
  }

  private setSelectionInternal(selection: Selection): void {
    const previous = this.selectionValue;
    this.selectionValue = selection;
    if (
      previous.start === selection.start &&
      previous.end === selection.end &&
      previous.fileSize === selection.fileSize
    ) {
      return;
    }
    for (const listener of this.selectionListeners) listener(selection);
  }

  private emitContent(change: DocumentContentChange): void {
    for (const listener of this.contentListeners) listener(change);
  }

  /**
   * Applies an overwrite that may run past EOF, returning the operations it
   * took.
   *
   * Split into an overwrite of the existing bytes plus an insert of the new
   * tail, so that every stored operation is length-preserving and undoing
   * shrinks the file back to the size it had.
   */
  private async applyOverwrite(start: number, bytes: Uint8Array): Promise<UndoOperation[]> {
    if (bytes.length === 0) return [];
    const end = start + bytes.length;
    const existingEnd = Math.min(end, this.storageValue.size);
    const ops: UndoOperation[] = [];

    if (existingEnd > start) {
      const before = await this.storageValue.read(start, existingEnd - start);
      const after = bytes.slice(0, before.length);
      ops.push({ kind: "overwrite", at: start, before, after });
      await this.storageValue.overwrite(start, after);
    }
    if (end > existingEnd) {
      const tail = bytes.slice(existingEnd - start);
      ops.push({ kind: "insert", at: existingEnd, bytes: tail });
      await this.storageValue.append(tail);
    }
    return ops;
  }

  private async applyForward(operation: UndoOperation): Promise<void> {
    switch (operation.kind) {
      case "overwrite":
        await this.storageValue.overwrite(operation.at, operation.after);
        break;
      case "insert":
        await this.storageValue.insert(operation.at, operation.bytes);
        break;
      case "delete":
        await this.storageValue.delete(operation.at, operation.at + operation.bytes.length);
        break;
    }
  }
}
