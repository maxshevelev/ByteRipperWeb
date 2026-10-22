import type { Selection } from "@/core/document/selectionModel";
import type { UndoOperation } from "@/core/edit/undoHistory";
import type { OperationSpan } from "@/core/session/sessionProtocol";
import type { ByteStorage, Bytes } from "@/core/storage/byteStorage";

/**
 * What edits a document: a `BinaryDocument` itself, or a window's `SessionView` of one in the
 * session host (`Design/FILE_SESSIONS.md`). The typing controller and the segment replacer drive
 * either, so the same code edits a document in the host and in a test.
 *
 * An undo answers what it applied — the operations themselves, or the stretches they touched,
 * which is all an editor does with them ({@link spanOf}).
 *
 * @web-only upstream's editors hold the `BinaryDocument`; here they may hold a view of one
 */
export interface EditableDocument {
  readonly size: number;
  readonly selection: Selection;
  readonly storage: ByteStorage;
  read(at: number, length: number): Promise<Bytes>;
  overwrite(at: number, bytes: Uint8Array): Promise<void>;
  insert(at: number, bytes: Uint8Array): Promise<void>;
  delete(start: number, end: number): Promise<void>;
  fill(pattern: Uint8Array, start: number, end: number, caretAfter?: number): Promise<void>;
  fillZero(start: number, end: number, caretAfter?: number): Promise<void>;
  replace(start: number, end: number, bytes: Uint8Array): Promise<void>;
  undo(batch?: boolean): Promise<readonly (UndoOperation | OperationSpan)[] | undefined>;
  redo(): Promise<readonly (UndoOperation | OperationSpan)[] | undefined>;
  beginEditGroup(label?: string): void;
  /** Done when the step is in the history, which a view of a document in the host awaits. */
  endEditGroup(): void | Promise<void>;
  cancelEditGroup(): Promise<void>;
  beginSeries(id: number): void;
  endSeries(): void;
  setSelection(selection: Selection): void;
  noteSelectionAfterEdit(): void;
}
