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

import { L } from "@/core/localization/localization";
import type { ToolValueTone } from "@/tools/toolValueTone";

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
   * What the value says, when it is a verdict: the panel draws it bold and in
   * the colour the tone names, and leads a passed check with its tick.
   * `standard` is ordinary text, which is what most fields are.
   *
   * @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFIDetailField.tone
   */
  readonly tone: ToolValueTone;
  /**
   * What a verdict was read from, drawn in brackets after the value in the ordinary font and
   * colour: the tone is the verdict's, and the evidence beside it must not borrow it.
   *
   * @upstream Packages/MEPresentation/Sources/MEPresentation/MEANode.swift#MEAField.evidence
   * @upstream-differs on the shared field, which the ME panel's rows and its detail both draw
   */
  readonly evidence?: string | undefined;
}

/**
 * A value that reads as a problem — a checksum that does not check out. A `bad`
 * tone is what that is, so this asks the tone rather than keeping a second flag
 * that could disagree with it.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFIDetailField.isProblem
 */
export const isProblemField = (one: DetailField): boolean => one.tone === "bad";

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
  /**
   * Drawn in bold: a value that stands out from the ones around it — a strap field
   * this board's build set away from the tool's default.
   *
   * @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFIDetailTable.Cell.isStrong
   */
  readonly isStrong?: boolean | undefined;
}

/** The glyphs a table heading can carry — upstream's system symbols, by meaning. */
export type DetailSymbol =
  | "key"
  | "lock.shield"
  | "cpu"
  | "number"
  | "info.circle"
  | "square.split.2x2"
  | "clock.arrow.circlepath"
  | "checkmark.seal"
  | "slider.horizontal.3"
  | "list.bullet.rectangle"
  | "text.alignleft"
  | "person.text.rectangle"
  | "cable.connector"
  | "square.grid.4x3.fill";

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
  /**
   * What each row stands for, where a row stands for something: a click on the row
   * goes there. Absent, or undefined for a row, when it is text only.
   *
   * @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFIDetailTable.rowTargets
   */
  readonly rowTargets?: readonly (DetailTableTarget | undefined)[] | undefined;
  /**
   * The column a row with a target draws as a link: the one that says where the
   * target is. Absent means the second.
   *
   * @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFIDetailTable.linkColumn
   */
  readonly linkColumn?: number | undefined;
  /**
   * Whether the table folds under its heading, and is folded until the reader opens it:
   * one long enough to push everything after it out of sight, and read only now and then
   * — a descriptor's strap words.
   *
   * @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFIDetailTable.startsFolded
   */
  readonly startsFolded?: boolean | undefined;
  /**
   * The sections the rows fall into, in order, covering every row. Absent for a table
   * of plain rows.
   *
   * @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFIDetailTable.sections
   */
  readonly sections?: readonly DetailTableSection[] | undefined;
  /**
   * One line under the table, for what its rows add up to — the verdict the BIOS
   * master's access masks make. Absent for a table that is only a list of facts, and
   * drawn in the ordinary colour: it says what the rows show, not a second answer in a
   * tone of its own.
   *
   * @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFIDetailTable.note
   */
  readonly note?: string | undefined;
}

/**
 * A run of rows under a line of its own, folded until the reader opens it: a
 * descriptor's strap fields, under the word they are bits of.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFIDetailTable.Section
 */
export interface DetailTableSection {
  /**
   * What the section is — `PCHSTRP1` — and, in `subtitle`, what its rows have in
   * common, where they have anything (`GPCOM4_gpio_sstrap`).
   *
   * @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFIDetailTable.Section.title
   */
  readonly title: string;
  /** @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFIDetailTable.Section.subtitle */
  readonly subtitle?: string | undefined;
  /**
   * The rows it holds, as indices into the table's rows: `[start, end)`.
   *
   * @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFIDetailTable.Section.rows
   */
  readonly start: number;
  readonly end: number;
  /**
   * Where a click on the section's address goes, and the address as it is shown.
   * Absent for a section that stands for nothing in the dump.
   *
   * @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFIDetailTable.Section.target
   */
  readonly target?: DetailTableTarget | undefined;
  /** @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFIDetailTable.Section.address */
  readonly address?: string | undefined;
  /**
   * What the folded line says about the rows it hides, where something in them stands
   * out: how many strap fields the build set.
   *
   * @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFIDetailTable.Section.note
   */
  readonly note?: string | undefined;
}

/**
 * Where a click on a row goes.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFIDetailTable.Target
 * @upstream-differs a tagged object, where upstream has an enum with payloads
 */
export type DetailTableTarget =
  /** A node: the click puts it in focus, its detail and its bytes. */
  | { readonly kind: "node"; readonly path: readonly number[] }
  /**
   * Bytes that are not one node — a region an Insyde map names, which can span
   * several or lie inside one. The click outlines them in the dump under `name`
   * and leaves the focus where it is.
   */
  | { readonly kind: "range"; readonly start: number; readonly end: number; readonly name: string };

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
  /**
   * The bytes of the picture the node is, for the panel to draw under the rows —
   * nothing for every node that is not one. Decoding them is the browser's, which
   * knows how.
   *
   * @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFINodeDetail.picture
   */
  readonly picture?: { readonly bytes: Uint8Array; readonly mime: string } | undefined;
  /**
   * The bytes of the sound the node is — a whole WAV file — for the panel to play
   * under the rows; nothing for every node that is not one.
   *
   * @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFINodeDetail.sound
   */
  readonly sound?: Uint8Array | undefined;
}

/** @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFINodeDetail.empty */
export const EMPTY_DETAIL: NodeDetail = { title: "", fields: [], tables: [] };

/**
 * An ordinary field, or one whose value is a problem.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFIDetailField.init
 */
export const field = (label: string, value: string, isProblem = false): DetailField => ({
  label,
  value,
  tone: isProblem ? "bad" : "standard",
});

/**
 * A field whose value carries a status of its own — the ME facts that are a
 * verdict rather than a number.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFIDetailField.init
 */
export const tonedField = (label: string, value: string, tone: ToolValueTone): DetailField => ({
  label,
  value,
  tone,
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
  cell(allowed ? L("Yes") : L("No"), allowed ? "yes" : "no");
