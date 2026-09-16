import type { DiffEdit } from "@/core/diff/diffEngine";
import type { UndoOperation } from "@/core/edit/undoHistory";

/**
 * Why what a session read is no longer what the file holds.
 *
 * A tool's claim is that what it shows is what is in the file. An edit makes
 * that claim false, and *how* it is false depends on what happened: an
 * overwrite leaves every offset where it was and only the bytes underneath are
 * new, while an insert or a delete moves everything after it — so a session
 * told "these bytes are not yours any more" can drop what the change reached
 * and keep the rest, where a session told nothing has to read the file again
 * and loses everything the user had opened.
 *
 * What crosses this seam is therefore the damage, never the content.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolSession.swift#ToolContentChange
 */
export type ToolContentChange =
  | {
      readonly kind: "edited";
      /**
       * Half-open `[start, end)`, the application's convention throughout: what
       * the edit covered, as the file stands after it. For a deletion this is
       * empty — the two bytes that were removed are no longer anywhere.
       */
      readonly start: number;
      readonly end: number;
      /**
       * How the file's length moved. Zero for an overwrite, which is nearly all
       * editing here; non-zero for an insert or a delete, which moves every
       * offset after the range and so invalidates a map wholesale rather than
       * in part.
       */
      readonly sizeDelta: number;
    }
  | { readonly kind: "reloaded" };

/**
 * This change and `next` as one, for a host that holds a change back briefly
 * rather than waking a read per keystroke.
 *
 * A reload swallows everything: once the content has been replaced there is
 * nothing left to be precise about. Two edits become the stretch from the
 * earlier start to the later end, with the length changes added up —
 * deliberately generous, because after a length change the second edit's
 * offsets are already measured in a file the first one moved, and the number a
 * session can act on is where the damage *starts*.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolSession.swift#ToolContentChange.merged
 */
export function mergedWith(
  earlier: ToolContentChange,
  later: ToolContentChange
): ToolContentChange {
  if (earlier.kind !== "edited" || later.kind !== "edited") return { kind: "reloaded" };
  return {
    kind: "edited",
    start: Math.min(earlier.start, later.start),
    end: Math.max(earlier.end, later.end),
    sizeDelta: earlier.sizeDelta + later.sizeDelta,
  };
}

/**
 * Where the content stopped being what the session last read, or nothing for a
 * reload, which invalidates all of it.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolSession.swift#ToolContentChange.earliestAffectedOffset
 */
export function earliestAffectedOffset(change: ToolContentChange): number | undefined {
  return change.kind === "edited" ? change.start : undefined;
}

/**
 * One edit of the comparison's kind, as the change a session hears.
 *
 * The comparison's `DiffEdit` and this change say the same three things in the
 * same words — what was covered, and whether the offsets after it moved — so
 * the mapping is the shape of the two types and nothing else.
 *
 * @upstream ByteRipperApp/Tools/ToolController.swift#ToolController.paneEdited
 * @upstream-differs an edit the document made, rather than a `DiffEdit` the shell was told about: the port's document reports whole transactions, and this is where one becomes a change
 */
export function changeOfEdit(edit: DiffEdit): ToolContentChange {
  switch (edit.kind) {
    case "overwrite":
      return { kind: "edited", start: edit.start, end: edit.end, sizeDelta: 0 };
    case "insert":
      return { kind: "edited", start: edit.at, end: edit.at + edit.length, sizeDelta: edit.length };
    case "delete":
      // An empty range at the point the bytes left from: a deletion's damage is
      // the shift, not the bytes, which are nowhere to be found any more.
      return {
        kind: "edited",
        start: edit.start,
        end: edit.start,
        sizeDelta: -(edit.end - edit.start),
      };
  }
}

/**
 * A whole transaction's operations, as the one change they are.
 *
 * A transaction is one gesture — a typing series, a checksum repair that writes
 * six places, a file appended in chunks — and the session hears it once. Where
 * the operations are scattered the merged change is the stretch between the
 * outermost of them, which is what the merge rules already say two edits are.
 *
 * @upstream ByteRipperApp/Tools/ToolController.swift#ToolController.paneEdited
 */
export function changeOfOperations(
  operations: readonly UndoOperation[]
): ToolContentChange | undefined {
  let change: ToolContentChange | undefined;
  for (const operation of operations) {
    const one = changeOfEdit(operationAsEdit(operation));
    change = change === undefined ? one : mergedWith(change, one);
  }
  return change;
}

/** An undo operation read as an edit of the same kind, for the mapping above. */
function operationAsEdit(operation: UndoOperation): DiffEdit {
  switch (operation.kind) {
    case "overwrite":
      return {
        kind: "overwrite",
        start: operation.at,
        end: operation.at + operation.before.length,
      };
    case "insert":
      return { kind: "insert", at: operation.at, length: operation.bytes.length };
    case "delete":
      return { kind: "delete", start: operation.at, end: operation.at + operation.bytes.length };
  }
}
