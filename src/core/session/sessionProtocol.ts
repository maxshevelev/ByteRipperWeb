import type { JoinPosition } from "@/core/document/binaryDocument";
import type { Selection } from "@/core/document/selectionModel";
import type { UndoOperation } from "@/core/edit/undoHistory";
import type { PartitionData } from "@/core/session/sessionCuts";
import type { Bytes } from "@/core/storage/byteStorage";

/**
 * The words a window and the session host say to each other (`Design/FILE_SESSIONS.md`).
 *
 * A file session — the file, its changes, their history — lives in the host; a window shows it
 * through a `SessionView`. Everything here is plain data, what a `MessagePort` clones: no class
 * instance, no function, no `UndoBytes` — an operation crosses as the stretch it touched, which is
 * all a window does with one (repaint it, move a comparison past it, tell a tool).
 *
 * @web-only upstream has one process, and its windows hold the document itself
 */
export type SessionId = string;

/**
 * What a window may read about a session without asking: every value the page used to read off a
 * `BinaryDocument` synchronously, kept current by the host.
 *
 * @web-only see {@link SessionId}
 */
export interface SessionState {
  readonly size: number;
  readonly dirty: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly undoLabel?: string | undefined;
  readonly redoLabel?: string | undefined;
  readonly selection: Selection;
  readonly contentGeneration: number;
  readonly lastCommittedSerial?: number | undefined;
  /** The serial the history stands on below its oldest step — what a dropped step leaves. */
  readonly baseSerial: number;
  /** Where the history stands — what a kept snapshot is compared with. */
  readonly historyVersion: { readonly epoch: number; readonly serial: number };
  /** The partition the session's cuts make, and how many times it has changed. */
  readonly cuts: { readonly version: number; readonly partition: PartitionData };
}

/**
 * The stretch one operation touched: an overwrite's bytes, or where an insert or a delete moved
 * the tail from.
 *
 * @web-only see {@link SessionId}
 */
export interface OperationSpan {
  readonly kind: UndoOperation["kind"];
  readonly at: number;
  readonly count: number;
  /**
   * What an overwrite or an insert left at `at`, when the host sent it: the window lays it over
   * what it has read. Absent for a delete, and for an edit too large to send.
   */
  readonly bytes?: Bytes | undefined;
}

/** The stretch an operation touched, or the stretch itself. @web-only see {@link OperationSpan} */
export function spanOf(applied: UndoOperation | OperationSpan): OperationSpan {
  return "count" in applied ? applied : operationSpan(applied);
}

/** @web-only see {@link OperationSpan} */
export function operationSpan(operation: UndoOperation): OperationSpan {
  return operation.kind === "overwrite"
    ? { kind: "overwrite", at: operation.at, count: operation.after.count }
    : { kind: operation.kind, at: operation.at, count: operation.bytes.count };
}

/**
 * Where a join's bytes come from: another session, or bytes the host resolves by a reference the
 * platform gave it (a `File`, a path) — the core does not name either.
 *
 * @web-only see {@link SessionId}
 */
export type JoinSource =
  | { readonly kind: "session"; readonly session: SessionId }
  | { readonly kind: "external"; readonly reference: unknown };

/**
 * One thing a window asks of a session. The host applies a session's requests one at a time, in
 * the order they arrive, so a window that sends a group's opening, an edit and the group's close
 * gets them applied in that order whatever it awaits.
 *
 * @web-only see {@link SessionId}
 */
export type SessionRequest =
  | { readonly kind: "state" }
  | { readonly kind: "read"; readonly at: number; readonly length: number }
  | { readonly kind: "overwrite"; readonly at: number; readonly bytes: Bytes }
  | { readonly kind: "insert"; readonly at: number; readonly bytes: Bytes }
  | { readonly kind: "delete"; readonly start: number; readonly end: number }
  | {
      readonly kind: "fill";
      readonly pattern: Bytes;
      readonly start: number;
      readonly end: number;
      readonly caretAfter?: number | undefined;
    }
  | {
      readonly kind: "replace";
      readonly start: number;
      readonly end: number;
      readonly bytes: Bytes;
    }
  | { readonly kind: "join"; readonly source: JoinSource; readonly position: JoinPosition }
  | { readonly kind: "undo"; readonly batch: boolean }
  | { readonly kind: "redo" }
  | { readonly kind: "beginEditGroup"; readonly label?: string | undefined }
  | { readonly kind: "endEditGroup" }
  | { readonly kind: "cancelEditGroup" }
  | { readonly kind: "beginSeries"; readonly id: number }
  | { readonly kind: "endSeries" }
  | { readonly kind: "setSelection"; readonly selection: Selection }
  | { readonly kind: "noteSelectionAfterEdit" }
  | { readonly kind: "markSaved" }
  | { readonly kind: "clearKeepingDirty" }
  /** A cut, a merge, a rename: the partition it leaves, an undoable step of its own. */
  | { readonly kind: "applyCuts"; readonly partition: PartitionData }
  /** The content was replaced wholesale: one piece over it, and no act left to take back. */
  | { readonly kind: "resetCuts" }
  /** Everything until `endActs` is one act — a join, which inserts bytes and cuts the seam. */
  | { readonly kind: "beginActs" }
  | { readonly kind: "endActs" }
  /**
   * Something the platform around the host does to a session in its turn — a save written, a kept
   * history put back — by the name it was defined under, with plain data both ways.
   */
  | { readonly kind: "operate"; readonly name: string; readonly args: unknown };

/**
 * What a request gives back beyond the state: the bytes read, the stretches an undo or a redo
 * applied (nothing when there was nothing to take back), the serial of a join's step.
 *
 * @web-only see {@link SessionId}
 */
export type SessionResult =
  | { readonly kind: "none" }
  | { readonly kind: "bytes"; readonly bytes: Bytes; readonly generation: number }
  | { readonly kind: "applied"; readonly spans?: readonly OperationSpan[] | undefined }
  | { readonly kind: "serial"; readonly serial?: number | undefined }
  | { readonly kind: "changed"; readonly changed: boolean }
  | { readonly kind: "value"; readonly value: unknown };

/**
 * A request that failed, as it crosses: its error's name and message, so the window throws what
 * the document threw (`JoinEmpty` comes back as a `JoinEmpty`).
 *
 * @web-only see {@link SessionId}
 */
export interface SessionFailure {
  readonly name: string;
  readonly message: string;
}

/**
 * What happened to a session, told to every window that shows it — the one that asked included,
 * and before its answer, so a listener has heard of an edit by the time the edit's promise
 * settles, as with a document in the page.
 *
 * @web-only see {@link SessionId}
 */
export type SessionEvent =
  | {
      readonly kind: "content";
      readonly spans: readonly OperationSpan[];
      readonly restoring: boolean;
    }
  | { readonly kind: "selection" }
  | { readonly kind: "committed" }
  /** The state changed without an edit: the history put back or emptied, the file saved. */
  | { readonly kind: "state" }
  /** The session is over — or never began, its bytes unreadable, which `reason` says. */
  | { readonly kind: "closed"; readonly reason?: string | undefined };

/** @web-only see {@link SessionId} */
export type ViewMessage =
  | {
      readonly kind: "request";
      readonly seq: number;
      readonly session: SessionId;
      readonly request: SessionRequest;
    }
  | { readonly kind: "show"; readonly session: SessionId }
  | { readonly kind: "hide"; readonly session: SessionId }
  /**
   * Opens a session under the id the window chose, from bytes the platform names — a `File`, or
   * nothing — and shows it to that window. Everything the window sends after it comes after it.
   */
  | { readonly kind: "open"; readonly session: SessionId; readonly source: unknown }
  /** Something the host does on no one session's account — the workspace's kept content. */
  | {
      readonly kind: "operate";
      readonly seq: number;
      readonly name: string;
      readonly args: unknown;
    };

/**
 * The host's side. Every message about a session carries its state as it stands after the
 * message's cause, so a window's mirror is never older than the last word it heard; `acked` is the
 * last of this window's requests the host has applied, which is what lets a window keep its own
 * selection until the host has seen it.
 *
 * @web-only see {@link SessionId}
 */
export type HostMessage =
  | {
      readonly kind: "answer";
      readonly seq: number;
      readonly session: SessionId;
      readonly state?: SessionState | undefined;
      readonly result?: SessionResult | undefined;
      readonly failure?: SessionFailure | undefined;
    }
  | {
      readonly kind: "event";
      readonly session: SessionId;
      readonly event: SessionEvent;
      readonly state: SessionState;
      readonly acked: number;
    };

/**
 * One end of a window's line to the host — a `MessagePort` in a page, a pair of queues in a test.
 * The core names neither.
 *
 * @web-only see {@link SessionId}
 */
export interface SessionLine<Out, In> {
  post(message: Out, transfer?: readonly unknown[]): void;
  listen(receive: (message: In) => void): void;
  close(): void;
}
