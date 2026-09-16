import type { ToolRowMark } from "@/tools/toolRowMarks";

/**
 * How each mark is drawn (`Design/ROW_MARKS.md` §3, §4) — the one place the
 * symbol names and the palette meanings are chosen, read by the rows and the
 * legend alike.
 *
 * Upstream hands out an `NSImage` and an `NSColor` here; a browser has neither,
 * so a mark names the symbol and the palette entry and the panel draws them.
 * The names are upstream's own — the SF Symbol string and the `AppPalette`
 * group member — so a symbol that changes upstream changes in one table.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolRowMarkStyle.swift
 */

/** A palette entry a mark is drawn in (`Design/ROW_MARKS.md` §3, §4). */
export type RowMarkTint =
  | "protectedIBB"
  | "protectedFirmware"
  | "decompressed"
  | "good"
  | "caution"
  | "bad"
  | "secondary";

/**
 * The SF Symbol an icon mark is drawn with; nothing for the background and the
 * rail, which are paint.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolRowMarkStyle.swift#ToolRowMark.symbol
 */
export const ROW_MARK_SYMBOL: Readonly<Record<ToolRowMark, string | undefined>> = {
  protectedIBB: undefined,
  protectedFirmware: undefined,
  decompressed: undefined,
  // The verdicts: outline shapes, so none of them is ever a problem's — no
  // exclamation mark, which is the problems' (ROW_MARKS.md §4).
  newest: "checkmark.seal.fill",
  newerListed: "arrow.up.circle",
  newerMaybe: "questionmark.circle",
  error: "exclamationmark.octagon.fill",
  caution: "exclamationmark.circle.fill",
  compressed: "zipper.page",
  compressedUndecoded: "zipper.page",
  holdsChecks: "lock.shield",
  partlyProtected: "shield.lefthalf.filled",
};

/** @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolRowMarkStyle.swift#ToolRowMark.symbol */
export const rowMarkSymbol = (mark: ToolRowMark): string | undefined => ROW_MARK_SYMBOL[mark];

/**
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolRowMarkStyle.swift#ToolRowMark.tint
 */
export const ROW_MARK_TINT: Readonly<Record<ToolRowMark, RowMarkTint>> = {
  protectedIBB: "protectedIBB",
  protectedFirmware: "protectedFirmware",
  decompressed: "decompressed",
  compressed: "decompressed",
  newest: "good",
  // Both say "not confirmed newest", and differ in how sure of it we are, not
  // in what kind of thing it is: one colour.
  newerListed: "caution",
  newerMaybe: "caution",
  error: "bad",
  caution: "caution",
  compressedUndecoded: "secondary",
  holdsChecks: "secondary",
  partlyProtected: "secondary",
};

/** @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolRowMarkStyle.swift#ToolRowMark.tint */
export const rowMarkTint = (mark: ToolRowMark): RowMarkTint => ROW_MARK_TINT[mark];
