import { describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import { FIT } from "@/firmware/fit/fitEntry";
import { readFitTable } from "@/firmware/fit/fitTable";
import { ImageReader } from "@/firmware/imageReader";
import { fitImage, fitMicrocode, type TestRow } from "@/firmware/testing/testFit";
import { UEFIImage } from "@/firmware/uefi/uefiImage";
import { type FITDisplay, fitDisplay } from "@/tools/fit/fitDisplay";
import {
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
  // @upstream ByteRipperTests/FITToolFlowTests.swift#FITToolFlowTests.testAMicrocodeRowOpensIntoItsCPUID
  it("opens a microcode row a level by itself, into its CPUID", () => {
    const shown = display([microcodeRow]);
    const rows = fitOutlineRows(shown);
    // The header, the microcode, its CPUID open a level, and Add under it.
    expect(kinds(rows)).toEqual(["entry", "entry", "cpuid", "addMicrocode"]);
    expect(rows[0]?.expandable, "the header opens into nothing").toBe(false);
    expect(rows[1]?.isOpen, "the microcode is open to begin with").toBe(true);
    expect(rows[2]?.isOpen, "the CPUID is closed to begin with").toBe(false);

    const lines = shown.rows[1]?.processorGroups[0]?.lines ?? [];
    expect(lines.length, "806EA is in the shipped table").toBeGreaterThan(0);
    const opened = withOpening(NO_OPENINGS, itemAt(rows, 2), true);
    const open = fitOutlineRows(shown, opened);
    expect(open).toHaveLength(4 + lines.length);
    expect(open[3]?.item).toEqual({ kind: "line", key: 1, group: 0, line: 0 });
    expect(open[3]?.depth).toBe(2);
    // Add sits under the last microcode, after what the microcode opened.
    expect(open.at(-1)?.item.kind).toBe("addMicrocode");

    // A line stands for its microcode.
    expect(outlineItemKey(itemAt(open, 4))).toBe(1);

    // Closed by the reader, it stays closed.
    const closed = withOpening(opened, itemAt(rows, 1), false);
    expect(kinds(fitOutlineRows(shown, closed))).toEqual(["entry", "entry", "addMicrocode"]);
  });

  // @upstream ByteRipperTests/FITToolFlowTests.swift#FITToolFlowTests.testEachCPUIDOfAnUpdateIsALevelOfItsOwn
  it("makes each CPUID of an update a level of its own", () => {
    const shown = display(
      [microcodeRow],
      [
        { signature: 0x000b_06a2, platformIDs: 1 },
        { signature: 0x000b_06a3, platformIDs: 1 },
        { signature: 0x000b_06a8, platformIDs: 1 },
      ]
    );
    const rows = fitOutlineRows(shown);
    expect(rows.slice(2, 5).map((row) => [row.item, row.depth])).toEqual([
      [{ kind: "cpuid", key: 1, group: 0 }, 1],
      [{ kind: "cpuid", key: 1, group: 1 }, 1],
      [{ kind: "cpuid", key: 1, group: 2 }, 1],
    ]);
    const open = fitOutlineRows(shown, withOpening(NO_OPENINGS, itemAt(rows, 4), true));
    expect(open[5]).toMatchObject({ item: { kind: "line", key: 1, group: 2, line: 0 }, depth: 2 });
    expect(shown.rows[1]?.processorGroups[2]?.lines[0]?.text).toBe(
      "No processor names known for CPUID B06A8"
    );
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
    expect(kinds(two)).toEqual(["entry", "entry", "cpuid", "entry", "addMicrocode"]);
    // Neither Add nor the heading can be chosen.
    expect(isChoosable({ kind: "addMicrocode" })).toBe(false);
    expect(isChoosable({ kind: "heading" })).toBe(false);
    expect(isChoosable({ kind: "line", key: 1, group: 0, line: 0 })).toBe(true);

    // A Top Swap backup: its heading in front of its copy, and Add in the table.
    const backup: FITDisplay = { ...display([microcodeRow]) };
    const withCopy: FITDisplay = {
      ...backup,
      rows: [...backup.rows, ...backup.rows.map((row) => ({ ...row, isBackup: true }))],
      backupStart: backup.rows.length,
    };
    expect(kinds(fitOutlineRows(withCopy))).toEqual([
      "entry",
      "entry",
      "cpuid",
      "addMicrocode",
      "heading",
      "entry",
      "entry",
      "cpuid",
    ]);
  });
});
