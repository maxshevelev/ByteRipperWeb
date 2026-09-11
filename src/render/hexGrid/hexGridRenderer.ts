import type { DiffBlockIndex } from "@/core/diff/diffBlock";
import type { ByteDecoder } from "@/core/text/byteDecoder";
import { addressString } from "@/core/text/offsetParser";
import { addressSignificantFrom, byteInk, type InkRole } from "@/render/hexGrid/byteStyle";
import { DirtyRows } from "@/render/hexGrid/dirtyRows";
import { GlyphAtlas, type GlyphAtlasKey } from "@/render/hexGrid/glyphAtlas";
import { BYTES_PER_ROW, type HexLayout } from "@/render/hexGrid/hexLayout";

/**
 * The hex grid, drawn.
 *
 * Imperative, and it imports no React — M2's definition of done says so, and
 * the lint rule in `biome.jsonc` enforces it. React's job is the chrome around
 * this canvas; it never renders a byte.
 *
 * Three things make the frame budget:
 *
 * - **Only dirty rows are painted** ({@link DirtyRows}). A caret moving down a
 *   column repaints two rows, not a screen.
 * - **Scrolling blits.** The rows that stayed on screen are copied up or down
 *   with one `drawImage` of the canvas onto itself, and only the newly exposed
 *   band is painted.
 * - **Glyphs are blitted, not shaped** ({@link GlyphAtlas}, D6).
 *
 * Bytes arrive through {@link HexGridSource.peek}, which is allowed to fail: a
 * canvas cannot await. A row whose bytes are not resident paints as a
 * placeholder and is left dirty, and the prefetch the renderer issues for the
 * viewport brings it back as soon as the chunk lands.
 */

/** Just enough of a match set for the renderer to ask about one row. */
export interface MatchLookup {
  matchesIntersecting(start: number, end: number): { start: number; end: number }[];
}

/** What the grid draws from. `BinaryDocument` satisfies this as it stands. */
export interface HexGridSource {
  readonly size: number;
  peek(at: number, length: number): Uint8Array | undefined;
  prefetch(at: number, length: number): Promise<void>;
}

/** The colours the grid paints with, resolved from the theme's CSS variables. */
/** Where the next typed byte will land, and how that is drawn. */
export interface HexGridCaret {
  readonly offset: number;
  /** 0 before the high nibble, 1 before the low one. */
  readonly nibble: 0 | 1;
  readonly region: "hex" | "text";
  readonly insertMode: boolean;
  /**
   * False while a selection stands and typing is not consuming it — the
   * selection fill already shows the active region, and a caret inside it would
   * claim a precision the user has not asked for.
   */
  readonly visible: boolean;
}

export interface HexGridColors extends Record<InkRole, string> {
  readonly background: string;
  readonly selection: string;
  readonly eofHatch: string;
  /** The orange wash over a byte that differs from the other pane's. */
  readonly difference: string;
  /** The outline showing where the other pane's selection falls here. */
  readonly peerSelection: string;
  /** Every occurrence of the search pattern. */
  readonly matchFill: string;
  /** The one the find bar is standing on. */
  readonly currentMatchFill: string;
  /** The overwrite-mode caret: a bar under the nibble about to be replaced. */
  readonly caret: string;
  /** The insert-mode caret: a line at the boundary bytes will be pushed from. */
  readonly insertCaret: string;
}

export interface HexGridConfig {
  readonly layout: HexLayout;
  readonly decoder: ByteDecoder;
  readonly colors: HexGridColors;
  readonly fontFamily: string;
  readonly fontSizePx: number;
  readonly devicePixelRatio: number;
}

export interface HexGridViewport {
  /** Scroll offset in content coordinates. */
  readonly scrollTop: number;
  /**
   * Horizontal scroll offset. A narrow window scrolls sideways rather than
   * wrapping the row: 16 bytes a row is the rule, not a preference.
   */
  readonly scrollLeft: number;
  readonly widthCss: number;
  readonly heightCss: number;
}

/** The selection to paint, as a half-open byte range. */
export interface HexGridSelection {
  readonly start: number;
  readonly end: number;
}

/**
 * How many rows either side of the viewport are kept resident, so a scroll of
 * a screen or so never paints a placeholder. One screen's worth is the useful
 * amount: less and a flick outruns it, more and the prefetch competes with the
 * reads the viewport itself needs.
 */
const READ_AHEAD_SCREENS = 1;

export class HexGridRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;

  private config: HexGridConfig | undefined;
  private atlas: GlyphAtlas | undefined;
  private source: HexGridSource | undefined;

  private viewport: HexGridViewport = {
    scrollTop: 0,
    scrollLeft: 0,
    widthCss: 0,
    heightCss: 0,
  };
  private selection: HexGridSelection = { start: 0, end: 0 };
  /**
   * The file as it was last saved, for deciding which bytes are unsaved edits.
   *
   * A byte is modified when it differs from the byte at the same offset in this
   * source — compared per byte, not looked up in a record of which ranges were
   * written. Those are not the same question: undo writes the original values
   * back *through the edit buffer*, so a range-based answer keeps calling them
   * modified long after they have gone back to what the file holds.
   *
   * Absent for a document that was never on disk — a new file, a duplicate —
   * where every byte would otherwise compare as modified. The unsaved marker in
   * the pane's readout already says what needs saying there.
   */
  private savedSource: HexGridSource | undefined;
  /** The comparison, when there is one. Differing bytes take the orange wash. */
  private differences: DiffBlockIndex | undefined;
  /** Where the other pane's selection falls at these offsets. */
  private peerSelection: HexGridSelection | undefined;
  private caret: HexGridCaret | undefined;
  /** Where the search pattern occurs, when a search is active. */
  private matches: MatchLookup | undefined;
  private currentMatch: HexGridSelection | undefined;
  /** Only the pane the commands act on draws a caret. */
  private active = false;

  private readonly dirty = new DirtyRows();
  /** The scroll offset the canvas currently holds, for the blit. */
  private paintedScrollTop = 0;
  private paintedRows: { first: number; end: number } = { first: 0, end: 0 };

  private prefetching: Promise<void> | undefined;
  private onBytesArrived: (() => void) | undefined;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const context = canvas.getContext("2d", { alpha: false });
    if (context === null) throw new Error("the hex grid needs a 2D canvas context");
    this.context = context;
  }

  /**
   * Called when bytes the last paint was missing have arrived, so the host can
   * schedule another frame.
   */
  setBytesArrivedHandler(handler: (() => void) | undefined): void {
    this.onBytesArrived = handler;
  }

  configure(config: HexGridConfig): void {
    this.config = config;
    const key: GlyphAtlasKey = {
      fontFamily: config.fontFamily,
      fontSizePx: config.fontSizePx,
      charWidth: config.layout.charWidth,
      rowHeight: config.layout.rowHeight,
      devicePixelRatio: config.devicePixelRatio,
      colors: config.colors,
      decoderIdentifier: config.decoder.identifier,
      placeholder: config.decoder.placeholder,
    };
    if (this.atlas === undefined || !this.atlas.matches(key)) {
      this.atlas = GlyphAtlas.build(key, config.decoder);
    }
    this.invalidateAll();
  }

  setSource(source: HexGridSource | undefined): void {
    this.source = source;
    this.invalidateAll();
  }

  /**
   * How far the pane must be scrollable, in bytes: its own file, or the
   * comparison's extent when the companion is longer.
   *
   * The two panes scroll by absolute offset, so both must reach the longer
   * file's end — otherwise the shorter one hits its own last row and stops
   * while the other keeps going, and the pair, which exists to show the same
   * offsets side by side, stops doing that. The rows past this pane's own EOF
   * are simply empty.
   */
  setScrollExtent(extent: number | undefined): void {
    if (this.scrollExtent === extent) return;
    this.scrollExtent = extent;
    this.invalidateAll();
  }

  private scrollExtent: number | undefined;

  setViewport(viewport: HexGridViewport): void {
    const config = this.config;
    if (config === undefined) return;

    const sizeChanged =
      viewport.widthCss !== this.viewport.widthCss ||
      viewport.heightCss !== this.viewport.heightCss;
    // The blit only ever moves rows vertically, so a sideways scroll has to be
    // repainted rather than shifted.
    const scrolledSideways = viewport.scrollLeft !== this.viewport.scrollLeft;
    this.viewport = viewport;

    if (sizeChanged) {
      const scale = config.devicePixelRatio;
      this.canvas.width = Math.max(1, Math.round(viewport.widthCss * scale));
      this.canvas.height = Math.max(1, Math.round(viewport.heightCss * scale));
      this.canvas.style.width = `${viewport.widthCss}px`;
      this.canvas.style.height = `${viewport.heightCss}px`;
      // A resized canvas is a cleared canvas: nothing of the old paint survives
      // to be blitted, so there is nothing to preserve.
      this.invalidateAll();
    } else if (scrolledSideways) {
      this.invalidateAll();
    }
  }

  setSelection(selection: HexGridSelection): void {
    const previous = this.selection;
    this.selection = selection;
    const config = this.config;
    if (config === undefined) return;
    // Only the rows the selection left and the rows it now covers.
    for (const range of [previous, selection]) {
      if (range.end < range.start) continue;
      const first = Math.floor(range.start / BYTES_PER_ROW);
      const last = Math.floor(Math.max(range.start, range.end - 1) / BYTES_PER_ROW);
      this.dirty.invalidate(first, last + 1);
    }
  }

  /**
   * Where the caret is. Dirties the row it left and the row it arrived at, so a
   * caret walking down a column repaints two rows rather than a screen.
   */
  setCaret(caret: HexGridCaret | undefined): void {
    const previous = this.caret;
    this.caret = caret;
    for (const each of [previous, caret]) {
      if (each === undefined) continue;
      const row = Math.floor(each.offset / BYTES_PER_ROW);
      // The row below, too. The overwrite bar deliberately runs a pixel past
      // its own row so it reads as a solid rule under the byte — which means
      // repainting only the caret's row leaves that pixel behind, and every
      // click a caret has been in keeps a stub of one.
      this.dirty.invalidate(row, row + 2);
    }
  }

  /**
   * The search matches to grey, and the one the find bar is standing on.
   *
   * A lookup rather than a list: the renderer asks only for the row it is
   * painting, so a pattern occurring four million times costs a row's worth of
   * work per row rather than a flattening of the whole set.
   */
  setMatches(matches: MatchLookup | undefined, current: HexGridSelection | undefined): void {
    this.matches = matches;
    this.currentMatch = current;
    this.invalidateAll();
  }

  /** Whether this is the pane the keyboard is talking to. */
  setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    const caret = this.caret;
    if (caret === undefined) return;
    const row = Math.floor(caret.offset / BYTES_PER_ROW);
    this.dirty.invalidate(row, row + 2);
  }

  /**
   * The comparison to paint. Passing `undefined` clears it — which is what
   * closing the other pane does, and the difference wash has to go with it.
   */
  setDifferences(index: DiffBlockIndex | undefined): void {
    this.differences = index;
    this.invalidateAll();
  }

  /**
   * The other pane's selection, outlined here so the same offsets can be seen
   * on both sides at once.
   */
  setPeerSelection(selection: HexGridSelection | undefined): void {
    const previous = this.peerSelection;
    this.peerSelection = selection;
    for (const range of [previous, selection]) {
      if (range === undefined || range.end < range.start) continue;
      const first = Math.floor(range.start / BYTES_PER_ROW);
      const last = Math.floor(Math.max(range.start, range.end - 1) / BYTES_PER_ROW);
      this.dirty.invalidate(first, last + 1);
    }
  }

  /** The file as it was last saved. `undefined` means nothing is an edit yet. */
  setSavedSource(source: HexGridSource | undefined): void {
    this.savedSource = source;
    this.invalidateAll();
  }

  /** Marks the rows covering `[start, end)` for repaint. */
  invalidateBytes(start: number, end: number): void {
    this.dirty.invalidate(
      Math.floor(start / BYTES_PER_ROW),
      Math.floor(Math.max(start, end - 1) / BYTES_PER_ROW) + 1
    );
  }

  invalidateAll(): void {
    this.dirty.clear();
    this.dirty.invalidate(0, Number.MAX_SAFE_INTEGER);
    this.paintedRows = { first: 0, end: 0 };
  }

  /** Total content height, for the scrollbar the pane puts beside this. */
  get contentHeight(): number {
    const config = this.config;
    if (config === undefined) return 0;
    const own = this.source?.size ?? 0;
    return config.layout.totalHeight(Math.max(own, this.scrollExtent ?? 0));
  }

  get contentWidth(): number {
    return this.config?.layout.contentWidth ?? 0;
  }

  /**
   * Paints whatever is dirty and visible. Cheap to call every frame: with
   * nothing dirty and no scroll it does nothing at all.
   */
  draw(): void {
    const config = this.config;
    const atlas = this.atlas;
    if (config === undefined || atlas === undefined) return;
    if (this.canvas.width === 0 || this.canvas.height === 0) return;

    const { layout } = config;
    const size = this.source?.size ?? 0;
    const rowCount = layout.rowCount(size);
    const visible = layout.visibleRowRange(this.viewport.scrollTop, this.viewport.heightCss);
    const first = Math.min(visible.first, rowCount);
    const end = Math.min(visible.end, rowCount);

    this.scrollBlit(first, end);
    this.requestReadAhead(first, end, size);

    const runs = this.dirty.within(first, end);
    if (runs.length === 0) {
      this.paintedScrollTop = this.viewport.scrollTop;
      this.paintedRows = { first, end };
      return;
    }

    const scale = config.devicePixelRatio;
    this.context.save();
    this.context.setTransform(
      scale,
      0,
      0,
      scale,
      -this.viewport.scrollLeft * scale,
      -this.viewport.scrollTop * scale
    );

    let missedBytes = false;
    for (const run of runs) {
      for (let row = run.start; row < run.end; row++) {
        if (!this.paintRow(row, size)) missedBytes = true;
      }
    }
    this.paintPastLastRow(rowCount);
    this.context.restore();

    this.dirty.clearWithin(first, end);
    if (missedBytes) {
      // The rows that painted placeholders stay dirty, so the frame after the
      // chunk lands paints them properly.
      for (const run of runs) this.dirty.invalidate(run.start, run.end);
    }
    this.paintedScrollTop = this.viewport.scrollTop;
    this.paintedRows = { first, end };
  }

  // MARK: - Internals

  /**
   * Moves what is already painted rather than repainting it.
   *
   * A scroll of one row copies the canvas onto itself, offset by a row, and
   * leaves a one-row band dirty. Without this, every scroll frame paints a
   * whole screen of glyphs.
   */
  private scrollBlit(first: number, end: number): void {
    const config = this.config;
    if (config === undefined) return;

    const delta = this.viewport.scrollTop - this.paintedScrollTop;
    if (delta === 0 || this.paintedRows.end === this.paintedRows.first) return;

    const scale = config.devicePixelRatio;
    const shift = Math.round(delta * scale);
    if (Math.abs(shift) >= this.canvas.height) {
      // Nothing that is painted is still on screen.
      this.dirty.invalidate(first, end);
      return;
    }

    this.context.save();
    this.context.setTransform(1, 0, 0, 1, 0, 0);
    this.context.globalCompositeOperation = "copy";
    this.context.drawImage(this.canvas, 0, -shift);
    this.context.restore();

    // The band the blit exposed, in rows, with one row of slack either side so
    // a fractional scroll never leaves a half-painted row behind.
    if (delta > 0) {
      const exposedFrom = Math.floor(
        (this.paintedScrollTop + this.viewport.heightCss) / config.layout.rowHeight
      );
      this.dirty.invalidate(exposedFrom - 1, end);
    } else {
      const exposedTo = Math.ceil(this.paintedScrollTop / config.layout.rowHeight);
      this.dirty.invalidate(first, exposedTo + 1);
    }
  }

  /**
   * Paints one row. Returns false when its bytes were not resident, which
   * leaves the row dirty for the frame after they arrive.
   */
  private paintRow(row: number, size: number): boolean {
    const config = this.config;
    const atlas = this.atlas;
    if (config === undefined || atlas === undefined) return true;

    const { layout, colors } = config;
    const y = row * layout.rowHeight;
    const rowStart = layout.byteOffset(row, 0);
    const available = Math.max(0, Math.min(BYTES_PER_ROW, size - rowStart));

    this.context.fillStyle = colors.background;
    // Across the whole canvas, not only the row's content: a window wider than
    // a row would otherwise leave whatever the last paint put there.
    this.context.fillRect(
      this.viewport.scrollLeft,
      y,
      Math.max(layout.contentWidth, this.viewport.widthCss),
      layout.rowHeight
    );

    // The greys go under the difference wash, which goes under the selection:
    // telling two dumps apart is what the application is for, so orange yields
    // to nothing but what the user is doing right now.
    this.paintMatches(rowStart, y);
    this.paintDifferences(rowStart, y);
    this.paintSelection(rowStart, y);
    this.paintPeerSelection(rowStart, y);
    this.paintAddress(rowStart, y);

    if (available === 0) {
      this.paintEofHatch(0, BYTES_PER_ROW, y);
      return true;
    }

    const bytes = this.source?.peek(rowStart, available);
    const saved = this.savedSource?.peek(rowStart, available);
    // Not knowing yet is not the same as not modified: paint the row when the
    // saved bytes are in, rather than showing black ink that turns red later.
    const savedPending = this.savedSource !== undefined && saved === undefined;

    if (bytes === undefined) {
      // Not resident. A placeholder band rather than a blank row, so a fast
      // scroll reads as "still loading" and not as "this file is empty here".
      this.paintEofHatch(0, available, y, 0.4);
      if (available < BYTES_PER_ROW) this.paintEofHatch(available, BYTES_PER_ROW, y);
      return false;
    }

    const savedSize = this.savedSource?.size ?? 0;
    for (let column = 0; column < bytes.length; column++) {
      const byte = bytes[column] ?? 0;
      const modified =
        this.savedSource === undefined || saved === undefined
          ? false
          : // Past the saved file's end, every byte is new.
            rowStart + column >= savedSize || saved[column] !== byte;
      const role = byteInk(byte, modified);
      this.blit(atlas.hexPair(byte, role), layout.hexByteX(column), y, 2 * layout.charWidth);
      this.blit(atlas.character(byte, role), layout.textX(column), y, layout.charWidth);
    }
    if (available < BYTES_PER_ROW) this.paintEofHatch(available, BYTES_PER_ROW, y);
    this.paintCaret(rowStart, y);
    return !savedPending;
  }

  /**
   * The ground below the file's last row.
   *
   * A document shorter than the viewport leaves the rest of the canvas holding
   * whatever was there before — which on a fresh canvas is transparent black.
   * Nothing paints it, because there is no row there to paint.
   */
  private paintPastLastRow(rowCount: number): void {
    const config = this.config;
    if (config === undefined) return;

    const { layout, colors } = config;
    const contentBottom = rowCount * layout.rowHeight;
    const viewportBottom = this.viewport.scrollTop + this.viewport.heightCss;
    if (contentBottom >= viewportBottom) return;

    this.context.fillStyle = colors.background;
    this.context.fillRect(
      this.viewport.scrollLeft,
      contentBottom,
      Math.max(layout.contentWidth, this.viewport.widthCss),
      viewportBottom - contentBottom
    );
  }

  /**
   * The caret, on the active pane only.
   *
   * Overwrite mode draws a bar under the nibble about to be replaced — below
   * the glyph, whose ink is centred in the row, so it never covers the symbol
   * it is pointing at. Insert mode draws a full-height line at the boundary the
   * bytes will be pushed from, in a different colour, because the two do
   * different things to the file and a caret that looked the same for both
   * would be the app's most dangerous piece of ambiguity.
   *
   * With no selection the caret also outlines its byte in the *other* column,
   * linking the hex and the decoded views of the same byte.
   */
  private paintCaret(rowStart: number, y: number): void {
    const config = this.config;
    const caret = this.caret;
    if (config === undefined || caret === undefined || !this.active || !caret.visible) return;
    if (caret.offset < rowStart || caret.offset >= rowStart + BYTES_PER_ROW) return;

    const { layout, colors } = config;
    const column = caret.offset - rowStart;

    // The link to the same byte in the column the caret is not in.
    this.context.save();
    this.context.strokeStyle = colors.caret;
    this.context.globalAlpha = 0.5;
    this.context.lineWidth = 1;
    if (caret.region === "hex") {
      this.context.strokeRect(
        layout.textX(column) + 0.5,
        y + 0.5,
        layout.charWidth - 1,
        layout.rowHeight - 1
      );
    } else {
      this.context.strokeRect(
        layout.hexByteX(column) + 0.5,
        y + 0.5,
        layout.hexByteWidth - 1,
        layout.rowHeight - 1
      );
    }
    this.context.restore();

    if (caret.insertMode) {
      // A thin line at the byte's left edge — where the byte will go. After the
      // first digit it shifts between the nibbles; the text column is
      // whole-byte, so its line stays on the cell's edge.
      const x =
        caret.region === "text"
          ? layout.textX(column)
          : layout.hexByteX(column) + (caret.nibble === 1 ? layout.charWidth : 0);
      this.context.fillStyle = colors.insertCaret;
      this.context.fillRect(x, y, 1, layout.rowHeight);
      return;
    }

    const x = caret.region === "text" ? layout.textX(column) : layout.caretX(column, caret.nibble);
    // Two pixels at the row's bottom edge, running a little past it, so it
    // reads as a solid bar under the byte without eating into the row.
    this.context.fillStyle = colors.caret;
    this.context.fillRect(x, y + layout.rowHeight - 2, layout.charWidth, 3);
  }

  /** The address, with its leading zeros muted. */
  private paintAddress(rowStart: number, y: number): void {
    const config = this.config;
    const atlas = this.atlas;
    if (config === undefined || atlas === undefined) return;

    const { layout } = config;
    const text = addressString(rowStart, layout.offsetColumnChars);
    const significant = addressSignificantFrom(text);

    for (let index = 0; index < text.length; index++) {
      const digit = Number.parseInt(text[index] ?? "0", 16);
      const role: InkRole = index < significant ? "mutedAddress" : "address";
      this.blit(
        atlas.digit(digit, role),
        layout.leftPadding + index * layout.charWidth,
        y,
        layout.charWidth
      );
    }
  }

  /**
   * Every occurrence of the search pattern, and the one being stood on.
   *
   * Grey for the rest, raised for the current one — so the eye can see how many
   * there are and where this one sits among them, which is what a scroll
   * through a result set is for.
   */
  private paintMatches(rowStart: number, y: number): void {
    const config = this.config;
    const matches = this.matches;
    if (config === undefined || matches === undefined) return;

    const found = matches.matchesIntersecting(rowStart, rowStart + BYTES_PER_ROW);
    if (found.length === 0) return;

    const { layout, colors } = config;
    for (const match of found) {
      const from = Math.max(match.start, rowStart) - rowStart;
      const to = Math.min(match.end, rowStart + BYTES_PER_ROW) - rowStart;
      if (to <= from) continue;

      const isCurrent =
        this.currentMatch !== undefined &&
        match.start === this.currentMatch.start &&
        match.end === this.currentMatch.end;
      this.context.fillStyle = isCurrent ? colors.currentMatchFill : colors.matchFill;
      this.context.fillRect(
        layout.hexByteX(from),
        y,
        layout.hexByteX(to - 1) + layout.hexByteWidth - layout.hexByteX(from),
        layout.rowHeight
      );
      this.context.fillRect(
        layout.textX(from),
        y,
        (to - from) * layout.charWidth,
        layout.rowHeight
      );
    }
  }

  /**
   * The orange wash, per byte.
   *
   * Per byte rather than per span: a difference is a fact about one offset, and
   * a run drawn through the word and group gaps would claim the gaps differ
   * too. The blocks touching this row are found by binary search, so a row
   * costs a lookup and not a walk of the index.
   */
  private paintDifferences(rowStart: number, y: number): void {
    const config = this.config;
    const index = this.differences;
    if (config === undefined || index === undefined) return;

    const blocks = index.blocksIn(rowStart, rowStart + BYTES_PER_ROW);
    if (blocks.length === 0) return;

    const { layout, colors } = config;
    this.context.fillStyle = colors.difference;
    for (const block of blocks) {
      if (block.kind !== "different") continue;
      const from = Math.max(block.start, rowStart) - rowStart;
      const to = Math.min(block.end, rowStart + BYTES_PER_ROW) - rowStart;
      for (let column = from; column < to; column++) {
        this.context.fillRect(layout.hexByteX(column), y, layout.hexByteWidth, layout.rowHeight);
        this.context.fillRect(layout.textX(column), y, layout.charWidth, layout.rowHeight);
      }
    }
  }

  /**
   * The other pane's selection, as an outline rather than a fill.
   *
   * An outline because a second fill would compete with this pane's own
   * selection and with the difference wash underneath both; what it has to say
   * is only "the same offsets, over there".
   */
  private paintPeerSelection(rowStart: number, y: number): void {
    const config = this.config;
    const peer = this.peerSelection;
    if (config === undefined || peer === undefined || peer.end <= peer.start) return;

    const from = Math.max(peer.start, rowStart) - rowStart;
    const to = Math.min(peer.end, rowStart + BYTES_PER_ROW) - rowStart;
    if (to <= from) return;

    const { layout, colors } = config;
    this.context.save();
    this.context.strokeStyle = colors.peerSelection;
    this.context.lineWidth = 1;
    // Half-pixel offsets so a one-pixel stroke lands on a pixel, not across two.
    const stroke = (x: number, width: number) =>
      this.context.strokeRect(x + 0.5, y + 0.5, width - 1, layout.rowHeight - 1);
    stroke(
      layout.hexByteX(from),
      layout.hexByteX(to - 1) + layout.hexByteWidth - layout.hexByteX(from)
    );
    stroke(layout.textX(from), (to - from) * layout.charWidth);
    this.context.restore();
  }

  private paintSelection(rowStart: number, y: number): void {
    const config = this.config;
    if (config === undefined) return;
    const { start, end } = this.selection;
    if (end <= start) return;

    const from = Math.max(start, rowStart) - rowStart;
    const to = Math.min(end, rowStart + BYTES_PER_ROW) - rowStart;
    if (to <= from) return;

    const { layout, colors } = config;
    this.context.fillStyle = colors.selection;
    // The hex cells, and the decoded characters beside them.
    this.context.fillRect(
      layout.hexByteX(from),
      y,
      layout.hexByteX(to - 1) + layout.hexByteWidth - layout.hexByteX(from),
      layout.rowHeight
    );
    this.context.fillRect(layout.textX(from), y, (to - from) * layout.charWidth, layout.rowHeight);
  }

  /**
   * Past EOF, and where bytes have not arrived. Hatching rather than emptiness,
   * because the state has to be carried by form as well as colour.
   */
  private paintEofHatch(fromColumn: number, toColumn: number, y: number, alpha = 1): void {
    const config = this.config;
    if (config === undefined || toColumn <= fromColumn) return;
    const { layout, colors } = config;

    const bands: [x: number, width: number][] = [
      [
        layout.hexByteX(fromColumn),
        layout.hexByteX(toColumn - 1) + layout.hexByteWidth - layout.hexByteX(fromColumn),
      ],
      [layout.textX(fromColumn), (toColumn - fromColumn) * layout.charWidth],
    ];

    for (const [x, width] of bands) {
      this.context.save();
      this.context.beginPath();
      this.context.rect(x, y, width, layout.rowHeight);
      this.context.clip();

      this.context.globalAlpha = alpha;
      this.context.strokeStyle = colors.eofHatch;
      this.context.lineWidth = 1;
      this.context.beginPath();
      // Diagonals at 45°, spaced so the band reads as hatched at any row
      // height. They run past the band's edges and the clip trims them.
      for (let offset = 0; offset < width + layout.rowHeight; offset += 6) {
        this.context.moveTo(x + offset, y + layout.rowHeight);
        this.context.lineTo(x + offset - layout.rowHeight, y);
      }
      this.context.stroke();
      this.context.restore();
    }
  }

  private blit(
    tile: { x: number; y: number; width: number; height: number },
    x: number,
    y: number,
    cssWidth: number
  ): void {
    const atlas = this.atlas;
    const config = this.config;
    if (atlas === undefined || config === undefined) return;
    this.context.drawImage(
      atlas.source,
      tile.x,
      tile.y,
      tile.width,
      tile.height,
      x,
      y,
      cssWidth,
      config.layout.rowHeight
    );
  }

  /**
   * Asks the storage for the viewport and a screen either side of it. One
   * request at a time: a fast scroll would otherwise queue a read per frame.
   */
  private requestReadAhead(first: number, end: number, size: number): void {
    const source = this.source;
    if (source === undefined || this.prefetching !== undefined || size === 0) return;

    const screens = (end - first) * READ_AHEAD_SCREENS;
    const from = Math.max(0, (first - screens) * BYTES_PER_ROW);
    const to = Math.min(size, (end + screens) * BYTES_PER_ROW);
    if (to <= from) return;

    const saved = this.savedSource;
    // Already resident on both sides: nothing to wait for, no frame to schedule.
    if (
      source.peek(from, to - from) !== undefined &&
      (saved === undefined || saved.peek(from, Math.min(to, saved.size) - from) !== undefined)
    ) {
      return;
    }

    this.prefetching = Promise.all([
      source.prefetch(from, to - from),
      saved === undefined || from >= saved.size
        ? Promise.resolve()
        : saved.prefetch(from, Math.min(to, saved.size) - from),
    ])
      .then(() => undefined)
      .catch(() => undefined)
      .then(() => {
        this.prefetching = undefined;
        this.onBytesArrived?.();
      });
  }
}
