import {
  caretAt,
  clampedSelection,
  type Selection,
  selectionIsEmpty,
} from "@/core/document/selectionModel";
import { invertOperation, UndoHistory, type UndoOperation } from "@/core/edit/undoHistory";
import type { ByteStorage, Bytes, EditableByteStorage } from "@/core/storage/byteStorage";

/**
 * Which end of the document a join puts its bytes at (§22).
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/BinaryDocument.swift#JoinPosition
 */
export type JoinPosition = "start" | "end";

/**
 * A file with no bytes in it has nothing to join, and saying so beats a no-op.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/BinaryDocument.swift#JoinError
 * @upstream-differs one error class for JoinError's one case, emptySource
 */
export class JoinEmpty extends Error {
  constructor() {
    super("That file has no bytes to join.");
    this.name = "JoinEmpty";
  }
}

/**
 * How much of the source goes in per insert.
 *
 * The same megabyte the save path streams in: a join of a 32 MB donor is 32
 * inserts through the piece table, not one array the size of the file.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/BinaryDocument.swift#BinaryDocument.joinChunkSize
 */
const JOIN_CHUNK_SIZE = 1024 * 1024;

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

/** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/BinaryDocument.swift#BinaryDocument */
export class BinaryDocument {
  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/BinaryDocument.swift#BinaryDocument.undoHistory */
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

  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/BinaryDocument.swift#BinaryDocument.init */
  constructor(storage: EditableByteStorage) {
    this.storageValue = storage;
    this.selectionValue = caretAt(0, storage.size);
  }

  // MARK: - Reading

  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/BinaryDocument.swift#BinaryDocument.storage */
  get storage(): EditableByteStorage {
    return this.storageValue;
  }

  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/BinaryDocument.swift#BinaryDocument.size */
  get size(): number {
    return this.storageValue.size;
  }

  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/BinaryDocument.swift#BinaryDocument.read */
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
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/BinaryDocument.swift#BinaryDocument.onTransactionCommitted
   * @upstream-differs a subscription, so more than one listener can hear a commit
   */
  onTransactionCommitted(listener: () => void): Unsubscribe {
    this.commitListeners.add(listener);
    return () => this.commitListeners.delete(listener);
  }

  // MARK: - Mutations, each recording an undo operation

  /**
   * Overwrites `bytes` at `at`, extending past EOF when needed.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/BinaryDocument.swift#BinaryDocument.overwrite
   */
  async overwrite(at: number, bytes: Uint8Array): Promise<void> {
    this.record(await this.applyOverwrite(at, bytes));
    this.clampSelection();
  }

  /**
   * Inserts `bytes` at `at`, clamped to EOF, shifting what follows.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/BinaryDocument.swift#BinaryDocument.insert
   */
  async insert(at: number, bytes: Uint8Array): Promise<void> {
    if (bytes.length === 0) return;
    const offset = Math.min(Math.max(at, 0), this.storageValue.size);
    await this.storageValue.insert(offset, bytes);
    this.record([{ kind: "insert", at: offset, bytes }]);
    this.clampSelection();
  }

  /**
   * Removes `[start, end)`, shifting what follows.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/BinaryDocument.swift#BinaryDocument.delete
   */
  async delete(start: number, end: number): Promise<void> {
    const from = Math.min(Math.max(start, 0), this.storageValue.size);
    const to = Math.min(Math.max(end, 0), this.storageValue.size);
    if (to <= from) return;

    const removed = await this.storageValue.read(from, to - from);
    await this.storageValue.delete(from, to);
    this.record([{ kind: "delete", at: from, bytes: removed }]);
    this.clampSelection();
  }

  /**
   * Overwrites `[start, end)` with zero bytes — what Delete and Backspace do.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/BinaryDocument.swift#BinaryDocument.fillZero
   */
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
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/BinaryDocument.swift#BinaryDocument.fill
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
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/BinaryDocument.swift#BinaryDocument.replace
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

  // MARK: - Joining another file in (§22)

  /**
   * Puts another stream of bytes at one end of this document.
   *
   * A *document-level act*, not an edit: it detaches the document from the file
   * it came from, which is the pane's business rather than this one's — but the
   * bytes go in as **one undoable insert**, so taking the join back is a single
   * press and the attachment can come back with it. The serial returned is what
   * lets the caller recognise that step later.
   *
   * The source's size is taken once, before anything is written. It has to be:
   * a document can be joined to *itself*, and then the source is this
   * document's own storage, growing with every chunk — a loop that reads until
   * it reaches the end never reaches it, and the document grows until the
   * browser stops it.
   *
   * The caret ends at the start of the added part, which is the seam, and that
   * is what redo restores; undo returns it to where it was before.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/BinaryDocument.swift#BinaryDocument.join
   */
  async join(
    source: ByteStorage,
    position: JoinPosition,
    options: { readonly chunkSize?: number } = {}
  ): Promise<number | undefined> {
    if (source.size === 0) throw new JoinEmpty();
    const chunkSize = options.chunkSize ?? JOIN_CHUNK_SIZE;

    const anchor = position === "start" ? 0 : this.storageValue.size;
    const sourceSize = source.size;
    // Inserting at the start moves the original bytes right by however much has
    // gone in, so a self-join reading its own byte `k` has to look for it at
    // `k + inserted`. Appending leaves the bytes before the anchor where they
    // are, and a source that is a different storage never moves at all.
    const readsShiftWithWrites = position === "start" && (source as unknown) === this.storageValue;

    this.beginEditGroup(position === "start" ? "Insert File" : "Append File");
    try {
      let at = anchor;
      let read = 0;
      while (read < sourceSize) {
        const from = readsShiftWithWrites ? read + (at - anchor) : read;
        const chunk = await source.read(from, Math.min(chunkSize, sourceSize - read));
        if (chunk.length === 0) break;
        await this.insert(at, chunk);
        at += chunk.length;
        read += chunk.length;
      }
      this.endEditGroup();
    } catch (error) {
      await this.cancelEditGroup();
      throw error;
    }

    this.setSelectionInternal(caretAt(anchor, this.storageValue.size));
    this.noteSelectionAfterEdit();
    return this.undoHistory.lastCommittedSerial;
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
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/BinaryDocument.swift#BinaryDocument.undo
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
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/BinaryDocument.swift#BinaryDocument.redo
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
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/BinaryDocument.swift#BinaryDocument.noteSelectionAfterEdit
   */
  noteSelectionAfterEdit(): void {
    if (!this.transactionAwaitingSelection) return;
    this.transactionAwaitingSelection = false;
    this.undoHistory.noteSelectionAfterOnLast(this.selectionValue);
  }

  // MARK: - Dirty state

  /**
   * True when the document holds anything the file on disk does not.
   *
   * The undo history answers for committed transactions. An open edit group is
   * the other half: a half-typed hex byte has already changed the bytes — it is
   * on screen, in red — but its transaction is not recorded until the second
   * nibble closes the group. Upstream reports that state as clean, which is the
   * one moment a close could throw away a visible edit without asking.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/BinaryDocument.swift#BinaryDocument.isDirty
   */
  get isDirty(): boolean {
    return this.undoHistory.isDirty || this.pendingGroupOps.length > 0;
  }

  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/BinaryDocument.swift#BinaryDocument.canUndo */
  get canUndo(): boolean {
    return this.undoHistory.canUndo;
  }

  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/BinaryDocument.swift#BinaryDocument.canRedo */
  get canRedo(): boolean {
    return this.undoHistory.canRedo;
  }

  /**
   * Marks the current state as the saved one. Called by the save path (M4).
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/BinaryDocument.swift#BinaryDocument.save
   * @upstream-differs the document only takes the saved checkpoint; the write itself is src/platform/files/fileSink.ts
   */
  markSaved(): void {
    this.undoHistory.markSaved();
  }

  /**
   * Discards every in-memory edit and starts again over `storage`.
   *
   * Upstream's `revert()` reopens the file itself; here the reopening is the
   * platform's job and the reopened storage is handed in, which keeps the
   * document free of file handles and makes the whole thing testable.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/BinaryDocument.swift#BinaryDocument.revert
   * @upstream-differs one revert onto a base the caller supplies: there is no URL for the document to reopen
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
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/BinaryDocument.swift#BinaryDocument.beginEditGroup
   */
  beginEditGroup(label?: string): void {
    if (this.groupDepth === 0) {
      this.groupStartSelection = this.selectionValue;
      this.groupLabel = label;
    }
    this.groupDepth++;
  }

  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/BinaryDocument.swift#BinaryDocument.endEditGroup */
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
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/BinaryDocument.swift#BinaryDocument.cancelEditGroup
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
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/BinaryDocument.swift#BinaryDocument.beginSeries
   */
  beginSeries(id: number): void {
    this.currentSeriesId = id;
  }

  /**
   * Closes the series — a breaker fired, or the input simply ended.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/BinaryDocument.swift#BinaryDocument.endSeries
   */
  endSeries(): void {
    this.currentSeriesId = undefined;
  }

  // MARK: - Selection

  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/BinaryDocument.swift#BinaryDocument.selection */
  get selection(): Selection {
    return this.selectionValue;
  }

  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/BinaryDocument.swift#BinaryDocument.setSelection */
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
    this.generation += 1;
    for (const listener of this.contentListeners) listener(change);
  }

  /**
   * How many times these bytes have changed — a number that means nothing on
   * its own and everything beside itself: something holding a verdict about
   * this document's content can ask whether the content could have moved since
   * it decided, and re-read only then.
   *
   * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.contentGeneration
   * @upstream-differs the document counts rather than the pane around it, so a
   * part and a file are asked the same way and a remounted pane changes nothing
   */
  get contentGeneration(): number {
    return this.generation;
  }

  private generation = 0;

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
