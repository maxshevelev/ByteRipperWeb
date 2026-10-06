/**
 * Where the tree scrolls to so that a row and what it holds are on screen.
 *
 * Positions are those of `uefiStructureTool`'s list: a row at index `i` lies at
 * `i * rowHeight` below the column header, which is `headerHeight` tall and lies over the
 * top of what is seen.
 *
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolViewController.swift#UEFIToolViewController.scrollToShowChildren
 */
export function scrollToShowStretch(options: {
  readonly scrollTop: number;
  readonly clientHeight: number;
  readonly headerHeight: number;
  readonly rowHeight: number;
  /** The index of the row itself. */
  readonly row: number;
  /** The index of its last child, or of the row itself when it has none on show. */
  readonly last: number;
}): number {
  const { scrollTop, clientHeight, headerHeight, rowHeight, row, last } = options;
  const rowTop = row * rowHeight;
  const seenHeight = clientHeight - headerHeight;
  let top = scrollTop;
  // As many of the rows as fit...
  const stretchBottom = (last + 1) * rowHeight;
  if (stretchBottom > top + seenHeight) top = stretchBottom - seenHeight;
  // ...without taking the row itself off the top: the row at the top when the stretch is
  // taller than the view.
  if (rowTop < top) top = rowTop;
  return Math.max(0, top);
}
