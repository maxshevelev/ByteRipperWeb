import { L } from "@/core/localization/localization";
import type { ImageRange, ImageReader } from "@/firmware/imageReader";
import { type DMIField, dmiFieldText } from "@/firmware/uefi/dmiField";
import { nodeRange, type UEFINode } from "@/firmware/uefi/uefiNode";
import { cell, type DetailField, type DetailTable, field } from "@/tools/toolDetail";

/**
 * The table an identity area's details list its values in — Acer's block, HP's `HP_MUD`, Apple's
 * SysF store — each a way to the row it is read from, as Lenovo's store lists its entries in use
 * (`uefiLenovoDMIDetail.ts`). One table for every vendor, so the areas read alike whatever layout
 * is under them.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIDMIEntries.swift#UEFIDMIEntries
 */

/** @upstream Modules/UEFITool/Sources/UEFITool/UEFIDMIEntries.swift#UEFIDMIEntries.Row */
export interface DMIEntryRow {
  /** @upstream Modules/UEFITool/Sources/UEFITool/UEFIDMIEntries.swift#UEFIDMIEntries.Row.name */
  readonly name: string;
  /**
   * Nothing or empty where the area has no value: a dash.
   *
   * @upstream Modules/UEFITool/Sources/UEFITool/UEFIDMIEntries.swift#UEFIDMIEntries.Row.value
   */
  readonly value?: string | undefined;
  /**
   * Where the row the value is read from lies; nothing for a value no row holds.
   *
   * @upstream Modules/UEFITool/Sources/UEFITool/UEFIDMIEntries.swift#UEFIDMIEntries.Row.source
   */
  readonly source?: ImageRange | undefined;
}

/**
 * The table, a row's link going to the one of `nodes` that lies where its value is read from.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIDMIEntries.swift#UEFIDMIEntries.table
 */
export function dmiEntriesTable(
  rows: readonly DMIEntryRow[],
  nodes: readonly UEFINode[]
): DetailTable {
  return {
    title: L("Entries"),
    symbol: "person.text.rectangle",
    columns: [L("Entry"), L("Value")],
    rows: rows.map((row) => [
      cell(row.name),
      cell(row.value === undefined || row.value.length === 0 ? "—" : row.value),
    ]),
    rowTargets: rows.map((row) => {
      const source = row.source;
      if (source === undefined) return undefined;
      const node = nodes.find((one) => {
        const range = nodeRange(one);
        return range.start === source.start && range.end === source.end;
      });
      return node === undefined ? undefined : { kind: "node", path: node.id };
    }),
    linkColumn: 0,
  };
}

/**
 * The rows of an area whose values are fields of its own bytes, read from `reader`.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIDMIEntries.swift#UEFIDMIEntries.rows
 */
export function dmiEntryRows(fields: readonly DMIField[], reader: ImageReader): DMIEntryRow[] {
  return fields.map((one) => {
    const bytes = reader.bytes(one.range);
    return {
      name: one.name.text,
      value: bytes === undefined ? undefined : dmiFieldText(bytes, one.encoding),
      source: one.range,
    };
  });
}

/**
 * What reads wrong, as the details say it above the table.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIDMIEntries.swift#UEFIDMIEntries.findings
 */
export function dmiFindings(
  findings: readonly { readonly text: string; readonly isProblem: boolean }[]
): DetailField[] {
  return findings.map((one) =>
    field(one.isProblem ? L("Problem") : L("Note"), one.text, one.isProblem)
  );
}
