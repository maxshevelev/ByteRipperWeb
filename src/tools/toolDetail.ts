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

/**
 * One label/value row.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFIDetailField
 */
export interface DetailField {
  /** @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFIDetailField.label */
  readonly label: string;
  /** @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFIDetailField.value */
  readonly value: string;
  /**
   * A value that reads as a problem — a checksum that does not check out.
   *
   * @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFIDetailField.isProblem
   */
  readonly isProblem: boolean;
  /**
   * A value that is a check that passed, led by the green done mark.
   *
   * @upstream Modules/MEATool/Sources/MEAToolUI/MEAToolViewController.swift#MEAToolViewController.doneValue
   * @upstream-differs a flag the shared detail draws, rather than the ME panel's own attributed string
   */
  readonly isDone?: boolean;
}

/**
 * A cell, and whether it is an answer worth colouring.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFIDetailTable.Cell
 */
export interface DetailCell {
  /** @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFIDetailTable.Cell.text */
  readonly text: string;
  /**
   * @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFIDetailTable.Cell.tone
   *
   * @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFIDetailTable.Cell.Tone
   */
  readonly tone: "plain" | "yes" | "no";
}

/** The glyphs a table heading can carry — upstream's system symbols, by meaning. */
export type DetailSymbol = "key" | "lock.shield" | "cpu";

/** @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFIDetailTable */
export interface DetailTable {
  /** @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFIDetailTable.title */
  readonly title: string;
  /** @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFIDetailTable.symbol */
  readonly symbol: DetailSymbol;
  /** @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFIDetailTable.columns */
  readonly columns: readonly string[];
  /** @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFIDetailTable.rows */
  readonly rows: readonly (readonly DetailCell[])[];
}

/** @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFINodeDetail */
export interface NodeDetail {
  /**
   * The node's name, or its kind when the name is empty.
   *
   * @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFINodeDetail.title
   */
  readonly title: string;
  /** @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFINodeDetail.fields */
  readonly fields: readonly DetailField[];
  /**
   * The blocks that follow the rows. Empty for every node but a descriptor.
   *
   * @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFINodeDetail.tables
   */
  readonly tables: readonly DetailTable[];
}

/** @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFINodeDetail.empty */
export const EMPTY_DETAIL: NodeDetail = { title: "", fields: [], tables: [] };

/** @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFIDetailField.init */
export const field = (label: string, value: string, isProblem = false): DetailField => ({
  label,
  value,
  isProblem,
});

/** @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFIDetailTable.Cell.init */
export const cell = (text: string, tone: DetailCell["tone"] = "plain"): DetailCell => ({
  text,
  tone,
});

/**
 * A permission, as the word and the colour that go with it.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFIDetailTable.Cell.permission
 */
export const permission = (allowed: boolean): DetailCell =>
  cell(allowed ? "Yes" : "No", allowed ? "yes" : "no");
