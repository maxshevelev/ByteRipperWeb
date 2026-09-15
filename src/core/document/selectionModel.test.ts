import { describe, expect, it } from "vitest";
import {
  blockRange,
  blockRangeOfLength,
  rangeCount,
  rangeIsEmpty,
} from "@/core/document/blockRange";
import {
  caretAt,
  clampedSelection,
  selection,
  selectionCount,
  selectionIsEmpty,
  selectionOfLength,
  selectionRange,
} from "@/core/document/selectionModel";
import { MAX_REPRESENTABLE_SIZE } from "@/core/limits";

/** Ported from `SelectionModelTests.swift`. */

// @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SelectionModelTests.swift#SelectionModelTests.testConstruction
describe("a selection can never point outside its file", () => {
  const cases: {
    name: string;
    make: () => ReturnType<typeof selection>;
    start: number;
    end: number;
    fileSize: number;
  }[] = [
    {
      name: "an end past EOF is clamped to the size",
      make: () => selection(2, 100, 8),
      start: 2,
      end: 8,
      fileSize: 8,
    },
    {
      name: "a length inside the file",
      make: () => selectionOfLength(2, 3, 100),
      start: 2,
      end: 5,
      fileSize: 100,
    },
    {
      name: "a length overshooting EOF is clamped",
      make: () => selectionOfLength(6, 100, 8),
      start: 6,
      end: 8,
      fileSize: 8,
    },
    {
      name: "a start past EOF collapses to a caret at EOF",
      make: () => selectionOfLength(50, 1, 8),
      start: 8,
      end: 8,
      fileSize: 8,
    },
    {
      name: "a backward drag is normalised",
      make: () => selection(5, 2, 100),
      start: 2,
      end: 5,
      fileSize: 100,
    },
    {
      name: "an empty selection is a caret",
      make: () => caretAt(3, 100),
      start: 3,
      end: 3,
      fileSize: 100,
    },
    {
      name: "re-clamping to a smaller file pulls the end in",
      make: () => clampedSelection(selection(0, 10, 100), 5),
      start: 0,
      end: 5,
      fileSize: 5,
    },
    {
      // The largest length there is must not run off the end when added to a
      // start. Upstream guards UInt64 overflow; the same case, the same answer.
      name: "the largest possible length does not overshoot",
      make: () => selectionOfLength(3, MAX_REPRESENTABLE_SIZE, 100),
      start: 3,
      end: 100,
      fileSize: 100,
    },
  ];

  for (const testCase of cases) {
    it(testCase.name, () => {
      const value = testCase.make();
      expect(value.start).toBe(testCase.start);
      expect(value.end).toBe(testCase.end);
      expect(value.fileSize).toBe(testCase.fileSize);
      expect(selectionCount(value)).toBe(testCase.end - testCase.start);
      expect(selectionIsEmpty(value)).toBe(testCase.end === testCase.start);
      // A clamped selection always describes a valid range.
      expect(selectionRange(value)).toBeDefined();
    });
  }
});

// @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SelectionModelTests.swift#BlockRangeTests.testConstruction
describe("a block range validates instead of clamping", () => {
  // Except a length, which is clamped to EOF the way the Select Block dialog
  // needs it to be.
  const cases: {
    name: string;
    make: () => ReturnType<typeof blockRange>;
    expected: [start: number, count: number] | undefined;
  }[] = [
    { name: "a valid start and end", make: () => blockRange(1, 4, 10), expected: [1, 3] },
    {
      name: "a length inside the file",
      make: () => blockRangeOfLength(2, 5, 100),
      expected: [2, 5],
    },
    {
      name: "a length overshooting EOF is clamped",
      make: () => blockRangeOfLength(8, 50, 10),
      expected: [8, 2],
    },
    { name: "an empty range is valid", make: () => blockRange(3, 3, 10), expected: [3, 0] },
    {
      name: "an end before the start is rejected",
      make: () => blockRange(4, 2, 10),
      expected: undefined,
    },
    { name: "an end past EOF is rejected", make: () => blockRange(2, 11, 10), expected: undefined },
    {
      name: "a start past EOF is rejected",
      make: () => blockRange(11, 12, 10),
      expected: undefined,
    },
    {
      name: "a start past EOF is rejected with a length too",
      make: () => blockRangeOfLength(11, 1, 10),
      expected: undefined,
    },
  ];

  for (const testCase of cases) {
    it(testCase.name, () => {
      const range = testCase.make();
      if (testCase.expected === undefined) {
        expect(range).toBeUndefined();
        return;
      }
      const [start, count] = testCase.expected;
      expect(range).toBeDefined();
      if (range === undefined) return;
      expect(range.start).toBe(start);
      expect(range.end).toBe(start + count);
      expect(rangeCount(range)).toBe(count);
      expect(rangeIsEmpty(range)).toBe(count === 0);
    });
  }
});
