import { describe, expect, it } from "vitest";
import { BinaryDocument, FILL_CHUNK_SIZE } from "@/core/document/binaryDocument";
import { UndoHistory, type UndoOperation } from "@/core/edit/undoHistory";
import { UndoBytes } from "@/core/edit/undoJournal";
import { EditOverlayStorage } from "@/core/storage/editOverlayStorage";
import { asArray, readAll, storageOver } from "@/core/testing/support";

/**
 * The undo history keeps the operations' bytes in a journal, not in memory, and keeps to its
 * bounds by dropping the oldest steps (`Design/PERSISTENT_UNDO_PLAN.md` upstream).
 *
 * @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/UndoJournalTests.swift#UndoJournalTests
 */

/** @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/UndoJournalTests.swift#UndoJournalTests.overwrite */
const overwrite = (at: number, before: number[], after: number[]): UndoOperation => ({
  kind: "overwrite",
  at,
  before: UndoBytes.of(new Uint8Array(before)),
  after: UndoBytes.of(new Uint8Array(after)),
});

/** @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/UndoJournalTests.swift#UndoJournalTests.makeDocument */
const documentOf = (bytes: Uint8Array) =>
  new BinaryDocument(new EditOverlayStorage(storageOver(bytes)));

const content = async (doc: BinaryDocument) => asArray(await readAll(doc.storage));

const record = (history: UndoHistory, op: UndoOperation) =>
  history.recordAtCaret([op], op.at, op.at, 1024);

/** The first operation of the first transaction `undo` hands back, as an overwrite. */
function firstOverwrite(history: UndoHistory) {
  const op = history.undo()?.[0]?.ops[0];
  if (op?.kind !== "overwrite") throw new Error("not an overwrite");
  return op;
}

describe("where the bytes are", () => {
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/UndoJournalTests.swift#UndoJournalTests.testRecordedBytesLieInTheJournal
  it("puts recorded bytes in the journal, and reads them back as recorded", async () => {
    const history = new UndoHistory();
    record(history, overwrite(4, [1, 2, 3], [7, 8, 9]));
    const op = firstOverwrite(history);
    expect(op.before.journal).toBeDefined();
    expect(op.after.journal).toBeDefined();
    expect(asArray(await op.before.load())).toEqual([1, 2, 3]);
    expect(asArray(await op.after.load())).toEqual([7, 8, 9]);
    expect(history.heldBytes).toBe(6);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/UndoJournalTests.swift#UndoJournalTests.testAGroupsBytesGoToTheJournalAsItRuns
  it("puts a group's bytes in the journal as it runs, and a cancelled group undoes them", async () => {
    const doc = documentOf(new Uint8Array([0, 1, 2, 3]));
    doc.beginEditGroup();
    await doc.overwrite(0, new Uint8Array([9, 9]));
    await doc.insert(4, new Uint8Array([5, 6]));
    await doc.cancelEditGroup();
    expect(await content(doc)).toEqual([0, 1, 2, 3]);
    expect(doc.canUndo).toBe(false);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/UndoJournalTests.swift#UndoJournalTests.testUndoAndRedoReadTheJournal
  it("gives the document its bytes back through the journal on undo and redo", async () => {
    const doc = documentOf(new Uint8Array(64).fill(0x11));
    await doc.fill(new Uint8Array([0xab, 0xcd]), 8, 40);
    await doc.delete(0, 4);
    await doc.insert(2, new Uint8Array([1, 2, 3]));
    const edited = await content(doc);
    await doc.undo();
    await doc.undo();
    await doc.undo();
    expect(await content(doc)).toEqual(Array(64).fill(0x11));
    expect(doc.isDirty).toBe(false);
    await doc.redo();
    await doc.redo();
    await doc.redo();
    expect(await content(doc)).toEqual(edited);
  });
});

describe("a fill", () => {
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/UndoJournalTests.swift#UndoJournalTests.testAFillKeepsItsPatternNotItsBytes
  it("keeps the bytes it replaced and its pattern, in slices that carry one repetition on", async () => {
    const size = FILL_CHUNK_SIZE * 2 + 1000;
    const original = Uint8Array.from({ length: size }, (_, index) => (index * 7) & 0xff);
    const doc = documentOf(original.slice());
    const pattern = [0xaa, 0xbb, 0xcc];
    await doc.fill(new Uint8Array(pattern), 10, size - 10);

    const filled = await readAll(doc.storage);
    for (let index = 10; index < size - 10; index++) {
      if (filled[index] !== pattern[(index - 10) % 3]) expect.fail(`byte ${index}`);
    }
    expect(asArray(filled.subarray(0, 10))).toEqual(asArray(original.subarray(0, 10)));
    const slices = Math.ceil((size - 20) / FILL_CHUNK_SIZE);
    expect(doc.undoHistory.heldBytes, "what it replaced, and three bytes of pattern a slice").toBe(
      size - 20 + 3 * slices
    );
    expect(doc.undoHistory.undoDepth, "one fill, one step").toBe(1);

    await doc.undo();
    expect((await readAll(doc.storage)).every((byte, index) => byte === original[index])).toBe(
      true
    );
    await doc.redo();
    expect((await readAll(doc.storage)).every((byte, index) => byte === filled[index])).toBe(true);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/UndoJournalTests.swift#UndoJournalTests.testPatternBytesReadBackRepeated
  it("reads a pattern's bytes back repeated and cut short", async () => {
    const load = async (pattern: number[], count: number) =>
      asArray(await UndoBytes.pattern(new Uint8Array(pattern), count).load());
    expect(await load([1, 2, 3], 7)).toEqual([1, 2, 3, 1, 2, 3, 1]);
    expect(await load([1, 2, 3], 2)).toEqual([1, 2]);
    expect(await load([9], 4)).toEqual([9, 9, 9, 9]);
  });
});

describe("bounds", () => {
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/UndoJournalTests.swift#UndoJournalTests.testTheOldestStepsGoPastTheStepBound
  it("drops the oldest steps past the step bound, and stays dirty with them gone", () => {
    const history = new UndoHistory();
    history.limits = { transactions: 3 };
    for (let index = 0; index < 5; index++) record(history, overwrite(index, [0], [1]));
    expect(history.undoDepth).toBe(3);
    expect(history.heldBytes).toBe(6);
    while (history.undo() !== undefined) {
      // back to the oldest step kept
    }
    expect(history.isDirty, "two edits were dropped and still stand").toBe(true);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/UndoJournalTests.swift#UndoJournalTests.testUndoingBackToADroppedSavedStateIsClean
  it("is clean when the undo side runs back to a saved state whose step was dropped", () => {
    const history = new UndoHistory();
    history.limits = { transactions: 2 };
    for (let index = 0; index < 3; index++) record(history, overwrite(index, [0], [1]));
    history.markSaved();
    for (let index = 3; index < 5; index++) record(history, overwrite(index, [0], [1]));
    expect(history.isDirty).toBe(true);
    history.undo();
    history.undo();
    expect(history.isDirty).toBe(false);
    expect(history.canUndo).toBe(false);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/UndoJournalTests.swift#UndoJournalTests.testTheByteBoundKeepsTheNewestStepAlone
  it("counts before and after alike, and never drops the newest step", () => {
    const history = new UndoHistory();
    history.limits = { bytes: 10 };
    record(history, overwrite(0, [0, 0], [1, 1])); // 4
    record(history, overwrite(2, [0, 0], [1, 1])); // 8
    record(history, overwrite(4, [0, 0], [1, 1])); // 12 → the first goes
    expect(history.undoDepth).toBe(2);
    expect(history.heldBytes).toBe(8);
    record(history, overwrite(8, Array(20).fill(0), Array(20).fill(1)));
    expect(history.undoDepth).toBe(1);
    expect(history.heldBytes).toBe(40);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/UndoJournalTests.swift#UndoJournalTests.testALoweredBoundTakesEffectAtTheNextEdit
  it("takes a lowered bound in at the next edit", () => {
    const history = new UndoHistory();
    history.limits = {};
    for (let index = 0; index < 10; index++) record(history, overwrite(index, [0], [1]));
    history.limits = { transactions: 4 };
    expect(history.undoDepth).toBe(10);
    record(history, overwrite(10, [0], [1]));
    expect(history.undoDepth).toBe(4);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/UndoJournalTests.swift#UndoJournalTests.testACutRedoSideNoLongerCounts
  it("no longer counts a cut redo side", () => {
    const history = new UndoHistory();
    record(history, overwrite(0, [0, 0], [1, 1]));
    record(history, overwrite(2, [0, 0], [1, 1]));
    history.undo();
    expect(history.heldBytes, "an undone step can still be redone").toBe(8);
    record(history, overwrite(4, [0], [1]));
    expect(history.heldBytes).toBe(6);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/UndoJournalTests.swift#UndoJournalTests.testADroppedJoinNoLongerReattaches
  it("cannot undo a join the bounds dropped", async () => {
    const doc = documentOf(new Uint8Array([1, 2, 3]));
    doc.undoHistory.limits = { transactions: 1 };
    const serial = await doc.join(storageOver(new Uint8Array([9, 9])), "end");
    await doc.overwrite(0, new Uint8Array([7]));
    expect(doc.undoHistory.baseSerial, "the join's step is the state undo stops at").toBe(serial);
    await doc.undo();
    expect(doc.canUndo).toBe(false);
    expect(await content(doc)).toEqual([1, 2, 3, 9, 9]);
  });
});

describe("compaction", () => {
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/UndoJournalTests.swift#UndoJournalTests.testCompactionKeepsEveryStepsBytes
  it("moves the live bytes into a new journal, and every step still undoes and redoes", async () => {
    const doc = documentOf(new Uint8Array(256));
    doc.undoHistory.compactionFloor = 0;
    await doc.overwrite(0, new Uint8Array([1, 1, 1, 1]));
    await doc.overwrite(100, new Uint8Array(128).fill(2));
    await doc.undo(); // the 128 bytes are only redo
    const before = firstOverwrite(doc.undoHistory);
    doc.undoHistory.redo(); // back where the document is
    const oldJournal = before.before.journal;
    expect(oldJournal).toBeDefined();

    await doc.overwrite(8, new Uint8Array([3, 3])); // cuts the redo side: 256 dead, 12 live
    const moved = firstOverwrite(doc.undoHistory);
    expect(moved.before.journal, "compacted into a new journal").not.toBe(oldJournal);
    expect(asArray(await before.before.load()), "bytes handed out before still read").toEqual([
      0, 0, 0, 0,
    ]);
    doc.undoHistory.redo();

    await doc.undo();
    await doc.undo();
    expect(await content(doc)).toEqual(Array(256).fill(0));
    await doc.redo();
    await doc.redo();
    const expected = Array(256).fill(0);
    expected.splice(0, 4, 1, 1, 1, 1);
    expected.splice(8, 2, 3, 3);
    expect(await content(doc)).toEqual(expected);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/UndoJournalTests.swift#UndoJournalTests.testResetLetsTheJournalGo
  it("lets the journal go when the history is emptied", () => {
    const history = new UndoHistory();
    record(history, overwrite(0, [0], [1]));
    const journal = firstOverwrite(history).before.journal;
    expect(journal).toBeDefined();
    history.reset();
    expect(history.heldBytes).toBe(0);
    record(history, overwrite(0, [0], [1]));
    expect(firstOverwrite(history).before.journal, "a new journal after").not.toBe(journal);
  });
});
