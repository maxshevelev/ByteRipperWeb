import { describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import { FIT } from "@/firmware/fit/fitEntry";
import { fitProblemMessage, fitSeverity } from "@/firmware/fit/fitProblem";
import { type FITTable, readFitTable, tableEntries, tableHeader } from "@/firmware/fit/fitTable";
import { findTopSwapBackup, topSwapCopiesMatch } from "@/firmware/fit/fitTopSwap";
import { ImageReader } from "@/firmware/imageReader";
import { fitImage, fitMicrocode, type TestRow } from "@/firmware/testing/testFit";
import { file, volume } from "@/firmware/testing/testImage";
import { guidFromText } from "@/firmware/uefi/efiGuid";
import { FFS } from "@/firmware/uefi/fileParser";
import { parseUefiImage, type UEFIImage } from "@/firmware/uefi/uefiImage";
import { nodeRange } from "@/firmware/uefi/uefiNode";
import {
  backupKey,
  fitDisplay,
  focusingRow,
  rowCommands,
  rowIndexOfZone,
  rowKey,
} from "@/tools/fit/fitDisplay";
import {
  addOrReplaceMicrocode,
  type FITEdit,
  mirroringTransaction,
  removeMicrocodeAt,
} from "@/tools/fit/fitEditor";
import { validateTransaction } from "@/tools/toolTransaction";

/**
 * A microcode run that lives inside an FFS file rather than in a raw region —
 * upstream's `FITContainerTests`.
 *
 * Plenty of boards keep it there, and then a change to those bytes leaves the
 * *file's* own checksums describing what used to be in it. Putting them right
 * is part of the same edit: a file whose checksum is half-fixed is worse than
 * one that was never touched.
 */

const FIRST = 0x4060;
const SECOND = 0x4160;
const ADDRESS_DIFF = 0xffff_0000;

const guid = (text: string) => {
  const parsed = guidFromText(text);
  if (parsed === undefined) throw new Error(`${text} is not a GUID`);
  return parsed;
};

const RUN_FILE = guid("AABBCCDD-1122-3344-5566-778899AABBCC");
const OTHER_FILE = guid("11223344-5566-7788-99AA-BBCCDDEEFF00");

/**
 * A raw FFS file with a real body checksum, so an edit to its body has
 * something to invalidate.
 */
const rawFile = (
  body: Uint8Array,
  options: { checksummed?: boolean; guid?: typeof RUN_FILE } = {}
) =>
  file({
    guid: options.guid ?? RUN_FILE,
    type: FFS.rawType,
    attributes: (options.checksummed ?? true) ? FFS.checksumBit : 0,
    body,
  });

/** A 0x1000-byte FFSv2 volume holding one run of files. */
const holding = (...files: Uint8Array[]) => volume({ length: 0x1000, files });

/** The parts laid end to end, which is how every fixture body here is built. */
function join(...parts: readonly Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(parts.reduce((total, one) => total + one.length, 0));
  let at = 0;
  for (const part of parts) {
    bytes.set(part, at);
    at += part.length;
  }
  return bytes;
}

const readerOver = (bytes: Uint8Array) => new ImageReader(sourceOver(bytes));
const parse = (bytes: Uint8Array): UEFIImage => parseUefiImage(sourceOver(bytes));

/**
 * The FFS file holding `offset` — the element that bounds a run. The microcode
 * images inside it are nodes of their own, so the innermost node there is the
 * image, not the file.
 */
const fileAt = (tree: UEFIImage, offset: number) =>
  tree.allNodes.find(
    (node) =>
      node.kind === "file" && nodeRange(node).start <= offset && offset < nodeRange(node).end
  );

/** Where the element covering `offset` ends — the bound a run may not grow past. */
function endOfNodeAt(tree: UEFIImage, offset: number): number {
  const node = fileAt(tree, offset) ?? tree.innermostNodeContaining(offset);
  if (node === undefined) throw new Error(`nothing covers 0x${offset.toString(16)}`);
  return nodeRange(node).end;
}

function tableIn(bytes: Uint8Array, parsed: UEFIImage): FITTable {
  const table = readFitTable(readerOver(bytes), parsed).table;
  if (table === undefined) throw new Error("the fixture has no table");
  return table;
}

function applying<T>(edit: FITEdit<T>, bytes: Uint8Array): Uint8Array {
  if (!edit.ok) throw new Error(`refused: ${JSON.stringify(edit.problem)}`);
  const checked = validateTransaction(edit.transaction);
  if (!checked.ok) throw new Error(`invalid: ${checked.problem.kind}`);
  const edited = Uint8Array.from(bytes);
  for (const write of checked.transaction.writes) edited.set(write.bytes, write.offset);
  return edited;
}

function outcomeOf<T>(edit: FITEdit<T>): T {
  if (!edit.ok) throw new Error(`refused: ${JSON.stringify(edit.problem)}`);
  return edit.outcome;
}

function problemOf<T>(edit: FITEdit<T>) {
  if (edit.ok) throw new Error("expected a refusal rather than a loose component");
  return edit.problem;
}

/** The checksum complaints a parse of these bytes raises. */
const checksumProblems = (bytes: Uint8Array) =>
  parse(bytes).diagnostics.filter((one) => one.detail.kind === "checksumMismatch");

/**
 * A volume at 0x4000 with one raw FFS file in it whose body is two microcodes,
 * and a FIT at 0x1000 that names them.
 */
function containerImage(
  options: {
    readonly slack?: number;
    readonly checksummed?: boolean;
    readonly neighbour?: boolean;
  } = {}
): Uint8Array {
  const run = join(
    fitMicrocode({ signature: 0x0008_06ea, totalSize: 0x100 }),
    fitMicrocode({ signature: 0x0009_06ea, totalSize: 0x100 }),
    new Uint8Array(options.slack ?? 0).fill(0xff)
  );
  const files = [rawFile(run, { checksummed: options.checksummed ?? true })];
  if (options.neighbour === true) {
    files.push(rawFile(new Uint8Array(0x100).fill(0x5a), { guid: OTHER_FILE }));
  }
  return fitImage({
    rows: [
      { type: FIT.microcodeType, target: FIRST },
      { type: FIT.microcodeType, target: SECOND },
    ],
    addressDiff: ADDRESS_DIFF,
    contents: new Map([[0x4000, holding(...files)]]),
  });
}

const removeIn = (index: number, bytes: Uint8Array, parsed: UEFIImage) =>
  removeMicrocodeAt(index, tableIn(bytes, parsed), parsed, readerOver(bytes), ADDRESS_DIFF);

const addIn = (component: Uint8Array, bytes: Uint8Array, parsed: UEFIImage) =>
  addOrReplaceMicrocode(component, tableIn(bytes, parsed), parsed, readerOver(bytes), ADDRESS_DIFF);

describe("a run inside an FFS file", () => {
  // @upstream Modules/FITTool/Tests/FITToolTests/FITContainerTests.swift#FITContainerTests.testTheFixtureStartsOutRight
  it("starts out a valid image", () => {
    // Or the tests below prove nothing.
    const bytes = containerImage({ slack: 0x200 });
    const parsed = parse(bytes);

    expect(checksumProblems(bytes)).toEqual([]);
    // The raw file reads as its microcode images, and the file around them is
    // the element a component must not grow past.
    expect(parsed.innermostNodeContaining(FIRST)?.kind).toBe("microcode");
    expect(fileAt(parsed, FIRST)).toBeDefined();
    const report = readFitTable(readerOver(bytes), parsed);
    expect(report.problems).toEqual([]);
    expect(
      report.table === undefined
        ? []
        : tableEntries(report.table).map((row) =>
            row.target.kind === "microcode" ? row.target.header.offset : undefined
          )
    ).toEqual([FIRST, SECOND]);
  });

  // @upstream Modules/FITTool/Tests/FITToolTests/FITContainerTests.swift#FITContainerTests.testRemovingInsideAFileRepairsThatFilesChecksums
  it("repairs that file's checksums when a removal moves its body", () => {
    const bytes = containerImage({ slack: 0x200 });
    const parsed = parse(bytes);
    const edit = removeIn(1, bytes, parsed);
    const edited = applying(edit, bytes);

    expect(outcomeOf(edit).moved).toBe(1);
    expect(checksumProblems(edited)).toEqual([]);
    const after = readFitTable(readerOver(edited), parse(edited));
    expect(
      after.table === undefined ? [] : tableEntries(after.table).map((row) => row.entry.address)
    ).toEqual([0xffff_4060]);
    expect(after.problems).toEqual([]);
  });

  // @upstream Modules/FITTool/Tests/FITToolTests/FITContainerTests.swift#FITContainerTests.testReplacingInsideAFileRepairsThatFilesChecksums
  it("repairs them when a replacement of another size moves its body", () => {
    const bytes = containerImage({ slack: 0x200 });
    const parsed = parse(bytes);
    const edit = addIn(
      fitMicrocode({ signature: 0x0008_06ea, revision: 0xf1, totalSize: 0x180 }),
      bytes,
      parsed
    );
    const edited = applying(edit, bytes);

    expect(outcomeOf(edit).moved).toBe(1);
    expect(checksumProblems(edited)).toEqual([]);
  });

  // @upstream Modules/FITTool/Tests/FITToolTests/FITContainerTests.swift#FITContainerTests.testAFileWithNoBodyChecksumIsLeftAlone
  it("leaves a file with no body checksum alone", () => {
    // Without the attribute the field carries a fixed value, and which one
    // depends on the *volume's* revision. A change to the body leaves that
    // value right, so the repair has nothing to write — and must not write the
    // other revision's constant over it.
    const bytes = containerImage({ checksummed: false });
    expect(checksumProblems(bytes)).toEqual([]);
    const parsed = parse(bytes);

    const edited = applying(removeIn(1, bytes, parsed), bytes);

    expect(checksumProblems(edited)).toEqual([]);
  });
});

describe("growing out of the file", () => {
  // @upstream Modules/FITTool/Tests/FITToolTests/FITContainerTests.swift#FITContainerTests.testANewMicrocodeGoesIntoTheVolumesFreeSpace
  it("puts a new microcode in the volume's free space, and grows the file over it", () => {
    // The shape a real board has: a raw FFS file holding the run with no slack
    // left in it, and the volume's own free space directly behind that file.
    const bytes = containerImage();
    const parsed = parse(bytes);
    // The file ends right behind the second microcode, so there is nothing free
    // inside it at all.
    expect(endOfNodeAt(parsed, SECOND)).toBe(SECOND + 0x100);

    const edit = addIn(fitMicrocode({ signature: 0x000a_0671, totalSize: 0x300 }), bytes, parsed);
    const outcome = outcomeOf(edit);
    const edited = applying(edit, bytes);
    const after = readFitTable(readerOver(edited), parse(edited));

    expect(outcome.kind).toBe("added");
    // The free space starts where the file ends.
    expect(outcome.range.start).toBe(SECOND + 0x100);
    expect(outcome.range.start % 16).toBe(0);
    expect(after.table === undefined ? 0 : tableEntries(after.table).length).toBe(3);
    expect(after.problems).toEqual([]);
    expect(checksumProblems(edited)).toEqual([]);

    // The file grew to cover it, so the component is inside a structure rather
    // than loose in the volume's free space — and the free space shrank by
    // exactly as much, without anything having to record it.
    const tree = parse(edited);
    // And the new component reads as microcode inside it.
    expect(tree.innermostNodeContaining(outcome.range.start)?.kind).toBe("microcode");
    expect(endOfNodeAt(tree, outcome.range.start)).toBe(outcome.range.end);
    const free = tree.allNodes.find((node) => node.kind === "freeSpace");
    expect(free === undefined ? -1 : nodeRange(free).start).toBe(outcome.range.end);
    // Nothing is left loose in the volume.
    expect(tree.allNodes.some((node) => node.kind === "nonUEFIData")).toBe(false);
  });

  // @upstream Modules/FITTool/Tests/FITToolTests/FITContainerTests.swift#FITContainerTests.testAReplacementThatOutgrowsTheFileGrowsIt
  it("grows the file for a replacement that outgrows it", () => {
    // The same move an addition makes, for the same reason: the run belongs
    // inside a structure.
    const bytes = containerImage({ slack: 0x200 });
    const parsed = parse(bytes);
    const fileEnd = endOfNodeAt(parsed, FIRST);

    const edit = addIn(fitMicrocode({ signature: 0x0008_06ea, totalSize: 0x400 }), bytes, parsed);
    const edited = applying(edit, bytes);
    const tree = parse(edited);

    expect(outcomeOf(edit).moved).toBe(1);
    expect(fileAt(tree, FIRST)).toBeDefined();
    expect(endOfNodeAt(tree, FIRST)).toBeGreaterThan(fileEnd);
    expect(checksumProblems(edited)).toEqual([]);
    expect(tree.allNodes.some((node) => node.kind === "nonUEFIData")).toBe(false);
    expect(readFitTable(readerOver(edited), tree).problems).toEqual([]);
  });

  // @upstream Modules/FITTool/Tests/FITToolTests/FITContainerTests.swift#FITContainerTests.testAFileWithSomethingBehindItIsNotGrown
  it("does not grow a file with another one behind it", () => {
    // The free space beyond that neighbour is not somewhere to drop a
    // component: the volume's own walk would meet it as a file that is not one.
    // So the addition is refused rather than leaving a volume full of nonsense.
    const bytes = containerImage({ neighbour: true });
    const parsed = parse(bytes);
    // Precondition: the file has no slack.
    expect(endOfNodeAt(parsed, SECOND)).toBe(SECOND + 0x100);

    const problem = problemOf(
      addIn(fitMicrocode({ signature: 0x000a_0671, totalSize: 0x100 }), bytes, parsed)
    );

    expect(problem.kind).toBe("theRunCannotGrow");
  });

  // @upstream Modules/FITTool/Tests/FITToolTests/FITContainerTests.swift#FITContainerTests.testAReplacementIsRefusedWhereTheFileCannotGrow
  it("refuses a replacement where the file cannot grow", () => {
    const bytes = containerImage({ neighbour: true });
    const parsed = parse(bytes);

    const problem = problemOf(
      addIn(fitMicrocode({ signature: 0x0008_06ea, totalSize: 0x200 }), bytes, parsed)
    );

    expect(problem.kind).toBe("theRunCannotGrow");
  });
});

describe("a file padded with something that is not 0xFF", () => {
  /**
   * An image whose FIT table sits inside a second file in the same volume, that
   * file padded to its end with spaces — which is what one real board does.
   *
   * The volume holds the microcode file with slack of its own and then the
   * table's file, whose body starts where the first one ends. The table is
   * written over the front of that body and the rest of it stays 0x20.
   */
  function paddedWithSpaces(rows: number): Uint8Array {
    // Exactly as many components as the table names: one the table does not
    // name is a component in the way, and the tool is right to refuse to write
    // over it.
    const parts = [fitMicrocode({ signature: 0x0008_06ea, totalSize: 0x100 })];
    if (rows > 1) parts.push(fitMicrocode({ signature: 0x0009_06ea, totalSize: 0x100 }));
    parts.push(new Uint8Array(0x200).fill(0xff));
    const run = join(...parts);
    const spaces = rawFile(new Uint8Array(0x200).fill(0x20), { guid: OTHER_FILE });

    const table: TestRow[] = [{ type: FIT.microcodeType, target: FIRST }];
    if (rows > 1) table.push({ type: FIT.microcodeType, target: SECOND });
    // 0x48 volume header, 0x18 file header, the run, and 0x18 for the second
    // file's header: where the table's own body begins.
    const tableOffset = 0x4000 + 0x48 + 0x18 + run.length + 0x18;
    return fitImage({
      tableOffset,
      rows: table,
      addressDiff: ADDRESS_DIFF,
      contents: new Map([[0x4000, holding(rawFile(run), spaces)]]),
    });
  }

  // @upstream Modules/FITTool/Tests/FITToolTests/FITContainerTests.swift#FITContainerTests.testAFilePaddedWithSomethingElseStillHasRoom
  it("still has room in it", () => {
    // The specification says nothing about what unused space inside a file has
    // to contain; only a volume's free space is described. What marks filler is
    // the uniformity, not the byte.
    const bytes = paddedWithSpaces(1);
    const parsed = parse(bytes);
    const table = tableIn(bytes, parsed);
    expect(parsed.innermostNodeContaining(table.range.start)?.kind).toBe("file");

    const edit = addIn(fitMicrocode({ signature: 0x000a_0671, totalSize: 0x100 }), bytes, parsed);
    const edited = applying(edit, bytes);
    const after = readFitTable(readerOver(edited), parse(edited));

    expect(outcomeOf(edit).kind).toBe("added");
    // The table grew into the padding.
    expect(after.table === undefined ? 0 : tableHeader(after.table)?.size).toBe(3);
    expect(after.problems).toEqual([]);
  });

  // @upstream Modules/FITTool/Tests/FITToolTests/FITContainerTests.swift#FITContainerTests.testWhatARemovalGivesBackIsFilledTheWayTheFileIs
  it("gets back what an edit gives up padded the same way", () => {
    // So the tail stays the one uniform stretch the next edit can use.
    const bytes = paddedWithSpaces(2);
    const parsed = parse(bytes);
    const table = tableIn(bytes, parsed);
    const tableEnd = table.range.end;

    const edited = applying(removeIn(2, bytes, parsed), bytes);

    // The row it gave up is padded like the rest of the file.
    expect([...edited.subarray(tableEnd - 16, tableEnd)]).toEqual([
      ...new Uint8Array(16).fill(0x20),
    ]);
  });
});

/** Ported from upstream's `FITTopSwapTests`, in `FITContainerTests.swift`. */
describe("a Top Swap image", () => {
  /**
   * A 64 KiB block with a FIT at 0x1000 naming two microcodes in a file of a
   * volume at 0x4000 — the block an image keeps twice.
   */
  const block = (checksum?: number) =>
    fitImage({
      rows: [
        { type: FIT.microcodeType, target: FIRST },
        { type: FIT.microcodeType, target: SECOND },
      ],
      ...(checksum === undefined ? {} : { checksum }),
      contents: new Map([
        [
          0x4000,
          holding(
            rawFile(
              join(
                fitMicrocode({ signature: 0x0008_06ea, totalSize: 0x100 }),
                fitMicrocode({ signature: 0x0009_06ea, totalSize: 0x100 })
              )
            )
          ),
        ],
      ]),
    });
  const SWAP_DIFF = 0xfffe_0000;
  const reportOf = (bytes: Uint8Array) => readFitTable(readerOver(bytes), parse(bytes));

  // @upstream Modules/FITTool/Tests/FITToolTests/FITContainerTests.swift#FITTopSwapTests.testTheBackupIsFoundByItsOwnFIT
  it("finds the backup by its own FIT", () => {
    const bytes = join(block(), block());
    const found = findTopSwapBackup(tableIn(bytes, parse(bytes)), readerOver(bytes));
    expect(found?.top).toEqual({ start: 0x1_0000, end: 0x2_0000 });
    expect(found?.backup).toEqual({ start: 0, end: 0x1_0000 });
    expect(found === undefined ? false : topSwapCopiesMatch(found, readerOver(bytes))).toBe(true);

    // One block, and no copy of it.
    const single = block();
    expect(findTopSwapBackup(tableIn(single, parse(single)), readerOver(single))).toBeUndefined();
    // Bytes below that hold no FIT of their own are not a backup.
    const unrelated = join(new Uint8Array(0x1_0000).fill(0xff), block());
    unrelated[0xffc0] = 0x00;
    expect(
      findTopSwapBackup(tableIn(unrelated, parse(unrelated)), readerOver(unrelated))
    ).toBeUndefined();
  });

  // @upstream Modules/FITTool/Tests/FITToolTests/FITContainerTests.swift#FITTopSwapTests.testAnAdditionLandsInTheBackupToo
  it("makes an addition in the backup too", () => {
    const bytes = join(block(), block());
    const parsed = parse(bytes);
    const edit = addOrReplaceMicrocode(
      fitMicrocode({ signature: 0x000a_0671, totalSize: 0x300 }),
      tableIn(bytes, parsed),
      parsed,
      readerOver(bytes),
      SWAP_DIFF
    );
    const edited = applying(edit, bytes);

    expect(outcomeOf(edit).topSwapBackup).toEqual({ start: 0, end: 0x1_0000 });
    expect(edited).not.toEqual(bytes);
    // Both copies carry the change.
    expect(edited.subarray(0, 0x1_0000)).toEqual(edited.subarray(0x1_0000));
    // The backup, read as the top block it becomes when the swap is set.
    const swapped = Uint8Array.from(edited.subarray(0, 0x1_0000));
    const report = readFitTable(readerOver(swapped), parse(swapped));
    expect(report.table === undefined ? 0 : tableEntries(report.table).length).toBe(3);
    expect(report.problems).toEqual([]);
  });

  // @upstream Modules/FITTool/Tests/FITToolTests/FITContainerTests.swift#FITTopSwapTests.testARemovalLandsInTheBackupToo
  it("makes a removal in the backup too", () => {
    const bytes = join(block(), block());
    const parsed = parse(bytes);
    const edit = removeMicrocodeAt(1, tableIn(bytes, parsed), parsed, readerOver(bytes), SWAP_DIFF);
    const edited = applying(edit, bytes);

    expect(outcomeOf(edit).topSwapBackup).toEqual({ start: 0, end: 0x1_0000 });
    expect(edited.subarray(0, 0x1_0000)).toEqual(edited.subarray(0x1_0000));
    const lower = readFitTable(readerOver(Uint8Array.from(edited.subarray(0, 0x1_0000))));
    expect(lower.table === undefined ? 0 : tableEntries(lower.table).length).toBe(1);
  });

  // Copies that already differ are not changed as if they did not: the change is
  // refused, and says where the other copy is.
  // @upstream Modules/FITTool/Tests/FITToolTests/FITContainerTests.swift#FITTopSwapTests.testCopiesThatDifferAreNotChanged
  it("refuses to change copies that differ", () => {
    const backup = block();
    backup[0x8000] = 0x00;
    const bytes = join(backup, block());
    const parsed = parse(bytes);
    const edit = addOrReplaceMicrocode(
      fitMicrocode({ signature: 0x000a_0671, totalSize: 0x300 }),
      tableIn(bytes, parsed),
      parsed,
      readerOver(bytes),
      SWAP_DIFF
    );
    expect(problemOf(edit)).toEqual({
      kind: "topSwapCopiesDiffer",
      backup: { start: 0, end: 0x1_0000 },
    });
  });

  // @upstream Modules/FITTool/Tests/FITToolTests/FITContainerTests.swift#FITTopSwapTests.testAChecksumFixLandsInTheBackupToo
  it("writes a checksum fix into the backup too", () => {
    const bytes = join(block(0x00), block(0x00));
    const report = reportOf(bytes);
    expect(report.backup?.block.backup).toEqual({ start: 0, end: 0x1_0000 });
    expect(fitDisplay(report).checksumFix?.writes.map((write) => write.offset)).toEqual([
      0x1_100f, 0x100f,
    ]);

    const lone = reportOf(join(block(), block(0x00)));
    // A backup whose table differs is not written into.
    expect(lone.backup?.tableBytesMatch).toBe(false);
    expect(fitDisplay(lone).checksumFix?.writes).toHaveLength(1);
  });

  // The backup's copy of the table follows it, read-only, at its own offsets.
  // @upstream Modules/FITTool/Tests/FITToolTests/FITContainerTests.swift#FITTopSwapTests.testTheBackupsRowsFollowTheTableReadOnly
  it("lists the backup's rows after the table, read-only", () => {
    const report = reportOf(join(block(), block()));
    expect(report.backup?.status).toEqual({ kind: "identical" });
    // At its own place in the file.
    expect(report.backup?.table?.range.start).toBe(0x1000);
    expect(report.problems).toEqual([]);

    const display = fitDisplay(report);
    expect(display.rows).toHaveLength(6);
    expect(display.backupStart).toBe(3);
    expect(display.backupHeading).toBe("Top Swap backup at 0x0 · read-only · same as above");
    expect(display.summary).toContain("Top Swap backup matches");

    const copy = display.rows[4];
    if (copy === undefined) throw new Error("no backup row");
    expect(copy.isBackup).toBe(true);
    expect(rowKey(copy)).toBe(backupKey(1));
    expect(copy.zoneId).toBe("fit.backup.row.1");
    expect(copy.targetRange?.start).toBe(0x4060);
    // Nothing that changes the table.
    expect(rowCommands(copy)).toEqual([
      { kind: "goToOffset", offset: 0x4060 },
      { kind: "copyCPUID", cpuid: "806EA" },
    ]);
    const top = display.rows[1];
    expect(top === undefined ? [] : rowCommands(top).map((one) => one.kind)).toContain(
      "replaceMicrocode"
    );
    expect(rowIndexOfZone("fit.backup.target.1")).toBe(backupKey(1));
    expect(display.zones.zones.find((zone) => zone.id === "fit.backup.target.1")?.start).toBe(
      0x4060
    );
    expect(focusingRow(display, rowKey(copy)).detail.title).toBe("Backup #2 Microcode");
  });

  // @upstream Modules/FITTool/Tests/FITToolTests/FITContainerTests.swift#FITTopSwapTests.testABackupWhoseMicrocodeDiffersIsWarnedAbout
  it("warns about a backup whose microcode differs", () => {
    const lower = block();
    lower[0x4164] = (lower[0x4164] ?? 0) ^ 0xff; // the second microcode's revision, in the backup
    const report = reportOf(join(lower, block()));

    expect(report.backup?.status).toEqual({ kind: "tableDiffers", rows: [2] });
    expect(
      report.problems.some(
        (one) => one.detail.kind === "topSwapTableDiffers" && one.detail.at === 0x1000
      )
    ).toBe(true);
    const entry = report.problems.find((one) => one.detail.kind === "topSwapEntryDiffers");
    expect(entry?.entryIndex).toBe(2);
    expect(entry?.inBackup).toBe(true);
    expect(entry === undefined ? undefined : fitSeverity(entry.detail)).toBe("warning");
    expect(entry === undefined ? "" : fitProblemMessage(entry)).toMatch(/^Top Swap backup: /);

    const display = fitDisplay(report);
    expect(display.backupHeading).toBe(
      "Top Swap backup at 0x0 · read-only · differs from the table above"
    );
    // The backup's row wears it, not the table's.
    expect(display.rows.filter((row) => row.hasProblem).map(rowKey)).toEqual([backupKey(2)]);
  });

  // @upstream Modules/FITTool/Tests/FITToolTests/FITContainerTests.swift#FITTopSwapTests.testABackupWithOtherBytesDifferentSaysEditsWaitForIt
  it("says edits wait for a backup whose other bytes differ", () => {
    const lower = block();
    lower[0x8000] = 0x00;
    const report = reportOf(join(lower, block()));
    expect(report.backup?.status).toEqual({ kind: "otherBytesDiffer" });
    expect(report.problems.map((one) => one.detail)).toEqual([
      { kind: "topSwapBlockDiffers", backup: { start: 0, end: 0x1_0000 } },
    ]);
  });

  // @upstream Modules/FITTool/Tests/FITToolTests/FITContainerTests.swift#FITTopSwapTests.testAWriteAcrossTheBlocksHasNoPlaceInTheCopy
  it("refuses a write across the blocks, which has no place in the copy", () => {
    const copy = { top: { start: 0x1_0000, end: 0x2_0000 }, backup: { start: 0, end: 0x1_0000 } };
    const across = { name: "Edit", writes: [{ offset: 0xfff8, bytes: new Uint8Array(0x10) }] };
    expect(mirroringTransaction(copy, across)).toEqual({
      ok: false,
      problem: { kind: "topSwapWriteCrossesTheBlocks", at: 0xfff8 },
    });
    const inside = { name: "Edit", writes: [{ offset: 0x1_2000, bytes: Uint8Array.of(1, 2) }] };
    const mirrored = mirroringTransaction(copy, inside);
    expect(mirrored.ok ? mirrored.transaction.writes.map((write) => write.offset) : []).toEqual([
      0x1_2000, 0x2000,
    ]);
  });
});
