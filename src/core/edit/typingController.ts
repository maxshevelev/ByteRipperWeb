import { type DiffEdit, netDiffEdit } from "@/core/diff/diffEngine";
import type { BinaryDocument } from "@/core/document/binaryDocument";
import {
  caretAt,
  selection as makeSelection,
  type Selection,
} from "@/core/document/selectionModel";

/**
 * Typing into a dump.
 *
 * Ported from the editing half of upstream's `PaneViewModel`, and kept out of
 * the React component on purpose: it is a state machine with eight fields and
 * a dozen rules, every one of which is testable without a DOM.
 *
 * The rules it exists to hold:
 *
 * - **A byte is two nibbles and one undo step.** Typing `A` then `5` writes
 *   `0xA5` and undoes in one press, through an edit group.
 * - **A run of typing is one gesture.** Consecutive bytes share a series id, so
 *   a fast repeat of undo rolls the run back in one step while a deliberate one
 *   goes byte by byte. A pause longer than {@link SERIES_BREAK_MS}, a change of
 *   column, or a caret move starts a fresh series.
 * - **Typing into a selection consumes it**, byte by byte, and the shrinking
 *   remainder stays visible.
 * - **Insert mode never consumes a selection.** It drops it instead: a
 *   highlight left standing would name bytes that have since shifted right.
 *
 * **Every edit is asynchronous here, and that is the divergence.** Upstream's
 * document writes synchronously, so a keystroke is finished before the next one
 * arrives. A `Blob` read is a promise, so two fast keystrokes can overlap — and
 * a mid-byte nibble that read its "old" byte before the previous keystroke
 * finished writing would compose the wrong value. Every operation goes through
 * one queue, in the order the keys were pressed.
 */

/**
 * Which column the typing is going into.
 *
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#HexInputRegion
 */
export type InputRegion = "hex" | "text";

/**
 * How long a pause breaks a typing run, in milliseconds. Upstream's 0.7 s:
 * long enough that a slow typist's run stays one gesture, short enough that
 * coming back to the keyboard starts a new one.
 *
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.seriesBreakThreshold
 */
export const SERIES_BREAK_MS = 700;

export interface TypingControllerOptions {
  /**
   * For tests; defaults to the wall clock.
   *
   * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.clock
   */
  readonly now?: () => number;
  /** Announces what changed, so a comparison can update without re-scanning. */
  readonly onEdit?: (edit: DiffEdit) => void;
  /**
   * Asks the pane to bring an offset into view. Typing into a selection made
   * elsewhere writes at its start, which may be nowhere near what is on
   * screen — without this the first byte is typed blind.
   */
  readonly onReveal?: (offset: number) => void;
  /**
   * Asked once, before the first edit that shifts the file's offsets. Answering
   * no swallows the keystroke. Absent means no confirmation is wanted.
   *
   * May answer asynchronously, because a real dialog does. That is safe here
   * and nowhere else: every edit already goes through one queue, so the
   * keystrokes behind this one wait rather than racing past it.
   */
  readonly confirmInsertShift?: () => boolean | Promise<boolean>;
}

/**
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.hexEditor
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.hexEditorDeleteForward
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.hexEditorDeleteBackward
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.hexEditorSelectAll
 * @upstream-differs typing lives in the document's TypingController, which the pane drives
 */
export class TypingController {
  /**
   * Where to scroll when typing starts at an offset that may be off screen.
   *
   * Settable rather than constructor-injected because the controller belongs to
   * the document — it holds a half-typed nibble and an open undo group, neither
   * of which should survive a component remounting — while the scrolling
   * belongs to whichever pane is showing that document.
   */
  revealHandler: ((offset: number) => void) | undefined;

  private readonly doc: BinaryDocument;
  private readonly now: () => number;
  private readonly options: TypingControllerOptions;

  /** 0 means the next digit is the high nibble, 1 the low one. */
  private nibbleIndex: 0 | 1 = 0;
  private insertMode = false;
  private region: InputRegion = "hex";

  /** The selection being consumed by overwrite typing, while one is. */
  private consuming: Selection | undefined;

  private groupOpen = false;
  private seriesOpen = false;
  private seriesCounter = 0;
  private lastTypedAt = Number.NEGATIVE_INFINITY;
  private lastRegion: InputRegion | undefined;
  private warnedAboutShift = false;

  /** Edits run in the order the keys were pressed — see the class comment. */
  private queue: Promise<void> = Promise.resolve();

  constructor(doc: BinaryDocument, options: TypingControllerOptions = {}) {
    this.doc = doc;
    this.now = options.now ?? (() => Date.now());
    this.options = options;
  }

  // MARK: - Mode

  /**
   * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.isInsertMode
   * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.hexInsertMode
   */
  get isInsertMode(): boolean {
    return this.insertMode;
  }

  /** `INS` or `OVR`, as the pane's status shows it. */
  get modeLabel(): "INS" | "OVR" {
    return this.insertMode ? "INS" : "OVR";
  }

  /**
   * Which nibble the next hex digit fills — the caret's position inside a byte.
   *
   * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.nibble
   * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.hexCaretNibble
   */
  get nibble(): 0 | 1 {
    return this.nibbleIndex;
  }

  /**
   * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.inputRegion
   * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.hexInputRegion
   */
  get inputRegion(): InputRegion {
    return this.region;
  }

  setInsertMode(on: boolean): Promise<void> {
    if (this.insertMode === on) return Promise.resolve();
    this.insertMode = on;
    // A half-typed byte belongs to the mode it was started in.
    return this.breakRun();
  }

  /** @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.toggleInsertMode */
  toggleInsertMode(): Promise<void> {
    return this.setInsertMode(!this.insertMode);
  }

  /**
   * Moves the input to the other column. Breaks the run: the hex and text
   * columns are different gestures even when they land on the same byte.
   *
   * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.setInputRegion
   */
  setInputRegion(region: InputRegion): Promise<void> {
    if (this.region === region) return Promise.resolve();
    this.region = region;
    return this.breakRun();
  }

  /**
   * Ends the current run without flushing a half-typed byte's group — what a
   * caret move does. The next typed byte starts a fresh series.
   */
  breakRun(): Promise<void> {
    return this.run(async () => {
      await this.closeGroup();
      this.closeSeries();
      this.nibbleIndex = 0;
      this.consuming = undefined;
    });
  }

  /** Waits for every queued edit — for tests, and for saving. */
  settled(): Promise<void> {
    return this.queue;
  }

  // MARK: - Typing

  /**
   * One hex digit, 0–15.
   *
   * In overwrite mode the high nibble rewrites the byte's top half in place and
   * the low one its bottom half, then the caret advances. In insert mode the
   * *first* digit inserts a new byte with the high nibble set and the low one
   * empty — the tail shifts right — and the *second* fills that byte's low
   * nibble in place. Either way the pair is one undo step.
   *
   * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.typeHexNibble
   */
  typeHexDigit(digit: number): Promise<void> {
    if (!Number.isInteger(digit) || digit < 0 || digit > 15) return Promise.resolve();
    return this.run(async () => {
      if (!(await this.allowShift())) return;
      this.region = "hex";

      if (this.insertMode) {
        await (this.nibbleIndex === 0 ? this.insertHighNibble(digit) : this.fillLowNibble(digit));
        return;
      }

      if (this.nibbleIndex === 0) {
        this.prepareForTyping();
        this.ensureSeries("hex");
        const at = this.typingOffset();
        const old = (await this.byteAt(at)) ?? 0;
        await this.openGroup();
        await this.doc.overwrite(at, new Uint8Array([((digit << 4) | (old & 0x0f)) & 0xff]));
        this.nibbleIndex = 1;
        this.lastTypedAt = this.now();
        this.options.onEdit?.({ kind: "overwrite", start: at, end: at + 1 });
      } else {
        const at = this.typingOffset();
        const old = (await this.byteAt(at)) ?? 0;
        await this.doc.overwrite(at, new Uint8Array([((old & 0xf0) | digit) & 0xff]));
        this.nibbleIndex = 0;
        await this.closeGroup();
        this.advanceAfterByte();
        this.lastTypedAt = this.now();
        this.options.onEdit?.({ kind: "overwrite", start: at, end: at + 1 });
      }
    });
  }

  /**
   * One byte from the decoded-text column.
   *
   * The caller has already put the character through the decoding table, so
   * whatever arrives here is representable. A whole byte, so one undo step.
   *
   * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.typeASCII
   */
  typeByte(byte: number): Promise<void> {
    return this.run(async () => {
      if (!(await this.allowShift())) return;
      this.region = "text";
      await this.closeGroup();

      if (this.insertMode) {
        this.dropSelectionForInsert();
        this.ensureSeries("text");
        const at = this.typingOffset();
        await this.doc.insert(at, new Uint8Array([byte & 0xff]));
        this.nibbleIndex = 0;
        this.advanceAfterByte();
        this.lastTypedAt = this.now();
        this.options.onEdit?.({ kind: "insert", at, length: 1 });
        return;
      }

      this.prepareForTyping();
      this.ensureSeries("text");
      const at = this.typingOffset();
      await this.doc.overwrite(at, new Uint8Array([byte & 0xff]));
      this.nibbleIndex = 0;
      this.advanceAfterByte();
      this.lastTypedAt = this.now();
      this.options.onEdit?.({ kind: "overwrite", start: at, end: at + 1 });
    });
  }

  // MARK: - Undo and redo

  /**
   * Undo, through the same queue as typing.
   *
   * Through the queue because an undo racing a keystroke would apply to a
   * document the keystroke had not finished changing. And here rather than on
   * the document because *this* is where the comparison is told what moved: an
   * undo changes bytes exactly as an edit does, and a comparison that only
   * heard about the forward direction would drift the moment anyone pressed
   * Cmd+Z.
   *
   * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.undo
   */
  undo(batch = false): Promise<void> {
    return this.run(async () => {
      await this.closeGroup();
      this.closeSeries();
      this.nibbleIndex = 0;
      this.consuming = undefined;

      const applied = await this.doc.undo(batch);
      if (applied === undefined) return;
      const edit = netDiffEdit(applied);
      if (edit !== undefined) this.options.onEdit?.(edit);
    });
  }

  /** @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.redo */
  redo(): Promise<void> {
    return this.run(async () => {
      await this.closeGroup();
      this.closeSeries();
      this.nibbleIndex = 0;
      this.consuming = undefined;

      const applied = await this.doc.redo();
      if (applied === undefined) return;
      const edit = netDiffEdit(applied);
      if (edit !== undefined) this.options.onEdit?.(edit);
    });
  }

  // MARK: - Whole-range operations

  /**
   * Pastes bytes at the caret, or over the selection.
   *
   * In overwrite mode they replace what is there and the file keeps its length;
   * in insert mode they go in and the tail shifts. Either way it is one undo
   * step, because it was one gesture.
   *
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.paste
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.pasteWrite
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.pasteInsert
   * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.pasteWrite
   * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.pasteInsert
   */
  pasteBytes(bytes: Uint8Array): Promise<void> {
    if (bytes.length === 0) return Promise.resolve();
    return this.run(async () => {
      if (!(await this.allowShift())) return;
      await this.closeGroup();
      this.closeSeries();
      this.nibbleIndex = 0;
      this.consuming = undefined;

      const selection = this.doc.selection;
      const at = selection.start;

      if (this.insertMode) {
        // A selection in insert mode is replaced: pasting over a highlighted
        // span is what the highlight is for, and leaving it would be the only
        // operation in the app that ignored it.
        if (selection.end > selection.start) {
          this.doc.beginEditGroup();
          await this.doc.delete(selection.start, selection.end);
          await this.doc.insert(at, bytes);
          this.doc.endEditGroup();
        } else {
          await this.doc.insert(at, bytes);
        }
        this.options.onEdit?.({ kind: "insert", at, length: bytes.length });
      } else if (selection.end > selection.start) {
        await this.doc.replace(selection.start, selection.end, bytes);
        this.options.onEdit?.(
          bytes.length === selection.end - selection.start
            ? { kind: "overwrite", start: at, end: at + bytes.length }
            : { kind: "delete", start: at, end: selection.end }
        );
      } else {
        await this.doc.overwrite(at, bytes);
        this.options.onEdit?.({ kind: "overwrite", start: at, end: at + bytes.length });
      }

      this.doc.setSelection(caretAt(at + bytes.length, this.doc.size));
      this.doc.noteSelectionAfterEdit();
    });
  }

  /**
   * Fills the selection by repeating a pattern across it — the Fill dialog.
   *
   * The caret is left at the range's start rather than its end: a fill is an
   * act on a region, and coming back to the start is how you look at what you
   * just did.
   *
   * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.fillSelection
   */
  fillSelection(pattern: Uint8Array): Promise<void> {
    if (pattern.length === 0) return Promise.resolve();
    return this.run(async () => {
      await this.closeGroup();
      this.closeSeries();
      this.nibbleIndex = 0;
      this.consuming = undefined;

      const { start, end } = this.doc.selection;
      const range =
        end > start ? { start, end } : { start, end: Math.min(start + 1, this.doc.size) };
      if (range.end <= range.start) return;

      await this.doc.fill(pattern, range.start, range.end, range.start);
      this.doc.setSelection(makeSelection(range.start, range.end, this.doc.size));
      this.doc.noteSelectionAfterEdit();
      this.options.onEdit?.({ kind: "overwrite", start: range.start, end: range.end });
    });
  }

  /**
   * Removes the selection and shifts the tail left, whatever the mode.
   *
   * Distinct from Delete, which only removes bytes in insert mode: this is the
   * explicit command, so it does what it says and asks first.
   *
   * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.deleteBytes
   */
  deleteBytes(): Promise<void> {
    return this.run(async () => {
      const { start, end } = this.doc.selection;
      if (end <= start) return;
      if (!(await this.confirmShiftOnce())) return;

      await this.closeGroup();
      this.closeSeries();
      this.nibbleIndex = 0;
      this.consuming = undefined;

      await this.doc.delete(start, end);
      this.doc.setSelection(caretAt(start, this.doc.size));
      this.doc.noteSelectionAfterEdit();
      this.options.onEdit?.({ kind: "delete", start, end });
    });
  }

  // MARK: - Delete and backspace

  /**
   * Delete. In overwrite mode it fills the selection — or the byte at the caret
   * — with `0x00`, because a file has no gaps. In insert mode it removes those
   * bytes and shifts the tail left.
   *
   * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.deleteForward
   */
  deleteForward(): Promise<void> {
    return this.deleting(true);
  }

  /**
   * Backspace: the same, one byte earlier when there is no selection.
   *
   * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.deleteBackward
   */
  deleteBackward(): Promise<void> {
    return this.deleting(false);
  }

  private deleting(forward: boolean): Promise<void> {
    return this.run(async () => {
      if (!(await this.allowShift())) return;
      await this.closeGroup();
      this.closeSeries();

      const range = this.deletionRange(forward);
      if (range === undefined) return;

      if (this.insertMode) {
        await this.doc.delete(range.start, range.end);
        this.doc.setSelection(caretAt(range.start, this.doc.size));
        this.options.onEdit?.({ kind: "delete", start: range.start, end: range.end });
      } else {
        await this.doc.fillZero(range.start, range.end, range.start);
        this.doc.setSelection(caretAt(range.start, this.doc.size));
        this.options.onEdit?.({ kind: "overwrite", start: range.start, end: range.end });
      }
      this.doc.noteSelectionAfterEdit();
      this.nibbleIndex = 0;
      this.consuming = undefined;
    });
  }

  /** What Delete or Backspace acts on: the selection, or one byte. */
  private deletionRange(forward: boolean): { start: number; end: number } | undefined {
    const selection = this.doc.selection;
    if (selection.end > selection.start) return { start: selection.start, end: selection.end };

    const caret = selection.start;
    if (forward) {
      return caret < this.doc.size ? { start: caret, end: caret + 1 } : undefined;
    }
    return caret > 0 ? { start: caret - 1, end: caret } : undefined;
  }

  // MARK: - Internals

  /** One queue, so keystrokes land in the order they were pressed. */
  private run(operation: () => Promise<void>): Promise<void> {
    const next = this.queue.then(operation, operation);
    // A failed edit must not poison the queue for every keystroke after it.
    this.queue = next.catch(() => undefined);
    return next;
  }

  /**
   * The one-time warning before an edit that shifts every offset after it.
   * Answering no swallows the keystroke.
   */
  private async allowShift(): Promise<boolean> {
    if (!this.insertMode) return true;
    return await this.confirmShiftOnce();
  }

  /** The warning itself, for the commands that shift whatever the mode. */
  private async confirmShiftOnce(): Promise<boolean> {
    if (this.warnedAboutShift) return true;
    const confirm = this.options.confirmInsertShift;
    if (confirm === undefined) return true;
    if (!(await confirm())) return false;
    this.warnedAboutShift = true;
    return true;
  }

  /** High nibble in insert mode: a new byte, low half empty, tail shifted. */
  private async insertHighNibble(digit: number): Promise<void> {
    this.dropSelectionForInsert();
    this.ensureSeries("hex");
    const at = this.typingOffset();
    await this.openGroup();
    await this.doc.insert(at, new Uint8Array([(digit << 4) & 0xff]));
    // `insert` leaves the caret on the new byte, so the next digit fills it.
    this.nibbleIndex = 1;
    this.lastTypedAt = this.now();
    this.options.onEdit?.({ kind: "insert", at, length: 1 });
  }

  /** Low nibble in insert mode: an overwrite of the byte just inserted. */
  private async fillLowNibble(digit: number): Promise<void> {
    const at = this.typingOffset();
    const old = (await this.byteAt(at)) ?? 0;
    await this.doc.overwrite(at, new Uint8Array([((old & 0xf0) | digit) & 0xff]));
    this.nibbleIndex = 0;
    await this.closeGroup();
    this.advanceAfterByte();
    this.lastTypedAt = this.now();
    this.options.onEdit?.({ kind: "overwrite", start: at, end: at + 1 });
  }

  /**
   * Starts consuming a selection, if one is standing and typing has not already
   * begun to eat it.
   */
  private prepareForTyping(): void {
    if (this.consuming !== undefined) return;
    const selection = this.doc.selection;
    if (selection.end <= selection.start) return;

    this.consuming = selection;
    this.nibbleIndex = 0;
    (this.options.onReveal ?? this.revealHandler)?.(selection.start);
  }

  /**
   * Collapses a selection before an insert-mode byte lands.
   *
   * Insert mode does not consume a selection the way overwrite typing does, and
   * one left standing would go on highlighting a span whose bytes have since
   * shifted right — naming bytes the user never selected.
   */
  private dropSelectionForInsert(): void {
    this.consuming = undefined;
    const selection = this.doc.selection;
    if (selection.end <= selection.start) return;
    this.doc.setSelection(caretAt(selection.start, this.doc.size));
  }

  /** Where the next byte lands: the selection being eaten, or the caret. */
  private typingOffset(): number {
    return this.consuming?.start ?? this.doc.selection.start;
  }

  private async byteAt(offset: number): Promise<number | undefined> {
    if (offset >= this.doc.size) return undefined;
    return (await this.doc.read(offset, 1))[0];
  }

  private async openGroup(): Promise<void> {
    if (this.groupOpen) return;
    this.doc.beginEditGroup();
    this.groupOpen = true;
    await Promise.resolve();
  }

  private async closeGroup(): Promise<void> {
    if (!this.groupOpen) return;
    this.doc.endEditGroup();
    this.groupOpen = false;
    await Promise.resolve();
  }

  /**
   * Opens or continues the series the next byte belongs to. A pause, or a
   * change of column, starts a new one.
   */
  private ensureSeries(region: InputRegion): void {
    const now = this.now();
    if (
      !this.seriesOpen ||
      now - this.lastTypedAt > SERIES_BREAK_MS ||
      this.lastRegion !== region
    ) {
      this.doc.endSeries();
      this.seriesCounter++;
      this.doc.beginSeries(this.seriesCounter);
      this.seriesOpen = true;
    }
    this.lastRegion = region;
    this.lastTypedAt = now;
  }

  private closeSeries(): void {
    if (!this.seriesOpen) return;
    this.doc.endSeries();
    this.seriesOpen = false;
    this.lastRegion = undefined;
  }

  /** After a complete byte: through a consuming selection, or past the caret. */
  private advanceAfterByte(): void {
    const consuming = this.consuming;
    if (consuming !== undefined) {
      const next = consuming.start + 1;
      if (next < consuming.end) {
        this.consuming = makeSelection(next, consuming.end, this.doc.size);
        this.doc.setSelection(this.consuming);
      } else {
        this.consuming = undefined;
        this.doc.setSelection(caretAt(next, this.doc.size));
      }
    } else {
      this.doc.setSelection(caretAt(this.doc.selection.start + 1, this.doc.size));
    }
    this.doc.noteSelectionAfterEdit();
  }
}
