/**
 * Where a byte sits on the map, and which byte sits under a point.
 *
 * Pure arithmetic over heights and offsets, kept out of the renderer and the
 * component so both modes can be reasoned about — and tested — without a
 * canvas. Ported from the geometry half of
 * `ByteRipperApp/Minimap/MinimapView.swift`.
 *
 * One convention difference worth stating: AppKit's view is flipped and this
 * is a canvas, so `y` grows downward in both, and a y of 0 is the top of the
 * map area. Offsets into the area are used throughout rather than page
 * coordinates.
 */

/** The dump's row width, and the map's. */
export const BYTES_PER_ROW = 16;

/**
 * The detail scale, fixed by design: a byte cell is `BYTE_HEIGHT` tall with
 * `ROW_GAP` between rows, so one hex row costs `ROW_STEP` no matter how large
 * the file is. This is what makes detail a window rather than an overview.
 */
export const BYTE_HEIGHT = 2;
export const ROW_GAP = 1;
export const ROW_STEP = BYTE_HEIGHT + ROW_GAP;

/**
 * The size up to which detail is the more informative view, and a file opens in
 * it. A few hundred hex rows: a panel of any usual height shows most of such a
 * file byte by byte, while the overview would have little left to compress.
 * Fixed rather than derived from the panel's current height, so which mode a
 * file opens in does not depend on the window's size at that moment.
 */
export const DETAIL_PREFERRED_MAX_SIZE = 4 * 1024;

/** How near an overview's top or bottom edge a click snaps to the file bounds. */
export const FILE_EDGE_SNAP_DISTANCE = 3;

export type MinimapMode = "detail" | "overview";

/**
 * How many hex rows a map `areaHeight` tall can show in detail: every row costs
 * `BYTE_HEIGHT` plus a trailing `ROW_GAP` except the last. Small heights
 * collapse to zero rows — nothing fits.
 */
export function visibleRowCount(areaHeight: number): number {
  if (areaHeight <= 0) return 0;
  return Math.max(0, Math.floor((areaHeight + ROW_GAP) / ROW_STEP));
}

/**
 * How many overview rows a map `areaHeight` tall can show, at one device pixel
 * per row. Shared by both maps so the offset axis stays common.
 */
export function overviewRowCount(areaHeight: number, devicePixelRatio: number): number {
  const rowHeight = 1 / Math.max(devicePixelRatio, 1);
  if (areaHeight <= 0) return 0;
  return Math.max(0, Math.floor(areaHeight / rowHeight));
}

/** Total hex rows of the longest open file — the extent the window slides over. */
export function referenceRowCount(sizes: readonly number[]): number {
  const largest = sizes.length === 0 ? 0 : Math.max(...sizes);
  return Math.ceil(largest / BYTES_PER_ROW);
}

/** Whether the detail window can show the whole file at once. */
export function detailWindowFitsWholeFile(sizes: readonly number[], areaHeight: number): boolean {
  const rows = referenceRowCount(sizes);
  return rows === 0 || rows <= Math.max(0, visibleRowCount(areaHeight));
}

/**
 * Whether the overview would compress the file rather than magnify it: it is
 * worth showing while every pixel row stands for at least one byte.
 *
 * Below that each byte is stretched over several rows — a blown-up smear of a
 * file that detail shows whole, byte by byte, with real per-byte state. So the
 * mode is not offered there at all. An unmeasured panel has no answer yet and
 * counts as useful, so the switch is never disabled on the strength of geometry
 * that does not exist.
 */
export function overviewIsInformative(sizes: readonly number[], rows: number): boolean {
  if (rows <= 0) return true;
  return (sizes.length === 0 ? 0 : Math.max(...sizes)) >= rows;
}

/**
 * The mode a file should open in: detail while it is small enough to be read
 * byte by byte, the overview once it is not.
 */
export function preferredMode(sizes: readonly number[], areaHeight: number): MinimapMode {
  const largest = sizes.length === 0 ? 0 : Math.max(...sizes);
  if (largest <= DETAIL_PREFERRED_MAX_SIZE) return "detail";
  return detailWindowFitsWholeFile(sizes, areaHeight) ? "detail" : "overview";
}

/**
 * The detail window's first row, derived from where the panes are.
 *
 * The window's position within the file matches the panes' own: at the file's
 * start the window is at row 0, at its end the window's last row is the file's
 * last. That is what keeps the viewport band fully on the map — it travels the
 * map's height exactly once over the whole file. A file short enough to fit
 * sits at row 0 and the band moves inside it directly.
 */
export function derivedTopRow(options: {
  readonly mode: MinimapMode;
  readonly sizes: readonly number[];
  readonly windowRows: number;
  /** The byte range the panes are showing, half-open. */
  readonly viewport: { readonly start: number; readonly end: number } | undefined;
}): number {
  // The overview shows the whole file, so there is no window to position.
  if (options.mode !== "detail") return 0;
  const totalRows = referenceRowCount(options.sizes);
  const windowRows = Math.max(0, options.windowRows);
  if (windowRows <= 0 || totalRows <= windowRows) return 0;

  const visible = options.viewport;
  if (visible === undefined) return 0;
  const paneTop = Math.floor(visible.start / BYTES_PER_ROW);
  const paneRows = Math.max(1, Math.ceil((visible.end - visible.start) / BYTES_PER_ROW));
  // The panes cannot scroll past this row, so it is the 100 % mark.
  if (totalRows <= paneRows) return 0;
  const maxPaneTop = totalRows - paneRows;
  const fraction = Math.min(1, Math.min(paneTop, maxPaneTop) / maxPaneTop);
  return Math.round(fraction * (totalRows - windowRows));
}

/** The byte offset a point on the map stands for. */
export function offsetAtY(options: {
  readonly mode: MinimapMode;
  readonly y: number;
  readonly areaHeight: number;
  /** Detail: the window's first row. */
  readonly topRow: number;
  /** Overview: the extent the rows are binned over, and how many there are. */
  readonly extent: number;
  readonly overviewRows: number;
}): number {
  if (options.mode === "detail") {
    const row = Math.floor(Math.max(0, options.y) / ROW_STEP) + options.topRow;
    return row * BYTES_PER_ROW;
  }
  if (options.extent <= 0 || options.overviewRows <= 0) return 0;
  const rowHeight = options.areaHeight / options.overviewRows;
  const fraction = Math.min(1, Math.max(0, options.y / (options.overviewRows * rowHeight)));
  return Math.floor(fraction * options.extent);
}

/**
 * The offset a click lands on, with the overview's edge zones snapped to the
 * file's own bounds.
 *
 * Without it the first and last pixel rows of a map are unreachable: they stand
 * for a slice of the file, and the offset they yield is somewhere inside it.
 * Aiming at the top of the map means the start of the file.
 */
export function snappedOffsetAtY(options: {
  readonly mode: MinimapMode;
  readonly y: number;
  readonly areaHeight: number;
  readonly topRow: number;
  readonly extent: number;
  readonly overviewRows: number;
  /** This map's own file, which is what the snap clamps to. */
  readonly fileSize: number;
}): number {
  if (options.mode === "overview" && options.fileSize > 0) {
    if (options.y <= FILE_EDGE_SNAP_DISTANCE) return 0;
    if (options.areaHeight - options.y <= FILE_EDGE_SNAP_DISTANCE) return options.fileSize - 1;
  }
  const offset = offsetAtY(options);
  return Math.min(offset, Math.max(0, options.fileSize - 1));
}

/**
 * The band standing for what the panes are showing, as a half-open span of y
 * within the map area, or `undefined` when there is nothing to draw.
 *
 * Given a minimum height so a viewport that is a sliver of a large file is
 * still a thing the pointer can catch.
 */
export function viewportBand(options: {
  readonly mode: MinimapMode;
  readonly viewport: { readonly start: number; readonly end: number } | undefined;
  readonly areaHeight: number;
  readonly topRow: number;
  readonly extent: number;
  readonly overviewRows: number;
  readonly minHeight?: number;
}): { readonly top: number; readonly height: number } | undefined {
  const visible = options.viewport;
  if (visible === undefined || visible.end <= visible.start) return undefined;
  const minHeight = options.minHeight ?? 4;

  let top: number;
  let bottom: number;
  if (options.mode === "detail") {
    const firstRow = Math.floor(visible.start / BYTES_PER_ROW) - options.topRow;
    const lastRow = Math.ceil(visible.end / BYTES_PER_ROW) - options.topRow;
    top = firstRow * ROW_STEP;
    bottom = lastRow * ROW_STEP - ROW_GAP;
  } else {
    if (options.extent <= 0) return undefined;
    top = (visible.start / options.extent) * options.areaHeight;
    bottom = (Math.min(visible.end, options.extent) / options.extent) * options.areaHeight;
  }

  const height = Math.max(minHeight, bottom - top);
  // A band grown to the minimum height must not be pushed off the bottom edge.
  const clampedTop = Math.max(0, Math.min(top, options.areaHeight - height));
  if (clampedTop >= options.areaHeight || bottom <= 0) return undefined;
  return { top: clampedTop, height: Math.min(height, options.areaHeight - clampedTop) };
}
