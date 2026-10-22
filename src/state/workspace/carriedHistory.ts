import type { Selection } from "@/core/document/selectionModel";
import { historySides } from "@/core/edit/historyLog";
import type {
  KeptTransaction,
  UndoHistory,
  UndoOperation,
  UndoTransaction,
} from "@/core/edit/undoHistory";
import { UndoBytes } from "@/core/edit/undoJournal";

/**
 * A document's undo history as it crosses to another window with its pane
 * (`Design/DESKTOP_WINDOWS.md`, D5): every transaction it holds, with its bytes, and how they
 * stand — what can be undone and what redone. Plain data, so a `BroadcastChannel` carries it: the
 * bytes that lay in the history's journal are read out of it on the way.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.adoptPane
 * @upstream-differs upstream hands the pane, document and history included, to the other window;
 * two pages share no objects, so the history is written out and put back
 */
export interface CarriedHistory {
  readonly head: number;
  readonly nextSerial: number;
  readonly savedState: number;
  readonly dirtyRegardless: boolean;
  readonly undoBase: number;
  readonly redoTip?: number | undefined;
  readonly redoSteps: readonly number[];
  readonly records: readonly CarriedRecord[];
}

interface CarriedRecord {
  readonly serial: number;
  readonly parent: number;
  readonly selectionBefore: Selection;
  readonly selectionAfter: Selection;
  readonly seriesId?: number | undefined;
  readonly label?: string | undefined;
  readonly ops: readonly CarriedOp[];
}

/** Bytes as they are, or a fill's pattern and how far it is repeated. */
type CarriedBytes =
  | { readonly bytes: Uint8Array }
  | { readonly pattern: Uint8Array; readonly count: number };

type CarriedOp =
  | {
      readonly kind: "overwrite";
      readonly at: number;
      readonly before: CarriedBytes;
      readonly after: CarriedBytes;
    }
  | { readonly kind: "insert" | "delete"; readonly at: number; readonly bytes: CarriedBytes };

async function carriedBytes(bytes: UndoBytes): Promise<CarriedBytes> {
  const pattern = bytes.patternForm;
  return pattern !== undefined
    ? { pattern: pattern.pattern, count: pattern.count }
    : { bytes: await bytes.load() };
}

const undoBytes = (carried: CarriedBytes): UndoBytes =>
  "pattern" in carried
    ? UndoBytes.pattern(carried.pattern, carried.count)
    : UndoBytes.of(carried.bytes);

/** The history written out, its bytes read; nothing for a history that holds no step. */
export async function carryHistory(history: UndoHistory): Promise<CarriedHistory | undefined> {
  if (!history.canUndo && !history.canRedo) return undefined;
  const records: CarriedRecord[] = [];
  for (const kept of history.heldTransactions) {
    const { transaction } = kept;
    const ops: CarriedOp[] = [];
    for (const op of transaction.ops) {
      ops.push(
        op.kind === "overwrite"
          ? {
              kind: "overwrite",
              at: op.at,
              before: await carriedBytes(op.before),
              after: await carriedBytes(op.after),
            }
          : { kind: op.kind, at: op.at, bytes: await carriedBytes(op.bytes) }
      );
    }
    records.push({
      serial: transaction.serial,
      parent: transaction.parent,
      selectionBefore: transaction.selectionBefore,
      selectionAfter: transaction.selectionAfter,
      ...(kept.seriesId === undefined ? {} : { seriesId: kept.seriesId }),
      ...(kept.label === undefined ? {} : { label: kept.label }),
      ops,
    });
  }
  return {
    head: history.headSerial,
    nextSerial: history.upcomingSerial,
    savedState: history.savedStateSerial,
    dirtyRegardless: history.isDirtyRegardless,
    undoBase: history.undoBaseSerial,
    ...(history.redoTipSerial === undefined ? {} : { redoTip: history.redoTipSerial }),
    redoSteps: history.redoStepSizes,
    records,
  };
}

/**
 * Puts a carried history back over a document whose content is the state it names. Answers
 * whether it went back: a history whose steps do not lead to that state is left out.
 */
export function putBackHistory(history: UndoHistory, carried: CarriedHistory): boolean {
  const records = new Map<number, KeptTransaction>();
  for (const record of carried.records) {
    const ops: UndoOperation[] = record.ops.map((op) =>
      op.kind === "overwrite"
        ? { kind: "overwrite", at: op.at, before: undoBytes(op.before), after: undoBytes(op.after) }
        : { kind: op.kind, at: op.at, bytes: undoBytes(op.bytes) }
    );
    const transaction: UndoTransaction = {
      ops,
      selectionBefore: record.selectionBefore,
      selectionAfter: record.selectionAfter,
      serial: record.serial,
      parent: record.parent,
    };
    records.set(record.serial, { transaction, seriesId: record.seriesId, label: record.label });
  }
  const sides = historySides({
    head: carried.head,
    undoBase: carried.undoBase,
    redoTip: carried.redoTip,
    redoSizes: carried.redoSteps,
    records,
  });
  if (sides === undefined) return false;
  history.restore({
    undo: sides.undo,
    redo: sides.redo,
    base: carried.undoBase,
    nextSerial: carried.nextSerial,
    saved: carried.savedState,
    dirtyRegardless: carried.dirtyRegardless,
  });
  return true;
}
