import { describe, expect, it } from "vitest";
import { UndoHistory, type UndoOperation, type UndoTransaction } from "@/core/edit/undoHistory";

/** Ported from `UndoHistoryTests.swift` and `UndoStepLabelTests`. */

const FILE_SIZE = 1024;

const op = (at: number): UndoOperation => ({
  kind: "overwrite",
  at,
  before: new Uint8Array([0x00]),
  after: new Uint8Array([0xff]),
});

/** Which offsets each returned transaction touched, for comparing gestures. */
const offsets = (transactions: UndoTransaction[] | undefined): number[][] =>
  (transactions ?? []).map((transaction) => transaction.ops.map((each) => each.at));

/** The caret-only record, which is what most of these cases want. */
function record(
  history: UndoHistory,
  ops: UndoOperation[],
  options: { caretBefore?: number; caretAfter?: number; seriesId?: number; label?: string } = {}
): void {
  const { caretBefore = 0, caretAfter = 0, ...rest } = options;
  history.recordAtCaret(ops, caretBefore, caretAfter, FILE_SIZE, rest);
}

describe("the undo and redo cycle", () => {
  it("goes all the way down and all the way back", () => {
    const history = new UndoHistory();
    record(history, [op(0)]);
    record(history, [op(1)]);

    expect(history.undo()?.length).toBe(1);
    expect(history.undo()?.length).toBe(1);
    expect(history.undo()).toBeUndefined();
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(true);

    expect(history.redo()).toBeDefined();
    expect(history.redo()).toBeDefined();
    expect(history.redo()).toBeUndefined();
    expect(history.canUndo).toBe(true);
  });

  it("undoes a grouped transaction as one unit", () => {
    const history = new UndoHistory();
    record(history, [op(0), op(1), op(2)]); // one transaction, three ops
    expect(history.canUndo).toBe(true);
    expect(history.undo()?.[0]?.ops.length).toBe(3); // all three revert together
    expect(history.canUndo).toBe(false);
  });

  it("discards the redo stack when the state diverges", () => {
    const history = new UndoHistory();
    record(history, [op(0)]);
    record(history, [op(1)]);
    history.undo(); // now at transaction 0
    expect(history.canRedo).toBe(true);

    record(history, [op(2)]); // diverges: the redo stack is discarded
    expect(history.canRedo).toBe(false);
    expect(history.undo()?.length).toBe(1); // t2
    expect(history.undo()?.length).toBe(1); // t0, still committed
    expect(history.undo()).toBeUndefined();
  });

  it("does nothing for an empty transaction", () => {
    const history = new UndoHistory();
    record(history, []);
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
    expect(history.isDirty).toBe(false);
  });

  it("clears everything on reset", () => {
    const history = new UndoHistory();
    record(history, [op(0)]);
    record(history, [op(1)]);
    history.undo();
    expect(history.isDirty).toBe(true);

    history.reset();
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
    expect(history.isDirty).toBe(false);
    expect(history.undoDepth).toBe(0);
  });
});

describe("dirty is a state, not a depth", () => {
  it("follows the saved checkpoint through a whole cycle", () => {
    const history = new UndoHistory();
    expect(history.isDirty).toBe(false);

    record(history, [op(0)]);
    expect(history.isDirty).toBe(true);

    history.markSaved();
    expect(history.isDirty).toBe(false);

    record(history, [op(1)]);
    expect(history.isDirty).toBe(true);

    history.undo(); // back to the saved state
    expect(history.isDirty).toBe(false);

    history.redo(); // past it again
    expect(history.isDirty).toBe(true);
  });

  it("does not mistake a different edit at the same depth for the saved state", () => {
    // Counting edits reported clean here, and closing the file would have
    // discarded the change with no prompt.
    const history = new UndoHistory();
    record(history, [op(0)]);
    record(history, [op(1)]);
    history.markSaved();
    expect(history.isDirty).toBe(false);

    history.undo();
    expect(history.isDirty).toBe(true); // one edit short of the saved state

    record(history, [op(2)]); // a different second edit
    expect(history.isDirty).toBe(true); // as many edits stand, but not those ones

    history.undo();
    expect(history.isDirty).toBe(true); // and the state it replaced is gone for good
  });

  it("tells a restored batch from fresh bytes of the same count", () => {
    // The serials come back with the transactions, so a redo that lands on the
    // saved state is clean again.
    const history = new UndoHistory();
    for (let i = 0; i < 3; i++) record(history, [op(i)], { seriesId: 1 });
    history.markSaved();

    history.undo(false);
    history.undo(true); // the rest of the series, in one step
    expect(history.isDirty).toBe(true);
    history.redo(); // unfolds — back towards the saved state
    history.redo();
    expect(history.isDirty).toBe(false);

    history.undo(false);
    history.undo(true);
    for (let i = 10; i < 13; i++) record(history, [op(i)], { seriesId: 2 });
    expect(history.isDirty).toBe(true); // three other bytes are not the three saved ones
  });

  it("counts transactions rather than steps across a batch", () => {
    const history = new UndoHistory();
    for (let i = 0; i < 3; i++) record(history, [op(i)], { seriesId: 1 });
    history.markSaved();
    expect(history.isDirty).toBe(false);

    history.undo(false);
    history.undo(true);
    expect(history.isDirty).toBe(true);

    // Redo restores one step at a time: the batch brings back two
    // transactions, still short of the saved state.
    history.redo();
    expect(history.isDirty).toBe(true);
    history.redo();
    expect(history.isDirty).toBe(false);
  });
});

describe("what a transaction carries", () => {
  it("brackets the edit with carets, in both directions", () => {
    const history = new UndoHistory();
    record(history, [op(0)], { caretBefore: 5, caretAfter: 6 });
    record(history, [op(1)], { caretBefore: 7, caretAfter: 8 });

    const undone = history.undo();
    expect(undone?.[0]?.ops.map((each) => each.at)).toEqual([1]);
    expect(undone?.[0]?.selectionBefore.start).toBe(7);
    expect(undone?.[0]?.selectionAfter.start).toBe(8);

    const redone = history.redo();
    expect(redone?.[0]?.ops.map((each) => each.at)).toEqual([1]);
    expect(redone?.[0]?.selectionBefore.start).toBe(7);
    expect(redone?.[0]?.selectionAfter.start).toBe(8);

    record(history, [op(2)]);
    expect(history.undo()?.[0]?.selectionBefore.start).toBe(0);
  });

  it("lets the command refine what the edit left selected", () => {
    const history = new UndoHistory();
    record(history, [op(0)], { caretBefore: 5, caretAfter: 6 });
    history.noteSelectionAfterOnLast({ start: 5, end: 9, fileSize: FILE_SIZE });

    expect(history.undo()?.[0]?.selectionAfter).toEqual({ start: 5, end: 9, fileSize: FILE_SIZE });
  });

  it("ignores a refinement once something has been undone", () => {
    const history = new UndoHistory();
    record(history, [op(0)], { caretBefore: 5, caretAfter: 6 });
    history.undo();
    history.noteSelectionAfterOnLast({ start: 5, end: 9, fileSize: FILE_SIZE });

    expect(history.redo()?.[0]?.selectionAfter.end).toBe(6);
  });
});

describe("a typing series, and the coalescing window", () => {
  it("takes back the rest of the series on a fast second press", () => {
    const history = new UndoHistory();
    for (let i = 0; i < 3; i++) record(history, [op(i)], { seriesId: 1 });

    expect(offsets(history.undo(false))).toEqual([[2]]);
    // The fast repeat removes the rest of the series, in recording order.
    expect(offsets(history.undo(true))).toEqual([[0], [1]]);
    expect(history.canUndo).toBe(false);
  });

  it("removes one byte again after a pause", () => {
    const history = new UndoHistory();
    for (let i = 0; i < 3; i++) record(history, [op(i)], { seriesId: 1 });

    expect(offsets(history.undo(false))).toEqual([[2]]);
    expect(offsets(history.undo(false))).toEqual([[1]]);
  });

  // The whole point of the batch window is that it only rolls back what one
  // uninterrupted typing run recorded. In each case the second press comes back
  // with a single transaction, exactly as if batch had not been asked for.
  const refusals: {
    name: string;
    records: [offset: number, series: number | undefined][];
    firstUndo: number[][];
    interlude: [offset: number, series: number | undefined][];
    batchUndo: number[][];
  }[] = [
    {
      name: "the batch stops at a series boundary",
      records: [
        [0, 1],
        [1, 2],
      ],
      firstUndo: [[1]],
      interlude: [],
      batchUndo: [[0]],
    },
    {
      name: "a transaction with no series is never batched",
      records: [
        [0, undefined],
        [1, 1],
      ],
      firstUndo: [[1]],
      interlude: [],
      batchUndo: [[0]],
    },
    {
      name: "a new edit closes the fast window",
      records: [
        [0, 1],
        [1, 1],
      ],
      firstUndo: [[1]],
      interlude: [[2, undefined]],
      batchUndo: [[2]],
    },
  ];

  for (const testCase of refusals) {
    it(testCase.name, () => {
      const history = new UndoHistory();
      for (const [offset, series] of testCase.records) {
        record(history, [op(offset)], series === undefined ? {} : { seriesId: series });
      }
      expect(offsets(history.undo(false))).toEqual(testCase.firstUndo);
      for (const [offset, series] of testCase.interlude) {
        record(history, [op(offset)], series === undefined ? {} : { seriesId: series });
      }
      expect(offsets(history.undo(true))).toEqual(testCase.batchUndo);
    });
  }

  it("restores the byte-by-byte structure when a batch is redone", () => {
    const history = new UndoHistory();
    for (let i = 0; i < 3; i++) record(history, [op(i)], { seriesId: 1 });

    expect(offsets(history.undo(false))).toEqual([[2]]);
    expect(offsets(history.undo(true))).toEqual([[0], [1]]);
    // Redo is symmetric with undo: one press restores one step — first the
    // batch, unfolded back into individual byte steps, then the single byte.
    expect(offsets(history.redo())).toEqual([[0], [1]]);
    expect(offsets(history.redo())).toEqual([[2]]);
    expect(history.undoDepth).toBe(3);

    // The series is byte-by-byte again.
    expect(offsets(history.undo(false))).toEqual([[2]]);
    expect(history.undoDepth).toBe(2);
  });
});

describe("naming a step, so the menu can say what it takes back", () => {
  it("leaves ordinary editing unnamed", () => {
    const history = new UndoHistory();
    record(history, [op(0)], { caretBefore: 0, caretAfter: 1 });
    expect(history.undoLabel).toBeUndefined();
  });

  it("offers the name it was recorded under", () => {
    const history = new UndoHistory();
    record(history, [op(0)], { caretBefore: 0, caretAfter: 1, label: "Add Microcode" });
    expect(history.undoLabel).toBe("Add Microcode");
  });

  it("carries the name across to redo and back", () => {
    // A step undone is still the same act by the same name.
    const history = new UndoHistory();
    record(history, [op(0)], { caretBefore: 0, caretAfter: 1, label: "Add Microcode" });

    history.undo();
    expect(history.undoLabel).toBeUndefined();
    expect(history.redoLabel).toBe("Add Microcode");

    history.redo();
    expect(history.undoLabel).toBe("Add Microcode");
    expect(history.redoLabel).toBeUndefined();
  });

  it("does not leak the name onto the next step", () => {
    const history = new UndoHistory();
    record(history, [op(0)], { caretBefore: 0, caretAfter: 1, label: "Add Microcode" });
    record(history, [op(4)], { caretBefore: 4, caretAfter: 5 });
    expect(history.undoLabel).toBeUndefined();
  });
});

describe("inverting an operation", () => {
  it("is what undo applies", () => {
    const history = new UndoHistory();
    record(history, [{ kind: "insert", at: 4, bytes: new Uint8Array([1, 2]) }]);
    const undone = history.undo();
    expect(undone?.[0]?.ops[0]).toEqual({ kind: "insert", at: 4, bytes: new Uint8Array([1, 2]) });
  });
});

describe("clearing while staying dirty", () => {
  it("keeps content a join produced from being discarded silently", () => {
    // A join cannot be undone — there is no prior state to return to — but the
    // content it produced was never saved and must still warn on close.
    const history = new UndoHistory();
    record(history, [op(0)]);
    history.clearKeepingDirty();

    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
    expect(history.isDirty).toBe(true);

    history.markSaved();
    expect(history.isDirty).toBe(false);
  });

  it("lets later edits undo as usual without reaching the cleared work", () => {
    const history = new UndoHistory();
    record(history, [op(0)]);
    history.clearKeepingDirty();

    record(history, [op(5)]);
    expect(offsets(history.undo())).toEqual([[5]]);
    expect(history.canUndo).toBe(false);
    expect(history.isDirty).toBe(true);
  });
});
