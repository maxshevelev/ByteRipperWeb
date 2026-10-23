import { describe, expect, it } from "vitest";
import { BinaryDocument } from "@/core/document/binaryDocument";
import {
  applyHistory,
  HistoryLogWriter,
  historyPath,
  readHistoryLog,
} from "@/core/edit/historyLog";
import { EMPTY_HASH, MemoryJournalStore, UndoJournal } from "@/core/edit/undoJournal";
import { EditOverlayStorage } from "@/core/storage/editOverlayStorage";
import { fixtureBytes } from "@/core/testing/fixtureFile";
import { asArray, readAll, storageOver } from "@/core/testing/support";
import { decodeUtf8 } from "@/core/text/utf";

/**
 * What a workspace keeps in `Kept/` beside its JSON still reads as an earlier build wrote it. The
 * log's format is upstream's, record for record, so the fixture is upstream's own: the log its
 * build of workspace version 4 wrote, kept in `fixtures/v4/` and never rewritten
 * (`Design/WORKSPACE.md`, "Versions").
 *
 * @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/KeptFormatVersionTests.swift#KeptFormatVersionTests
 * @upstream-differs a file's edits are not upstream's property list here: their own encoding is
 * the web's, and the workspace fixtures keep it (`src/core/workspace/fixtures`)
 */

/** @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/KeptFormatVersionTests.swift#KeptFormatVersionTests.base */
const BASE = Array.from({ length: 64 }, (_, index) => index);

/**
 * The edits the version-4 log holds: every kind of op, a typing series, a labelled group and a
 * fill. The fixture was written from these, so they stay as they are.
 *
 * @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/KeptFormatVersionTests.swift#KeptFormatVersionTests.makeVersion4Edits
 */
async function makeVersion4Edits(doc: BinaryDocument): Promise<void> {
  doc.beginSeries(7);
  await doc.overwrite(0, new Uint8Array([0xaa]));
  await doc.overwrite(1, new Uint8Array([0xbb]));
  doc.endSeries();
  await doc.insert(10, new Uint8Array([1, 2, 3]));
  await doc.delete(20, 25);
  await doc.fill(new Uint8Array([0xf0, 0x0f]), 30, 50);
  doc.beginEditGroup("Add Microcode");
  await doc.overwrite(2, new Uint8Array([9, 9]));
  await doc.insert(62, new Uint8Array([0xee]));
  doc.endEditGroup();
}

/**
 * Where the version-4 log was pinned when it was written.
 *
 * @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/KeptFormatVersionTests.swift#KeptFormatVersionTests.version4LogLength
 * @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/KeptFormatVersionTests.swift#KeptFormatVersionTests.version4LogHash
 */
const VERSION_4_LOG = {
  length: 1188,
  hash: "c3a7b341d313df31b94a3e15d9d521410fefd1b59d7cc88d19bd7149ca2bbfc5",
};
/** @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/KeptFormatVersionTests.swift#KeptFormatVersionTests.version4Selection */
const VERSION_4_SELECTION = { start: 3, end: 7 };
/** @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/KeptFormatVersionTests.swift#KeptFormatVersionTests.version4Segments */
const VERSION_4_SEGMENTS = '{"contentSize":64,"pieces":[]}';

const hex = (text: string) =>
  Uint8Array.from(text.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));

/** Where the version-4 log is kept. */
const LOG = "src/core/edit/fixtures/v4/history.log";

/** The fixture as a journal, opened to read it. */
function fixtureLog(): UndoJournal {
  const bytes = fixtureBytes(LOG);
  const store = new MemoryJournalStore();
  void store.write(0, bytes);
  return new UndoJournal(store, { length: bytes.length, hash: EMPTY_HASH });
}

describe("the kept format of earlier versions", () => {
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/KeptFormatVersionTests.swift#KeptFormatVersionTests.testALogOfVersion4Reads
  it("reads a log of version 4", async () => {
    const records = await readHistoryLog(
      fixtureLog(),
      VERSION_4_LOG.length,
      hex(VERSION_4_LOG.hash)
    );
    const doc = new BinaryDocument(new EditOverlayStorage(storageOver(new Uint8Array(BASE))));
    await makeVersion4Edits(doc);
    const held = doc.undoHistory.heldTransactions;

    expect(records.map((one) => one.label)).toEqual(held.map((one) => one.label));
    expect(records.map((one) => one.seriesId)).toEqual(held.map((one) => one.seriesId));
    const after = records.at(-1)?.transaction.selectionAfter;
    expect({ start: after?.start, end: after?.end }).toEqual(VERSION_4_SELECTION);
    const segments = records[0]?.segmentsBefore;
    expect(segments === undefined ? undefined : decodeUtf8(segments)).toBe(VERSION_4_SEGMENTS);

    const first = records[0]?.transaction.parent;
    const last = records.at(-1)?.transaction.serial;
    const map = new Map(records.map((one) => [one.transaction.serial, one.transaction]));
    const path = historyPath(first ?? 0, last ?? 0, map);
    expect(path).toBeDefined();
    const storage = new EditOverlayStorage(storageOver(new Uint8Array(BASE)));
    await applyHistory(path ?? [], storage);
    expect(asArray(await readAll(storage))).toEqual(asArray(await readAll(doc.storage)));
  });

  // This build writes those records as version 4 did, byte for byte, but for the segments the
  // window pairs with them — which a document alone does not write.
  it("writes the transactions of version 4's log as that build did", async () => {
    const doc = new BinaryDocument(new EditOverlayStorage(storageOver(new Uint8Array(BASE))));
    await makeVersion4Edits(doc);
    const store = new MemoryJournalStore();
    const writer = HistoryLogWriter.creating(store);
    for (const record of doc.undoHistory.heldTransactions) writer.append(record);
    const pinned = await writer.pin();
    const written = await store.read(0, pinned?.length ?? 0);
    const fixture = fixtureBytes(LOG);
    const transactions = (bytes: Uint8Array) => {
      const out: string[] = [];
      for (let at = 0; at < bytes.length; ) {
        const kind = decodeUtf8(bytes.subarray(at, at + 4));
        const length = Number(
          new DataView(bytes.buffer, bytes.byteOffset + at + 4, 8).getBigUint64(0, true)
        );
        if (kind === "BRT1") out.push(asArray(bytes.subarray(at + 12, at + 12 + length)).join(","));
        at += 12 + length + 32;
      }
      return out;
    };
    expect(transactions(fixture)).toHaveLength(doc.undoHistory.heldTransactions.length);
    expect(transactions(written)).toEqual(transactions(fixture));
  });
});
