/**
 * The workspace's bookmarks.
 *
 * A bookmark marks a *row* of the dump, not a byte: `row` is always a multiple
 * of the row width. The two places a bookmark has to be visible — the offset
 * column and a minimap row — are row-granular by construction, so byte
 * precision would live only in the model and be invisible exactly where it is
 * meant to be seen. It also removes the "two bookmarks in one row" ambiguity
 * from the drawing.
 *
 * The list is shared rather than merged: comparison is by absolute offset, so a
 * bookmark is an offset, not "an offset in file A", and it marks the same
 * height in both panes of a comparison.
 *
 * Bookmarks are absolute addresses — an insert or a delete shifts the bytes,
 * not the bookmark — and one past the end of a file stays in the list and is
 * simply not drawn where the file does not reach.
 *
 * Ported from `ByteRipperApp/Bookmarks/BookmarkStore.swift`.
 */

import { BYTES_PER_ROW } from "@/core/document/rowWidth";
import { hexAddress } from "@/core/text/hexText";

/** @upstream ByteRipperApp/Bookmarks/BookmarkStore.swift#Bookmark */
export interface Bookmark {
  /**
   * The row's start offset, always a multiple of {@link BYTES_PER_ROW}.
   *
   * @upstream ByteRipperApp/Bookmarks/BookmarkStore.swift#Bookmark.row
   */
  readonly row: number;
  /**
   * A name; empty means "show the address".
   *
   * @upstream ByteRipperApp/Bookmarks/BookmarkStore.swift#Bookmark.name
   */
  readonly name: string;
}

/**
 * The row containing `offset`: the offset rounded down to a row boundary.
 *
 * @upstream ByteRipperApp/Bookmarks/BookmarkStore.swift#BookmarkStore.row
 */
export function rowContaining(offset: number): number {
  return offset - (offset % BYTES_PER_ROW);
}

/**
 * A name with its surrounding whitespace removed — the form every path stores,
 * so a name typed with a stray space is the same name, and one typed as nothing
 * but spaces is unnamed.
 *
 * @upstream ByteRipperApp/Bookmarks/BookmarkStore.swift#Bookmark.normalized
 */
export function normalizeBookmarkName(name: string): string {
  return name.trim();
}

/**
 * What a bookmark is called wherever a name is shown — the list, a tooltip, a
 * screen reader. An unnamed bookmark is not nameless: it is called by where it
 * is, so it shows its address. One place decides this, so every surface agrees.
 *
 * @upstream ByteRipperApp/Bookmarks/BookmarkStore.swift#Bookmark.displayName
 */
export function bookmarkDisplayName(bookmark: Bookmark): string {
  return bookmark.name.length === 0 ? hexAddress(bookmark.row) : bookmark.name;
}

/** @upstream ByteRipperApp/Bookmarks/BookmarkStore.swift#BookmarkStore */
export class BookmarkStore {
  /** Kept sorted by row. */
  private marks: Bookmark[] = [];

  /** @upstream ByteRipperApp/Bookmarks/BookmarkStore.swift#BookmarkStore.bookmarks */
  get bookmarks(): readonly Bookmark[] {
    return this.marks;
  }

  /**
   * Replaces the whole list at once, reporting nothing.
   *
   * Every other verb here is per row and reports the row that moved, so each
   * consumer repaints exactly that row. Replaying a list through them would
   * repaint the workspace once per mark. The contract is: seed a store nothing
   * is drawing yet.
   *
   * @upstream ByteRipperApp/Bookmarks/BookmarkStore.swift#BookmarkStore.seed
   */
  seed(marks: readonly Bookmark[]): void {
    this.marks = [...marks].sort((a, b) => a.row - b.row);
  }

  /**
   * Told after any change which row moved — not a bare signal.
   *
   * A toggle touches one row, and the panes redraw just it instead of every
   * visible row of a 16 MB dump.
   *
   * @upstream ByteRipperApp/Bookmarks/BookmarkStore.swift#BookmarkStore.onChange
   */
  onChange: ((row: number) => void) | undefined;

  /**
   * The bookmark on the row containing `offset`, if any.
   *
   * @upstream ByteRipperApp/Bookmarks/BookmarkStore.swift#BookmarkStore.bookmark
   */
  at(offset: number): Bookmark | undefined {
    const row = rowContaining(offset);
    return this.marks.find((mark) => mark.row === row);
  }

  /**
   * Adds an unnamed bookmark to an unmarked row, removes the one on a marked
   * row. Returns the bookmark when the row is marked after the call.
   *
   * @upstream ByteRipperApp/Bookmarks/BookmarkStore.swift#BookmarkStore.toggle
   */
  toggle(offset: number): Bookmark | undefined {
    const row = rowContaining(offset);
    const index = this.marks.findIndex((mark) => mark.row === row);
    if (index !== -1) {
      this.marks.splice(index, 1);
      this.onChange?.(row);
      return undefined;
    }
    const added: Bookmark = { row, name: "" };
    this.marks.splice(this.insertionIndex(row), 0, added);
    this.onChange?.(row);
    return added;
  }

  /**
   * Marks the row containing `offset`, named or not.
   *
   * An already-marked row keeps its one bookmark and takes the new name —
   * marking twice never makes two marks on one row, and the name given here is
   * the one that sticks.
   *
   * @upstream ByteRipperApp/Bookmarks/BookmarkStore.swift#BookmarkStore.add
   */
  add(offset: number, name = ""): Bookmark {
    const row = rowContaining(offset);
    const clean = normalizeBookmarkName(name);
    const index = this.marks.findIndex((mark) => mark.row === row);
    if (index !== -1) {
      const renamed: Bookmark = { row, name: clean };
      this.marks[index] = renamed;
      this.onChange?.(row);
      return renamed;
    }
    const added: Bookmark = { row, name: clean };
    this.marks.splice(this.insertionIndex(row), 0, added);
    this.onChange?.(row);
    return added;
  }

  /**
   * Renames the bookmark on a row, or `undefined` when that row carries none —
   * renaming is for a mark that exists, so a caller that means "mark it and
   * call it this" uses {@link add}. An empty name unnames it: it goes back to
   * showing its address.
   *
   * @upstream ByteRipperApp/Bookmarks/BookmarkStore.swift#BookmarkStore.rename
   */
  rename(offset: number, name: string): Bookmark | undefined {
    const row = rowContaining(offset);
    const index = this.marks.findIndex((mark) => mark.row === row);
    if (index === -1) return undefined;
    const renamed: Bookmark = { row, name: normalizeBookmarkName(name) };
    this.marks[index] = renamed;
    this.onChange?.(row);
    return renamed;
  }

  /**
   * Removes the mark from a row, reporting whether there was one — so a caller
   * can tell "removed" from "nothing there" without reading the list first.
   *
   * @upstream ByteRipperApp/Bookmarks/BookmarkStore.swift#BookmarkStore.remove
   */
  remove(offset: number): boolean {
    const row = rowContaining(offset);
    const index = this.marks.findIndex((mark) => mark.row === row);
    if (index === -1) return false;
    this.marks.splice(index, 1);
    this.onChange?.(row);
    return true;
  }

  /**
   * The edit dialog's change: the bookmark takes `name`, and moves to another
   * row when one is given. Moved rather than removed and re-made, so it is
   * never in the list without its name.
   *
   * The target row is taken as given: the dialog only offers free rows, which
   * is a question about the whole list and so is asked before the edit.
   *
   * @upstream ByteRipperApp/Bookmarks/BookmarkStore.swift#BookmarkStore.edit
   */
  edit(from: number, to: number, name: string): Bookmark | undefined {
    const fromRow = rowContaining(from);
    const toRow = rowContaining(to);
    if (!this.marks.some((mark) => mark.row === fromRow)) return undefined;
    if (toRow === fromRow) return this.rename(fromRow, name);
    this.remove(fromRow);
    return this.add(toRow, name);
  }

  /**
   * Drags a mark to another row, keeping its name, and reports where it landed.
   *
   * One row holds at most one bookmark, so a target another bookmark already
   * holds is **jumped over**: the search carries on in the direction of travel
   * to the first free row, which is what makes dragging a mark through a marked
   * row feel like one mark sliding past another rather than two merging.
   *
   * When there is no free row beyond the obstacle — occupied all the way to
   * `lastRow` going down, or to row 0 going up — the mark instead **stops
   * before it**, on the last free row on the way there: a mark may neither
   * leave the file to find room nor swallow the bookmark in its way, but it
   * should still travel as far as the pointer took it. Only when even that room
   * is missing does nothing move.
   *
   * `lastRow` comes from the view, not from a file size held here: the last row
   * a mark may be dragged to is the last row that pane draws, and only the view
   * knows that.
   *
   * @upstream ByteRipperApp/Bookmarks/BookmarkStore.swift#BookmarkStore.move
   */
  move(from: number, to: number, lastRow: number): number | undefined {
    const fromRow = rowContaining(from);
    const index = this.marks.findIndex((mark) => mark.row === fromRow);
    if (index === -1) return undefined;

    const limit = rowContaining(lastRow);
    const target = Math.min(rowContaining(to), limit);
    if (target === fromRow) return undefined;

    const landing = this.freeRow(target, fromRow, limit);
    if (landing === undefined) return undefined;

    const name = this.marks[index]?.name ?? "";
    this.marks.splice(index, 1);
    this.marks.splice(this.insertionIndex(landing), 0, { row: landing, name });
    // Both rows changed: the one the mark left and the one it landed on.
    this.onChange?.(fromRow);
    this.onChange?.(landing);
    return landing;
  }

  /**
   * The bookmarked rows in a byte range, for the dump's per-row drawing.
   *
   * @upstream ByteRipperApp/Bookmarks/BookmarkStore.swift#BookmarkStore.rows
   */
  rowsIn(start: number, end: number): Set<number> {
    const rows = new Set<number>();
    for (const mark of this.marks) {
      if (mark.row >= start && mark.row < end) rows.add(mark.row);
    }
    return rows;
  }

  /**
   * Where a mark travelling from `from` toward `target` can land: `target`
   * itself when free; else the first free row beyond the bookmarks blocking it,
   * in the direction of travel and within `0...limit`; else the last free row
   * before them, on the way back toward `from`.
   */
  private freeRow(target: number, from: number, limit: number): number | undefined {
    const descending = target > from;
    const isFree = (row: number) => !this.marks.some((mark) => mark.row === row);

    let row = target;
    while (!isFree(row)) {
      if (descending) {
        if (row + BYTES_PER_ROW > limit) return this.lastFreeRow(target, from);
        row += BYTES_PER_ROW;
      } else {
        if (row < BYTES_PER_ROW) return this.lastFreeRow(target, from);
        row -= BYTES_PER_ROW;
      }
    }
    return row;
  }

  /**
   * Walking back from `target` toward `from`, the first free row — where a mark
   * stops when the way past the obstacle is closed. `from`'s own row does not
   * count, since staying put is not moving.
   */
  private lastFreeRow(target: number, from: number): number | undefined {
    const descending = target > from;
    let row = target;
    while (row !== from) {
      row = descending ? row - BYTES_PER_ROW : row + BYTES_PER_ROW;
      if (row === from) return undefined;
      if (!this.marks.some((mark) => mark.row === row)) return row;
    }
    return undefined;
  }

  /** Where `row` belongs in the list, which is kept sorted. */
  private insertionIndex(row: number): number {
    const index = this.marks.findIndex((mark) => mark.row > row);
    return index === -1 ? this.marks.length : index;
  }
}
