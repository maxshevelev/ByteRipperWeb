import { describe, expect, it } from "vitest";
import { BinaryDocument } from "@/core/document/binaryDocument";
import {
  applyHistory,
  HistoryLogWriter,
  historyPath,
  historySides,
  readHistoryLog,
} from "@/core/edit/historyLog";
import { type KeptTransaction, UndoHistory } from "@/core/edit/undoHistory";
import {
  EMPTY_HASH,
  type JournalStore,
  MemoryJournalStore,
  UndoBytes,
  UndoJournal,
} from "@/core/edit/undoJournal";
import { EditOverlayStorage } from "@/core/storage/editOverlayStorage";
import { asArray, readAll, storageOver } from "@/core/testing/support";
import { encodeUtf8 } from "@/core/text/utf";

/**
 * A kept history's log: what goes in comes back, a damaged or cut log is refused, and the content
 * of any state is found from any other by the transactions between them.
 *
 * @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/HistoryLogTests.swift#HistoryLogTests
 */

/** @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/HistoryLogTests.swift#HistoryLogTests.makeDocument */
const documentOf = (bytes: number[]) =>
  new BinaryDocument(new EditOverlayStorage(storageOver(new Uint8Array(bytes))));

const range = (count: number) => Array.from({ length: count }, (_, index) => index);

/** @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/HistoryLogTests.swift#HistoryLogTests.content */
const content = async (doc: BinaryDocument) => asArray(await readAll(doc.storage));

/**
 * The content of the state `head` names, from `base` holding `baseBytes`.
 *
 * @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/HistoryLogTests.swift#HistoryLogTests.rebuild
 */
async function rebuild(
  baseBytes: number[],
  base: number,
  head: number,
  records: readonly KeptTransaction[]
): Promise<number[]> {
  const map = new Map(records.map((one) => [one.transaction.serial, one.transaction]));
  const ops = historyPath(base, head, map);
  if (ops === undefined) throw new Error("no way");
  const storage = new EditOverlayStorage(storageOver(new Uint8Array(baseBytes)));
  await applyHistory(ops, storage);
  return asArray(await readAll(storage));
}

/**
 * A new log over `store`, with `records` in it, pinned.
 *
 * @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/HistoryLogTests.swift#HistoryLogTests.write
 */
async function write(records: readonly KeptTransaction[], store: JournalStore) {
  const writer = HistoryLogWriter.creating(store);
  for (const record of records) writer.append(record);
  const pinned = await writer.pin();
  if (pinned === undefined) throw new Error("not pinned");
  return { writer, ...pinned };
}

/** The log in `store` as a journal opened to read it, `length` bytes long. */
const opened = (store: JournalStore, length: number) =>
  new UndoJournal(store, { length, hash: EMPTY_HASH });

/** What the operations hold, loaded, for comparing two transactions' bytes. */
async function loaded(records: readonly KeptTransaction[]) {
  return Promise.all(
    records.map(async (one) => ({
      serial: one.transaction.serial,
      parent: one.transaction.parent,
      selectionBefore: one.transaction.selectionBefore,
      selectionAfter: one.transaction.selectionAfter,
      seriesId: one.seriesId,
      label: one.label,
      ops: await Promise.all(
        one.transaction.ops.map(async (op) =>
          op.kind === "overwrite"
            ? {
                kind: op.kind,
                at: op.at,
                before: asArray(await op.before.load()),
                after: asArray(await op.after.load()),
              }
            : { kind: op.kind, at: op.at, bytes: asArray(await op.bytes.load()) }
        )
      ),
    }))
  );
}

describe("a kept history's log", () => {
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/HistoryLogTests.swift#HistoryLogTests.testWhatIsWrittenReadsBack
  it("reads back every kind of operation, a series, a label and a fill's pattern", async () => {
    const doc = documentOf(range(64));
    doc.beginSeries(7);
    await doc.overwrite(0, new Uint8Array([0xaa]));
    doc.endSeries();
    await doc.insert(10, new Uint8Array([1, 2, 3]));
    await doc.delete(20, 25);
    await doc.fill(new Uint8Array([0xf0, 0x0f]), 30, 50);
    doc.beginEditGroup("Add Microcode");
    await doc.overwrite(2, new Uint8Array([9, 9]));
    doc.endEditGroup();

    const held = doc.undoHistory.heldTransactions;
    const store = new MemoryJournalStore();
    const { length, hash } = await write(held, store);
    const read = await readHistoryLog(opened(store, length), length, hash);
    expect(await loaded(read)).toEqual(await loaded(held));
    expect(read[0]?.seriesId).toBe(7);
    expect(read.at(-1)?.label).toBe("Add Microcode");
    const fill = read[3]?.transaction.ops[0];
    expect(
      fill?.kind === "overwrite" && fill.after.patternForm !== undefined,
      "kept as its pattern"
    ).toBe(true);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/HistoryLogTests.swift#HistoryLogTests.testTheLogRebuildsEveryStateFromTheBase
  it("rebuilds every state the history passed through from the base", async () => {
    const original = range(48);
    const doc = documentOf(original);
    const start = doc.undoHistory.headSerial;
    await doc.overwrite(4, new Uint8Array([1, 1, 1, 1]));
    const afterFirst = await content(doc);
    const first = doc.undoHistory.headSerial;
    await doc.insert(0, new Uint8Array([7, 7]));
    await doc.delete(30, 40);
    const store = new MemoryJournalStore();
    const { length, hash } = await write(doc.undoHistory.heldTransactions, store);
    const records = await readHistoryLog(opened(store, length), length, hash);
    const head = doc.undoHistory.headSerial;

    expect(await rebuild(original, start, head, records)).toEqual(await content(doc));
    expect(await rebuild(original, start, first, records)).toEqual(afterFirst);
    // Down from the state the document holds now, back to the opened file.
    expect(await rebuild(await content(doc), head, start, records)).toEqual(original);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/HistoryLogTests.swift#HistoryLogTests.testAWayLeadsAcrossBranches
  it("finds the way across branches: up to where they part, then down", async () => {
    const doc = documentOf(Array(16).fill(0));
    await doc.overwrite(0, new Uint8Array([1, 1]));
    await doc.overwrite(4, new Uint8Array([2, 2]));
    const tipA = doc.undoHistory.headSerial;
    const contentA = await content(doc);
    const branchA = doc.undoHistory.heldTransactions;
    await doc.undo();
    await doc.insert(8, new Uint8Array([3, 3, 3]));
    const tipB = doc.undoHistory.headSerial;
    const contentB = await content(doc);
    const all = [
      ...new Map(
        [...branchA, ...doc.undoHistory.heldTransactions].map((one) => [
          one.transaction.serial,
          one,
        ])
      ).values(),
    ];

    expect(await rebuild(contentA, tipA, tipB, all)).toEqual(contentB);
    expect(await rebuild(contentB, tipB, tipA, all)).toEqual(contentA);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/HistoryLogTests.swift#HistoryLogTests.testNoWayWithoutTheTransactionsBetween
  it("has no way without the transactions between", () => {
    expect(historyPath(3, 9, new Map())).toBeUndefined();
    expect(historyPath(3, 3, new Map())).toEqual([]);
  });
});

describe("integrity", () => {
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/HistoryLogTests.swift#HistoryLogTests.testADamagedLogIsRefused
  it("refuses a log with a byte changed in a record", async () => {
    const doc = documentOf(range(32));
    await doc.overwrite(0, new Uint8Array(8).fill(5));
    const store = new MemoryJournalStore();
    const { length, hash } = await write(doc.undoHistory.heldTransactions, store);
    const middle = Math.floor(length / 2);
    const byte = (await store.read(middle, 1))[0] as number;
    await store.write(middle, Uint8Array.of(byte ^ 0xff));
    await expect(readHistoryLog(opened(store, length), length, hash)).rejects.toThrow();
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/HistoryLogTests.swift#HistoryLogTests.testACutOrMisnamedLogIsRefused
  it("refuses a log shorter than its manifest says, or pinned by another hash", async () => {
    const doc = documentOf(range(32));
    await doc.overwrite(0, new Uint8Array(8).fill(5));
    await doc.insert(0, new Uint8Array([1]));
    const store = new MemoryJournalStore();
    const { length, hash } = await write(doc.undoHistory.heldTransactions, store);
    await expect(readHistoryLog(opened(store, length), length + 1, hash)).rejects.toThrow();
    await expect(readHistoryLog(opened(store, length), length, EMPTY_HASH)).rejects.toThrow();
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/HistoryLogTests.swift#HistoryLogTests.testATailPastThePinnedLengthIsCutOff
  it("leaves out what was appended past the pinned length, and writes over it", async () => {
    const doc = documentOf(range(32));
    await doc.overwrite(0, new Uint8Array([1, 1]));
    const store = new MemoryJournalStore();
    const {
      writer,
      length: pinnedLength,
      hash: pinnedHash,
    } = await write(doc.undoHistory.heldTransactions, store);
    await doc.overwrite(2, new Uint8Array([2, 2]));
    writer.append(doc.undoHistory.heldTransactions[1] as KeptTransaction); // never pinned
    await writer.pin();

    expect(
      await readHistoryLog(opened(store, pinnedLength), pinnedLength, pinnedHash)
    ).toHaveLength(1);
    const resumed = HistoryLogWriter.appendingTo(store, pinnedLength, pinnedHash);
    await doc.overwrite(4, new Uint8Array([3, 3]));
    resumed.append(doc.undoHistory.heldTransactions[2] as KeptTransaction);
    const pinned = await resumed.pin();
    if (pinned === undefined) throw new Error("not pinned");
    const read = await readHistoryLog(opened(store, pinned.length), pinned.length, pinned.hash);
    const held = doc.undoHistory.heldTransactions;
    expect(read.map((one) => one.transaction.serial)).toEqual([
      held[0]?.transaction.serial,
      held[2]?.transaction.serial,
    ]);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/HistoryLogTests.swift#HistoryLogTests.testAnOpThatDoesNotFitIsRefused
  it("refuses an operation that does not fit, rather than doing half", async () => {
    const storage = new EditOverlayStorage(storageOver(new Uint8Array([1, 2, 3])));
    await expect(
      applyHistory([{ kind: "delete", at: 2, bytes: UndoBytes.of(new Uint8Array(7)) }], storage)
    ).rejects.toThrow();
  });
});

describe("serials", () => {
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/HistoryLogTests.swift#HistoryLogTests.testEveryStateHasASerialOfItsOwn
  it("names a reset's content anew, so later edits never descend from what came before", async () => {
    const doc = documentOf([0, 0, 0, 0]);
    await doc.overwrite(0, new Uint8Array([1]));
    const edited = doc.undoHistory.headSerial;
    doc.undoHistory.reset();
    expect(doc.undoHistory.headSerial).not.toBe(0);
    expect(doc.undoHistory.headSerial).not.toBe(edited);
    expect(doc.undoHistory.isDirty, "a reset document is its file").toBe(false);
    const reset = doc.undoHistory.headSerial;
    await doc.overwrite(1, new Uint8Array([1]));
    expect(doc.undoHistory.heldTransactions.at(-1)?.transaction.parent).toBe(reset);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/HistoryLogTests.swift#HistoryLogTests.testAResumedHistoryGoesOnCounting
  it("goes on counting where a kept history stopped, and knows the saved state", () => {
    const history = new UndoHistory();
    history.resume({ head: 40, nextSerial: 52, saved: 31, dirty: false });
    expect(history.headSerial).toBe(40);
    expect(history.isDirty, "the file holds state 31, the content is 40").toBe(true);
    history.recordAtCaret(
      [
        {
          kind: "overwrite",
          at: 0,
          before: UndoBytes.of(new Uint8Array([0])),
          after: UndoBytes.of(new Uint8Array([1])),
        },
      ],
      0,
      1,
      8
    );
    expect(history.heldTransactions.at(-1)?.transaction.serial).toBe(52);
    expect(history.heldTransactions.at(-1)?.transaction.parent).toBe(40);

    const untitled = new UndoHistory();
    untitled.resume({ head: 9, nextSerial: 10, saved: undefined, dirty: true });
    expect(untitled.isDirty).toBe(true);
    const clean = new UndoHistory();
    clean.resume({ head: 9, nextSerial: 10, saved: 9, dirty: false });
    expect(clean.isDirty).toBe(false);
  });
});

describe("the history itself", () => {
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/HistoryLogTests.swift#HistoryLogTests.testAKeptHistoryUndoesAndRedoesAsBefore
  it("undoes and redoes as before, put back into a fresh document", async () => {
    const original = Array(32).fill(0);
    const doc = documentOf(original);
    await doc.overwrite(0, new Uint8Array([1, 1]));
    doc.undoHistory.markSaved();
    doc.beginEditGroup("Add Microcode");
    await doc.overwrite(4, new Uint8Array([2, 2]));
    doc.endEditGroup();
    doc.beginSeries(5);
    for (let index = 0; index < 3; index++) await doc.overwrite(10 + index, new Uint8Array([3]));
    doc.endSeries();
    await doc.undo(false);
    await doc.undo(true); // the rest of the series: one redo step
    const history = doc.undoHistory;
    expect(history.redoStepSizes).toEqual([2, 1]);

    const store = new MemoryJournalStore();
    const { length, hash } = await write(history.heldTransactions, store);
    const records = await readHistoryLog(opened(store, length), length, hash);
    const sides = historySides({
      head: history.headSerial,
      undoBase: history.undoBaseSerial,
      redoTip: history.redoTipSerial,
      redoSizes: history.redoStepSizes,
      records: new Map(records.map((one) => [one.transaction.serial, one])),
    });
    if (sides === undefined) throw new Error("no sides");
    expect(sides.undo).toHaveLength(2);
    expect(sides.redo.map((step) => step.length)).toEqual([2, 1]);

    const copy = documentOf(await content(doc));
    copy.undoHistory.restore({
      undo: sides.undo,
      redo: sides.redo,
      base: history.undoBaseSerial,
      nextSerial: history.upcomingSerial,
      saved: history.savedStateSerial,
      dirtyRegardless: history.isDirtyRegardless,
    });
    expect(copy.undoHistory.undoLabel).toBe("Add Microcode");
    expect(copy.isDirty).toBe(true);
    await copy.redo();
    await copy.redo();
    await doc.redo();
    await doc.redo();
    expect(await content(copy)).toEqual(await content(doc));
    await copy.undo(false);
    await copy.undo(true);
    await copy.undo();
    expect(copy.isDirty, "the saved state, reached by undo").toBe(false);
    await copy.undo();
    expect(await content(copy)).toEqual(original);
    expect(copy.canUndo).toBe(false);
    await copy.overwrite(20, new Uint8Array([9]));
    expect(
      copy.undoHistory.heldTransactions.at(-1)?.transaction.serial,
      "serials go on, never named twice"
    ).toBeGreaterThanOrEqual(history.upcomingSerial);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/HistoryLogTests.swift#HistoryLogTests.testSidesThatDoNotAddUpAreLeftOut
  it("puts back nothing with no way to the undo base, and leaves out a redo side that does not add up", async () => {
    const doc = documentOf(Array(8).fill(0));
    await doc.overwrite(0, new Uint8Array([1]));
    await doc.overwrite(1, new Uint8Array([1]));
    await doc.undo();
    const records = new Map(
      doc.undoHistory.heldTransactions.map((one) => [one.transaction.serial, one])
    );
    const head = doc.undoHistory.headSerial;
    expect(historySides({ head, undoBase: 999, redoTip: undefined, redoSizes: [], records })).toBe(
      undefined
    );
    const wrong = historySides({
      head,
      undoBase: doc.undoHistory.undoBaseSerial,
      redoTip: doc.undoHistory.redoTipSerial,
      redoSizes: [5],
      records,
    });
    expect(wrong?.undo).toHaveLength(1);
    expect(wrong?.redo).toHaveLength(0);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/HistoryLogTests.swift#HistoryLogTests.testARefinedSelectionReadsBack
  it("reads back a selection refined after its transaction was written", async () => {
    const doc = documentOf(Array(16).fill(0));
    await doc.overwrite(0, new Uint8Array([1, 1]));
    const store = new MemoryJournalStore();
    const { writer } = await write(doc.undoHistory.heldTransactions, store);
    const refined = { start: 3, end: 7, fileSize: 16 };
    writer.appendSelection(doc.undoHistory.headSerial, refined);
    const pinned = await writer.pin();
    if (pinned === undefined) throw new Error("not pinned");
    const read = await readHistoryLog(opened(store, pinned.length), pinned.length, pinned.hash);
    expect(read[0]?.transaction.selectionAfter).toEqual(refined);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/HistoryLogTests.swift#HistoryLogTests.testSegmentsPairedWithATransactionReadBack
  it("reads back the segments paired with a transaction, a repeat costing a flag", async () => {
    const doc = documentOf(Array(16).fill(0));
    await doc.overwrite(0, new Uint8Array([1]));
    await doc.overwrite(1, new Uint8Array([1]));
    const held = doc.undoHistory.heldTransactions;
    const store = new MemoryJournalStore();
    const { writer } = await write(held, store);
    const a = encodeUtf8("cuts A");
    const b = encodeUtf8("cuts B");
    writer.appendSegments(held[0]?.transaction.serial as number, false, a);
    const lengthBefore = writer.length;
    writer.appendSegments(held[1]?.transaction.serial as number, false, a);
    expect(writer.length - lengthBefore, "a repeat is a flag, not the bytes again").toBeLessThan(
      64
    );
    writer.appendSegments(held[1]?.transaction.serial as number, true, b);
    const pinned = await writer.pin();
    if (pinned === undefined) throw new Error("not pinned");
    const read = await readHistoryLog(opened(store, pinned.length), pinned.length, pinned.hash);
    expect(read[0]?.segmentsBefore).toEqual(a);
    expect(read[1]?.segmentsBefore).toEqual(a);
    expect(read[1]?.segmentsAfter).toEqual(b);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/HistoryLogTests.swift#HistoryLogTests.testARecordNamesTheBytesTheJournalHolds
  it("names in a record the bytes the history's own journal holds, and reads them back whole", async () => {
    const store = new MemoryJournalStore();
    const history = new UndoHistory();
    const big = new Uint8Array(300_000).fill(0xab);
    history.moveJournal(new UndoJournal(store));
    history.recordAtCaret([{ kind: "insert", at: 0, bytes: UndoBytes.of(big) }], 0, 0, 0);
    const journal = history.currentJournal;
    if (journal === undefined) throw new Error("no journal");
    const before = journal.length;
    const writer = new HistoryLogWriter(journal);
    writer.append(history.heldTransactions[0] as KeptTransaction);
    expect(journal.length - before, "named, not written again").toBeLessThan(512);

    const pinned = await writer.pin();
    if (pinned === undefined) throw new Error("not pinned");
    const read = await readHistoryLog(opened(store, pinned.length), pinned.length, pinned.hash);
    expect(await loaded(read)).toEqual(await loaded(history.heldTransactions));
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/HistoryLogTests.swift#HistoryLogTests.testAContinuedJournalNamesWhatItsRecordsCarried
  it("names, in a journal taken up again, the bytes its old records carried", async () => {
    const doc = documentOf(Array(64).fill(0));
    await doc.overwrite(0, new Uint8Array(8).fill(7));
    const store = new MemoryJournalStore();
    const first = await write(doc.undoHistory.heldTransactions, store); // the bytes written into the record
    const continuing = new UndoJournal(store, { length: first.length, hash: first.hash });
    const records = await readHistoryLog(continuing, first.length, first.hash);
    const writer = new HistoryLogWriter(continuing);
    const lengthBefore = writer.length;
    writer.append(records[0] as KeptTransaction);
    expect(writer.length - lengthBefore, "named by where the record carried them").toBeLessThan(
      300
    );
    const pinned = await writer.pin();
    if (pinned === undefined) throw new Error("not pinned");
    const again = await readHistoryLog(opened(store, pinned.length), pinned.length, pinned.hash);
    expect(again).toHaveLength(2);
    expect((await loaded(again))[1]?.ops).toEqual((await loaded(records))[0]?.ops);
  });
});
