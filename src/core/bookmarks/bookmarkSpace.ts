/**
 * A pane's view of a bookmark list: the list itself, and where the pane's byte
 * 0 sits in it (§20.7).
 *
 * One list serves a workspace — its panes *and* every fragment panel opened out
 * of them — because a bookmark is an offset in the file, not in whatever
 * happens to be showing it. A panel shows a part of that file starting at
 * `origin`, so one mark is one byte at two addresses: `0x1F400` in the dump,
 * `0x400` in the part taken out at `0x1F000`. Marking a row in either place
 * marks it in the other.
 *
 * Every verb here takes and returns the **pane's** offsets, and the translation
 * lives in this one type: nothing outside it has to remember which of the two
 * spaces the number in its hand belongs to.
 *
 * A part whose bytes are not the file's bytes — a decompressed body — has no
 * space at all. Its pane is given none, and with none there is nothing to draw
 * and nothing to add: the file's offsets do not reach those bytes, so a mark in
 * one would mean nothing in the other.
 *
 * A value, not an object: the list is the shared thing, and where a pane sits
 * in it is a fact about the pane that never changes while it is there.
 *
 * Ported from `ByteRipperApp/Bookmarks/BookmarkSpace.swift`.
 */

import { type Bookmark, type BookmarkStore, rowContaining } from "@/core/bookmarks/bookmarkStore";
import { BYTES_PER_ROW } from "@/core/document/rowWidth";

/** @upstream ByteRipperApp/Bookmarks/BookmarkSpace.swift#BookmarkSpace */
export class BookmarkSpace {
  /**
   * The list the marks live in — the workspace's.
   *
   * @upstream ByteRipperApp/Bookmarks/BookmarkSpace.swift#BookmarkSpace.store
   */
  readonly store: BookmarkStore;
  /**
   * The pane's byte 0 in `store`'s address space. Zero for a pane showing a
   * file whole, the part's offset in its file for a fragment panel.
   *
   * @upstream ByteRipperApp/Bookmarks/BookmarkSpace.swift#BookmarkSpace.origin
   */
  readonly origin: number;

  /** @upstream ByteRipperApp/Bookmarks/BookmarkSpace.swift#BookmarkSpace.init */
  constructor(store: BookmarkStore, origin = 0) {
    this.store = store;
    this.origin = origin;
  }

  /**
   * Whether the pane's offsets are not the list's — true exactly for a panel
   * showing a part taken out past the start of its file. What decides whether a
   * mark has an address elsewhere worth saying (§20.7).
   *
   * @upstream ByteRipperApp/Bookmarks/BookmarkSpace.swift#BookmarkSpace.isShifted
   */
  get isShifted(): boolean {
    return this.origin !== 0;
  }

  // MARK: - The two spaces

  /**
   * The list's row a mark made on this pane's row containing `local` belongs
   * on.
   *
   * Rounded **up** to the list's grid, and that is not an arbitrary half of a
   * coin toss: a part need not begin on a row boundary, and of the sixteen byte
   * offsets the pane's row covers in the list exactly one is a row of the list
   * — the first at or after `local + origin`. Rounding down would pick the row
   * *before* the pane's, and the mark would read back one row higher than it
   * was made. Rounding up makes {@link localRowOf} this function's inverse,
   * which is what stops a mark drifting every time it is looked at.
   *
   * @upstream ByteRipperApp/Bookmarks/BookmarkSpace.swift#BookmarkSpace.storeRow
   */
  storeRowOf(local: number): number {
    const absolute = rowContaining(local) + this.origin;
    const remainder = absolute % BYTES_PER_ROW;
    return remainder === 0 ? absolute : absolute + (BYTES_PER_ROW - remainder);
  }

  /**
   * Where the list's row `row` shows in this pane, or nothing when it falls
   * before the part's first byte — a mark on the file's rows above the part is
   * not in the part.
   *
   * Past the part's last byte needs no answer here: the dump draws no rows it
   * has no bytes for, so a mark beyond the end is simply never asked about
   * (§9), and the workspace's list keeps it either way.
   *
   * @upstream ByteRipperApp/Bookmarks/BookmarkSpace.swift#BookmarkSpace.localRow
   */
  localRowOf(row: number): number | undefined {
    if (row < this.origin) return undefined;
    return rowContaining(row - this.origin);
  }

  // MARK: - Reading

  /**
   * The marks as this pane has them: the list's, at this pane's offsets,
   * without the ones that fall before its first byte. Sorted, because the list
   * is and the translation is monotonic.
   *
   * @upstream ByteRipperApp/Bookmarks/BookmarkSpace.swift#BookmarkSpace.bookmarks
   */
  get bookmarks(): readonly Bookmark[] {
    const rows: Bookmark[] = [];
    for (const mark of this.store.bookmarks) {
      const local = this.localRowOf(mark.row);
      if (local !== undefined) rows.push({ row: local, name: mark.name });
    }
    return rows;
  }

  /**
   * The mark on the pane's row containing `local`, at that row.
   *
   * @upstream ByteRipperApp/Bookmarks/BookmarkSpace.swift#BookmarkSpace.bookmark
   */
  at(local: number): Bookmark | undefined {
    const mark = this.store.at(this.storeRowOf(local));
    return mark === undefined ? undefined : { row: rowContaining(local), name: mark.name };
  }

  /**
   * The pane's marked rows in `[start, end)`, a range of the pane's own
   * offsets.
   *
   * @upstream ByteRipperApp/Bookmarks/BookmarkSpace.swift#BookmarkSpace.rows
   */
  rowsIn(start: number, end: number): Set<number> {
    if (end <= start) return new Set();
    // Asked in the list's space and answered in the pane's. Both ends are taken
    // to the list's row their own row maps to, so a drawn row whose last bytes
    // fall past the range — the file's final, part-full row — still brings its
    // mark with it.
    const lower = this.storeRowOf(start);
    const upper = this.storeRowOf(end - 1);
    const rows = new Set<number>();
    for (const row of this.store.rowsIn(lower, upper + 1)) {
      const local = this.localRowOf(row);
      if (local !== undefined) rows.add(local);
    }
    return rows;
  }

  // MARK: - Writing

  /** @upstream ByteRipperApp/Bookmarks/BookmarkSpace.swift#BookmarkSpace.toggle */
  toggle(local: number): Bookmark | undefined {
    const mark = this.store.toggle(this.storeRowOf(local));
    return mark === undefined ? undefined : { row: rowContaining(local), name: mark.name };
  }

  /** @upstream ByteRipperApp/Bookmarks/BookmarkSpace.swift#BookmarkSpace.add */
  add(local: number, name = ""): Bookmark {
    const mark = this.store.add(this.storeRowOf(local), name);
    return { row: rowContaining(local), name: mark.name };
  }

  /** @upstream ByteRipperApp/Bookmarks/BookmarkSpace.swift#BookmarkSpace.rename */
  rename(local: number, name: string): Bookmark | undefined {
    const mark = this.store.rename(this.storeRowOf(local), name);
    return mark === undefined ? undefined : { row: rowContaining(local), name: mark.name };
  }

  /** @upstream ByteRipperApp/Bookmarks/BookmarkSpace.swift#BookmarkSpace.remove */
  remove(local: number): boolean {
    return this.store.remove(this.storeRowOf(local));
  }

  /** @upstream ByteRipperApp/Bookmarks/BookmarkSpace.swift#BookmarkSpace.edit */
  edit(from: number, to: number, name: string): Bookmark | undefined {
    const mark = this.store.edit(this.storeRowOf(from), this.storeRowOf(to), name);
    return mark === undefined ? undefined : { row: rowContaining(to), name: mark.name };
  }

  /**
   * Drags the mark on the pane's row containing `from` to the row containing
   * `to`, with `lastRow` the last row the pane draws (§20.6).
   *
   * The store decides where it lands — rows another mark holds are jumped over
   * — and the answer comes back in the pane's offsets. Nothing also when the
   * landing row is outside the part: the mark is still in the workspace's list,
   * at a row this panel does not reach.
   *
   * @upstream ByteRipperApp/Bookmarks/BookmarkSpace.swift#BookmarkSpace.move
   */
  move(from: number, to: number, lastRow: number): number | undefined {
    const landing = this.store.move(
      this.storeRowOf(from),
      this.storeRowOf(to),
      this.storeRowOf(lastRow)
    );
    return landing === undefined ? undefined : this.localRowOf(landing);
  }
}
