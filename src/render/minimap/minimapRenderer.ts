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
import {
  BOOKMARK_MARK_SIDE,
  MARGIN_MARKER_INSET,
  type MapPlacement,
  MinimapLayout,
  ZONE_BRACKET_MIN_HEIGHT,
  ZONE_MAX_LANES,
} from "@/render/minimap/minimapLayout";
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

/** One piece as the strip draws it. */
export interface SegmentBandStrip {
  readonly top: number;
  readonly height: number;
  readonly tint: string;
  readonly hovered?: boolean | undefined;
}

/** One zone as the gutter draws it. */
export interface ZoneBracket {
  readonly top: number;
  readonly height: number;
  /** How deeply nested, so brackets inside brackets step inward. */
  readonly depth: number;
  readonly focused?: boolean | undefined;
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
  /** The bookmark marks in the margin (§19.4.3). */
  readonly bookmark: string;
  /** The zone the open tool is looking at, and the rest of them (§19.4.5). */
  readonly zoneFocused: string;
  readonly zoneOther: string;
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

/**
 * The map's own horizontal layout — its margins, its strip and its gutter.
 *
 * Every layer asks the layout rather than deriving its own margins, which is
 * what stopped them agreeing: the bookmark margin, the segment strip and the
 * zone gutter each measured from a different edge, so a mark, a band and a
 * bracket disagreed about where the map ended. It also differs by *which* map
 * this is — the inner edge of a side-by-side pair carries no padding at all.
 */
/**
 * How many lanes the gutter needs: one per level of nesting the published zones
 * actually reach, capped. A tree a dozen levels deep would leave no map.
 */
function laneCount(zones: readonly ZoneBracket[] | undefined): number {
  if (zones === undefined || zones.length === 0) return 0;
  const deepest = Math.max(...zones.map((one) => one.depth));
  return Math.min(deepest + 1, ZONE_MAX_LANES);
}

export class MinimapRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private colors: MinimapColors;
  private ratio = 1;
  /** Rebuilt on every paint, since the strip and the gutter come and go. */
  private layout = new MinimapLayout({
    width: 0,
    placement: "single",
    segmentStripVisible: false,
    zoneLaneCount: 0,
  });

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

  /** Where the dump itself starts, and how wide it is. */
  private get mapLeft(): number {
    return this.layout.contentArea.x;
  }

  private get mapWidth(): number {
    return Math.max(1, this.layout.contentArea.width);
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
    /**
     * Which map this is. Side by side the inner edges carry no padding, so the
     * two maps are not laid out alike — which is the whole reason the layout
     * needs telling.
     */
    readonly placement?: MapPlacement | undefined;
    /** The y of each bookmarked row inside this map, in CSS pixels. */
    readonly bookmarks?: readonly number[] | undefined;
    /** One band per piece, in CSS pixels down the map. */
    readonly segments?: readonly SegmentBandStrip[] | undefined;
    /** One bracket per zone the open tool published, in CSS pixels. */
    readonly zones?: readonly ZoneBracket[] | undefined;
    /** Detail mode: the states of the window's bytes, row-major, 16 per row. */
    readonly cells?: readonly CellState[] | undefined;
    /** Overview mode: the picture and its overlays. */
    readonly picture?: OverviewPicture | undefined;
    /** What the pane has selected, as a strip. */
    readonly selection?: { readonly top: number; readonly height: number } | undefined;
  }): void {
    // The strip and the gutter are only there when they have something to say,
    // and the dump takes the width back when they are not — so the layout is
    // built from what this paint actually holds rather than reserved for good.
    this.layout = new MinimapLayout({
      width: this.width,
      placement: options.placement ?? "single",
      segmentStripVisible: (options.segments?.length ?? 0) > 1,
      zoneLaneCount: laneCount(options.zones),
    });
    this.begin();
    if (options.mode === "detail") this.drawDetail(options.cells ?? []);
    else if (options.picture !== undefined) this.drawOverview(options.picture);
    if (options.selection !== undefined) this.drawSelection(options.selection);
    if (options.segments !== undefined) this.drawSegmentStrip(options.segments);
    if (options.zones !== undefined) this.drawZones(options.zones);
    if (options.bookmarks !== undefined) this.drawBookmarks(options.bookmarks);
  }

  /**
   * The open tool's zones, as brackets down the gutter.
   *
   * A bracket and not a band: zones nest — a FIT table, a row in it, the
   * microcode that row points at — and a band per zone would paint the outer
   * ones over the inner. Nested brackets step inward so the nesting is what the
   * eye reads. The one in focus takes the louder colour, which is how the panel
   * says which zone it is looking at.
   */
  private drawZones(brackets: readonly ZoneBracket[]): void {
    const gutter = this.layout.zoneGutterRect;
    if (gutter === undefined) return;
    const context = this.context;
    for (const bracket of brackets) {
      // Lane 0 — the outermost zones — is furthest from the map, and each level
      // of nesting steps one lane toward it, so a child's bracket is drawn
      // inside its parent's and the gutter reads as the tree it stands for.
      const lane = Math.min(bracket.depth, ZONE_MAX_LANES - 1);
      const x = this.layout.zoneLaneX(lane);
      // The arm reaches from the stem toward the map, across the lanes inside
      // it — which is what a nest of brackets looks like on paper.
      const arm = Math.max(1, gutter.x + gutter.width - x);
      const height = Math.max(ZONE_BRACKET_MIN_HEIGHT, bracket.height);
      context.fillStyle =
        bracket.focused === true ? this.colors.zoneFocused : this.colors.zoneOther;
      // The stem, and an arm at each end: an extent with ends the eye can find
      // is what tells one zone from the one it sits inside.
      context.fillRect(x, bracket.top, 1.5, height);
      context.fillRect(x, bracket.top, arm, 1.5);
      context.fillRect(x, bracket.top + height - 1.5, arm, 1.5);
    }
  }

  /**
   * The segment strip: one band per piece, from one cut to the next, at the y
   * the map's own rows use.
   *
   * The piece under the pointer is painted at full strength and the rest are
   * given a little air, so the strip says which piece is being asked about
   * without changing which colour it is.
   */
  private drawSegmentStrip(bands: readonly SegmentBandStrip[]): void {
    const strip = this.layout.segmentStripRect;
    if (strip === undefined) return;
    const context = this.context;
    for (const band of bands) {
      context.globalAlpha = band.hovered === true ? 1 : 0.75;
      context.fillStyle = band.tint;
      context.fillRect(strip.x, band.top, strip.width, Math.max(1, band.height));
    }
    context.globalAlpha = 1;
  }

  /**
   * The bookmark marks: a small purple triangle per marked row, in the margin,
   * pointing at the row it marks.
   *
   * Purple is the bookmark colour throughout (§20.4), which keeps a mark apart
   * from the grey viewport band that shares the map with it. Last, so a mark is
   * never buried under an overlay.
   */
  private drawBookmarks(rows: readonly number[]): void {
    const margin = this.layout.bookmarkMargin;
    if (margin === undefined) return;
    const context = this.context;
    context.fillStyle = this.colors.bookmark;
    // The apex stops just short of the margin's inner edge, and the base sits on
    // its outer one — so the triangle points *at* the row it marks from outside
    // the dump, and never over a byte.
    const apex = margin.pointsRight
      ? margin.x + margin.width - MARGIN_MARKER_INSET
      : margin.x + MARGIN_MARKER_INSET;
    const base = margin.pointsRight ? margin.x : margin.x + margin.width;
    for (const y of rows) {
      if (y < -BOOKMARK_MARK_SIDE || y > this.height + BOOKMARK_MARK_SIDE) continue;
      const top = y - BOOKMARK_MARK_SIDE / 2;
      context.beginPath();
      context.moveTo(base, top);
      context.lineTo(apex, y);
      context.lineTo(base, top + BOOKMARK_MARK_SIDE);
      context.closePath();
      context.fill();
    }
  }

  /** The pane's selection, across the width of its map. */
  private drawSelection(strip: { readonly top: number; readonly height: number }): void {
    const context = this.context;
    context.fillStyle = this.colors.selection;
    context.fillRect(this.mapLeft, strip.top, this.mapWidth, strip.height);
  }

  /** One cell per byte: the map reads as a miniature of the dump itself. */
  private drawDetail(cells: readonly CellState[]): void {
    const context = this.context;
    const cellWidth = this.mapWidth / BYTES_PER_ROW;
    const rows = Math.ceil(cells.length / BYTES_PER_ROW);

    for (let row = 0; row < rows; row++) {
      const y = row * ROW_STEP;
      if (y >= this.height) break;
      for (let column = 0; column < BYTES_PER_ROW; column++) {
        const cell = cells[row * BYTES_PER_ROW + column];
        if (cell === undefined) continue;
        const x = this.mapLeft + column * cellWidth;

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
    const cellWidth = this.mapWidth / MINIMAP_COLUMNS;
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
        context.fillRect(this.mapLeft + column * cellWidth, y, cellWidth, rowHeight);
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
    const bar = matchBarFor(mask, cellWidth, this.mapWidth);
    // The bar is measured within the map, so it is moved onto it: a mark that
    // stands for bytes has to sit over them, margins and all.
    return bar === undefined ? undefined : { x: this.mapLeft + bar.x, width: bar.width };
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
    // The map's own columns, not the canvas's: a mark stands for the bytes
    // under it, so it has to sit over them. Measured from the canvas it ran
    // into the margins, and a whole-row mark reached edge to edge where the
    // bytes it was about stopped two columns short.
    const left = this.mapLeft;
    const mapWidth = this.mapWidth;
    const cellWidth = mapWidth / MINIMAP_COLUMNS;
    context.fillStyle = color;

    for (let row = 0; row < rowCount; row++) {
      const word = mask[row] ?? 0;
      if (word === 0) continue;
      // A mark grown past its row must not be pushed off the bottom edge.
      const y = Math.min(row * rowHeight, this.height - markHeight);
      if (word === 0xffff) {
        context.fillRect(left, y, mapWidth, markHeight);
        continue;
      }
      for (let column = 0; column < MINIMAP_COLUMNS; column++) {
        if ((word & (1 << column)) === 0) continue;
        context.fillRect(left + column * cellWidth, y, cellWidth, markHeight);
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
