import { describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import { FIT } from "@/firmware/fit/fitEntry";
import { fitProblemMessage, fitSeverity } from "@/firmware/fit/fitProblem";
import { readFitTable } from "@/firmware/fit/fitTable";
import { ImageReader } from "@/firmware/imageReader";
import * as Test from "@/firmware/testing/testFit";

/** Ported from `FITValidatorTests.swift`: the list a bench opens this panel to read. */

const MICROCODE_AT = 0x2000;
const goodRow: Test.TestRow = { type: FIT.microcodeType, target: MICROCODE_AT };

const problems = (
  rows: readonly Test.TestRow[],
  options: { checksum?: number; checksumValid?: boolean; headerType?: number } = {}
) => {
  const bytes = Test.fitImage({
    rows,
    ...options,
    contents: new Map([[MICROCODE_AT, Test.fitMicrocode()]]),
  });
  return readFitTable(new ImageReader(sourceOver(bytes))).problems.filter(
    (one) => fitSeverity(one.detail) === "error"
  );
};

describe("the invariants", () => {
  it("find nothing wrong with a good table", () => {
    expect(problems([goodRow])).toEqual([]);
  });

  // A FIT handler is allowed to stop looking at the first type past the one it
  // wants, so order is a rule and not a preference.
  it("report types that decrease", () => {
    const found = problems([{ type: FIT.startupACMType, target: 0x3000 }, goodRow]);

    expect(found.map((one) => one.detail)).toEqual([
      { kind: "typesOutOfOrder", previous: FIT.startupACMType, type: FIT.microcodeType },
    ]);
    expect(found[0]?.entryIndex).toBe(2);
  });

  it("report a second header", () => {
    const found = problems([goodRow, { type: FIT.headerType, address: 0 }]);
    expect(found.some((one) => one.detail.kind === "secondHeader" && one.entryIndex === 2)).toBe(
      true
    );
  });

  it("report a first entry that is not the header", () => {
    const found = problems([goodRow], { headerType: FIT.microcodeType });
    expect(
      found.some(
        (one) =>
          one.detail.kind === "firstEntryIsNotTheHeader" && one.detail.type === FIT.microcodeType
      )
    ).toBe(true);
  });

  // A table without microcode will not boot the machine it came out of.
  it("report a table with no microcode", () => {
    const found = problems([{ type: FIT.startupACMType, target: 0x3000 }]);
    expect(found.some((one) => one.detail.kind === "noMicrocodeEntry")).toBe(true);
  });

  it("report an address that is not aligned", () => {
    const found = problems([{ type: FIT.microcodeType, target: MICROCODE_AT + 4 }]);
    expect(
      found.some(
        (one) => one.detail.kind === "addressNotAligned" && one.detail.address === 0xffff_2004
      )
    ).toBe(true);
  });

  it("report an address outside the image", () => {
    const found = problems([goodRow, { type: FIT.startupACMType, address: 0x40 }]);
    expect(
      found.some(
        (one) => one.detail.kind === "addressOutsideTheImage" && one.detail.address === 0x40
      )
    ).toBe(true);
  });
});

describe("the table checksum", () => {
  // The checksum left over from the edit before.
  it("is reported when it is stale", () => {
    const found = problems([goodRow], { checksum: 0xcc });

    expect(found).toHaveLength(1);
    expect(found[0]?.detail).toMatchObject({ kind: "checksumMismatch", stored: 0xcc });
    expect(found[0]?.detail.kind === "checksumMismatch" && found[0].detail.computed).not.toBe(0xcc);
    expect(found[0]?.offset).toBe(0x100f);
  });

  // The header's own bit decides whether anyone checks the sum, so a table that
  // never claimed a checksum is not wrong for having none.
  it("is not checked when the header says it does not count", () => {
    expect(problems([goodRow], { checksum: 0xcc, checksumValid: false })).toEqual([]);
  });
});

/**
 * The reserved byte is a subtype on a CSE SecureBoot entry and reserved
 * everywhere else — a rule that reads as noise if it is applied to the one type
 * that breaks it.
 */
describe("the reserved byte", () => {
  const allProblems = (rows: readonly Test.TestRow[]) =>
    readFitTable(
      new ImageReader(
        sourceOver(
          Test.fitImage({ rows, contents: new Map([[MICROCODE_AT, Test.fitMicrocode()]]) })
        )
      )
    ).problems;

  it("is a warning where it is reserved", () => {
    const found = allProblems([goodRow, { type: FIT.startupACMType, target: 0x3000, reserved: 3 }]);
    expect(
      found.some(
        (one) =>
          one.detail.kind === "reservedIsNotZero" &&
          one.detail.value === 3 &&
          fitSeverity(one.detail) === "warning"
      )
    ).toBe(true);
  });

  it("is nothing to say where it is a subtype", () => {
    const found = allProblems([
      goodRow,
      { type: FIT.cseSecureBootType, target: 0x3000, reserved: 8 },
    ]);
    expect(found.some((one) => one.detail.kind === "reservedIsNotZero")).toBe(false);
  });
});

describe("every problem", () => {
  it("points somewhere, and says something", () => {
    const found = problems([{ type: FIT.startupACMType, address: 0x40 }, goodRow], {
      checksum: 0xcc,
    });

    expect(found.length).toBeGreaterThan(0);
    expect(found.every((one) => one.offset !== undefined)).toBe(true);
    expect(found.every((one) => fitProblemMessage(one).length > 0)).toBe(true);
  });
});
