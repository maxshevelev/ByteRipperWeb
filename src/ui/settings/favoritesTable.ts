import { encodingTitle, parsePattern, type SearchEncoding } from "@/core/search/searchPattern";
import { type SearchPatternEntry, searchPatternEntry } from "@/core/search/searchPatternEntry";
import type { ImportResult } from "@/state/favoritesStore";

/**
 * The Favorites tab's table, as rows and what an edit does to them — kept apart
 * from the component so the rules can be tested without one.
 *
 * Two rules are the ones a table like this usually gets wrong:
 *
 * - **Nothing unsearchable is stored.** A pattern is committed through the same
 *   parse the find bar makes; when it fails, the cell goes back to what it held
 *   and the reason is said under the table.
 * - **A new row is a draft until it has a pattern.** An entry with no pattern is
 *   not a search, so it lives in the table and not in the store.
 */

export interface TableEdit {
  readonly rows: readonly SearchPatternEntry[];
  /** What the edit was refused for, when it was. */
  readonly message?: string;
}

/**
 * @upstream ByteRipperApp/Settings/FavoritePatternsSettingsViewController.swift#FavoritePatternsSettingsViewController.complaint
 */
export function patternComplaint(pattern: string, encoding: SearchEncoding): string {
  return encoding === "hex"
    ? `"${pattern}" is not hex — use pairs like DE AD BE EF.`
    : `"${pattern}" cannot be written in ${encodingTitle(encoding)}.`;
}

/** @upstream ByteRipperApp/Settings/FavoritePatternsSettingsViewController.swift#FavoritePatternsSettingsViewController.hasDraft */
export function hasDraft(rows: readonly SearchPatternEntry[]): boolean {
  return rows.some((row) => row.pattern === "");
}

/**
 * The rows that are searches — what is stored. A draft is left out.
 *
 * @upstream ByteRipperApp/Settings/FavoritePatternsSettingsViewController.swift#FavoritePatternsSettingsViewController.save
 */
export function storedRows(rows: readonly SearchPatternEntry[]): SearchPatternEntry[] {
  return rows.filter((row) => row.pattern !== "");
}

/**
 * @upstream ByteRipperApp/Settings/FavoritePatternsSettingsViewController.swift#FavoritePatternsSettingsViewController.fieldCommitted
 */
export function commitName(
  rows: readonly SearchPatternEntry[],
  index: number,
  text: string
): TableEdit {
  return { rows: replaced(rows, index, { name: text.trim() }) };
}

/**
 * A pattern typed into a cell: kept when it is a search, refused — the row as it
 * was, and the reason — when it is not.
 *
 * @upstream ByteRipperApp/Settings/FavoritePatternsSettingsViewController.swift#FavoritePatternsSettingsViewController.fieldCommitted
 */
export function commitPattern(
  rows: readonly SearchPatternEntry[],
  index: number,
  text: string
): TableEdit {
  const row = rows[index];
  if (row === undefined) return { rows };
  const pattern = text.trim();
  if (pattern !== "" && !parsePattern(pattern, row.encoding).ok) {
    return { rows, message: patternComplaint(pattern, row.encoding) };
  }
  return { rows: replaced(rows, index, { pattern }) };
}

/**
 * A new encoding for a row. The pattern has to survive it — `DE A` is fine as
 * ASCII and is not hex — so an encoding it cannot be read in is refused rather
 * than the entry quietly becoming unsearchable.
 *
 * @upstream ByteRipperApp/Settings/FavoritePatternsSettingsViewController.swift#FavoritePatternsSettingsViewController.encodingPicked
 */
export function commitEncoding(
  rows: readonly SearchPatternEntry[],
  index: number,
  encoding: SearchEncoding
): TableEdit {
  const row = rows[index];
  if (row === undefined) return { rows };
  if (row.pattern !== "" && !parsePattern(row.pattern, encoding).ok) {
    return { rows, message: patternComplaint(row.pattern, encoding) };
  }
  return { rows: replaced(rows, index, { encoding }) };
}

/** @upstream ByteRipperApp/Settings/FavoritePatternsSettingsViewController.swift#FavoritePatternsSettingsViewController.casePicked */
export function commitCase(
  rows: readonly SearchPatternEntry[],
  index: number,
  caseSensitive: boolean
): TableEdit {
  return { rows: replaced(rows, index, { caseSensitive }) };
}

/**
 * The rows with a draft at the end, and where it is. One draft at a time — a
 * second empty row would be indistinguishable from the first.
 *
 * @upstream ByteRipperApp/Settings/FavoritePatternsSettingsViewController.swift#FavoritePatternsSettingsViewController.addPressed
 */
export function withDraft(rows: readonly SearchPatternEntry[]): {
  readonly rows: readonly SearchPatternEntry[];
  readonly draft: number;
} {
  const existing = rows.findIndex((row) => row.pattern === "");
  if (existing !== -1) return { rows, draft: existing };
  return {
    rows: [...rows, searchPatternEntry({ pattern: "", encoding: "hex" })],
    draft: rows.length,
  };
}

/** @upstream ByteRipperApp/Settings/FavoritePatternsSettingsViewController.swift#FavoritePatternsSettingsViewController.removePressed */
export function removeRow(
  rows: readonly SearchPatternEntry[],
  index: number
): readonly SearchPatternEntry[] {
  return rows.filter((_, at) => at !== index);
}

/**
 * Moves a row into the gap above `destination` — a drop between rows, read
 * before the row left, so everything after it has shifted down by one.
 *
 * @upstream ByteRipperApp/Settings/FavoritePatternsSettingsViewController.swift#FavoritePatternsSettingsViewController.move
 */
export function moveRow(
  rows: readonly SearchPatternEntry[],
  from: number,
  destination: number
): readonly SearchPatternEntry[] {
  const moving = rows[from];
  if (moving === undefined) return rows;
  const rest = rows.filter((_, at) => at !== from);
  const at = Math.min(from < destination ? destination - 1 : destination, rest.length);
  return [...rest.slice(0, at), moving, ...rest.slice(at)];
}

/**
 * Whether the list the store now holds says something the table does not — a
 * list that says the same thing is not a change to show, and redrawing for it
 * takes a row out from under the user.
 *
 * @upstream ByteRipperApp/Settings/FavoritePatternsSettingsViewController.swift#FavoritePatternsSettingsViewController.reload
 */
export function differs(
  rows: readonly SearchPatternEntry[],
  stored: readonly SearchPatternEntry[]
): boolean {
  return (
    rows.length !== stored.length ||
    rows.some((row, index) => {
      const other = stored[index];
      return (
        other === undefined ||
        other.id !== row.id ||
        other.name !== row.name ||
        other.pattern !== row.pattern ||
        other.encoding !== row.encoding ||
        other.caseSensitive !== row.caseSensitive
      );
    })
  );
}

/** The line under the table: something that went wrong, or what was done. */
export interface TabReport {
  readonly problem?: string;
  readonly report?: string;
}

/**
 * What an import did, as the line under the table says it. An import that is
 * asking says nothing here: the resolver is already on screen.
 *
 * @web-only upstream has no import
 */
export function importReport(result: ImportResult, fileName: string): TabReport {
  switch (result.kind) {
    case "unreadable":
      return { problem: `"${fileName}" is not a ByteRipper pattern library.` };
    case "asking":
      return {};
    case "imported": {
      const parts = [
        result.added > 0 ? `${result.added} added` : "",
        result.changed > 0 ? `${result.changed} changed` : "",
        result.removed > 0 ? `${result.removed} removed` : "",
      ].filter((part) => part !== "");
      return parts.length === 0
        ? { report: `"${fileName}" holds nothing this browser does not already have.` }
        : { report: `Imported "${fileName}": ${parts.join(", ")}.` };
    }
  }
}

function replaced(
  rows: readonly SearchPatternEntry[],
  index: number,
  change: Partial<SearchPatternEntry>
): readonly SearchPatternEntry[] {
  return rows.map((row, at) => (at === index ? { ...row, ...change } : row));
}
