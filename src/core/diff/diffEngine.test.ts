import { describe, expect, it } from "vitest";
import { type DiffBlock, DiffBlockIndex } from "@/core/diff/diffBlock";
import {
  applyEdit,
  collapseEdits,
  DiffCancelled,
  type DiffEdit,
  diffBytes,
  netDiffEdit,
  scanDiff,
} from "@/core/diff/diffEngine";
import type { UndoOperation } from "@/core/edit/undoHistory";
import { MemoryBackedStorage } from "@/core/storage/memoryBackedStorage";
import { SeededRandom } from "@/core/testing/support";

/** Ported from `DiffEngineTests.swift`. */

const bytes = (values: number[]) => new Uint8Array(values);
const storage = (values: number[] | Uint8Array) =>
  new MemoryBackedStorage(values instanceof Uint8Array ? values : bytes(values));

/** A block list as `s0-3 d3-4` — one line a test can state whole. */
const shape = (index: DiffBlockIndex) =>
  index.blocks
    .map((block) => `${block.kind === "same" ? "s" : "d"}${block.start}-${block.end}`)
    .join(" ");

const scan = (left: number[] | Uint8Array, right: number[] | Uint8Array, chunkSize?: number) =>
  scanDiff(storage(left), storage(right), chunkSize === undefined ? {} : { chunkSize });

describe("block construction, byte at a time", () => {
  // The reference implementation: maximal runs at absolute offsets, with the
  // tail only one file has folded into a difference block.
  const cases: { name: string; left: number[]; right: number[]; expected: string }[] = [
    {
      name: "identical files are one same block",
      left: [1, 2, 3],
      right: [1, 2, 3],
      expected: "s0-3",
    },
    {
      name: "every byte differing is one different block",
      left: [0x01, 0x02, 0x03],
      right: [0xff, 0xfe, 0xfd],
      expected: "d0-3",
    },
    {
      name: "a single differing byte",
      left: [0xaa, 0x00, 0xaa],
      right: [0xaa, 0x01, 0xaa],
      expected: "s0-1 d1-2 s2-3",
    },
    {
      name: "alternating single bytes",
      left: [0, 0, 0, 0],
      right: [1, 0, 1, 0],
      expected: "d0-1 s1-2 d2-3 s3-4",
    },
    { name: "an empty left file", left: [], right: [1, 2, 3], expected: "d0-3" },
    { name: "an empty right file", left: [1, 2, 3], right: [], expected: "d0-3" },
    { name: "two empty files have no blocks", left: [], right: [], expected: "" },
    {
      name: "an EOF-only tail on the right",
      left: [0x00, 0x01],
      right: [0x00, 0x01, 0xaa],
      expected: "s0-2 d2-3",
    },
    {
      name: "an EOF-only tail on the left",
      left: [0x00, 0x01, 0xaa],
      right: [0x00, 0x01],
      expected: "s0-2 d2-3",
    },
    {
      // Byte 1 differs and the tail is EOF-only, so they are one block.
      name: "an EOF-only tail merges with an adjacent difference",
      left: [0x00, 0x00, 0x01, 0x02],
      right: [0x00, 0xff],
      expected: "s0-1 d1-4",
    },
  ];

  for (const testCase of cases) {
    it(testCase.name, () => {
      expect(shape(diffBytes(bytes(testCase.left), bytes(testCase.right)))).toBe(testCase.expected);
    });
  }
});

describe("the chunked scan", () => {
  it("joins a difference spanning a chunk boundary", async () => {
    const index = await scan([0, 1, 2, 3, 4, 5], [0, 1, 2, 9, 4, 5], 3);
    expect(shape(index)).toBe("s0-3 d3-4 s4-6");
  });

  it("throws when cancelled between chunks", async () => {
    let checks = 0;
    await expect(
      scanDiff(storage(new Uint8Array(8).fill(0)), storage(new Uint8Array(8).fill(1)), {
        chunkSize: 2,
        shouldCancel: () => ++checks > 1,
      })
    ).rejects.toBeInstanceOf(DiffCancelled);
  });

  it("reports progress reaching one", async () => {
    let last = -1;
    const index = await scanDiff(storage(new Uint8Array(16)), storage(new Uint8Array(16)), {
      chunkSize: 3,
      onProgress: (value) => (last = Math.max(last, value)),
    });
    expect(last).toBe(1);
    expect(shape(index)).toBe("s0-16");
  });
});

describe("looking things up", () => {
  it("finds the state at an offset", async () => {
    const index = await scan([0x00, 0x01, 0x02], [0x00, 0xff, 0x02]);
    expect(index.stateAt(0)).toBe("same");
    expect(index.stateAt(1)).toBe("different");
    expect(index.stateAt(2)).toBe("same");
    expect(index.stateAt(3)).toBeUndefined(); // past EOF
  });

  it("counts the bytes on each side for the status bar", async () => {
    const index = await scan([0, 0, 1, 0, 0], [0, 0, 2, 0, 0]);
    expect(index.summary).toEqual({ differing: 1, same: 4 });
  });

  it("answers whether anything differs at all", async () => {
    // The trap is the single-block case: identical files coalesce to one same
    // block, while wholly different ones coalesce to one different block.
    expect(DiffBlockIndex.empty().hasDifferences).toBe(false);
    expect((await scan([1, 2, 3], [1, 2, 3])).hasDifferences).toBe(false);
    expect((await scan([1, 2, 3], [0xff, 0xfe, 0xfd])).hasDifferences).toBe(true);
    expect((await scan([], [1, 2, 3])).hasDifferences).toBe(true);
    expect((await scan([0xaa, 0, 0xaa], [0xaa, 1, 0xaa])).hasDifferences).toBe(true);
  });
});

describe("navigation", () => {
  const range = (block: DiffBlock | undefined) =>
    block === undefined ? undefined : `${block.start}-${block.end}`;

  it("steps by block in both directions", async () => {
    // s0-2 d2-4 s4-6 d6-8
    const index = await scan([0, 0, 1, 1, 2, 2, 3, 3], [0, 0, 9, 9, 2, 2, 8, 8]);

    expect(range(index.firstBlockAfter(1))).toBe("2-4");
    expect(range(index.firstBlockAfter(3))).toBe("4-6");
    expect(index.firstBlockAfter(7)).toBeUndefined();
    expect(range(index.lastBlockAtOrBefore(4))).toBe("2-4");
    expect(range(index.lastBlockAtOrBefore(2))).toBe("0-2");
    expect(index.lastBlockAtOrBefore(0)).toBeUndefined();

    // Strictly after, for "next".
    expect(range(index.nextDifference(0))).toBe("2-4");
    expect(range(index.nextDifference(2))).toBe("6-8"); // skips the current block
    expect(index.nextDifference(7)).toBeUndefined();
    expect(range(index.nextSame(1))).toBe("4-6");
    expect(index.nextSame(4)).toBeUndefined();

    // At or before, for "previous".
    expect(range(index.previousDifference(4))).toBe("2-4");
    expect(range(index.previousDifference(6))).toBe("2-4");
    expect(range(index.previousDifference(8))).toBe("6-8");
    expect(index.previousDifference(1)).toBeUndefined();
    expect(range(index.previousSame(7))).toBe("4-6");
    expect(index.previousSame(1)).toBeUndefined();
  });

  it("includes the EOF-only block", async () => {
    const index = await scan([0x00, 0x01], [0x00, 0x01, 0xaa, 0xbb]);
    expect(range(index.nextDifference(0))).toBe("2-4");
    expect(range(index.previousDifference(4))).toBe("2-4");
  });

  it("stays fast across hundreds of thousands of blocks", () => {
    // Two very different large files produce one block per byte. A linear scan
    // here is exactly what froze drag selection upstream once indexing finished.
    const count = 200_000;
    const blocks: DiffBlock[] = [];
    for (let i = 0; i < count; i++) {
      blocks.push({ kind: i % 2 === 0 ? "same" : "different", start: i, end: i + 1 });
    }
    const index = DiffBlockIndex.of(count, count, blocks);

    expect(range(index.nextDifference(0))).toBe("1-2");
    expect(range(index.nextDifference(2))).toBe("3-4");
    expect(range(index.nextDifference(123_456))).toBe("123457-123458");
    expect(index.nextDifference(count - 1)).toBeUndefined();

    expect(range(index.previousDifference(4))).toBe("3-4");
    expect(range(index.previousDifference(count))).toBe(`${count - 1}-${count}`);
    expect(range(index.previousDifference(2))).toBe("1-2");
    expect(index.previousDifference(1)).toBeUndefined();

    expect(range(index.nextSame(0))).toBe("2-3");
    expect(range(index.nextSame(1))).toBe("2-3");
    expect(index.nextSame(count - 1)).toBeUndefined();

    expect(range(index.previousSame(1))).toBe("0-1");
    expect(range(index.previousSame(count))).toBe(`${count - 2}-${count - 1}`);
    expect(index.previousSame(0)).toBeUndefined();
  });
});

describe("incremental invalidation", () => {
  it("splices an overwrite back and matches a full rescan", async () => {
    const cases: {
      name: string;
      baseLeft: number[];
      right: number[];
      editedLeft: number[];
      edit: DiffEdit;
      chunkSize: number;
      expected: string;
    }[] = [
      {
        name: "same becomes different",
        baseLeft: [1, 2, 3, 4],
        right: [1, 2, 3, 4],
        editedLeft: [1, 0xff, 3, 4],
        edit: { kind: "overwrite", start: 1, end: 2 },
        chunkSize: 2,
        expected: "s0-1 d1-2 s2-4",
      },
      {
        name: "different becomes same",
        baseLeft: [1, 0xff, 3, 4],
        right: [1, 2, 3, 4],
        editedLeft: [1, 2, 3, 4],
        edit: { kind: "overwrite", start: 1, end: 2 },
        chunkSize: 1024,
        expected: "s0-4",
      },
      {
        name: "a write extending past EOF",
        baseLeft: [1, 2],
        right: [1, 2],
        editedLeft: [1, 3, 4],
        edit: { kind: "overwrite", start: 1, end: 3 },
        chunkSize: 1024,
        expected: "s0-1 d1-3",
      },
      {
        name: "a write entirely past EOF, from two empty files",
        baseLeft: [],
        right: [],
        editedLeft: [0xaa, 0xbb, 0xcc],
        edit: { kind: "overwrite", start: 2, end: 5 },
        chunkSize: 1024,
        expected: "d0-3",
      },
    ];

    for (const testCase of cases) {
      const right = storage(testCase.right);
      const base = await scanDiff(storage(testCase.baseLeft), right, {
        chunkSize: testCase.chunkSize,
      });
      const edited = storage(testCase.editedLeft);
      const updated = await applyEdit(testCase.edit, base, edited, right, {
        chunkSize: testCase.chunkSize,
      });

      expect(shape(updated), testCase.name).toBe(testCase.expected);
      expect(shape(updated), `${testCase.name}: must equal a full rescan`).toBe(
        shape(await scanDiff(edited, right, { chunkSize: testCase.chunkSize }))
      );
    }
  });

  it("rescans the tail after an insert", async () => {
    const right = storage([1, 2, 3, 4]);
    const base = await scanDiff(storage([1, 2, 3, 4, 5]), right);
    expect(shape(base)).toBe("s0-4 d4-5");

    const inserted = storage([1, 2, 0xaa, 0xbb, 3, 4, 5]);
    const updated = await applyEdit({ kind: "insert", at: 2, length: 2 }, base, inserted, right);
    expect(shape(updated)).toBe("s0-2 d2-7");
    expect(shape(updated)).toBe(shape(await scanDiff(inserted, right)));
  });

  it("rescans the tail after a delete", async () => {
    const right = storage([1, 0x0a, 3, 4]);
    const base = await scanDiff(storage([1, 2, 3, 4]), right);
    expect(shape(base)).toBe("s0-1 d1-2 s2-4");

    const deleted = storage([1, 3, 4]);
    const updated = await applyEdit({ kind: "delete", start: 1, end: 2 }, base, deleted, right);
    expect(shape(updated)).toBe("s0-1 d1-4");
    expect(shape(updated)).toBe(shape(await scanDiff(deleted, right)));
  });

  it("matches a full rescan for every edit shape", async () => {
    const right = storage([0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f]);
    const edits: [DiffEdit, number[]][] = [
      [{ kind: "overwrite", start: 2, end: 4 }, [0x0a, 0x0b, 0xff, 0xfe, 0x0e, 0x0f]],
      [{ kind: "overwrite", start: 0, end: 6 }, [1, 2, 3, 4, 5, 6]],
      [{ kind: "insert", at: 3, length: 1 }, [0x0a, 0x0b, 0x0c, 0x99, 0x0d, 0x0e, 0x0f]],
      [{ kind: "delete", start: 1, end: 4 }, [0x0a, 0x0e, 0x0f]],
    ];

    for (const [edit, newBytes] of edits) {
      const base = await scanDiff(storage([0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f]), right, {
        chunkSize: 2,
      });
      const edited = storage(newBytes);
      const updated = await applyEdit(edit, base, edited, right, { chunkSize: 2 });
      expect(shape(updated), edit.kind).toBe(
        shape(await scanDiff(edited, right, { chunkSize: 2 }))
      );
    }
  });
});

describe("the net edit a transaction produces", () => {
  const overwrite = (at: number, length: number): UndoOperation => ({
    kind: "overwrite",
    at,
    before: new Uint8Array(length),
    after: new Uint8Array(length),
  });
  const insert = (at: number, length: number): UndoOperation => ({
    kind: "insert",
    at,
    bytes: new Uint8Array(length),
  });
  const remove = (at: number, length: number): UndoOperation => ({
    kind: "delete",
    at,
    bytes: new Uint8Array(length),
  });

  const cases: { name: string; ops: UndoOperation[]; expected: DiffEdit | undefined }[] = [
    {
      name: "a single overwrite",
      ops: [overwrite(5, 1)],
      expected: { kind: "overwrite", start: 5, end: 6 },
    },
    {
      // Two nibbles of one byte are two overwrites of the same range.
      name: "a typing pair coalesces to one overwrite",
      ops: [overwrite(5, 1), overwrite(5, 1)],
      expected: { kind: "overwrite", start: 5, end: 6 },
    },
    {
      name: "a single insert",
      ops: [insert(2, 2)],
      expected: { kind: "insert", at: 2, length: 2 },
    },
    {
      name: "a single delete",
      ops: [remove(3, 3)],
      expected: { kind: "delete", start: 3, end: 6 },
    },
    {
      // replace(3..8, two bytes) records an overwrite 3..5 plus a delete 5..8:
      // a net delete of three bytes from the earliest affected offset.
      name: "a replace that shrinks becomes a delete",
      ops: [overwrite(3, 2), remove(5, 3)],
      expected: { kind: "delete", start: 3, end: 6 },
    },
    {
      // What an overwrite past EOF splits into. The overwritten byte stays at
      // 5, so the insert must start there and not at 6.
      name: "an overwrite past EOF becomes an insert",
      ops: [overwrite(5, 1), insert(6, 3)],
      expected: { kind: "insert", at: 5, length: 3 },
    },
    {
      // Undoing a committed delete-then-insert applies the inverses reversed.
      name: "an undo of delete-then-insert",
      ops: [overwrite(4, 2), insert(0, 2)],
      expected: { kind: "insert", at: 0, length: 2 },
    },
    { name: "no ops at all", ops: [], expected: undefined },
  ];

  for (const testCase of cases) {
    it(testCase.name, () => {
      expect(netDiffEdit(testCase.ops)).toEqual(testCase.expected);
    });
  }
});

describe("collapsing a batch of edits", () => {
  const overwrite = (start: number, end: number): DiffEdit => ({ kind: "overwrite", start, end });
  const insert = (at: number, length: number): DiffEdit => ({ kind: "insert", at, length });
  const remove = (start: number, end: number): DiffEdit => ({ kind: "delete", start, end });

  const cases: { name: string; edits: DiffEdit[]; expected: DiffEdit[] }[] = [
    { name: "nothing collapses to nothing", edits: [], expected: [] },
    {
      name: "a lone overwrite is kept as it is",
      edits: [overwrite(5, 9)],
      expected: [overwrite(5, 9)],
    },
    { name: "a lone insert is kept as it is", edits: [insert(5, 1)], expected: [insert(5, 1)] },
    {
      // A run of typed bytes in insert mode: every edit shifts from a slightly
      // higher offset, and the lowest one covers all of them.
      name: "a run of inserts becomes the earliest one",
      edits: Array.from({ length: 10 }, (_, i) => insert(1000 + i, 1)),
      expected: [insert(1000, 1)],
    },
    {
      name: "the earliest shifting edit wins, whichever kind it is",
      edits: [insert(900, 4), remove(40, 50), insert(500, 1)],
      expected: [remove(40, 50)],
    },
    {
      name: "an overwrite above the shift point is dropped",
      edits: [overwrite(200, 300), insert(100, 1)],
      expected: [insert(100, 1)],
    },
    {
      name: "an overwrite straddling the shift point is trimmed to it",
      edits: [overwrite(50, 300), insert(100, 1)],
      expected: [overwrite(50, 100), insert(100, 1)],
    },
    {
      name: "an overwrite entirely below the shift point survives whole",
      edits: [overwrite(10, 20), insert(100, 1)],
      expected: [overwrite(10, 20), insert(100, 1)],
    },
    {
      // A run of typed bytes in overwrite mode: adjacent windows are one.
      name: "a run of touching overwrites becomes one",
      edits: Array.from({ length: 8 }, (_, i) => overwrite(100 + i, 101 + i)),
      expected: [overwrite(100, 108)],
    },
    {
      name: "overlapping overwrites in any order become one",
      edits: [overwrite(0, 10), overwrite(20, 30), overwrite(5, 22)],
      expected: [overwrite(0, 30)],
    },
    {
      name: "overwrites with a gap between them stay apart",
      edits: [overwrite(0, 10), overwrite(40, 50)],
      expected: [overwrite(0, 10), overwrite(40, 50)],
    },
  ];

  for (const testCase of cases) {
    it(testCase.name, () => {
      expect(collapseEdits(testCase.edits)).toEqual(testCase.expected);
    });
  }

  it("describes the same damage as applying every edit", async () => {
    const size = 4096;
    const left = new Uint8Array(size).map((_, i) => i % 251);
    const right = left.slice();
    for (let i = 1000; i < 1100; i++) right[i] = (right[i] ?? 0) ^ 0xff;
    // The left side ends up one byte longer, as an insert would leave it.
    const editedLeft = storage(new Uint8Array([0xaa, ...left]));
    const rightStorage = storage(right);

    const base = await scanDiff(storage(left), rightStorage);
    const batch: DiffEdit[] = [
      { kind: "overwrite", start: 10, end: 20 },
      { kind: "insert", at: 0, length: 1 },
      { kind: "overwrite", start: 3000, end: 3010 },
    ];

    let oneByOne = base;
    for (const edit of batch) oneByOne = await applyEdit(edit, oneByOne, editedLeft, rightStorage);

    let collapsed = base;
    for (const edit of collapseEdits(batch)) {
      collapsed = await applyEdit(edit, collapsed, editedLeft, rightStorage);
    }

    expect(shape(collapsed)).toBe(shape(oneByOne));
    expect(shape(collapsed)).toBe(shape(await scanDiff(editedLeft, rightStorage)));
  });
});

describe("the word-wise scan against the byte-wise reference", () => {
  // These are the shapes word stepping can get wrong: runs shorter than a word,
  // runs straddling a word boundary, runs ending exactly on one, and a
  // difference in the buffer's last bytes.
  const matchesReference = async (left: Uint8Array, right: Uint8Array, chunkSize = 64) => {
    const expected = shape(diffBytes(left, right));
    const scanned = shape(await scanDiff(storage(left), storage(right), { chunkSize }));
    return { expected, scanned };
  };

  it("agrees for a single differing byte at every alignment", async () => {
    const size = 200;
    const base = new Uint8Array(size).map((_, i) => i % 251);
    for (const offset of [
      ...Array.from({ length: 17 }, (_, i) => i),
      size - 9,
      size - 8,
      size - 1,
    ]) {
      const other = base.slice();
      other[offset] = (other[offset] ?? 0) ^ 0xff;
      const { expected, scanned } = await matchesReference(base, other);
      expect(scanned, `one byte differing at ${offset}`).toBe(expected);
    }
  });

  it("agrees for differing runs of every length up to two words", async () => {
    const size = 200;
    const base = new Uint8Array(size).map((_, i) => i % 251);
    for (const start of [0, 1, 7, 8, 9, 62, 63, 64]) {
      for (let length = 1; length <= 17 && start + length <= size; length++) {
        const other = base.slice();
        for (let i = start; i < start + length; i++) other[i] = (other[i] ?? 0) ^ 0xff;
        const { expected, scanned } = await matchesReference(base, other);
        expect(scanned, `run ${start}..${start + length}`).toBe(expected);
      }
    }
  });

  it("agrees at the extremes and for unequal lengths", async () => {
    const size = 200;
    const base = new Uint8Array(size).map((_, i) => i % 251);
    const inverted = base.map((byte) => byte ^ 0xff);

    for (const [name, left, right] of [
      ["all bytes differ", base, inverted],
      ["no byte differs", base, base],
      ["shorter right", base, base.slice(0, 100)],
      ["shorter left", base.slice(0, 100), base],
      ["empty left", new Uint8Array(0), base],
      ["empty right", base, new Uint8Array(0)],
    ] as [string, Uint8Array, Uint8Array][]) {
      const { expected, scanned } = await matchesReference(left, right);
      expect(scanned, name).toBe(expected);
    }
  });

  it("joins runs that cross a chunk boundary", async () => {
    // The builder merges them, and the word stepping must not confuse it by
    // ending a chunk mid-run.
    const size = 300;
    const base = new Uint8Array(size).map((_, i) => i % 251);
    const other = base.slice();
    for (let i = 60; i < 70; i++) other[i] = (other[i] ?? 0) ^ 0xff; // spans a 64-byte boundary
    for (let i = 128; i < 136; i++) other[i] = (other[i] ?? 0) ^ 0xff; // starts on one

    for (const chunk of [1, 2, 7, 8, 9, 16, 64, 100, 299, 300, 1024]) {
      const { expected, scanned } = await matchesReference(base, other, chunk);
      expect(scanned, `chunk size ${chunk}`).toBe(expected);
    }
  });

  it("agrees over a random walk", async () => {
    // Mostly-equal files with scattered differences, which is what the word
    // stepping is tuned for, plus a few dense ones.
    for (let round = 0; round < 40; round++) {
      const random = new SeededRandom(0xd1ff5eed + round);
      const size = random.int(1, 601);
      const left = random.bytes(size);
      let right = left.slice();
      const differences = random.int(0, Math.floor(size / 2) + 2);
      for (let i = 0; i < differences; i++) right[random.int(0, size)] = random.int(0, 256);
      if (random.next() < 0.5) right = right.slice(0, random.int(0, size + 1));

      const { expected, scanned } = await matchesReference(left, right, random.int(1, 129));
      expect(scanned, `round ${round}`).toBe(expected);
    }
  });
});

describe("querying a window", () => {
  const index = DiffBlockIndex.of(40, 40, [
    { kind: "same", start: 0, end: 10 },
    { kind: "different", start: 10, end: 20 },
    { kind: "same", start: 20, end: 30 },
    { kind: "different", start: 30, end: 40 },
  ]);
  const kinds = (start: number, end: number) =>
    index.blocksIn(start, end).map((block) => `${block.kind === "same" ? "s" : "d"}${block.start}`);

  it("finds the blocks a window touches, by binary search", () => {
    expect(kinds(0, 40)).toEqual(["s0", "d10", "s20", "d30"]);
    expect(kinds(0, 1)).toEqual(["s0"]);
    expect(kinds(9, 11)).toEqual(["s0", "d10"]);
    expect(kinds(10, 20)).toEqual(["d10"]);
    expect(kinds(10, 21)).toEqual(["d10", "s20"]);
    expect(kinds(19, 20)).toEqual(["d10"]);
    expect(kinds(20, 20)).toEqual([]);
    expect(kinds(40, 50)).toEqual([]);
    expect(kinds(35, 50)).toEqual(["d30"]);
    expect(DiffBlockIndex.empty().blocksIn(0, 10)).toEqual([]);
  });

  it("agrees with the flattened list over a random index", () => {
    for (let round = 0; round < 30; round++) {
      const random = new SeededRandom(0x51d3b10c + round);
      const blocks: DiffBlock[] = [];
      let offset = 0;
      let kind: "same" | "different" = "same";
      while (offset < 500) {
        const length = random.int(1, 41);
        blocks.push({ kind, start: offset, end: offset + length });
        offset += length;
        kind = kind === "same" ? "different" : "same";
      }
      const built = DiffBlockIndex.of(offset, offset, blocks);

      const start = random.int(0, offset);
      const end = Math.min(offset, start + random.int(1, 120));
      const windowed = built.blocksIn(start, end);
      const scanned = built.blocks.filter((block) => block.start < end && block.end > start);
      expect(windowed, `round ${round}`).toEqual(scanned);
    }
  });
});
