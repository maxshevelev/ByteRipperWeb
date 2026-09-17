import { describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import { FIT } from "@/firmware/fit/fitEntry";
import type { FITProblem } from "@/firmware/fit/fitProblem";
import { readFitTable } from "@/firmware/fit/fitTable";
import type { ImageRange } from "@/firmware/imageReader";
import { ImageReader } from "@/firmware/imageReader";
import { fitImage, fitMicrocode, type TestRow } from "@/firmware/testing/testFit";
import type { ProtectedRangeKind, ProtectedRanges } from "@/firmware/uefi/protectedRanges";
import { UEFIImage } from "@/firmware/uefi/uefiImage";
import {
  type FITDisplay,
  type FITDisplayRow,
  fitDisplay,
  protecting,
  ratingLatest,
} from "@/tools/fit/fitDisplay";
import { FIT_ROW_MARKS, fitRowMarks, holdsChecks, verdict } from "@/tools/fit/fitRowMarks";
import { rowMarkChannel, type ToolRowMarks } from "@/tools/toolRowMarks";

/**
 * What a FIT row wears, in the shared catalogue's icons
 * (`Design/ROW_MARKS.md` §5.2) — upstream's `FITRowMarksTests`.
 *
 * The two gaps this port has are checked here too: the Boot Guard background
 * and the partly-protected badge (G3) are never drawn, so they are not in the
 * legend either, and a FIT row never wears the rail.
 */

const MICROCODE = 0x2000;

function display(rows: readonly TestRow[], microcodeBytes?: Uint8Array): FITDisplay {
  const bytes = fitImage({
    rows,
    contents: new Map([[MICROCODE, microcodeBytes ?? fitMicrocode({ totalSize: 0x180 })]]),
    addressDiff: 0xffff_0000,
  });
  const image = new UEFIImage({ size: 0x1_0000, roots: [], addressDiff: 0xffff_0000 });
  return fitDisplay(readFitTable(new ImageReader(sourceOver(bytes)), image));
}

/**
 * @upstream Modules/FITTool/Tests/FITToolTests/FITRowMarksTests.swift#FITRowMarksTests.ranges
 */
const protectedBy = (
  list: readonly (readonly [ProtectedRangeKind, ImageRange])[]
): ProtectedRanges => ({
  ranges: list.map(([kind, range]) => ({
    kind,
    range,
    digests: [],
    source: { start: 0xf000, end: 0xf010 },
    verdict: { kind: "unchecked" as const },
  })),
  obbDigests: [],
  diagnostics: [],
});

function rowAt(rows: readonly FITDisplayRow[], index: number): FITDisplayRow {
  const row = rows[index];
  if (row === undefined) throw new Error(`the fixture has no row ${index}`);
  return row;
}

/** What row `index` of a display wears. */
function marksOf(shown: FITDisplay, index: number): ToolRowMarks {
  return fitRowMarks(rowAt(shown.rows, index), shown.problems);
}

describe("what a row wears", () => {
  // @upstream Modules/FITTool/Tests/FITToolTests/FITRowMarksTests.swift#FITRowMarksTests.testAGoodMicrocodeRowHasNoProblem
  it("gives a good microcode row no problem, and the header none either", () => {
    const shown = display([{ type: FIT.microcodeType, target: MICROCODE }]);

    expect(marksOf(shown, 1).problem).toBeUndefined();
    expect(marksOf(shown, 0).problem).toBeUndefined();
  });

  // @upstream Modules/FITTool/Tests/FITToolTests/FITRowMarksTests.swift#FITRowMarksTests.testAMicrocodeWithAWrongImageChecksumIsAnError
  it("makes a microcode image that does not sum to zero an error, saying both values", () => {
    const broken = fitMicrocode({ totalSize: 0x180 });
    // One byte of the image flipped: the sum it carries no longer describes it.
    broken[0x60] = (broken[0x60] ?? 0) ^ 0x01;
    const shown = display([{ type: FIT.microcodeType, target: MICROCODE }], broken);

    const problem = marksOf(shown, 1).problem;
    expect(problem?.isError).toBe(true);
    expect(problem?.lines).toHaveLength(1);
    expect(problem?.lines[0]?.startsWith("Invalid microcode image checksum: 0x")).toBe(true);
    expect(problem?.lines[0]?.includes("should be 0x")).toBe(true);
    expect(marksOf(shown, 0).problem).toBeUndefined();
  });

  // @upstream Modules/FITTool/Tests/FITToolTests/FITRowMarksTests.swift#FITRowMarksTests.testTheValidatorsFindingsKeepTheirSeverity
  it("keeps the validator's severity: an error an error, a warning a caution", () => {
    // An unaligned address is a rule the specification states as one.
    const unaligned = display([{ type: FIT.microcodeType, target: MICROCODE + 4 }]);
    expect(marksOf(unaligned, 1).problem?.isError).toBe(true);

    // A reserved byte that is not zero: worth saying, but the table works.
    const reserved = display([{ type: FIT.microcodeType, target: MICROCODE, reserved: 1 }]);
    const caution = marksOf(reserved, 1).problem;
    expect(caution?.isError).toBe(false);
    expect(caution?.lines).toEqual(["The reserved byte is 0x1, and should be zero"]);
  });

  // @upstream Modules/FITTool/Tests/FITToolTests/FITRowMarksTests.swift#FITRowMarksTests.testTheBootGuardManifestRowsHoldChecks
  it("gives the Key Manifest and Boot Policy rows the holds-checks badge, and no other", () => {
    const shown = display([
      { type: FIT.microcodeType, target: MICROCODE },
      { type: FIT.keyManifestType, target: 0x3000 },
      { type: FIT.bootPolicyType, target: 0x4000 },
    ]);

    expect(marksOf(shown, 0).roles).toEqual([]);
    expect(marksOf(shown, 1).roles).toEqual([]);
    const key = marksOf(shown, 2).roles?.[0];
    const policy = marksOf(shown, 3).roles?.[0];
    expect(key?.kind).toBe("holdsChecks");
    expect(policy?.kind).toBe("holdsChecks");
    expect(JSON.stringify(key)).toContain("Key Manifest");
    expect(JSON.stringify(policy)).toContain("Boot Policy");
    expect(FIT_ROW_MARKS.legendMarks).toContain("holdsChecks");
  });

  /**
   * A row wholly inside the IBB wears the IBB background; the header, whose
   * table lies outside it, wears none.
   *
   * @upstream Modules/FITTool/Tests/FITToolTests/FITRowMarksTests.swift#FITRowMarksTests.testARowPointingIntoTheIBBWearsItsBackground
   */
  it("tints a row pointing into the IBB", () => {
    const shown = protecting(
      display([{ type: FIT.microcodeType, target: MICROCODE }]),
      protectedBy([["ibb", { start: 0x2000, end: 0x3000 }]])
    );

    expect(fitRowMarks(rowAt(shown.rows, 1), shown.problems).protection).toBe("ibb");
    expect(fitRowMarks(rowAt(shown.rows, 0), shown.problems).protection).toBeUndefined();
  });

  /**
   * The header is placed by the table's own bytes.
   *
   * @upstream Modules/FITTool/Tests/FITToolTests/FITRowMarksTests.swift#FITRowMarksTests.testTheHeaderIsPlacedByTheTablesBytes
   */
  it("places the header by the table's own bytes", () => {
    const shown = protecting(
      display([{ type: FIT.microcodeType, target: MICROCODE }]),
      protectedBy([["phoenix", { start: 0x1000, end: 0x1100 }]])
    );

    expect(fitRowMarks(rowAt(shown.rows, 0), shown.problems).protection).toBe("firmware");
    expect(fitRowMarks(rowAt(shown.rows, 1), shown.problems).protection).toBeUndefined();
  });

  /**
   * A component only partly covered gets no tint and the partly-protected
   * badge, after the badge it may already wear.
   *
   * @upstream Modules/FITTool/Tests/FITToolTests/FITRowMarksTests.swift#FITRowMarksTests.testAPartlyCoveredComponentWearsTheBadgeNotTheTint
   */
  it("badges a partly covered component rather than tinting it", () => {
    const shown = protecting(
      display([
        { type: FIT.microcodeType, target: MICROCODE },
        { type: FIT.bootPolicyType, target: 0x4000 },
      ]),
      protectedBy([
        ["ibb", { start: 0x2100, end: 0x2200 }],
        ["ibb", { start: 0x4000, end: 0x4004 }],
      ])
    );

    const first = fitRowMarks(rowAt(shown.rows, 1), shown.problems);
    expect(first.protection).toBeUndefined();
    expect(first.roles).toEqual([{ kind: "partlyProtected" }]);
    const second = fitRowMarks(rowAt(shown.rows, 2), shown.problems);
    expect(second.roles?.at(-1)).toEqual({ kind: "partlyProtected" });
    // The holds-checks badge first.
    expect(second.roles?.length).toBe(2);
  });

  /**
   * Before the ranges are read nothing is placed, and nothing is tinted.
   *
   * @upstream Modules/FITTool/Tests/FITToolTests/FITRowMarksTests.swift#FITRowMarksTests.testNoRangesPlaceNothing
   */
  it("places nothing before the ranges are read", () => {
    const plain = display([{ type: FIT.microcodeType, target: MICROCODE }]);

    expect(protecting(plain, undefined)).toEqual(plain);
    const none = protecting(plain, { ranges: [], obbDigests: [], diagnostics: [] });
    expect(none.rows.map((row) => row.protection)).toEqual([undefined, undefined]);
  });

  // @upstream Modules/FITTool/Sources/FITTool/FITRowMarks.swift#FITRowMarks.marks
  it("wears only its own copy's problems, not the backup's", () => {
    // An image kept twice lists the backup's rows below the table's; the same
    // index in each copy is a different row of a different copy.
    const shown = display([{ type: FIT.microcodeType, target: MICROCODE }]);
    const top = rowAt(shown.rows, 1);
    const aboutMyRow: FITProblem = {
      detail: { kind: "addressNotAligned", address: MICROCODE },
      entryIndex: top.index,
    };
    const aboutTheBackups: FITProblem = { ...aboutMyRow, inBackup: true };

    expect(top.isBackup).toBe(false);
    expect(fitRowMarks(top, [aboutMyRow]).problem).not.toBeUndefined();
    expect(fitRowMarks(top, [aboutTheBackups]).problem).toBeUndefined();

    // And the other way round: a backup row wears the backup's problems only.
    const backup: FITDisplayRow = { ...top, isBackup: true };
    expect(fitRowMarks(backup, [aboutMyRow]).problem).toBeUndefined();
    expect(fitRowMarks(backup, [aboutTheBackups]).problem).not.toBeUndefined();
  });

  // @upstream Modules/FITTool/Sources/FITTool/FITRowMarks.swift#FITRowMarks.marks
  it("leaves a problem about another row on that row", () => {
    const shown = display([{ type: FIT.microcodeType, target: MICROCODE }]);
    const elsewhere: FITProblem = {
      detail: { kind: "addressNotAligned", address: 0x3000 },
      entryIndex: 3,
    };

    expect(fitRowMarks(rowAt(shown.rows, 1), [elsewhere]).problem).toBeUndefined();
  });

  // @upstream Modules/FITTool/Sources/FITTool/FITRowMarks.swift#FITRowMarks.holdsChecks
  it("names what each Boot Guard component holds", () => {
    expect(holdsChecks(FIT.keyManifestType)).toContain("the key the Boot Policy is signed with");
    expect(holdsChecks(FIT.bootPolicyType)).toContain("the IBB segments and the hash");
    expect(holdsChecks(FIT.microcodeType)).toBeUndefined();
    expect(holdsChecks(0x7f)).toBeUndefined();
  });
});

describe("the verdict", () => {
  // @upstream Modules/FITTool/Tests/FITToolTests/FITRowMarksTests.swift#FITRowMarksTests.testTheLatestStatesAreTheCataloguesVerdicts
  it("draws each 'latest' state as a verdict of the catalogue, and no state as none", () => {
    expect(verdict({ kind: "latest" })?.mark).toBe("newest");
    expect(verdict({ kind: "outdated", newestRevision: 0xf0 })?.mark).toBe("newerListed");
    expect(verdict({ kind: "outdated", newestRevision: 0xf0 })?.toolTip).toBe(
      "Catalogue lists a newer revision (r.F0)"
    );
    expect(verdict({ kind: "undecided", newestRevision: 0xf0 })?.mark).toBe("newerMaybe");
    expect(verdict({ kind: "notRated" })).toBeUndefined();
  });

  it("gives the two newer verdicts different shapes and the same colour", () => {
    // Both say "not confirmed newest"; a newer revision that serves this board
    // is not the same news as one that may not.
    const listed = verdict({ kind: "outdated", newestRevision: 1 });
    const maybe = verdict({ kind: "undecided", newestRevision: 1 });

    expect(listed?.mark).not.toBe(maybe?.mark);
    expect(listed?.toolTip).not.toBe(maybe?.toolTip);
  });

  it("rates a row against a catalogue the panel handed in", () => {
    const shown = ratingLatest(display([{ type: FIT.microcodeType, target: MICROCODE }]), []);

    // Nothing to rate against is no verdict, not a wrong one.
    expect(shown.rows[1]?.latestState).toEqual({ kind: "notRated" });
    expect(verdict(rowAt(shown.rows, 1).latestState)).toBeUndefined();
  });
});

describe("the legend", () => {
  // @upstream Modules/FITTool/Tests/FITToolTests/FITRowMarksTests.swift#FITRowMarksTests.testTheLatestStatesAreTheCataloguesVerdicts
  it("lists the paint, the verdicts and the problems, and no rail", () => {
    expect(FIT_ROW_MARKS.legendMarks).toEqual([
      "protectedIBB",
      "protectedFirmware",
      "newest",
      "newerListed",
      "newerMaybe",
      "error",
      "caution",
      "holdsChecks",
      "partlyProtected",
    ]);
    for (const mark of FIT_ROW_MARKS.legendMarks) {
      const channel = rowMarkChannel(mark);
      expect(["background", "verdict", "problem", "role"]).toContain(channel);
    }
  });
});
