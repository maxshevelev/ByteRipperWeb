import { describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import { FIT } from "@/firmware/fit/fitEntry";
import {
  checksumIsCorrect,
  type FITReport,
  type FITTable,
  readFitTable,
  tableEntries,
  tableHeader,
} from "@/firmware/fit/fitTable";
import { ImageReader } from "@/firmware/imageReader";
import {
  assumedAddressDiff,
  fitImage,
  fitMicrocode,
  type TestRow,
} from "@/firmware/testing/testFit";
import { UEFIImage } from "@/firmware/uefi/uefiImage";
import { makeNode } from "@/firmware/uefi/uefiNode";
import {
  addOrReplaceMicrocode,
  type FITEdit,
  type FITEditOutcome,
  type FITRemovalOutcome,
  readPickedMicrocode,
  removeMicrocodeAt,
  replaceMicrocodeAt,
} from "@/tools/fit/fitEditor";
import { validateTransaction } from "@/tools/toolTransaction";

/**
 * Adding a microcode entry and taking one out — upstream's `FITEditorTests`,
 * which is the specification this is checked against.
 */

const MICROCODE = 0x2000;

/** An image with one microcode in it and erased space after it. */
function image(
  options: {
    readonly rows?: readonly TestRow[];
    readonly contents?: ReadonlyMap<number, Uint8Array>;
  } = {}
): Uint8Array {
  const contents = new Map<number, Uint8Array>([[MICROCODE, fitMicrocode({ totalSize: 0x100 })]]);
  for (const [offset, bytes] of options.contents ?? new Map()) contents.set(offset, bytes);
  return fitImage({
    rows: options.rows ?? [{ type: FIT.microcodeType, target: MICROCODE }],
    contents,
  });
}

/** Three microcodes in a run, one row each. */
const runOfThree = (): Uint8Array =>
  fitImage({
    rows: [
      { type: FIT.microcodeType, target: 0x2000 },
      { type: FIT.microcodeType, target: 0x2100 },
      { type: FIT.microcodeType, target: 0x2200 },
    ],
    contents: new Map([
      [0x2000, fitMicrocode({ signature: 0x0008_06ea, totalSize: 0x100 })],
      [0x2100, fitMicrocode({ signature: 0x0009_06ea, totalSize: 0x100 })],
      [0x2200, fitMicrocode({ signature: 0x000a_0671, totalSize: 0x100 })],
    ]),
  });

const newMicrocode = () => fitMicrocode({ signature: 0x000a_0671, totalSize: 0x100 });

const readerOver = (bytes: Uint8Array) => new ImageReader(sourceOver(bytes));

function tableOf(bytes: Uint8Array): FITTable {
  const table = readFitTable(readerOver(bytes)).table;
  if (table === undefined) throw new Error("the fixture has no table");
  return table;
}

const reportOf = (bytes: Uint8Array): FITReport => readFitTable(readerOver(bytes));

/** The addresses the table's rows point at, after an edit. */
const addressesIn = (report: FITReport) =>
  report.table === undefined ? [] : tableEntries(report.table).map((row) => row.entry.address);

const signaturesIn = (report: FITReport) =>
  report.table === undefined
    ? []
    : tableEntries(report.table)
        .map((row) =>
          row.target.kind === "microcode" ? row.target.header.processorSignature : undefined
        )
        .filter((one) => one !== undefined);

function applying<T>(edit: FITEdit<T>, bytes: Uint8Array): Uint8Array {
  if (!edit.ok) throw new Error(`refused: ${edit.problem.kind}`);
  const checked = validateTransaction(edit.transaction);
  if (!checked.ok) throw new Error(`invalid: ${checked.problem.kind}`);
  const edited = Uint8Array.from(bytes);
  for (const write of checked.transaction.writes) edited.set(write.bytes, write.offset);
  return edited;
}

function outcomeOf<T>(edit: FITEdit<T>): T {
  if (!edit.ok) throw new Error(`refused: ${edit.problem.kind}`);
  return edit.outcome;
}

function problemOf<T>(edit: FITEdit<T>) {
  if (edit.ok) throw new Error("expected a refusal");
  return edit.problem;
}

const add = (
  component: Uint8Array,
  bytes: Uint8Array,
  parsed?: UEFIImage
): FITEdit<FITEditOutcome> =>
  addOrReplaceMicrocode(
    component,
    tableOf(bytes),
    parsed,
    readerOver(bytes),
    assumedAddressDiff(bytes.length)
  );

const replaceAt = (
  component: Uint8Array,
  index: number,
  bytes: Uint8Array
): FITEdit<FITEditOutcome> =>
  replaceMicrocodeAt(
    index,
    component,
    tableOf(bytes),
    undefined,
    readerOver(bytes),
    assumedAddressDiff(bytes.length)
  );

const remove = (index: number, bytes: Uint8Array): FITEdit<FITRemovalOutcome> =>
  removeMicrocodeAt(
    index,
    tableOf(bytes),
    undefined,
    readerOver(bytes),
    assumedAddressDiff(bytes.length)
  );

const writesOf = <T>(edit: FITEdit<T>) => {
  if (!edit.ok) throw new Error(`refused: ${edit.problem.kind}`);
  const checked = validateTransaction(edit.transaction);
  if (!checked.ok) throw new Error(`invalid: ${checked.problem.kind}`);
  return checked.transaction.writes;
};

describe("the file the user picked", () => {
  it("refuses a file that is not microcode", () => {
    expect(readPickedMicrocode(new Uint8Array(0x100).fill(0x5a))).toEqual({
      ok: false,
      problem: { kind: "notMicrocode" },
    });
    expect(readPickedMicrocode(new Uint8Array(0))).toEqual({
      ok: false,
      problem: { kind: "notMicrocode" },
    });
  });

  it("refuses a microcode with a broken checksum", () => {
    // Every dword of a microcode image sums to zero. One that does not is not
    // going to be loaded by anything.
    const bytes = fitMicrocode();
    bytes[0x40] = (bytes[0x40] ?? 0) ^ 0xff;

    expect(readPickedMicrocode(bytes)).toEqual({
      ok: false,
      problem: { kind: "microcodeChecksumIsWrong" },
    });
  });

  it("gives a good microcode back with its header", () => {
    const read = readPickedMicrocode(fitMicrocode({ totalSize: 0x180 }));
    if (!read.ok) throw new Error("that should have read as microcode");

    expect(read.header.processorSignature).toBe(0x0008_06ea);
    expect(read.header.totalSize).toBe(0x180);
  });
});

describe("where a new component goes", () => {
  it("puts it after the last microcode", () => {
    // A microcode run is one block, and a new component goes on the end of it.
    const outcome = outcomeOf(add(newMicrocode(), image()));

    expect(outcome.kind).toBe("added");
    expect(outcome.range).toEqual({ start: 0x2100, end: 0x2200 });
    expect(outcome.moved).toBe(0);
  });

  it("starts it on a sixteen-byte boundary", () => {
    // Every FIT address is aligned to sixteen, so a component whose size is not
    // a multiple of it leaves a gap in front of the next one.
    const bytes = fitImage({
      rows: [{ type: FIT.microcodeType, target: MICROCODE }],
      contents: new Map([[MICROCODE, fitMicrocode({ totalSize: 0x108 })]]),
    });

    expect(outcomeOf(add(newMicrocode(), bytes)).range.start).toBe(0x2110);
  });

  it("puts it after the highest microcode, not the first listed", () => {
    // Rows are ordered by type, not by address.
    const bytes = fitImage({
      rows: [
        { type: FIT.microcodeType, target: 0x2100 },
        { type: FIT.microcodeType, target: MICROCODE },
      ],
      contents: new Map([
        [MICROCODE, fitMicrocode({ totalSize: 0x100 })],
        [0x2100, fitMicrocode({ signature: 0x0009_06ea, totalSize: 0x100 })],
      ]),
    });

    const outcome = outcomeOf(add(newMicrocode(), bytes));

    expect(outcome.range).toEqual({ start: 0x2200, end: 0x2300 });
    // A run with no gaps in it does not move.
    expect(outcome.moved).toBe(0);
  });

  it("closes a gap in the run rather than stepping over it", () => {
    // The run is laid out again with the new component on the end, so it closes
    // up behind it.
    const bytes = fitImage({
      rows: [
        { type: FIT.microcodeType, target: MICROCODE },
        { type: FIT.microcodeType, target: 0x2200 },
      ],
      contents: new Map([
        [MICROCODE, fitMicrocode({ totalSize: 0x100 })],
        // 0x2100..0x2200 is erased: something was removed from there.
        [0x2200, fitMicrocode({ signature: 0x0009_06ea, totalSize: 0x100 })],
      ]),
    });

    const edit = add(newMicrocode(), bytes);
    const outcome = outcomeOf(edit);
    const after = reportOf(applying(edit, bytes));

    expect(outcome.moved).toBe(1); // the one behind the gap moved up
    expect(outcome.range).toEqual({ start: 0x2200, end: 0x2300 }); // and the new one took its place
    expect(addressesIn(after)).toEqual([0xffff_2000, 0xffff_2100, 0xffff_2200]);
    expect(after.problems).toEqual([]);
  });

  it("has nowhere to put one when the table names no microcode", () => {
    // Guessing is how a component lands in the wrong region.
    const bytes = image({ rows: [{ type: FIT.startupACMType, target: 0x3000 }] });

    expect(problemOf(add(newMicrocode(), bytes))).toEqual({ kind: "noMicrocodeToFollow" });
  });

  it("will not grow the run over something behind it", () => {
    const bytes = image({ contents: new Map([[0x2100, Uint8Array.of(0x11, 0x22, 0x33, 0x44)]]) });
    const problem = problemOf(add(newMicrocode(), bytes));

    expect(problem.kind).toBe("theRunCannotGrow");
    expect(problem.kind === "theRunCannotGrow" ? problem.needed : 0).toBe(0x100);
  });

  it("will not grow the run past its element", () => {
    // Past its end is another structure, or another flash region.
    const bytes = image();
    const padding = makeNode({
      kind: "padding",
      name: "Padding",
      header: { start: 0x1800, end: 0x1800 },
      body: { start: 0x1800, end: 0x2180 },
    });
    const parsed = new UEFIImage({
      size: bytes.length,
      roots: [padding],
      addressDiff: 0xffff_0000,
    });

    const problem = problemOf(add(newMicrocode(), bytes, parsed));

    expect(problem.kind).toBe("theRunCannotGrow");
    expect(problem.kind === "theRunCannotGrow" ? problem.needed : 0).toBe(0x80);
  });

  it("bounds a microcode with no parent by the file", () => {
    // A microcode found by the raw scan of an image with no volumes in it is a
    // node with no parent, and then there is nothing to bound the run but the
    // file.
    const bytes = image();
    const node = makeNode({
      kind: "microcode",
      name: "Microcode",
      header: { start: MICROCODE, end: MICROCODE },
      body: { start: MICROCODE, end: MICROCODE + 0x100 },
    });
    const parsed = new UEFIImage({ size: bytes.length, roots: [node], addressDiff: 0xffff_0000 });

    expect(outcomeOf(add(newMicrocode(), bytes, parsed)).range).toEqual({
      start: 0x2100,
      end: 0x2200,
    });
  });

  it("does not write what did not change", () => {
    // The point of laying the run out again rather than appending to it: the
    // dump does not colour bytes that did not change.
    const bytes = fitImage({
      rows: [
        { type: FIT.microcodeType, target: MICROCODE },
        { type: FIT.microcodeType, target: 0x2100 },
      ],
      contents: new Map([
        [MICROCODE, fitMicrocode({ totalSize: 0x100 })],
        [0x2100, fitMicrocode({ signature: 0x0009_06ea, totalSize: 0x100 })],
      ]),
    });

    const writes = writesOf(add(newMicrocode(), bytes));

    // The two components already there are not in any write: only the new one,
    // and the table.
    expect(writes.every((one) => one.offset >= 0x2200 || one.offset < 0x2000)).toBe(true);
  });
});

describe("replacing", () => {
  it("replaces a new revision of a known CPUID where it was", () => {
    // The ordinary reason to open this form. A second row for the same
    // processor is legal, wasteful, and not what anybody meant.
    const bytes = image();
    const edit = add(fitMicrocode({ revision: 0xf1, totalSize: 0x100 }), bytes);
    const outcome = outcomeOf(edit);

    expect(edit.ok && edit.transaction.name).toBe("Replace Microcode");
    expect(outcome.kind).toBe("replaced");
    expect(outcome.range).toEqual({ start: MICROCODE, end: MICROCODE + 0x100 });
    expect(outcome.entryIndex).toBe(1);
    expect(outcome.moved).toBe(0);
    expect(outcome.replaced?.updateRevision).toBe(0xf0);

    // The same size means nothing behind it moves, so nothing in the table
    // changes and the whole edit is one write. A transaction that wrote the
    // table back unchanged would be an undo step that undoes nothing.
    const writes = writesOf(edit);
    expect(writes).toHaveLength(1);
    // And the write covers only what differs: the two microcodes share their
    // first bytes, and bytes that did not change must not be coloured as though
    // they had.
    expect(writes[0]?.offset ?? 0).toBeGreaterThan(MICROCODE);
    expect((writes[0]?.offset ?? 0) + (writes[0]?.bytes.length ?? 0)).toBeLessThanOrEqual(
      MICROCODE + 0x100
    );

    const after = tableOf(applying(edit, bytes));
    expect(after.rows).toHaveLength(2);
    expect(checksumIsCorrect(after)).toBe(true);
    const now = tableEntries(after)[0]?.target;
    expect(now?.kind === "microcode" ? now.header.updateRevision : undefined).toBe(0xf1);
  });

  it("moves nothing for a same-size replacement in a run", () => {
    // The common case at a bench: a revision bump of the same size.
    const bytes = runOfThree();
    const edit = add(
      fitMicrocode({ signature: 0x0009_06ea, revision: 0xf1, totalSize: 0x100 }),
      bytes
    );
    const after = reportOf(applying(edit, bytes));

    expect(outcomeOf(edit).moved).toBe(0);
    const writes = writesOf(edit);
    expect(writes).toHaveLength(1); // one write, and only over what differs
    expect(writes[0]?.offset ?? 0).toBeGreaterThanOrEqual(0x2100);
    expect((writes[0]?.offset ?? 0) + (writes[0]?.bytes.length ?? 0)).toBeLessThanOrEqual(0x2200);
    expect(addressesIn(after)).toEqual([0xffff_2000, 0xffff_2100, 0xffff_2200]);
    expect(after.problems).toEqual([]);
  });

  it("moves the run along for a bigger replacement", () => {
    const bytes = runOfThree();
    const edit = add(
      fitMicrocode({ signature: 0x0009_06ea, revision: 0xf1, totalSize: 0x200 }),
      bytes
    );
    const outcome = outcomeOf(edit);
    const after = reportOf(applying(edit, bytes));

    expect(outcome.kind).toBe("replaced");
    expect(outcome.range).toEqual({ start: 0x2100, end: 0x2300 });
    expect(outcome.moved).toBe(1);
    // 0x2000 stays, the replacement fills 0x2100..0x2300, and the third
    // microcode has moved from 0x2200 to 0x2300.
    expect(addressesIn(after)).toEqual([0xffff_2000, 0xffff_2100, 0xffff_2300]);
    expect(signaturesIn(after)).toEqual([0x0008_06ea, 0x0009_06ea, 0x000a_0671]);
    expect(after.problems).toEqual([]);
  });

  it("pulls the run up for a smaller replacement", () => {
    // So the run stays tight and the free space stays at the end where the next
    // addition can use it.
    const bytes = runOfThree();
    const edit = add(
      fitMicrocode({ signature: 0x0009_06ea, revision: 0xf1, totalSize: 0x80 }),
      bytes
    );
    const edited = applying(edit, bytes);
    const after = reportOf(edited);

    expect(outcomeOf(edit).moved).toBe(1);
    expect(addressesIn(after)).toEqual([0xffff_2000, 0xffff_2100, 0xffff_2180]);
    // The bytes the run gave up are erased.
    expect([...edited.subarray(0x2280, 0x2300)]).toEqual([...new Uint8Array(0x80).fill(0xff)]);
    expect(after.problems).toEqual([]);
  });

  it("refuses a replacement that would leave the element", () => {
    const bytes = runOfThree();
    const padding = makeNode({
      kind: "padding",
      name: "Padding",
      header: { start: 0x1800, end: 0x1800 },
      body: { start: 0x1800, end: 0x2400 },
    });
    const parsed = new UEFIImage({
      size: bytes.length,
      roots: [padding],
      addressDiff: 0xffff_0000,
    });

    const problem = problemOf(
      add(fitMicrocode({ signature: 0x0009_06ea, totalSize: 0x400 }), bytes, parsed)
    );

    // What is asked for is the shortfall past the element's end — the room that
    // would have to be freed — not the whole amount the run grew by.
    expect(problem.kind).toBe("theRunCannotGrow");
    expect(problem.kind === "theRunCannotGrow" ? problem.needed : 0).toBe(0x200);
  });

  it("refuses a replacement that would write over something", () => {
    // Bytes belonging to something else are not room, whatever the element's
    // bounds say.
    const bytes = runOfThree();
    bytes.set(new Uint8Array(0x10).fill(0x5a), 0x2300);

    const problem = problemOf(
      add(fitMicrocode({ signature: 0x000a_0671, totalSize: 0x200 }), bytes)
    );

    expect(problem.kind).toBe("theRunCannotGrow");
    expect(problem.kind === "theRunCannotGrow" ? problem.needed : 0).toBe(0x100);
  });

  it("adds an unknown CPUID rather than replacing", () => {
    const bytes = image();
    const edit = add(fitMicrocode({ signature: 0x0009_06ea, totalSize: 0x100 }), bytes);

    expect(edit.ok && edit.transaction.name).toBe("Add Microcode");
    expect(outcomeOf(edit).kind).toBe("added");
    expect(outcomeOf(edit).range).toEqual({ start: 0x2100, end: 0x2200 });
    expect(tableEntries(tableOf(applying(edit, bytes)))).toHaveLength(2);
  });

  it("replaces the row for the matching platform", () => {
    // One CPUID can have a row per platform mask, and they are not
    // interchangeable.
    const bytes = fitImage({
      rows: [
        { type: FIT.microcodeType, target: MICROCODE },
        { type: FIT.microcodeType, target: 0x2100 },
      ],
      contents: new Map([
        [MICROCODE, fitMicrocode({ revision: 0xf0, totalSize: 0x100, platformIDs: 0x02 })],
        [0x2100, fitMicrocode({ revision: 0xec, totalSize: 0x100, platformIDs: 0x22 })],
      ]),
    });

    const outcome = outcomeOf(
      add(fitMicrocode({ revision: 0xf1, totalSize: 0x100, platformIDs: 0x22 }), bytes)
    );

    expect(outcome.kind).toBe("replaced");
    expect(outcome.entryIndex).toBe(2);
    expect(outcome.range.start).toBe(0x2100);
  });

  it("refuses a file that is not microcode before anything is planned", () => {
    expect(problemOf(add(new Uint8Array(0x100).fill(0x5a), image()))).toEqual({
      kind: "notMicrocode",
    });
  });
});

describe("replacing a specific row", () => {
  it("goes by the row and not the CPUID", () => {
    // A component for a processor the table does not name goes into the row it
    // was asked for, and the table keeps the same number of rows — where the
    // same component through the add path would have been a second row.
    const bytes = image();
    const edit = replaceAt(fitMicrocode({ signature: 0x0009_06ea, totalSize: 0x100 }), 1, bytes);
    const outcome = outcomeOf(edit);

    expect(outcome.kind).toBe("replaced");
    expect(outcome.entryIndex).toBe(1);
    expect(outcome.range).toEqual({ start: 0x2000, end: 0x2100 });

    const after = tableOf(applying(edit, bytes));
    expect(after.rows).toHaveLength(2); // the row was swapped, not a second added
    const now = tableEntries(after)[0]?.target;
    expect(now?.kind === "microcode" ? now.header.processorSignature : undefined).toBe(0x0009_06ea);
  });

  it("refuses an index that is not a microcode row", () => {
    const bytes = image();
    const other = fitMicrocode({ signature: 0x0009_06ea, totalSize: 0x100 });

    expect(problemOf(replaceAt(other, 0, bytes))).toEqual({ kind: "noSuchEntry" });
    expect(problemOf(replaceAt(other, 9, bytes))).toEqual({ kind: "noSuchEntry" });
  });
});

describe("removing", () => {
  it("closes up the run", () => {
    // A hole in the middle of it is not what a bench wants back: the body goes,
    // what follows moves up into the space, and the rows that name it follow.
    const bytes = runOfThree();
    const edit = remove(2, bytes);
    const outcome = outcomeOf(edit);
    const edited = applying(edit, bytes);
    const after = reportOf(edited);

    expect(outcome.moved).toBe(1);
    expect(outcome.erased).toEqual({ start: 0x2200, end: 0x2300 });
    expect(addressesIn(after)).toEqual([0xffff_2000, 0xffff_2100]);
    expect(signaturesIn(after)).toEqual([0x0008_06ea, 0x000a_0671]);
    // The bytes the move freed are erased.
    expect([...edited.subarray(0x2200, 0x2300)]).toEqual([...new Uint8Array(0x100).fill(0xff)]);
    expect(after.problems).toEqual([]);
  });

  it("brings the count down and erases the tail", () => {
    const bytes = runOfThree();
    const before = tableOf(bytes);
    const edit = remove(2, bytes);
    const edited = applying(edit, bytes);
    const after = tableOf(edited);

    expect(tableHeader(before)?.size).toBe(4);
    expect(tableHeader(after)?.size).toBe(3);
    expect(after.range.end - after.range.start).toBe(3 * 16);
    expect(checksumIsCorrect(after)).toBe(true);
    expect([...edited.subarray(before.range.end - 16, before.range.end)]).toEqual([
      ...new Uint8Array(16).fill(0xff),
    ]);
  });

  it("just erases the last of the run", () => {
    const bytes = runOfThree();
    const edit = remove(3, bytes);
    const outcome = outcomeOf(edit);
    const edited = applying(edit, bytes);

    expect(outcome.moved).toBe(0);
    expect(outcome.erased).toEqual({ start: 0x2200, end: 0x2300 });
    expect([...edited.subarray(0x2200, 0x2300)]).toEqual([...new Uint8Array(0x100).fill(0xff)]);
    expect([...edited.subarray(0x2000, 0x2004)]).toEqual([...bytes.subarray(0x2000, 0x2004)]);
    expect(reportOf(edited).problems).toEqual([]);
  });

  it("stops compacting at what is not erased", () => {
    // A component with anything but erase bytes in front of it is not part of
    // this run, and the compaction stops rather than writing over whatever that
    // is.
    const bytes = fitImage({
      rows: [
        { type: FIT.microcodeType, target: 0x2000 },
        { type: FIT.microcodeType, target: 0x2100 },
        { type: FIT.microcodeType, target: 0x2300 },
      ],
      contents: new Map([
        [0x2000, fitMicrocode({ signature: 0x0008_06ea, totalSize: 0x100 })],
        [0x2100, fitMicrocode({ signature: 0x0009_06ea, totalSize: 0x100 })],
        [0x2200, new Uint8Array(0x10).fill(0x5a)],
        [0x2300, fitMicrocode({ signature: 0x000a_0671, totalSize: 0x100 })],
      ]),
    });

    const edit = remove(2, bytes);
    const edited = applying(edit, bytes);
    const after = reportOf(edited);

    expect(outcomeOf(edit).moved).toBe(0); // the third does not move
    // And the bytes in the way are untouched.
    expect([...edited.subarray(0x2200, 0x2210)]).toEqual([...new Uint8Array(0x10).fill(0x5a)]);
    expect(addressesIn(after)).toEqual([0xffff_2000, 0xffff_2300]);
    expect(after.problems).toEqual([]);
  });

  it("keeps what moves up aligned to sixteen", () => {
    const bytes = fitImage({
      rows: [
        { type: FIT.microcodeType, target: 0x2000 },
        { type: FIT.microcodeType, target: 0x2110 },
        { type: FIT.microcodeType, target: 0x2220 },
      ],
      contents: new Map([
        [0x2000, fitMicrocode({ signature: 0x0008_06ea, totalSize: 0x108 })],
        [0x2110, fitMicrocode({ signature: 0x0009_06ea, totalSize: 0x108 })],
        [0x2220, fitMicrocode({ signature: 0x000a_0671, totalSize: 0x108 })],
      ]),
    });

    const edit = remove(2, bytes);
    const after = reportOf(applying(edit, bytes));

    expect(outcomeOf(edit).moved).toBe(1);
    expect(addressesIn(after)).toEqual([0xffff_2000, 0xffff_2110]);
    expect(after.problems).toEqual([]);
  });

  it("refuses a row that is not microcode", () => {
    // The extent of an ACM or a policy is not something this tool knows, so the
    // row stays and the bytes it names stay with it.
    const bytes = fitImage({
      rows: [
        { type: FIT.microcodeType, target: MICROCODE },
        { type: FIT.startupACMType, target: 0x3000 },
      ],
      contents: new Map([
        [MICROCODE, fitMicrocode({ totalSize: 0x100 })],
        [0x3000, new Uint8Array(0x40).fill(0x5a)],
      ]),
    });

    expect(problemOf(remove(2, bytes))).toEqual({ kind: "notAMicrocodeRow" });
  });

  it("refuses the header", () => {
    expect(problemOf(remove(0, image()))).toEqual({ kind: "cannotRemoveTheHeader" });
  });

  it("refuses the last microcode", () => {
    // A table without microcode will not boot the machine it came out of.
    expect(problemOf(remove(1, image()))).toEqual({ kind: "cannotRemoveTheLastMicrocode" });
  });

  it("refuses a row that is not there", () => {
    expect(problemOf(remove(9, image()))).toEqual({ kind: "noSuchEntry" });
  });

  it("comes back to where it started after an add and a remove", () => {
    // The table and the run both come back to what they were, and the file has
    // not changed size.
    const bytes = image();
    const added = applying(
      add(fitMicrocode({ signature: 0x0009_06ea, totalSize: 0x100 }), bytes),
      bytes
    );
    expect(tableHeader(tableOf(added))?.size).toBe(3);

    const back = applying(remove(2, added), added);
    const report = reportOf(back);

    expect(back.length).toBe(bytes.length);
    expect([...back]).toEqual([...bytes]); // byte for byte what it was
    expect(tableHeader(report.table ?? tableOf(back))?.size).toBe(2);
    expect(report.problems).toEqual([]);
  });
});
