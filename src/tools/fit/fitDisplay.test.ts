import { describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import { FIT } from "@/firmware/fit/fitEntry";
import { readFitTable } from "@/firmware/fit/fitTable";
import { ImageReader } from "@/firmware/imageReader";
import { fitImage, fitMicrocode, type TestRow } from "@/firmware/testing/testFit";
import { UEFIImage } from "@/firmware/uefi/uefiImage";
import { makeNode } from "@/firmware/uefi/uefiNode";
import {
  type FITDisplay,
  type FITDisplayRow,
  fitCommandTitle,
  fitDisplay,
  focusingRow,
  focusingTarget,
  POINTER_ZONE_ID,
  rowCommands,
  rowIndexOfZone,
  TABLE_ZONE_ID,
  zoneToFocus,
} from "@/tools/fit/fitDisplay";

/**
 * What the panel draws, decided here so the component has no decisions left in
 * it — upstream's `FITDisplayTests`.
 */

const MICROCODE = 0x2000;

function display(
  rows: readonly TestRow[],
  options: {
    readonly checksum?: number;
    readonly checksumValid?: boolean;
    readonly focus?: number;
    readonly pointerAddress?: number;
    readonly signature?: number;
    readonly revision?: number;
    readonly platformIDs?: number;
  } = {}
): FITDisplay {
  const bytes = fitImage({
    rows,
    ...(options.pointerAddress === undefined ? {} : { pointerAddress: options.pointerAddress }),
    ...(options.checksum === undefined ? {} : { checksum: options.checksum }),
    ...(options.checksumValid === undefined ? {} : { checksumValid: options.checksumValid }),
    addressDiff: 0xffff_0000,
    contents: new Map([
      [
        MICROCODE,
        fitMicrocode({
          signature: options.signature ?? 0x0008_06ea,
          revision: options.revision ?? 0xf0,
          totalSize: 0x180,
          platformIDs: options.platformIDs ?? 1,
        }),
      ],
    ]),
  });
  const image = new UEFIImage({ size: 0x1_0000, roots: [], addressDiff: 0xffff_0000 });
  const report = readFitTable(new ImageReader(sourceOver(bytes)), image);
  return fitDisplay(report, options.focus);
}

const microcodeRow: TestRow = { type: FIT.microcodeType, target: MICROCODE };

/** The row at `index`, which a fixture that built it has. */
function rowAt(rows: readonly FITDisplayRow[], index: number): FITDisplayRow {
  const row = rows[index];
  if (row === undefined) throw new Error(`the fixture has no row ${index}`);
  return row;
}

describe("the summary", () => {
  it("says where the table is and whether it adds up", () => {
    // The count includes the header row, so one microcode reads as two.
    expect(display([microcodeRow]).summary).toBe("FIT at 0x1000 · 2 entries · checksum 0x5C");
  });

  it("does not restate a wrong checksum", () => {
    // It is a problem, and the list below says so in red.
    expect(display([microcodeRow], { checksum: 0xcc }).summary).toBe("FIT at 0x1000 · 2 entries");
  });

  it("says when the mapping was assumed", () => {
    // A region cut out of a dump has no volume top file, and then every address
    // in the table is wrong by whatever was cut off in front of it.
    const bytes = fitImage({
      rows: [microcodeRow],
      contents: new Map([[MICROCODE, fitMicrocode({ totalSize: 0x180 })]]),
    });
    const shown = fitDisplay(readFitTable(new ImageReader(sourceOver(bytes))));

    expect(shown.summary).toBe("FIT at 0x1000 · 2 entries · addresses assumed · checksum 0x5C");
    expect(shown.problems).toEqual([]);
  });

  it("says when the checksum is not used", () => {
    // A table whose header says the checksum does not count is not wrong for
    // having a stale one.
    expect(display([microcodeRow], { checksum: 0xcc, checksumValid: false }).summary).toBe(
      "FIT at 0x1000 · 2 entries · checksum unused"
    );
  });

  it("offers the candidates when the pointer has lost the table", () => {
    const shown = display([microcodeRow], { pointerAddress: 0xffff_5000 });

    expect(shown.summary).toBe("No FIT table where the pointer leads. A signature sits at 0x1000.");
    expect(shown.rows).toEqual([]);
  });
});

describe("the rows", () => {
  it("leads a microcode row with its CPUID", () => {
    // The type column has said "microcode" already, and the CPUID is the thing
    // being looked for. Hex digits, no leading zero, the way a bench writes it.
    const row = display([microcodeRow]).rows[1];

    expect(row?.typeText).toBe("Microcode");
    expect(row?.addressText).toBe("0xFFFF2000");
    expect(row?.cpuidText).toBe("806EA");
    expect(row?.targetText).toBe("CPUID 806EA · r.F0 · 2019-07-15 · 0x2000");
    // The size has its own column; for a microcode it is the component's, not
    // the row's zero field.
    expect(row?.sizeText).toBe("0x180");
    expect(row?.targetRange).toEqual({ start: MICROCODE, end: MICROCODE + 0x180 });
    expect(row?.hasProblem).toBe(false);
  });

  it("says where a row that leads somewhere else leads", () => {
    const node = makeNode({
      kind: "volume",
      name: "FFSv2",
      header: { start: 0x2800, end: 0x2800 },
      body: { start: 0x2800, end: 0x4000 },
    });
    const image = new UEFIImage({ size: 0x1_0000, roots: [node], addressDiff: 0xffff_0000 });
    const bytes = fitImage({
      rows: [{ type: FIT.startupACMType, target: 0x3000 }],
      addressDiff: 0xffff_0000,
    });
    const row = fitDisplay(readFitTable(new ImageReader(sourceOver(bytes)), image)).rows[1];

    expect(row?.cpuidText).toBeUndefined();
    // The address leads and the name follows it in brackets: the name is the
    // half that arrives second, once the branch covering the address has been
    // read, so it must not push the address sideways when it does.
    expect(row?.targetText).toBe("0x3000 (FFSv2)");
  });

  it("says the header's count both ways", () => {
    // The header's `Size` counts entries, not bytes — the field everyone reads
    // wrong — so the row says it both ways rather than showing `0x20` and
    // leaving the reader to guess which it meant.
    const row = display([microcodeRow]).rows[0];

    expect(row?.addressText).toBe("_FIT_");
    expect(row?.typeText).toBe("FIT Header");
    expect(row?.targetText).toBe("2 rows · 0x20");
    expect(row?.sizeText).toBe("2 rows");
  });

  it("names a CSE SecureBoot row's subtype", () => {
    // The reserved byte is a subtype here, and saying so is the difference
    // between a row that means something and a row that does not.
    const row = display([
      microcodeRow,
      { type: FIT.cseSecureBootType, target: 0x3000, reserved: 8 },
    ]).rows[2];

    expect(row?.typeText).toBe("CSE SecureBoot Settings: IBB Hash");
  });

  it("marks a row the validator complained about", () => {
    const shown = display([{ type: FIT.microcodeType, target: MICROCODE + 4 }]);

    expect(shown.rows[1]?.hasProblem).toBe(true);
    expect(shown.rows[0]?.hasProblem).toBe(false);
  });
});

describe("the zones", () => {
  it("covers the table, the pointer and what the rows point at", () => {
    const zones = display([microcodeRow]).zones;
    const find = (id: string) => zones.zones.find((zone) => zone.id === id);

    expect(zones.zones.map((zone) => zone.id).sort()).toEqual([
      "fit.pointer",
      "fit.row.0",
      "fit.row.1",
      "fit.table",
      "fit.target.1",
    ]);
    expect(find("fit.table")).toMatchObject({ start: 0x1000, end: 0x1020 });
    expect(find("fit.pointer")).toMatchObject({ start: 0xffc0, end: 0xffc4 });
    expect(find("fit.row.1")).toMatchObject({ start: 0x1010, end: 0x1020 });
    expect(find("fit.target.1")).toMatchObject({
      start: MICROCODE,
      end: MICROCODE + 0x180,
    });
  });

  it("names every microcode zone by its CPUID", () => {
    const zones = display([microcodeRow, { type: FIT.microcodeType, target: 0x3000 }]).zones;
    const find = (id: string) => zones.zones.find((zone) => zone.id === id);

    // The row's number counts from one, so the first microcode — the row after
    // the header — is the second row, not the first.
    expect(find("fit.row.1")?.name).toBe("#2 Microcode");
    expect(find("fit.target.1")?.name).toBe("CPUID 806EA");
    expect(find("fit.target.2")).toMatchObject({ start: 0x3000, end: 0x3010 });
  });

  it("focuses the component when going to a target", () => {
    expect(focusingTarget(display([microcodeRow]), 1).zones.focus).toBe("fit.target.1");
  });

  it("focuses a row's own zone when it is selected", () => {
    // It is a change to the focus and not a reason to read the file again.
    expect(display([microcodeRow]).zones.focus).toBeUndefined();
    expect(display([microcodeRow], { focus: 1 }).zones.focus).toBe("fit.row.1");

    const shown = display([microcodeRow], { focus: 1 });
    const refocused = focusingRow(shown, 0);
    expect(refocused.zones.focus).toBe("fit.row.0");
    expect(refocused.rows).toEqual(shown.rows);
  });

  it("says which row a zone id came from", () => {
    // The trip back: the user picks a zone in the dump, and the panel has to
    // know which row it came from.
    expect(rowIndexOfZone("fit.row.3")).toBe(3);
    expect(rowIndexOfZone("fit.target.12")).toBe(12);
    expect(rowIndexOfZone(TABLE_ZONE_ID)).toBeUndefined();
    expect(rowIndexOfZone(POINTER_ZONE_ID)).toBeUndefined();
    expect(rowIndexOfZone("fit.row.x")).toBeUndefined();
  });
});

describe("the right-button menu", () => {
  it("offers a microcode row its CPUID and its offset", () => {
    // An item that does not apply to the row is absent rather than greyed. The
    // one microcode may be replaced but not removed: the slot stays, so the
    // one-microcode rule is not touched by a swap.
    const commands = rowCommands(rowAt(display([microcodeRow]).rows, 1));

    expect(commands).toEqual([
      { kind: "goToOffset", offset: MICROCODE },
      { kind: "copyCPUID", cpuid: "806EA" },
      { kind: "replaceMicrocode", index: 1 },
    ]);
    expect(commands.map(fitCommandTitle)).toEqual([
      "Go to Offset",
      "Copy CPUID",
      "Replace Microcode",
    ]);
  });

  it("offers every microcode row its replacement", () => {
    // The slot stays, so even the last and only one is offered it, where it is
    // not offered removal. A row that is not a microcode is offered neither.
    const one = display([microcodeRow]).rows;
    expect(one[1]?.canReplace).toBe(true);

    const two = display([microcodeRow, { type: FIT.microcodeType, target: 0x3000 }]).rows;
    expect(two[1]?.canReplace).toBe(true);
    expect(two[2]?.canReplace).toBe(true);

    const acm = display([{ type: FIT.startupACMType, target: 0x3000 }]).rows;
    expect(acm[1]?.canReplace).toBe(false);
    expect(rowCommands(rowAt(acm, 1)).map(fitCommandTitle)).not.toContain("Replace Microcode");
  });

  it("sends a row that points nowhere to itself", () => {
    // The header and an empty slot still have an offset of their own, so they
    // still go somewhere: to their own sixteen bytes in the table.
    const rows = display([microcodeRow, { type: FIT.emptyType, address: 0 }]).rows;

    expect(rowCommands(rowAt(rows, 0))).toEqual([{ kind: "goToOffset", offset: 0x1000 }]);
    expect(rowCommands(rowAt(rows, 2))).toEqual([{ kind: "goToOffset", offset: 0x1020 }]);
    expect(zoneToFocus(rowAt(rows, 0))).toBe("fit.row.0");
    expect(zoneToFocus(rowAt(rows, 2))).toBe("fit.row.2");
  });

  it("offers its offset to a row with no CPUID", () => {
    const rows = display([{ type: FIT.startupACMType, target: 0x3000 }]).rows;

    expect(rowCommands(rowAt(rows, 1))).toEqual([{ kind: "goToOffset", offset: 0x3000 }]);
    expect(zoneToFocus(rowAt(rows, 1))).toBe("fit.target.1");
  });

  it("does not offer the last microcode for removal", () => {
    // A table needs one microcode entry, so the only one is not offered at all
    // — rather than offered and then refused.
    const one = display([microcodeRow]).rows;
    expect(one[1]?.canRemove).toBe(false);
    expect(rowCommands(rowAt(one, 1)).map(fitCommandTitle)).not.toContain("Remove Microcode");

    const two = display([microcodeRow, { type: FIT.microcodeType, target: 0x3000 }]).rows;
    expect(two[1]?.canRemove).toBe(true);
    expect(two[2]?.canRemove).toBe(true);
  });

  it("offers the checksum fix only on the header row", () => {
    // The byte is the header's, so the fix sits on the row the mismatch turns
    // red and on no other; a table whose checksum is right offers nothing.
    const broken = display([microcodeRow], { checksum: 0xcc }).rows;
    expect(broken[0]?.checksumFixAvailable).toBe(true);
    expect(rowCommands(rowAt(broken, 0))).toContainEqual({ kind: "fixChecksum" });
    expect(broken[1]?.checksumFixAvailable).toBe(false);
    expect(rowCommands(rowAt(broken, 1))).not.toContainEqual({ kind: "fixChecksum" });

    const good = display([microcodeRow]).rows;
    expect(good[0]?.checksumFixAvailable).toBe(false);
    expect(good[1]?.checksumFixAvailable).toBe(false);
  });
});

describe("the one repair", () => {
  it("offers a stale checksum as a one-byte repair", () => {
    const fix = display([microcodeRow], { checksum: 0xcc }).checksumFix;

    expect(fix?.name).toBe("Fix FIT Checksum");
    expect(fix?.writes.map((write) => write.offset)).toEqual([0x100f]);
    expect(fix?.writes.map((write) => [...write.bytes])).toEqual([[0x5c]]);
  });

  it("offers nothing when the checksum is right or unused", () => {
    expect(display([microcodeRow]).checksumFix).toBeUndefined();
    expect(
      display([microcodeRow], { checksum: 0xcc, checksumValid: false }).checksumFix
    ).toBeUndefined();
  });
});
