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
  readonly byte: string;
  readonly mutedByte: string;
  readonly modified: string;
  readonly difference: string;
  readonly matchFill: string;
  readonly currentMatchFill: string;
  readonly viewport: string;
  readonly viewportBorder: string;
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
    /** The band standing for what the panes show. */
    readonly band?: { readonly top: number; readonly height: number } | undefined;
  }): void {
    this.begin();
    if (options.mode === "detail") this.drawDetail(options.cells ?? []);
    else if (options.picture !== undefined) this.drawOverview(options.picture);
    if (options.band !== undefined) this.drawBand(options.band);
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
    for (let row = 0; row < picture.rowCount; row++) {
      const y = row * rowHeight;
      const base = row * MINIMAP_COLUMNS;
      for (let column = 0; column < MINIMAP_COLUMNS; column++) {
        const density = picture.density[base + column] ?? 0;
        if (density === 0) continue;
        context.fillStyle = this.toneFor(density);
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
    this.drawMask(picture.matched, picture.rowCount, rowHeight, markHeight, this.colors.matchFill);
    this.drawMask(picture.modified, picture.rowCount, rowHeight, markHeight, this.colors.modified);
    this.drawMask(
      picture.current,
      picture.rowCount,
      rowHeight,
      markHeight,
      this.colors.currentMatchFill
    );
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

  /** The band standing for what the panes are showing. */
  private drawBand(band: { readonly top: number; readonly height: number }): void {
    const context = this.context;
    context.fillStyle = this.colors.viewport;
    context.fillRect(0, band.top, this.width, band.height);
    context.strokeStyle = this.colors.viewportBorder;
    context.lineWidth = 1 / this.ratio;
    const half = context.lineWidth / 2;
    context.strokeRect(
      half,
      band.top + half,
      this.width - context.lineWidth,
      band.height - context.lineWidth
    );
  }

  /**
   * The ink a cell's density earns, as a colour.
   *
   * Interpolated in the byte colour's own alpha rather than towards a fixed
   * grey, so the map follows the theme the dump follows.
   */
  private toneFor(density: number): string {
    const share = density / 255;
    const tone = MIN_TONE + (MAX_TONE - MIN_TONE) * share ** TONE_GAMMA;
    return withAlpha(this.colors.byte, tone);
  }
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
