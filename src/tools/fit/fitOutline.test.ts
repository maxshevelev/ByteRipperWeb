import { describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import { FIT } from "@/firmware/fit/fitEntry";
import { readFitTable } from "@/firmware/fit/fitTable";
import { ImageReader } from "@/firmware/imageReader";
import { fitImage, fitMicrocode, type TestRow } from "@/firmware/testing/testFit";
import { UEFIImage } from "@/firmware/uefi/uefiImage";
import { type FITDisplay, fitDisplay, rowCommands } from "@/tools/fit/fitDisplay";
import {
  cpuidLines,
  type FITOutlineItem,
  type FITOutlineRow,
  fitOutlineRows,
  isChoosable,
  NO_OPENINGS,
  outlineItemKey,
  withOpening,
} from "@/tools/fit/fitOutline";

/**
 * The FIT table as an outline — the rows upstream's `FITToolFlowTests` counts
 * in its `NSOutlineView`, decided here without a page.
 */

const MICROCODE = 0x2000;
const microcodeRow: TestRow = { type: FIT.microcodeType, target: MICROCODE };

function display(
  rows: readonly TestRow[],
  extended?: readonly { readonly signature: number; readonly platformIDs: number }[]
): FITDisplay {
  const bytes = fitImage({
    rows,
    addressDiff: 0xffff_0000,
    contents: new Map([
      [
        MICROCODE,
        fitMicrocode({
          signature: extended === undefined ? 0x0008_06ea : 0x000b_06a2,
          totalSize: 0x180,
          ...(extended === undefined ? {} : { extended }),
        }),
      ],
    ]),
  });
  const image = new UEFIImage({ size: 0x1_0000, roots: [], addressDiff: 0xffff_0000 });
  return fitDisplay(readFitTable(new ImageReader(sourceOver(bytes)), image));
}

const kinds = (rows: readonly FITOutlineRow[]) => rows.map((row) => row.item.kind);

function itemAt(rows: readonly FITOutlineRow[], index: number): FITOutlineItem {
  const row = rows[index];
  if (row === undefined) throw new Error(`the outline has no row ${index}`);
  return row.item;
}

describe("the FIT table as an outline", () => {
  // @upstream ByteRipperTests/FITToolFlowTests.swift#FITToolFlowTests.testAMicrocodeRowOpensIntoAPlateOfItsCPUIDs
  it("opens a microcode row a level by itself, into the lines of its CPUIDs", () => {
    const shown = display([microcodeRow]);
    const rows = fitOutlineRows(shown);
    // The header, the microcode, its CPUIDs, and Add under it.
    expect(kinds(rows)).toEqual(["entry", "entry", "cpuids", "addMicrocode"]);
    expect(rows[0]?.expandable, "the header opens into nothing").toBe(false);
    expect(rows[1]?.isOpen, "the microcode is open to begin with").toBe(true);
    expect(rows[2]?.expandable, "the CPUIDs open into nothing").toBe(false);
    expect(isChoosable(itemAt(rows, 2)), "the CPUIDs cannot be chosen").toBe(false);
    // They stand for their microcode: its menu and its double-click.
    expect(outlineItemKey(itemAt(rows, 2))).toBe(1);

    const row = shown.rows[1];
    if (row === undefined) throw new Error("the fixture has a microcode");
    expect(cpuidLines(row)).toEqual([
      {
        cpuid: "CPUID 806EA",
        names: "Coffee Lake U43e, Kaby Lake Refresh U",
        hasInfo: true,
      },
    ]);

    // Closed by the reader, it stays closed.
    const closed = withOpening(NO_OPENINGS, itemAt(rows, 1), false);
    expect(kinds(fitOutlineRows(shown, closed))).toEqual(["entry", "entry", "addMicrocode"]);
    expect(kinds(fitOutlineRows(shown, withOpening(closed, itemAt(rows, 1), true)))).toEqual(
      kinds(rows)
    );
  });

  // @upstream ByteRipperTests/FITToolFlowTests.swift#FITToolFlowTests.testEachCPUIDOfAnUpdateIsALineOfThePlate
  it("says each CPUID of an update on a line of its own, and no ⓘ where nothing is known", () => {
    const shown = display(
      [microcodeRow],
      [
        { signature: 0x000b_06a2, platformIDs: 1 },
        { signature: 0x000b_06a3, platformIDs: 1 },
        { signature: 0x000b_06a8, platformIDs: 1 },
      ]
    );
    const rows = fitOutlineRows(shown);
    expect(kinds(rows), "one block, not a row a CPUID").toEqual([
      "entry",
      "entry",
      "cpuids",
      "addMicrocode",
    ]);
    expect(rows[2]?.depth).toBe(1);
    const row = shown.rows[1];
    if (row === undefined) throw new Error("the fixture has a microcode");
    const lines = cpuidLines(row);
    expect(lines.map((line) => line.cpuid)).toEqual(["CPUID B06A2", "CPUID B06A3", "CPUID B06A8"]);
    expect(lines[0]?.hasInfo).toBe(true);
    expect(lines[2], "the CPUID alone: the table knows no names for it").toEqual({
      cpuid: "CPUID B06A8",
      names: "",
      hasInfo: false,
    });
    // No Copy CPUID in the row's menu: the lines are text to select and copy.
    expect(rowCommands(row).map((command) => command.kind)).not.toContain("copyCPUID");
  });

  it("puts Add under the table's last microcode and never in the backup's copy", () => {
    // Where the table has no microcode, Add sits under the header.
    expect(kinds(fitOutlineRows(display([{ type: FIT.startupACMType, target: 0x3000 }])))).toEqual([
      "entry",
      "addMicrocode",
      "entry",
    ]);
    // After the last of two microcodes, and what it opened.
    const two = fitOutlineRows(
      display([microcodeRow, { type: FIT.microcodeType, target: 0x3000 }])
    );
    expect(kinds(two)).toEqual(["entry", "entry", "cpuids", "entry", "addMicrocode"]);
    // Neither Add nor the heading can be chosen.
    expect(isChoosable({ kind: "addMicrocode" })).toBe(false);
    expect(isChoosable({ kind: "heading" })).toBe(false);

    // A Top Swap backup: its heading in front of its copy, and Add in the table.
    const backup = display([microcodeRow]);
    const withCopy: FITDisplay = {
      ...backup,
      rows: [...backup.rows, ...backup.rows.map((row) => ({ ...row, isBackup: true }))],
      backupStart: backup.rows.length,
    };
    expect(kinds(fitOutlineRows(withCopy))).toEqual([
      "entry",
      "entry",
      "cpuids",
      "addMicrocode",
      "heading",
      "entry",
      "entry",
      "cpuids",
    ]);
  });
});
