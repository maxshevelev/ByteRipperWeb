/**
 * The minimap, drawn.
 *
 * Two modes over one canvas. Detail is a miniature hex dump — one cell per
 * byte, a fixed scale, a window onto the file around the panes. Overview is the
 * whole file at one device pixel per row, each cell shaded by how much of its
 * slice is real content, so erased padding, code and mixed regions separate at
 * a glance.
 *
 * Imperative and React-free (D2/D6), like the hex grid beside it. Unlike the
 * grid it does not blit glyphs: every mark here is a rectangle, so there is no
 * atlas — the cost is in how many rectangles, which is what the dirty-row
 * handling below is about.
 */

import {
  BYTE_HEIGHT,
  BYTES_PER_ROW,
  type MinimapMode,
  ROW_STEP,
} from "@/render/minimap/minimapGeometry";
import { MINIMAP_COLUMNS } from "@/render/minimap/overviewBinning";

/** The flags that colour a cell. A byte can carry any combination. */
export interface CellState {
  /** The byte is not a 0x00/0xFF fill. */
  readonly significant: boolean;
  /** The byte was modified since the file was last read from disk. */
  readonly modified: boolean;
  /** The byte differs from the companion file. */
  readonly different: boolean;
}

/** The overview's precomputed picture of one file. */
export interface OverviewPicture {
  readonly extent: number;
  /**
   * This file's own length, which is not the extent when the companion is
   * longer. Cells past it hold none of this file's bytes and stay bare.
   */
  readonly fileSize: number;
  readonly rowCount: number;
  /** `rowCount × 16`, row-major. */
  readonly density: Uint8Array;
  readonly modified: Uint16Array;
  readonly different: Uint16Array;
  /** Per row, a bit per column holding at least one search match. */
  readonly matched?: Uint16Array | undefined;
  /** The same for the current match alone — the one the dump plates. */
  readonly current?: Uint16Array | undefined;
}

export interface MinimapColors {
  readonly background: string;
  readonly selection: string;
  /** The one hue reserved for search: the current match's plate. */
  readonly findIndicator: string;
  readonly byte: string;
  readonly mutedByte: string;
  readonly modified: string;
  readonly difference: string;
  readonly matchFill: string;
  readonly currentMatchFill: string;
}

/**
 * How dark the overview draws its content. Deliberately short of full ink: the
 * dump itself renders a dense row as *glyphs* on paper, which reads as a mid
 * grey, and a fill byte is drawn muted rather than left blank. Mapping "all
 * content" to solid black and "all padding" to bare paper turned the map into
 * black islands on white; these bounds put it in the tonal range the dump
 * beside it actually occupies.
 */
const MIN_TONE = 0.1;
const MAX_TONE = 0.55;
/** Lifts the low end so a sparse slice separates from an empty one. */
const TONE_GAMMA = 0.75;

/**
 * The floor on a mark's height, in device pixels.
 *
 * A difference, an edit or a match is a fact about the file, not a smudge of
 * one: at overview scale a single changed byte among millions occupies a
 * fraction of a pixel row, and drawn honestly it would not survive rounding.
 * Two device pixels is the smallest mark that reliably survives it.
 */
const MIN_MARK_DEVICE_PIXELS = 2;

/**
 * A match's stroke on the overview, and the current match's plate.
 *
 * Precision is not the point at this scale — a row is kilobytes — so a match is
 * solid ink a couple of pixels tall and wide enough to be seen when its bytes
 * fall in a single cell. A grey tint could not do that against a grey density
 * picture.
 *
 * The current match is a plate instead: the find indicator's yellow inside a
 * thin frame, "you are here" in the one hue reserved for search. Taller than a
 * stroke, but only just — a tall plate reads as a block on the map rather than
 * as a position in it.
 */
const MATCH_HEIGHT = 2;
const MATCH_MIN_WIDTH = 7;
const CURRENT_MATCH_HEIGHT = 4;

export class MinimapRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private colors: MinimapColors;
  private ratio = 1;

  constructor(canvas: HTMLCanvasElement, colors: MinimapColors) {
    const context = canvas.getContext("2d", { alpha: false });
    if (context === null) throw new Error("This browser did not give the minimap a 2D context.");
    this.canvas = canvas;
    this.context = context;
    this.colors = colors;
  }

  setColors(colors: MinimapColors): void {
    this.colors = colors;
  }

  /**
   * Sizes the backing store to the element, in device pixels.
   *
   * Only the backing store: the element's own size is CSS's business. Writing
   * `style.width`/`style.height` here from the size just measured overrides the
   * flex layout that produced it, the observer sees the new box, and the two
   * chase each other down to a few pixels — which is exactly what happened.
   */
  resize(cssWidth: number, cssHeight: number, devicePixelRatio: number): void {
    this.ratio = Math.max(1, devicePixelRatio);
    const width = Math.max(1, Math.round(cssWidth * this.ratio));
    const height = Math.max(1, Math.round(cssHeight * this.ratio));
    // Assigning either attribute clears the canvas, so only do it on a change.
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
  }

  /** The smallest height a mark may be drawn at, in CSS pixels. */
  get minMarkHeight(): number {
    return MIN_MARK_DEVICE_PIXELS / this.ratio;
  }

  private get width(): number {
    return this.canvas.width / this.ratio;
  }

  private get height(): number {
    return this.canvas.height / this.ratio;
  }

  private begin(): void {
    const context = this.context;
    context.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    context.fillStyle = this.colors.background;
    context.fillRect(0, 0, this.width, this.height);
  }

  /**
   * Draws the whole map.
   *
   * Everything is repainted: a map is a few hundred pixel rows of rectangles,
   * and the measured cost of a full repaint is well inside a frame. The grid
   * next door tracks dirty rows because it blits thousands of glyphs; doing the
   * same here would be bookkeeping bought with nothing.
   */
  draw(options: {
    readonly mode: MinimapMode;
    /** Detail mode: the states of the window's bytes, row-major, 16 per row. */
    readonly cells?: readonly CellState[] | undefined;
    /** Overview mode: the picture and its overlays. */
    readonly picture?: OverviewPicture | undefined;
    /** What the pane has selected, as a strip. */
    readonly selection?: { readonly top: number; readonly height: number } | undefined;
  }): void {
    this.begin();
    if (options.mode === "detail") this.drawDetail(options.cells ?? []);
    else if (options.picture !== undefined) this.drawOverview(options.picture);
    if (options.selection !== undefined) this.drawSelection(options.selection);
  }

  /** The pane's selection, across the width of its map. */
  private drawSelection(strip: { readonly top: number; readonly height: number }): void {
    const context = this.context;
    context.fillStyle = this.colors.selection;
    context.fillRect(0, strip.top, this.width, strip.height);
  }

  /** One cell per byte: the map reads as a miniature of the dump itself. */
  private drawDetail(cells: readonly CellState[]): void {
    const context = this.context;
    const cellWidth = this.width / BYTES_PER_ROW;
    const rows = Math.ceil(cells.length / BYTES_PER_ROW);

    for (let row = 0; row < rows; row++) {
      const y = row * ROW_STEP;
      if (y >= this.height) break;
      for (let column = 0; column < BYTES_PER_ROW; column++) {
        const cell = cells[row * BYTES_PER_ROW + column];
        if (cell === undefined) continue;
        const x = column * cellWidth;

        // Difference is a background and the byte is drawn on top, matching the
        // panes — a byte that is both differing and edited shows both.
        if (cell.different) {
          context.fillStyle = this.colors.difference;
          context.fillRect(x, y, cellWidth, BYTE_HEIGHT);
        }
        context.fillStyle = cell.modified
          ? this.colors.modified
          : cell.significant
            ? this.colors.byte
            : this.colors.mutedByte;
        // An insignificant byte is drawn as a hairline rather than a full cell,
        // so a field of 0xFF reads as empty without reading as absent.
        const inset = cell.significant || cell.modified ? 0 : BYTE_HEIGHT / 4;
        context.fillRect(x, y + inset, cellWidth, BYTE_HEIGHT - inset * 2);
      }
    }
  }

  /** The whole file at one device pixel per row. */
  private drawOverview(picture: OverviewPicture): void {
    const context = this.context;
    const rowHeight = this.height / Math.max(1, picture.rowCount);
    const cellWidth = this.width / MINIMAP_COLUMNS;
    const markHeight = Math.max(rowHeight, this.minMarkHeight);

    // The density picture first, as the ground everything else marks.
    //
    // Every cell inside the file is drawn, including the ones holding nothing
    // but 0x00/0xFF fill: the tone ramp has a floor, so an erased region reads
    // as a pale band that is part of the file rather than as bare paper. Skip
    // those cells and a chip that is mostly erased flash looks like a chip that
    // is mostly absent — which is the opposite of what the map is for.
    //
    // Cells past this file's own end are the ones that stay bare. The extent is
    // the longer of the two files, so without that bound the shorter map's tail
    // would wash pale all the way down and claim content it does not have.
    for (let row = 0; row < picture.rowCount; row++) {
      const y = row * rowHeight;
      const base = row * MINIMAP_COLUMNS;
      const rowStart = Math.floor((picture.extent * row) / picture.rowCount);
      const rowEnd = Math.floor((picture.extent * (row + 1)) / picture.rowCount);
      const lastColumn = lastColumnInFile(rowStart, rowEnd - rowStart, picture.fileSize);
      for (let column = 0; column <= lastColumn; column++) {
        context.fillStyle = this.toneFor(picture.density[base + column] ?? 0);
        context.fillRect(column * cellWidth, y, cellWidth, rowHeight);
      }
    }

    // Then the overlays, each at least two device pixels tall so a single byte
    // among millions is still a mark the eye can find.
    this.drawMask(
      picture.different,
      picture.rowCount,
      rowHeight,
      markHeight,
      this.colors.difference
    );
    this.drawMask(picture.modified, picture.rowCount, rowHeight, markHeight, this.colors.modified);
    // Matches last, and in two passes of their own — see below.
    this.drawMatches(picture, rowHeight, cellWidth);
  }

  /**
   * The search's matches over the density picture.
   *
   * Two passes, because a row here is about a pixel tall while the marks are a
   * few: a stroke drawn for a later row would otherwise land on top of the
   * current match's plate, and the plate has to be the topmost thing on the map.
   */
  private drawMatches(picture: OverviewPicture, rowHeight: number, cellWidth: number): void {
    const context = this.context;
    const matched = picture.matched;
    const current = picture.current;
    const strokeHeight = Math.max(MATCH_HEIGHT, this.minMarkHeight);

    if (matched !== undefined) {
      context.fillStyle = this.colors.byte;
      for (let row = 0; row < picture.rowCount; row++) {
        const bar = this.matchBar(matched[row] ?? 0, cellWidth);
        if (bar === undefined) continue;
        const y = Math.min(row * rowHeight, this.height - strokeHeight);
        context.fillRect(bar.x, y, bar.width, strokeHeight);
      }
    }

    if (current === undefined) return;
    // The first row carrying it is the plate: the current match is one range,
    // and a second plate would be a second "you are here".
    for (let row = 0; row < picture.rowCount; row++) {
      const bar = this.matchBar(current[row] ?? 0, cellWidth);
      if (bar === undefined) continue;
      const height = Math.max(CURRENT_MATCH_HEIGHT, strokeHeight * 2);
      const inset = (height - strokeHeight) / 2;
      const y = Math.max(0, Math.min(row * rowHeight - inset, this.height - height));

      context.fillStyle = this.colors.findIndicator;
      context.fillRect(bar.x, y, bar.width, height);
      context.strokeStyle = this.colors.byte;
      context.lineWidth = 1 / this.ratio;
      const half = context.lineWidth / 2;
      context.strokeRect(
        bar.x + half,
        y + half,
        bar.width - context.lineWidth,
        height - context.lineWidth
      );
      return;
    }
  }

  /**
   * The mark for a row's mask: the marked cells' span, widened to a readable
   * minimum and kept inside the map.
   */
  private matchBar(mask: number, cellWidth: number) {
    return matchBarFor(mask, cellWidth, this.width);
  }

  private drawMask(
    mask: Uint16Array | undefined,
    rowCount: number,
    rowHeight: number,
    markHeight: number,
    color: string
  ): void {
    if (mask === undefined) return;
    const context = this.context;
    const cellWidth = this.width / MINIMAP_COLUMNS;
    context.fillStyle = color;

    for (let row = 0; row < rowCount; row++) {
      const word = mask[row] ?? 0;
      if (word === 0) continue;
      // A mark grown past its row must not be pushed off the bottom edge.
      const y = Math.min(row * rowHeight, this.height - markHeight);
      if (word === 0xffff) {
        context.fillRect(0, y, this.width, markHeight);
        continue;
      }
      for (let column = 0; column < MINIMAP_COLUMNS; column++) {
        if ((word & (1 << column)) === 0) continue;
        context.fillRect(column * cellWidth, y, cellWidth, markHeight);
      }
    }
  }

  /**
   * The ink a cell's density earns, as a colour.
   *
   * Interpolated in the byte colour's own alpha rather than towards a fixed
   * grey, so the map follows the theme the dump follows.
   */
  private toneFor(density: number): string {
    return withAlpha(this.colors.byte, overviewTone(density));
  }
}

/**
 * The ink a cell's density earns, mapped into the tonal band the dump itself
 * occupies rather than the full paper-to-black range.
 *
 * Ported from `MinimapView.overviewTone`. Note the floor: density 0 is
 * {@link MIN_TONE}, not nothing — a cell of pure fill is still a cell of the
 * file.
 */
export function overviewTone(density: number): number {
  const fraction = density / 255;
  const shaped = fraction > 0 ? fraction ** TONE_GAMMA : 0;
  return MIN_TONE + (MAX_TONE - MIN_TONE) * shaped;
}

/**
 * The mark for a row's mask: the marked cells' span, widened to a readable
 * minimum and kept inside a map `mapWidth` wide.
 *
 * Ported from the `mark(for:y:height:)` inside
 * `MinimapView.overviewMatchBars`.
 */
export function matchBarFor(
  mask: number,
  cellWidth: number,
  mapWidth: number
): { readonly x: number; readonly width: number } | undefined {
  if (mask === 0) return undefined;
  let first = MINIMAP_COLUMNS;
  let last = -1;
  for (let column = 0; column < MINIMAP_COLUMNS; column++) {
    if ((mask & (1 << column)) === 0) continue;
    first = Math.min(first, column);
    last = Math.max(last, column);
  }
  if (last < first) return undefined;

  const left = first * cellWidth;
  let width = (last + 1) * cellWidth - left;
  let x = left;
  if (width < MATCH_MIN_WIDTH) {
    width = MATCH_MIN_WIDTH;
    x = Math.max(0, Math.min(left, mapWidth - width));
  }
  return { x, width };
}

/**
 * The last of a row's cells that holds a byte of this file, or -1 for none.
 *
 * Ported from `MinimapView.lastColumnInFile`.
 */
function lastColumnInFile(rowStart: number, span: number, fileSize: number): number {
  if (fileSize <= rowStart) return -1;
  const bytes = fileSize - rowStart;
  if (bytes >= span) return MINIMAP_COLUMNS - 1;
  return Math.min(MINIMAP_COLUMNS - 1, Math.floor((bytes * MINIMAP_COLUMNS) / Math.max(span, 1)));
}

/**
 * A colour at a given alpha.
 *
 * The palette arrives as whatever `getComputedStyle` resolved — usually `rgb()`
 * — so this parses the channels rather than assuming a hex string. Anything it
 * cannot read is returned unchanged, which draws at full strength: too dark is
 * a worse answer than the right hue, but it is a visible one rather than a
 * silent blank.
 */
export function withAlpha(color: string, alpha: number): string {
  const match = /^rgba?\(([^)]+)\)$/i.exec(color.trim());
  if (match !== null) {
    const parts = (match[1] ?? "").split(/[\s,/]+/).filter((part) => part.length > 0);
    const [r, g, b] = parts;
    if (r !== undefined && g !== undefined && b !== undefined) {
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
  }
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (hex !== null) {
    const digits = hex[1] ?? "";
    const full =
      digits.length === 3
        ? digits
            .split("")
            .map((d) => d + d)
            .join("")
        : digits;
    const value = Number.parseInt(full, 16);
    return `rgba(${(value >> 16) & 0xff}, ${(value >> 8) & 0xff}, ${value & 0xff}, ${alpha})`;
  }
  return color;
}
