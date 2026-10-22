import type { BinaryDocument } from "@/core/document/binaryDocument";
import type { UndoOperation } from "@/core/edit/undoHistory";
import type { Segmentation } from "@/core/segments/segmentation";
import type { CutHistory } from "@/core/session/sessionCuts";

/**
 * Which of a session's two histories a press of Undo takes back (`Design/FILE_SESSIONS.md`).
 *
 * A session has two kinds of undoable act: edits to its bytes, kept by the document's own history,
 * and changes to its partition — a cut, a merge, a rename — kept by its cut history. They cannot be
 * one history: the document's dirty state is a function of its history, and a cut changes no byte
 * and must not make a file look unsaved. So there are two, and this keeps the *order* the acts
 * happened in and asks each history to do its own work. It is the session's, so a press in any
 * window that shows the session takes back the last act whichever window did it.
 *
 * **Some acts are both.** A join inserts bytes *and* cuts the seam, and it is one thing the person
 * did, so it is one press to take back: a group folds everything recorded inside it into one act.
 *
 * **The order can drift, and it is made to correct itself.** A fast repeat of undo takes back a
 * whole typing series as one batch, one press for several recorded transactions — after which this
 * holds document acts the document no longer has. So an act whose history has nothing left to undo
 * is dropped and the next one tried.
 *
 * **The partition comes back by snapshot, not by inverse edit.** An edit moves the cuts, and so does
 * its undo — but a delete that swallowed a cut cannot give it back. So each act remembers the
 * partition it left, taken the moment it is undone, and a redo ends on exactly that; a group
 * remembers the one it started from, and an undo of it ends there.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.undo
 * @upstream-differs upstream's window routes between the pane's two histories; here the session
 * does, so every window showing it routes alike
 */
export class SessionActs {
  private readonly document: BinaryDocument;
  private readonly cuts: CutHistory;
  private past: Act[] = [];
  private future: Act[] = [];
  /** The acts recorded inside an open group, and how deep the opening goes. */
  private grouping: { parts: Act[]; before: Segmentation; depth: number } | undefined;

  constructor(document: BinaryDocument, cuts: CutHistory) {
    this.document = document;
    this.cuts = cuts;
  }

  /** A transaction was committed to the document's history. */
  noteDocument(): void {
    this.push({ kind: "document" });
  }

  /** The partition changed as an undoable step of its own. */
  noteCuts(): void {
    this.push({ kind: "segments" });
  }

  /**
   * Opens a group: everything recorded until the matching {@link endGroup} is one act. An opening
   * inside an open group joins it rather than nesting — one press has one meaning.
   */
  beginGroup(): void {
    if (this.grouping !== undefined) {
      this.grouping.depth++;
      return;
    }
    this.grouping = { parts: [], before: this.cuts.partition, depth: 1 };
  }

  endGroup(): void {
    const grouping = this.grouping;
    if (grouping === undefined) return;
    grouping.depth--;
    if (grouping.depth > 0) return;
    this.grouping = undefined;
    const [only] = grouping.parts;
    if (grouping.parts.length === 1 && only !== undefined) this.push(only);
    else if (grouping.parts.length > 1) {
      this.push({ kind: "group", parts: grouping.parts, before: grouping.before });
    }
  }

  /** Forgets every act: the content was replaced wholesale. */
  forget(): void {
    this.past = [];
    this.future = [];
    this.grouping = undefined;
  }

  get canUndo(): boolean {
    return this.past.some((act) => this.canUndoAct(act)) || this.document.canUndo;
  }

  get canRedo(): boolean {
    return this.future.some((act) => this.canRedoAct(act)) || this.document.canRedo;
  }

  /**
   * What the next undo is called: a tool's transaction names itself, a cut carries no name.
   *
   * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.undoLabel
   */
  get undoLabel(): string | undefined {
    const act = newest(this.past, (one) => this.canUndoAct(one));
    if (act?.kind === "segments") return undefined;
    return this.document.undoHistory.undoLabel;
  }

  /** @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.redoLabel */
  get redoLabel(): string | undefined {
    const act = newest(this.future, (one) => this.canRedoAct(one));
    if (act?.kind === "segments") return undefined;
    return this.document.undoHistory.redoLabel;
  }

  /**
   * Takes back the last act, whichever history it belongs to: the document's operations it
   * applied, or nothing when there was nothing to take back.
   */
  async undo(batch: boolean): Promise<UndoOperation[] | undefined> {
    for (let index = this.past.length - 1; index >= 0; index--) {
      const act = this.past[index];
      if (act === undefined) continue;
      this.past.splice(index, 1);
      if (!this.canUndoAct(act)) continue;
      this.future.push(act);
      // Every later act is already undone, so this is exactly what the act left.
      act.after = this.cuts.partition;
      const applied: UndoOperation[] = [];
      await this.undoAct(act, batch, applied);
      if (act.kind === "group" && act.before !== undefined) this.cuts.restore(act.before);
      return applied;
    }
    // Nothing recorded, which is the state after a restore or past the limit: the document still
    // knows its own history.
    if (!this.document.canUndo) return undefined;
    return (await this.document.undo(batch)) ?? [];
  }

  /** Puts back the last act an undo took out. */
  async redo(): Promise<UndoOperation[] | undefined> {
    for (let index = this.future.length - 1; index >= 0; index--) {
      const act = this.future[index];
      if (act === undefined) continue;
      this.future.splice(index, 1);
      if (!this.canRedoAct(act)) continue;
      this.past.push(act);
      const applied: UndoOperation[] = [];
      await this.redoAct(act, applied);
      if (act.after !== undefined) this.cuts.restore(act.after);
      return applied;
    }
    if (!this.document.canRedo) return undefined;
    return (await this.document.redo()) ?? [];
  }

  /**
   * The acts, the oldest first, and those undone, in the order a redo takes them back — what a
   * workspace writes down so a press of Undo after a relaunch takes back what it did before it.
   *
   * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.segmentUndoStack
   * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.segmentRedoStack
   * @upstream-differs the snapshots are on the acts rather than paired with the document's steps
   */
  get recorded(): {
    readonly past: readonly RecordedAct[];
    readonly future: readonly RecordedAct[];
  } {
    return { past: this.past.map(recordedAct), future: this.future.map(recordedAct) };
  }

  /** @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.restoreSegmentSnapshots */
  restore(past: readonly RecordedAct[], future: readonly RecordedAct[]): void {
    this.past = past.map(actOf);
    this.future = future.map(actOf);
  }

  private push(act: Act): void {
    if (this.grouping !== undefined) {
      this.grouping.parts.push(act);
      return;
    }
    this.past.push(act);
    if (this.past.length > LIMIT) this.past.shift();
    // A new act is a new future: what was undone is no longer reachable.
    this.future = [];
  }

  private canUndoAct(act: Act): boolean {
    if (act.kind === "group") return act.parts.some((part) => this.canUndoAct(part));
    return act.kind === "segments" ? this.cuts.canUndo : this.document.canUndo;
  }

  private canRedoAct(act: Act): boolean {
    if (act.kind === "group") return act.parts.some((part) => this.canRedoAct(part));
    return act.kind === "segments" ? this.cuts.canRedo : this.document.canRedo;
  }

  private async undoAct(act: Act, batch: boolean, applied: UndoOperation[]): Promise<void> {
    if (act.kind === "group") {
      // In reverse: the seam cut was made after the bytes went in, so it comes out first — and
      // the cut's offsets only mean anything while they are in.
      for (const part of [...act.parts].reverse()) await this.undoAct(part, false, applied);
      return;
    }
    if (act.kind === "segments") {
      this.cuts.undo();
      return;
    }
    applied.push(...((await this.document.undo(batch)) ?? []));
  }

  private async redoAct(act: Act, applied: UndoOperation[]): Promise<void> {
    if (act.kind === "group") {
      for (const part of act.parts) await this.redoAct(part, applied);
      return;
    }
    if (act.kind === "segments") {
      this.cuts.redo();
      return;
    }
    applied.push(...((await this.document.redo()) ?? []));
  }
}

/** How far back the order is kept. Beyond it the two histories answer for themselves. */
const LIMIT = 256;

/** @upstream-differs upstream's segmentUndoStack and segmentRedoStack become a partition on each act */
type Act =
  | { readonly kind: "document" | "segments"; after?: Segmentation | undefined }
  | {
      readonly kind: "group";
      readonly parts: readonly Act[];
      /** The partition from before the group's first part. */
      readonly before: Segmentation | undefined;
      after?: Segmentation | undefined;
    };

/**
 * An act as it is written down and put back.
 *
 * @web-only see {@link SessionActs}
 */
export type RecordedAct =
  | { readonly kind: "document" | "segments"; readonly after?: Segmentation | undefined }
  | {
      readonly kind: "group";
      readonly parts: readonly RecordedAct[];
      readonly before: Segmentation | undefined;
      readonly after?: Segmentation | undefined;
    };

function recordedAct(act: Act): RecordedAct {
  return act.kind === "group"
    ? { kind: "group", parts: act.parts.map(recordedAct), before: act.before, after: act.after }
    : { kind: act.kind, after: act.after };
}

function actOf(recorded: RecordedAct): Act {
  return recorded.kind === "group"
    ? {
        kind: "group",
        parts: recorded.parts.map(actOf),
        before: recorded.before,
        after: recorded.after,
      }
    : { kind: recorded.kind, after: recorded.after };
}

function newest(acts: readonly Act[], usable: (act: Act) => boolean): Act | undefined {
  for (let index = acts.length - 1; index >= 0; index--) {
    const act = acts[index];
    if (act !== undefined && usable(act)) return act;
  }
  return undefined;
}
