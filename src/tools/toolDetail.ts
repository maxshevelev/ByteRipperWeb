/**
 * What a tool's detail list says about the thing in focus: a title, label/value
 * rows, and the blocks that are tables rather than rows.
 *
 * Ported from upstream's `UEFIDetailField` / `UEFIDetailTable` /
 * `UEFINodeDetail`. It is shared code rather than the UEFI tool's own because
 * the panel that draws it (`ui/toolPanel/ToolDetail`) is one component for every
 * firmware tool, as upstream's `ToolDetailScroll` is — and a shape that has to
 * cross a worker boundary is plain data, which this is.
 */

/** One label/value row. */
export interface DetailField {
  readonly label: string;
  readonly value: string;
  /** A value that reads as a problem — a checksum that does not check out. */
  readonly isProblem: boolean;
}

/** A cell, and whether it is an answer worth colouring. */
export interface DetailCell {
  readonly text: string;
  readonly tone: "plain" | "yes" | "no";
}

/** The glyphs a table heading can carry — upstream's system symbols, by meaning. */
export type DetailSymbol = "key" | "lock.shield" | "cpu";

export interface DetailTable {
  readonly title: string;
  readonly symbol: DetailSymbol;
  readonly columns: readonly string[];
  readonly rows: readonly (readonly DetailCell[])[];
}

export interface NodeDetail {
  /** The node's name, or its kind when the name is empty. */
  readonly title: string;
  readonly fields: readonly DetailField[];
  /** The blocks that follow the rows. Empty for every node but a descriptor. */
  readonly tables: readonly DetailTable[];
}

export const EMPTY_DETAIL: NodeDetail = { title: "", fields: [], tables: [] };

export const field = (label: string, value: string, isProblem = false): DetailField => ({
  label,
  value,
  isProblem,
});

export const cell = (text: string, tone: DetailCell["tone"] = "plain"): DetailCell => ({
  text,
  tone,
});

/** A permission, as the word and the colour that go with it. */
export const permission = (allowed: boolean): DetailCell =>
  cell(allowed ? "Yes" : "No", allowed ? "yes" : "no");
