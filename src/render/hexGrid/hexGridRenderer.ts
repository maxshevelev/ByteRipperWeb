import type { DiffBlockIndex } from "@/core/diff/diffBlock";
import { NO_BASELINE, type ModifiedBaseline } from "@/core/segments/baseline";
import type { ByteStorage } from "@/core/storage/byteStorage";
import type { ByteDecoder } from "@/core/text/byteDecoder";
import { addressString } from "@/core/text/offsetParser";
import {
  addressDigitInk,
  addressSignificantFrom,
  byteInk,
  type InkRole,
} from "@/render/hexGrid/byteStyle";
import { bandOnDeviceGrid, snapToDevicePixels } from "@/render/hexGrid/devicePixels";
import { DirtyRows } from "@/render/hexGrid/dirtyRows";
import { GlyphAtlas, type GlyphAtlasKey } from "@/render/hexGrid/glyphAtlas";
import { BYTES_PER_ROW, type HexLayout } from "@/render/hexGrid/hexLayout";
import {
  type ContourPoint,
  contourRowSpan,
  selectionContours,
  traceContour,
} from "@/render/hexGrid/spanContour";

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

/**
 * What the grid draws from. `BinaryDocument` satisfies this as it stands.
 *
 * @upstream ByteRipperApp/Hex/HexView.swift#HexViewDataSource
 * @upstream-differs the renderer is handed each piece of state through a setter, rather than pulling it from a data source during draw
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#HexByteState
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#HexByteState.byte
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#HexByteState.isModified
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#HexByteState.isDifferent
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#HexByteState.isEOF
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.hexByteStates
 */
export interface HexGridSource {
  /** @upstream ByteRipperApp/Hex/HexView.swift#HexViewDataSource.fileSize */
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
   * The caret sits on a byte whose high nibble was just inserted in insert mode
   * and whose low nibble is still to come — a genuinely half-typed byte, as
   * opposed to a nibble-1 caret a click placed. Only then is the low nibble an
   * empty slot and drawn as a dim `_` (§7).
   *
   * @upstream ByteRipperApp/Hex/HexView.swift#HexViewDataSource.hexHasPendingInsert
   */
  readonly pendingInsert: boolean;
  /**
   * False while a selection stands and typing is not consuming it — the
   * selection fill already shows the active region, and a caret inside it would
   * claim a precision the user has not asked for.
   */
  readonly visible: boolean;
}

/**
 * The companion outline's stroke. Padded outward where a spacer allows it, so
 * the line clears the glyphs; rounded so the staircase reads as one region.
 */
/**
 * The overwrite caret's bar: how much of it sits inside the row, and how far it
 * runs past the bottom edge.
 *
 * It is an underline below the glyph — whose ink is centred in the row — so it
 * never covers the symbol it marks. Running past the edge is what makes it read
 * as a solid rule under the byte rather than a hairline squeezed into the last
 * pixel; it lands on the row below, which is why {@link caretRowReach} exists.
 */
const CARET_BAR_HEIGHT = 2;
const CARET_BAR_OVERHANG = 2;

/**
 * The rows the caret's ink reaches, half-open.
 *
 * Derived from the bar's own geometry rather than written out as `row + 2`, so
 * a taller bar cannot quietly outgrow what gets repainted — which shows up as a
 * stub of a rule under every row the caret has ever been in.
 *
 * @upstream ByteRipperApp/Hex/HexView.swift#HexView.bookmarkTipReach
 */
export function caretRowReach(
  offset: number,
  rowHeight: number
): { readonly first: number; readonly end: number } {
  const row = Math.floor(offset / BYTES_PER_ROW);
  const below = Math.ceil(CARET_BAR_OVERHANG / Math.max(1, rowHeight));
  return { first: row, end: row + 1 + below };
}

/**
 * The mark's body reaches this far past the offset column, as the ring does.
 *
 * @upstream ByteRipperApp/Hex/HexView.swift#HexView.bookmarkMarkBody
 */
const BOOKMARK_PADDING = 2;
/**
 * The apex angle of the mark's tip, held at every font size.
 *
 * @upstream ByteRipperApp/Hex/HexView.swift#HexView.bookmarkTipAngle
 */
const BOOKMARK_TIP_ANGLE = Math.PI / 2;
/**
 * The mark's outline, while a context menu is about the row it is on: dash
 * pattern in CSS pixels.
 *
 * @upstream ByteRipperApp/Hex/HexView.swift#HexView.bookmarkOutlineDashes
 */
const BOOKMARK_OUTLINE_DASHES: number[] = [3, 2];

/** @upstream ByteRipperApp/Hex/HexView.swift#HexView.mirrorContourPadding */
const PEER_CONTOUR_PADDING = 2;
/** @upstream ByteRipperApp/Hex/HexView.swift#HexView.mirrorContourRadius */
const PEER_CONTOUR_RADIUS = 3;
/** @upstream ByteRipperApp/Hex/HexView.swift#HexView.mirrorContourLineWidth */
const PEER_CONTOUR_LINE_WIDTH = 1.5;

/** The find indicator's outline: a hairline, enough to edge the yellow. */
const FIND_INDICATOR_LINE_WIDTH = 1;

/**
 * A published zone, drawn as upstream draws one: the mirror's own contour —
 * same padding, same rounding — stroked at a steady strength, teal for the
 * focused zone and khaki for the rest, and only the focused one washed. What is
 * being worked on is told from what is merely in the map by hue and by the
 * wash, never by how faintly the others are drawn.
 */
const ZONE_LINE_WIDTH = 2;
/** @upstream ByteRipperApp/Hex/HexView.swift#HexView.zoneFocusedAlpha */
const ZONE_ALPHA = 0.9;
/** @upstream ByteRipperApp/Hex/HexView.swift#HexView.zoneFillAlpha */
const ZONE_FILL_ALPHA = 0.1;

/**
 * A zone as the renderer holds it.
 *
 * @upstream ByteRipperApp/Hex/HexView.swift#HexZoneSpan
 */
interface DrawnZone {
  /** @upstream ByteRipperApp/Hex/HexView.swift#HexZoneSpan.range */
  readonly start: number;
  readonly end: number;
  /** @upstream ByteRipperApp/Hex/HexView.swift#HexZoneSpan.isFocused */
  readonly focused: boolean;
}

export interface HexGridColors extends Record<InkRole, string> {
  readonly background: string;
  readonly selection: string;
  readonly eofHatch: string;
  /** The orange wash over a byte that differs from the other pane's. */
  readonly difference: string;
  /**
   * The outline showing where the other pane's selection falls here.
   *
   * @upstream ByteRipperApp/Hex/HexView.swift#HexView.mirrorContourAlpha
   */
  readonly peerSelection: string;
  /** Every occurrence of the search pattern. */
  readonly matchFill: string;
  /**
   * The find indicator: the plate under the match the find bar is standing on.
   * A fixed yellow in either theme, which is why its ink is a role of its own.
   */
  readonly findIndicator: string;
  /** The indicator's outline, in place of upstream's shadow. */
  readonly findIndicatorBorder: string;
  /** The overwrite-mode caret: a bar under the nibble about to be replaced. */
  readonly caret: string;
  /** The insert-mode caret: a line at the boundary bytes will be pushed from. */
  readonly insertCaret: string;
  /** The bookmark's own colour, for the mark in the offset column (§20.4). */
  readonly bookmark: string;
  /** The zone a tool has in focus: its outline and its wash. */
  readonly zoneFocused: string;
  /** Every other zone a tool has published. */
  readonly zoneOther: string;
}

/**
 * One piece's extent and the colour its rows are printed on.
 *
 * @upstream ByteRipperApp/Hex/HexView.swift#HexSegmentSpan
 */
export interface SegmentBand {
  /** @upstream ByteRipperApp/Hex/HexView.swift#HexSegmentSpan.range */
  readonly start: number;
  readonly end: number;
  /**
   * @upstream ByteRipperApp/Hex/HexView.swift#HexSegmentSpan.colorIndex
   * @upstream-differs the band carries its resolved tint
   */
  readonly tint: string;
}

export interface HexGridConfig {
  readonly layout: HexLayout;
  /** @upstream ByteRipperApp/Hex/HexView.swift#HexView.textDecoder */
  readonly decoder: ByteDecoder;
  readonly colors: HexGridColors;
  /** @upstream ByteRipperApp/Hex/HexView.swift#HexView.hexFont */
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

/**
 * @upstream ByteRipperApp/Hex/HexView.swift#HexView
 * @upstream-differs the drawing half; the event half is HexPane
 */
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
   * What this pane's bytes are painted modified against (§21.7): the file as it
   * was last saved, or — an image with no file of its own, the one a join
   * leaves — the sources its pieces came from.
   *
   * A byte is modified when it differs from the byte at the same offset in the
   * span that answers for it — compared per byte, not looked up in a record of
   * which ranges were written. Those are not the same question: undo writes the
   * original values back *through the edit buffer*, so a range-based answer
   * keeps calling them modified long after they have gone back to what the file
   * holds.
   *
   * Empty for a document that was never on disk and no piece came from anywhere
   * — a new file, a manual split — where every byte would otherwise compare as
   * modified. The unsaved marker in the pane's readout already says what needs
   * saying there.
   *
   * @upstream ByteRipperApp/Segments/SegmentSources.swift#ModifiedBaseline
   */
  private baseline: ModifiedBaseline = NO_BASELINE;
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
  /** The bookmarked rows, by the offset each row opens at (§20.4). */
  private bookmarkRows: ReadonlySet<number> = new Set();
  /** What the open context menu is about, while one is up (§10.2). */
  private contextMenuAnchor: { readonly offset: number; readonly framesByte: boolean } | undefined;
  /** The pieces and the paper each is printed on, in file order (§21.3). */
  private segments: readonly SegmentBand[] = [];
  /**
   * The zones the open tool has published, the focused one last — zones nest,
   * the inner one is usually the focus, and its outline must not be crossed by
   * a neighbour's.
   */
  private zones: readonly DrawnZone[] = [];
  private readonly zoneContourCache = new Map<string, ContourPoint[][]>();
  /** The find indicator's contour, kept for the match and the layout it was traced for. */
  private indicatorContours:
    | { readonly key: string; readonly contours: ContourPoint[][] }
    | undefined;

  private readonly dirty = new DirtyRows();
  /** The scroll offset the canvas currently holds, for the blit. */
  private paintedScrollTop = 0;
  private paintedRows: { first: number; end: number } = { first: 0, end: 0 };
  /**
   * The content height the current paint measures its rows from.
   *
   * A row's absolute top is `row × rowHeight`, which at the end of a 16 MB file
   * is some eighteen million pixels — and canvas implementations keep drawing
   * coordinates in 32-bit floats, which cannot hold a whole number that large:
   * above 2^24 the representable values are two apart. Rows drawn there came
   * out one pixel up or down at random, stacked unevenly and overdrawing each
   * other's glyphs. So everything is drawn relative to the first visible row,
   * and the large scroll offset is subtracted in JavaScript's doubles instead,
   * leaving the canvas a transform of a few rows at most.
   */
  private originY = 0;
  /**
   * The band the row now being painted covers, on the device grid.
   *
   * A row is a whole number of CSS pixels but not of device pixels, so its top
   * and its height are put on that grid rather than merely computed from
   * `rowHeight` — otherwise the row and its neighbour each cover the pixel they
   * meet in partly, and a line the colour of the canvas shows between them
   * ({@link bandOnDeviceGrid}). It is one band per row, and everything that
   * paints in the row reads it: the paper, the washes, the clip the contours are
   * stroked inside, the glyphs. Two rows sharing an edge is then not a
   * coincidence of arithmetic but the same number, and a row's outline is not
   * cut at its neighbour's boundary.
   *
   * Set by {@link beginRowBand} before the row is painted, like `originY` above.
   */
  private rowBandTop = 0;
  private rowBandHeight = 0;

  private prefetching: Promise<void> | undefined;
  private onBytesArrived: (() => void) | undefined;

  /** @upstream ByteRipperApp/Hex/HexView.swift#HexView.init */
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
   *
   * @upstream ByteRipperApp/Hex/HexView.swift#HexViewDataSource.scrollExtent
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
    // On a whole device pixel, so the blit's copy and the paint of the band it
    // exposes put rows in the same place (see snapToDevicePixels).
    this.viewport = {
      ...viewport,
      scrollTop: snapToDevicePixels(viewport.scrollTop, config.devicePixelRatio),
    };

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

  /**
   * @upstream ByteRipperApp/Hex/HexView.swift#HexViewDataSource.hexSelection
   * @upstream ByteRipperApp/Hex/HexView.swift#HexView.reloadSelection
   * @upstream ByteRipperApp/Hex/HexView.swift#HexView.changedSelectionRects
   */
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
   *
   * @upstream ByteRipperApp/Hex/HexView.swift#HexViewDataSource.hexCaretRevealOffset
   * @upstream ByteRipperApp/Hex/HexView.swift#HexViewDataSource.hexCaretNibble
   * @upstream ByteRipperApp/Hex/HexView.swift#HexViewDataSource.hexInputRegion
   * @upstream ByteRipperApp/Hex/HexView.swift#HexViewDataSource.hexCaretVisible
   * @upstream ByteRipperApp/Hex/HexView.swift#HexViewDataSource.hexInsertMode
   */
  setCaret(caret: HexGridCaret | undefined): void {
    const previous = this.caret;
    this.caret = caret;
    const rowHeight = this.config?.layout.rowHeight ?? 1;
    for (const each of [previous, caret]) {
      if (each === undefined) continue;
      // Through the bar's own reach: it runs past its row deliberately, so
      // repainting only the caret's row leaves that part behind — and every
      // row the caret has been in keeps a stub of a rule.
      const rows = caretRowReach(each.offset, rowHeight);
      this.dirty.invalidate(rows.first, rows.end);
    }
  }

  /**
   * The search matches to grey, and the one the find bar is standing on.
   *
   * A lookup rather than a list: the renderer asks only for the row it is
   * painting, so a pattern occurring four million times costs a row's worth of
   * work per row rather than a flattening of the whole set.
   *
   * @upstream ByteRipperApp/Hex/HexView.swift#HexViewDataSource.hexMatchRanges
   * @upstream ByteRipperApp/Hex/HexView.swift#HexViewDataSource.hexCurrentMatch
   * @upstream ByteRipperApp/Hex/HexView.swift#HexView.reloadMatches
   */
  setMatches(matches: MatchLookup | undefined, current: HexGridSelection | undefined): void {
    this.matches = matches;
    this.currentMatch = current;
    this.invalidateAll();
  }

  /**
   * Whether this is the pane the keyboard is talking to.
   *
   * @upstream ByteRipperApp/Hex/HexView.swift#HexView.isActive
   */
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
   *
   * @upstream ByteRipperApp/Hex/HexView.swift#HexViewDataSource.hexByteStates
   */
  setDifferences(index: DiffBlockIndex | undefined): void {
    this.differences = index;
    this.invalidateAll();
  }

  /**
   * The other pane's selection, outlined here so the same offsets can be seen
   * on both sides at once.
   */
  /**
   * The bookmarked rows, by their first byte's offset.
   *
   * A set rather than a list because the question asked per row is only
   * "is this one marked", and a row is drawn thousands of times more often
   * than a bookmark is set.
   *
   * @upstream ByteRipperApp/Hex/HexView.swift#HexViewDataSource.hexBookmarkedRows
   */
  setBookmarks(rows: ReadonlySet<number>): void {
    // Compared rather than replaced blindly: this is handed the whole set on
    // every change, and an identical set must not repaint the dump.
    if (sameRows(this.bookmarkRows, rows)) return;
    this.bookmarkRows = rows;
    this.invalidateAll();
  }

  /**
   * The zones a tool wants drawn over the bytes, and which of them is in focus.
   *
   * Repaints the rows the old and the new outlines reach and nothing else: a
   * selection in a tool's tree moves one outline, not the whole dump.
   *
   * @upstream ByteRipperApp/Hex/HexView.swift#HexViewDataSource.hexZoneSpans
   */
  setZones(
    zones: readonly { readonly id: string; readonly start: number; readonly end: number }[],
    focus: string | undefined
  ): void {
    const next = zones
      .map((zone) => ({ start: zone.start, end: zone.end, focused: zone.id === focus }))
      .sort((left, right) => Number(left.focused) - Number(right.focused));
    if (sameZones(this.zones, next)) return;
    for (const zone of [...this.zones, ...next]) {
      const rows = contourRowSpan(zone.start, zone.end);
      this.dirty.invalidate(rows.first, rows.end);
    }
    this.zones = next;
  }

  /**
   * The segment tints. Empty for a file that has not been cut.
   *
   * @upstream ByteRipperApp/Hex/HexView.swift#HexViewDataSource.hexSegmentSpans
   */
  setSegments(bands: readonly SegmentBand[]): void {
    if (sameBands(this.segments, bands)) return;
    this.segments = bands;
    this.invalidateAll();
  }

  /** @upstream ByteRipperApp/Hex/HexView.swift#HexViewDataSource.hexMirroredSelection */
  setPeerSelection(selection: HexGridSelection | undefined): void {
    const previous = this.peerSelection;
    this.peerSelection = selection;
    this.peerContourKey = undefined;
    for (const range of [previous, selection]) {
      if (range === undefined || range.end <= range.start) continue;
      // Through the contour's own reach, which is a row wider at each end than
      // the span: the stroke straddles the row boundaries it is drawn on.
      const rows = contourRowSpan(range.start, range.end);
      this.dirty.invalidate(rows.first, rows.end);
    }
  }

  /**
   * What the open context menu is about, while one is up — `undefined` once it
   * is dismissed. The pane sets it when a menu really opened and clears it when
   * that menu closes.
   *
   * Repaints the rows the frame reaches, old and new. Upstream invalidates
   * through `invalidateContextMenuFrame(for:)`, whose whole point is that the
   * clearing call passes the anchor's row explicitly — the offset is already
   * gone by then, and a clear that read it would leave the ring on screen. Here
   * the previous anchor is the argument itself.
   *
   * @upstream ByteRipperApp/Hex/HexView.swift#HexView.beginContextMenu
   * @upstream ByteRipperApp/Hex/HexView.swift#HexView.endContextMenu
   * @upstream ByteRipperApp/Hex/HexView.swift#HexView.invalidateContextMenuFrame
   */
  setContextMenuAnchor(
    anchor: { readonly offset: number; readonly framesByte: boolean } | undefined
  ): void {
    if (sameContextMenuAnchor(this.contextMenuAnchor, anchor)) return;
    for (const one of [this.contextMenuAnchor, anchor]) {
      if (one === undefined) continue;
      const rows = contextMenuFrameRows(this.config?.layout, one.offset);
      if (rows !== undefined) this.dirty.invalidate(rows.first, rows.end);
    }
    this.contextMenuAnchor = anchor;
  }

  /**
   * What the red foreground is measured against (§21.7). An empty baseline
   * means nothing is an edit yet.
   */
  setBaseline(baseline: ModifiedBaseline): void {
    this.baseline = baseline;
    this.invalidateAll();
  }

  /**
   * Marks the rows covering `[start, end)` for repaint.
   *
   * @upstream ByteRipperApp/Hex/HexView.swift#HexViewChange
   * @upstream ByteRipperApp/Hex/HexView.swift#HexView.reloadContent
   * @upstream ByteRipperApp/Hex/HexView.swift#HexView.contentChangeRects
   * @upstream-differs a decoder change reconfigures the atlas rather than arriving as a change
   */
  invalidateBytes(start: number, end: number): void {
    this.dirty.invalidate(
      Math.floor(start / BYTES_PER_ROW),
      Math.floor(Math.max(start, end - 1) / BYTES_PER_ROW) + 1
    );
  }

  /** @upstream ByteRipperApp/Hex/HexView.swift#HexView.reloadData */
  invalidateAll(): void {
    this.dirty.clear();
    this.dirty.invalidate(0, Number.MAX_SAFE_INTEGER);
    this.paintedRows = { first: 0, end: 0 };
  }

  /**
   * Total content height, for the scrollbar the pane puts beside this.
   *
   * @upstream ByteRipperApp/Hex/HexView.swift#HexView.hexContentHeight
   */
  get contentHeight(): number {
    const config = this.config;
    if (config === undefined) return 0;
    const own = this.source?.size ?? 0;
    return config.layout.totalHeight(Math.max(own, this.scrollExtent ?? 0));
  }

  /** @upstream ByteRipperApp/Hex/HexView.swift#HexView.hexContentWidth */
  get contentWidth(): number {
    return this.config?.layout.contentWidth ?? 0;
  }

  /**
   * Paints whatever is dirty and visible. Cheap to call every frame: with
   * nothing dirty and no scroll it does nothing at all.
   *
   * @upstream ByteRipperApp/Hex/HexView.swift#HexView.draw
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
    // The ground below the last row is not a row, so no dirty run ever covers
    // it. Past the end of a file — which a comparison reaches whenever the
    // companion is longer — there are no rows to paint at all, and leaving on
    // that early return handed back an untouched canvas: black, because it is
    // opaque. Whether the ground is showing has to be part of the question.
    const contentBottom = rowCount * layout.rowHeight;
    const groundVisible = contentBottom < this.viewport.scrollTop + this.viewport.heightCss;
    if (runs.length === 0 && !groundVisible) {
      this.paintedScrollTop = this.viewport.scrollTop;
      this.paintedRows = { first, end };
      return;
    }

    const scale = config.devicePixelRatio;
    this.originY = first * layout.rowHeight;
    this.context.save();
    this.context.setTransform(
      scale,
      0,
      0,
      scale,
      -this.viewport.scrollLeft * scale,
      // On a whole device pixel, like the scroll offset above and for the same
      // reason one step further on: a row's band is put on the device grid
      // relative to *this*, so a fraction here would put every band back between
      // two pixels however carefully it was rounded. Nothing else notices — the
      // blit shifts by a whole number of device pixels, and rounding commutes
      // with a whole-number shift, so rows copied from the last frame and rows
      // painted in this one still land on the same pixel.
      Math.round((this.originY - this.viewport.scrollTop) * scale)
    );

    let missedBytes = false;
    for (const run of runs) {
      for (let row = run.start; row < run.end; row++) {
        if (!this.paintRow(row, size)) missedBytes = true;
      }
    }
    // After the rows, not inside one. The overwrite bar hangs below its own row
    // on purpose, and rows are painted in ascending order — so drawn from
    // inside its row, the part that hangs over was erased by the row beneath it
    // before the frame was out, and the bar came out half the height it asks
    // for. Nothing above it draws, so drawing it last costs one rect.
    this.paintCaret(first, end);
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

  /** A row's top, in the coordinates the current transform draws in. */
  private rowTop(row: number): number {
    const layout = this.config?.layout;
    return layout === undefined ? 0 : row * layout.rowHeight - this.originY;
  }

  /**
   * Puts the row's band on the device grid, for everything that paints in it.
   *
   * The band's bottom is the top of the row below, worked out by the same call,
   * so the two rows agree on the edge they share rather than the second one
   * arriving at it by its own arithmetic. Passed as that top rather than as a
   * height for exactly that reason.
   *
   * @web-only see `bandOnDeviceGrid`
   */
  private beginRowBand(row: number): void {
    const config = this.config;
    if (config === undefined) return;
    const band = bandOnDeviceGrid(this.rowTop(row), this.rowTop(row + 1), config.devicePixelRatio);
    this.rowBandTop = band.top;
    this.rowBandHeight = band.height;
  }

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
   *
   * @upstream ByteRipperApp/Hex/HexView.swift#HexView.RowPass
   */
  private paintRow(row: number, size: number): boolean {
    const config = this.config;
    const atlas = this.atlas;
    if (config === undefined || atlas === undefined) return true;

    const { layout, colors } = config;
    this.beginRowBand(row);
    const y = this.rowBandTop;
    const rowStart = layout.byteOffset(row, 0);
    const available = Math.max(0, Math.min(BYTES_PER_ROW, size - rowStart));

    this.context.fillStyle = colors.background;
    // Across the whole canvas, not only the row's content: a window wider than
    // a row would otherwise leave whatever the last paint put there.
    this.context.fillRect(
      this.viewport.scrollLeft,
      y,
      Math.max(layout.contentWidth, this.viewport.widthCss),
      this.rowBandHeight
    );

    // The segment tint is the paper the row is printed on: under everything,
    // because it says which piece of the file this row belongs to and not
    // anything about the bytes themselves (§21.3).
    this.paintSegments(rowStart, y, size);

    // The greys go under the difference wash, which goes under the selection:
    // telling two dumps apart is what the application is for, so orange yields
    // to nothing but what the user is doing right now.
    this.paintMatches(rowStart, y);
    this.paintDifferences(rowStart, y);
    this.paintSelection(rowStart, y);
    // The focused zone's wash over every background and under the bytes: over
    // them it would dull the one thing the window is for, under an opaque
    // segment tint it would vanish.
    this.paintZoneFills(rowStart, y);
    // The find indicator over every background and under the bytes, as
    // upstream draws it between its row pass and its glyphs.
    this.paintFindIndicator(rowStart, y);
    this.paintAddress(rowStart, y);

    if (available === 0) {
      this.paintEofHatch(0, BYTES_PER_ROW, y);
      this.paintOutlines(rowStart, y);
      return true;
    }

    const bytes = this.source?.peek(rowStart, available);
    // What the row's bytes are measured against (§21.7): each span the row
    // touches, peeked at the source position it opens at. Not knowing yet is
    // not the same as not modified: paint the row when its references are in,
    // rather than showing black ink that turns red later.
    const refs = rowReferences(this.baseline, rowStart, available);
    const refsPending = refs.some((ref) => ref.peeked === undefined);

    if (bytes === undefined) {
      // Not resident. A placeholder band rather than a blank row, so a fast
      // scroll reads as "still loading" and not as "this file is empty here".
      this.paintEofHatch(0, available, y, 0.4);
      if (available < BYTES_PER_ROW) this.paintEofHatch(available, BYTES_PER_ROW, y);
      this.paintOutlines(rowStart, y);
      return false;
    }

    const indicator = this.currentMatch;
    const pending = this.pendingLowNibbleColumn(rowStart, size);
    for (let column = 0; column < bytes.length; column++) {
      const byte = bytes[column] ?? 0;
      const offset = rowStart + column;
      const modified = modifiedAgainstRefs(this.baseline, refs, offset, byte);
      const onIndicator =
        indicator !== undefined && offset >= indicator.start && offset < indicator.end;
      const role = byteInk(byte, modified, onIndicator);
      if (column === pending) {
        // Insert mode, byte half typed: the low nibble is not a zero the user
        // entered, it is an empty slot waiting for the second digit — so the
        // high nibble is drawn in the byte's own ink and the slot as a dim `_`
        // in the placeholder ink (§7). Both come from the atlas: the `_` is the
        // tile the text column already has for byte 0x5F.
        const high = (byte >> 4) & 0x0f;
        this.blit(atlas.digit(high, role), layout.hexByteX(column), y, layout.charWidth);
        this.blit(
          atlas.character(0x5f, "mutedAddress"),
          layout.hexByteX(column) + layout.charWidth,
          y,
          layout.charWidth
        );
      } else {
        this.blit(atlas.hexPair(byte, role), layout.hexByteX(column), y, 2 * layout.charWidth);
      }
      this.blit(atlas.character(byte, role), layout.textX(column), y, layout.charWidth);
    }
    if (available < BYTES_PER_ROW) this.paintEofHatch(available, BYTES_PER_ROW, y);
    this.paintOutlines(rowStart, y);
    return !refsPending;
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
    // The ground starts where the last row ends, so it takes the top the row
    // *after* it would have had rather than the row height added up by hand: the
    // two have to be the same edge, or the last row and the ground show a line
    // between them wherever the row height is not a whole number of pixels.
    this.beginRowBand(rowCount);
    const top = this.rowBandTop;
    const viewportBottom = this.viewport.scrollTop + this.viewport.heightCss;
    if (top + this.originY >= viewportBottom) return;

    this.context.fillStyle = colors.background;
    this.context.fillRect(
      this.viewport.scrollLeft,
      top,
      Math.max(layout.contentWidth, this.viewport.widthCss),
      viewportBottom - top - this.originY
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
  /**
   * Draws the caret, if it is in the rows `[firstRow, endRow)` being painted.
   *
   * @upstream ByteRipperApp/Hex/HexView.swift#HexView.caretRect
   * @upstream ByteRipperApp/Hex/HexView.swift#HexView.crossLinkContour
   */
  private paintCaret(firstRow: number, endRow: number): void {
    const config = this.config;
    const caret = this.caret;
    if (config === undefined || caret === undefined || !this.active || !caret.visible) return;

    const { layout, colors } = config;
    const row = Math.floor(caret.offset / BYTES_PER_ROW);
    if (row < firstRow || row >= endRow) return;
    const rowStart = row * BYTES_PER_ROW;
    // The caret is painted after the rows, not with them, so it takes the band
    // of its own row here — the same band that row was painted with, since the
    // row's number is the only input.
    this.beginRowBand(row);
    const y = this.rowBandTop;
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
        this.rowBandHeight - 1
      );
    } else {
      this.context.strokeRect(
        layout.hexByteX(column) + 0.5,
        y + 0.5,
        layout.hexByteWidth - 1,
        this.rowBandHeight - 1
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
      this.context.fillRect(x, y, 1, this.rowBandHeight);
      return;
    }

    const x = caret.region === "text" ? layout.textX(column) : layout.caretX(column, caret.nibble);
    // An underline at the cell's bottom edge, below the glyph, running past the
    // edge onto the row beneath so it reads as a solid rule rather than a
    // hairline squeezed into the row's last pixels.
    this.context.fillStyle = colors.caret;
    this.context.fillRect(
      x,
      y + this.rowBandHeight - CARET_BAR_HEIGHT,
      layout.charWidth,
      CARET_BAR_HEIGHT + CARET_BAR_OVERHANG
    );
  }

  /**
   * The column of this row whose low nibble is an empty slot: the byte a
   * half-typed insert-mode entry has opened, whose high nibble has landed and
   * whose second digit is still to come. `undefined` on every other row and in
   * every other state.
   *
   * Guarded on the *active* pane, insert mode, and a genuinely pending insert:
   * a nibble-1 caret that a click placed shows the byte's own low nibble, and
   * the pane the user is not typing into shows no caret at all.
   *
   * @upstream ByteRipperApp/Hex/HexView.swift#HexView.pendingLowNibbleColumn
   */
  private pendingLowNibbleColumn(rowStart: number, size: number): number | undefined {
    const caret = this.caret;
    if (!this.active || caret === undefined) return undefined;
    if (!caret.insertMode || !caret.pendingInsert || caret.nibble !== 1) return undefined;
    const { offset } = caret;
    if (offset < rowStart || offset >= rowStart + BYTES_PER_ROW || offset >= size) {
      return undefined;
    }
    return offset - rowStart;
  }

  /**
   * The address, with its leading zeros muted — or standing on its mark.
   *
   * A row whose address is what the open context menu is about shows no ring:
   * the mark already occupies that rect, so the mark itself is outlined instead
   * and the address keeps the ink it has when nothing is marked (§20.4).
   *
   * @upstream ByteRipperApp/Hex/HexView.swift#HexView.offsetAddress
   * @upstream ByteRipperApp/Hex/HexView.swift#HexView.drawBookmarkMark(in:row:outlined:)
   */
  private paintAddress(rowStart: number, y: number): void {
    const config = this.config;
    const atlas = this.atlas;
    if (config === undefined || atlas === undefined) return;

    const { layout } = config;
    const text = addressString(rowStart, layout.offsetColumnChars);
    const significant = addressSignificantFrom(text);
    const marked = this.bookmarkRows.has(rowStart);
    const outlined = marked && this.contextMenuOutlinesMark(rowStart);
    if (marked) this.paintBookmarkMark(y, outlined);

    for (let index = 0; index < text.length; index++) {
      const digit = Number.parseInt(text[index] ?? "0", 16);
      // The mark decides the ink — an address standing on a filled shape is not
      // read against the paper — and the leading zeros decide their share of
      // it, dimmed in that ink rather than in the page's own (§6, §20.4). An
      // outlined mark is not something to be read against: it is a ring round
      // the address, and the address keeps its ordinary ink.
      const role = addressDigitInk(index, significant, marked && !outlined);
      this.blit(
        atlas.digit(digit, role),
        layout.leftPadding + index * layout.charWidth,
        y,
        layout.charWidth
      );
    }
  }

  /**
   * Whether the open context menu makes a marked row's own mark the thing it
   * frames — true only for a menu opened on that row's *address*: a menu opened
   * on a byte in the hex column frames that byte and leaves the mark filled.
   *
   * Upstream computes the same answer once per draw, into a local called
   * `contextMenuRowAddress`; here it is asked per row, because the web repaints
   * rows rather than the whole view.
   *
   * @upstream ByteRipperApp/Hex/HexView.swift#HexView.contextMenuOffset
   * @upstream ByteRipperApp/Hex/HexView.swift#HexView.contextMenuFramesByte
   */
  private contextMenuOutlinesMark(rowStart: number): boolean {
    const config = this.config;
    const anchor = this.contextMenuAnchor;
    if (config === undefined || anchor === undefined || anchor.framesByte) return false;
    return config.layout.rowColumn(anchor.offset).row === Math.floor(rowStart / BYTES_PER_ROW);
  }

  /**
   * The segment tints under this row.
   *
   * A piece that opens the row is tinted from the panel's own left edge, so the
   * band reaches past the offset column; one that closes it runs to the right
   * edge. In between, a boundary falls in the middle of the gap between the two
   * bytes it separates, which is the only place it can fall without landing on
   * a glyph.
   */
  private paintSegments(rowStart: number, y: number, size: number): void {
    const config = this.config;
    if (config === undefined || this.segments.length === 0) return;
    const { layout } = config;
    const rowEnd = rowStart + BYTES_PER_ROW;
    // Past EOF there is no tint: a piece ends where the file does.
    const lastByte = Math.min(rowEnd, size);
    if (lastByte <= rowStart) return;

    const context = this.context;
    const left = this.viewport.scrollLeft;
    const right = left + Math.max(layout.contentWidth, this.viewport.widthCss);
    // The middle of the gap between byte `column - 1` and byte `column`.
    const midGap = (column: number) =>
      (layout.hexByteX(column - 1) + layout.hexByteWidth + layout.hexByteX(column)) / 2;

    for (const span of this.segments) {
      const start = Math.max(span.start, rowStart);
      const end = Math.min(span.end, lastByte);
      if (end <= start) continue;
      const first = start - rowStart;
      const last = end - rowStart - 1;
      context.fillStyle = span.tint;
      const from = first === 0 ? left : midGap(first);
      const to = last === BYTES_PER_ROW - 1 ? right : midGap(last + 1);
      context.fillRect(from, y, to - from, this.rowBandHeight);
    }
  }

  /**
   * A bookmark's mark: the row's address on a tag pointing at the bytes.
   *
   * Upstream's pentagon (§20.4) — the offset column's own box with a triangular
   * tip growing out of its right edge, at a fixed apex angle so the shape holds
   * at every font size. The tip is clamped to the gap before the hex column,
   * because a mark that touched the bytes would read as a highlight on them.
   *
   * `outlined` is the marked row the open context menu is about: the ring would
   * land on top of the fill, so the shape the user already reads as "this row is
   * marked" is stroked instead of filled. Dashed, not solid — at the ring's line
   * width a closed purple loop round an address reads as a heavy slab, heavier
   * than the fill it replaces (§20.4).
   *
   * The fill and the stroke are one shape at one size, traced through the same
   * call, so the ring is the mark and the mark is the ring.
   *
   * @upstream ByteRipperApp/Hex/HexView.swift#HexView.drawBookmarkMark(in:row:outlined:)
   * @upstream ByteRipperApp/Hex/HexView.swift#HexView.bookmarkMarkPath(body:tipReach:)
   * @upstream ByteRipperApp/Hex/HexView.swift#HexView.bookmarkMarkRect
   */
  private paintBookmarkMark(y: number, outlined: boolean): void {
    const config = this.config;
    if (config === undefined) return;
    const { layout, colors } = config;

    const top = y;
    const height = this.rowBandHeight;
    const left = layout.leftPadding - BOOKMARK_PADDING;
    const right = layout.leftPadding + layout.offsetColumnWidth + BOOKMARK_PADDING;
    // Each of the tip's edges rises over half the height, so the reach that
    // opens the apex to BOOKMARK_TIP_ANGLE is (height / 2) / tan(angle / 2).
    const reach = Math.max(
      0,
      Math.min(
        height / 2 / Math.tan(BOOKMARK_TIP_ANGLE / 2),
        layout.gapAfterOffset - BOOKMARK_PADDING - 1
      )
    );

    const context = this.context;
    context.save();
    context.beginPath();
    traceContour(
      context,
      [
        { x: left, y: top },
        { x: right, y: top },
        { x: right + reach, y: top + height / 2 },
        { x: right, y: top + height },
        { x: left, y: top + height },
      ],
      PEER_CONTOUR_RADIUS
    );
    if (outlined) {
      context.strokeStyle = colors.bookmark;
      context.lineWidth = PEER_CONTOUR_LINE_WIDTH;
      context.setLineDash(BOOKMARK_OUTLINE_DASHES);
      context.lineJoin = "round";
      context.stroke();
    } else {
      context.fillStyle = colors.bookmark;
      context.fill();
    }
    context.restore();
  }

  /**
   * Every occurrence of the search pattern, and the one being stood on.
   *
   * Grey for the rest, and the current one on the find indicator's yellow
   * ({@link paintFindIndicator}) — so the eye can see how many there are and
   * where this one sits among them, which is what a scroll through a result set
   * is for.
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

      // The current one is the find indicator's, drawn over the backgrounds.
      const isCurrent =
        this.currentMatch !== undefined &&
        match.start === this.currentMatch.start &&
        match.end === this.currentMatch.end;
      if (isCurrent) continue;
      this.context.fillStyle = colors.matchFill;
      this.context.fillRect(
        layout.hexByteX(from),
        y,
        layout.hexByteX(to - 1) + layout.hexByteWidth - layout.hexByteX(from),
        this.rowBandHeight
      );
      this.context.fillRect(
        layout.textX(from),
        y,
        (to - from) * layout.charWidth,
        this.rowBandHeight
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
        this.context.fillRect(layout.hexByteX(column), y, layout.hexByteWidth, this.rowBandHeight);
        this.context.fillRect(layout.textX(column), y, layout.charWidth, this.rowBandHeight);
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
    // The same reach the invalidation uses, from the same function: a row that
    // is repainted but not drawn leaves a gap, and one drawn but not repainted
    // leaves a line behind.
    const rows = contourRowSpan(peer.start, peer.end);
    const row = rowStart / BYTES_PER_ROW;
    if (row < rows.first || row >= rows.end) return;

    this.strokeContours(
      y,
      this.peerContours(),
      config.colors.peerSelection,
      PEER_CONTOUR_LINE_WIDTH,
      1
    );
  }

  /**
   * The find indicator: a yellow plate under the match the find bar is standing
   * on, outlined, with the bytes on it in black.
   *
   * The plate follows the mirrored selection's contour — one staircase round a
   * match that crosses rows, standing off the glyphs as far as a spacer allows —
   * so it reads as something the bytes sit on rather than a box drawn on them.
   *
   * @upstream ByteRipperApp/Hex/HexView.swift#HexView.drawFindIndicator
   * @upstream-differs flat: no lift, bounce or shadow, and an outline in their place (GAPS.md G9)
   */
  private paintFindIndicator(rowStart: number, y: number): void {
    const config = this.config;
    const current = this.currentMatch;
    if (config === undefined || current === undefined || current.end <= current.start) return;
    // The same reach as every contour: its edges sit on row boundaries.
    const rows = contourRowSpan(current.start, current.end);
    const row = rowStart / BYTES_PER_ROW;
    if (row < rows.first || row >= rows.end) return;

    const { layout, colors } = config;
    const key = `${current.start}:${current.end}:${layout.wordSize}:${layout.charWidth}:${layout.rowHeight}`;
    if (this.indicatorContours?.key !== key) {
      this.indicatorContours = {
        key,
        contours: selectionContours(current.start, current.end, layout, PEER_CONTOUR_PADDING),
      };
    }
    const contours = this.indicatorContours.contours;
    this.fillContours(y, contours, colors.findIndicator, 1);
    this.strokeContours(y, contours, colors.findIndicatorBorder, FIND_INDICATOR_LINE_WIDTH, 1);
  }

  /**
   * The frame around what the open context menu is about (§10.2): the Offset
   * column's row, or the single byte it was opened on in the hex column.
   *
   * Drawn on the anchor's row and one either side, each row its own clipped
   * slice of one path, for the reason {@link strokeContours} gives: the ring's
   * horizontal edges sit on the row boundaries and their stroke straddles them,
   * so the neighbours have to put their half of the line down or a row repainted
   * later would erase it.
   *
   * A bookmarked row's address is the exception, and it is handled where the
   * mark is: the mark occupies exactly the rect the ring would, so the mark is
   * outlined in the bookmark colour instead of being buried under the ring
   * (§20.4).
   *
   * @upstream ByteRipperApp/Hex/HexView.swift#HexView.drawContextMenuFrame
   */
  private paintContextMenuFrame(rowStart: number, y: number): void {
    const config = this.config;
    const anchor = this.contextMenuAnchor;
    if (config === undefined || anchor === undefined) return;

    const { layout, colors } = config;
    // Past the file's end there is nothing to frame: a menu the user deleted
    // the last bytes out from under leaves its anchor behind, and the ring goes
    // with the bytes (§10.2).
    if (anchor.offset >= (this.source?.size ?? 0)) return;
    const anchored = layout.rowColumn(anchor.offset);
    const rows = contextMenuFrameRows(layout, anchor.offset);
    if (rows === undefined) return;
    const row = Math.floor(rowStart / BYTES_PER_ROW);
    if (row < rows.first || row >= rows.end) return;
    // A marked row's address is where its mark is, so the mark takes the ring's
    // place (§20.4) — the same test on the same row the frame is drawn around,
    // not on whichever row happens to be painting its slice.
    if (!anchor.framesByte && this.bookmarkRows.has(layout.byteOffset(anchored.row, 0))) return;

    // The *anchor's* rect for every row in the window: each row draws its own
    // clipped slice of one shape, so the neighbours only contribute the ~1px of
    // stroke that straddles their boundary. Drawing each row's own frame here
    // would ring two addresses.
    const frame = anchor.framesByte
      ? layout.hexByteFrame(anchored.row, anchored.column)
      : layout.offsetColumnFrame(anchored.row);
    const left = frame.x - PEER_CONTOUR_PADDING;
    const right = frame.x + frame.width + PEER_CONTOUR_PADDING;
    const top = frame.y;
    const bottom = frame.y + frame.height;

    this.strokeContours(
      y,
      [
        [
          { x: left, y: top },
          { x: right, y: top },
          { x: right, y: bottom },
          { x: left, y: bottom },
        ],
      ],
      colors.peerSelection,
      PEER_CONTOUR_LINE_WIDTH,
      1
    );
  }

  /**
   * Everything that is drawn over the bytes rather than under them, in
   * upstream's order: the zones' outlines, then the other pane's selection,
   * then the open context menu's frame.
   */
  private paintOutlines(rowStart: number, y: number): void {
    this.paintZoneOutlines(rowStart, y);
    this.paintPeerSelection(rowStart, y);
    this.paintContextMenuFrame(rowStart, y);
  }

  /** The zones whose outline reaches this row, each with its contour. */
  private zonesAt(rowStart: number): { zone: DrawnZone; contours: ContourPoint[][] }[] {
    const config = this.config;
    if (config === undefined || this.zones.length === 0) return [];
    const size = this.source?.size ?? 0;
    const row = rowStart / BYTES_PER_ROW;
    const found: { zone: DrawnZone; contours: ContourPoint[][] }[] = [];
    for (const zone of this.zones) {
      const end = Math.min(zone.end, size);
      if (end <= zone.start) continue;
      const rows = contourRowSpan(zone.start, end);
      if (row < rows.first || row >= rows.end) continue;
      const { layout } = config;
      const key = `${zone.start}:${end}:${layout.wordSize}:${layout.charWidth}:${layout.rowHeight}`;
      let contours = this.zoneContourCache.get(key);
      if (contours === undefined) {
        contours = selectionContours(zone.start, end, layout, PEER_CONTOUR_PADDING);
        // Bounded: a tree selection publishes a new set every click.
        if (this.zoneContourCache.size > 512) this.zoneContourCache.clear();
        this.zoneContourCache.set(key, contours);
      }
      found.push({ zone, contours });
    }
    return found;
  }

  private paintZoneFills(rowStart: number, y: number): void {
    const config = this.config;
    if (config === undefined) return;
    for (const { zone, contours } of this.zonesAt(rowStart)) {
      if (zone.focused) this.fillContours(y, contours, config.colors.zoneFocused, ZONE_FILL_ALPHA);
    }
  }

  private paintZoneOutlines(rowStart: number, y: number): void {
    const config = this.config;
    if (config === undefined) return;
    for (const { zone, contours } of this.zonesAt(rowStart)) {
      const colour = zone.focused ? config.colors.zoneFocused : config.colors.zoneOther;
      this.strokeContours(y, contours, colour, ZONE_LINE_WIDTH, ZONE_ALPHA);
    }
  }

  /**
   * Strokes closed contours inside this row's band — the one outline code the
   * mirrored selection and every zone go through.
   *
   * Clipped to the row, and the *whole* contour stroked inside it. The renderer
   * repaints dirty rows, not regions, so a contour drawn once would be erased the
   * next time any row it crosses is repainted. Each row stroking its own slice
   * of the same path puts them back together — and because the path has no
   * interior edges, no line appears between rows.
   */
  private strokeContours(
    y: number,
    contours: readonly (readonly ContourPoint[])[],
    style: string,
    lineWidth: number,
    alpha: number
  ): void {
    if (contours.length === 0) return;
    const context = this.context;
    context.save();
    this.clipToRow(y);
    context.globalAlpha = alpha;
    context.strokeStyle = style;
    context.lineWidth = lineWidth;
    context.lineJoin = "round";
    this.traceRelative(contours);
    context.stroke();
    context.restore();
  }

  /** Fills closed contours inside this row's band; see {@link strokeContours}. */
  private fillContours(
    y: number,
    contours: readonly (readonly ContourPoint[])[],
    style: string,
    alpha: number
  ): void {
    if (contours.length === 0) return;
    const context = this.context;
    context.save();
    this.clipToRow(y);
    context.globalAlpha = alpha;
    context.fillStyle = style;
    this.traceRelative(contours);
    context.fill();
    context.restore();
  }

  /**
   * Clips to the row's band, which the outlines rely on being exact: each row
   * strokes its own slice of one path and the slices have to add up to the path
   * ({@link strokeContours}). On the device grid the two rows' clips meet on a
   * pixel, so they do; a fraction between them would leave the outline's
   * horizontal edges cut or drawn twice.
   */
  private clipToRow(y: number): void {
    const config = this.config;
    if (config === undefined) return;
    const { layout } = config;
    this.context.beginPath();
    this.context.rect(
      this.viewport.scrollLeft,
      y,
      Math.max(layout.contentWidth, this.viewport.widthCss),
      this.rowBandHeight
    );
    this.context.clip();
  }

  /**
   * Traces contours as one path. They are geometry in content coordinates;
   * drawn, they are moved to the paint's origin like everything else (see
   * `originY`).
   */
  private traceRelative(contours: readonly (readonly ContourPoint[])[]): void {
    this.context.beginPath();
    for (const contour of contours) {
      const relative = contour.map((point) => ({ x: point.x, y: point.y - this.originY }));
      traceContour(this.context, relative, PEER_CONTOUR_RADIUS);
    }
  }

  /**
   * The companion's outline, rebuilt only when the span or the layout moves.
   *
   * Every row it crosses strokes it, so this would otherwise be recomputed a
   * dozen times a frame for an answer that did not change.
   *
   * @upstream ByteRipperApp/Hex/HexView.swift#HexView.mirrorContours
   */
  private peerContours(): ContourPoint[][] {
    const config = this.config;
    const peer = this.peerSelection;
    if (config === undefined || peer === undefined) return [];
    const key = `${peer.start}:${peer.end}:${config.layout.wordSize}:${config.layout.charWidth}`;
    if (this.peerContourKey !== key) {
      this.peerContourKey = key;
      this.peerContourCache = selectionContours(
        peer.start,
        peer.end,
        config.layout,
        PEER_CONTOUR_PADDING
      );
    }
    return this.peerContourCache;
  }

  private peerContourKey: string | undefined;
  private peerContourCache: ContourPoint[][] = [];

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
    // The hex cells, their vertical edges in the middle of the space between
    // two characters rather than against the first and last glyph — and the
    // decoded characters beside them, whose cells already touch.
    const left = layout.hexRunStart(from);
    this.context.fillRect(left, y, layout.hexRunEnd(to - 1) - left, this.rowBandHeight);
    this.context.fillRect(
      layout.textX(from),
      y,
      (to - from) * layout.charWidth,
      this.rowBandHeight
    );
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
      this.context.rect(x, y, width, this.rowBandHeight);
      this.context.clip();

      this.context.globalAlpha = alpha;
      this.context.strokeStyle = colors.eofHatch;
      this.context.lineWidth = 1;
      this.context.beginPath();
      // Diagonals at 45°, spaced so the band reads as hatched at any row
      // height. They run past the band's edges and the clip trims them.
      for (let offset = 0; offset < width + this.rowBandHeight; offset += 6) {
        this.context.moveTo(x + offset, y + this.rowBandHeight);
        this.context.lineTo(x + offset - this.rowBandHeight, y);
      }
      this.context.stroke();
      this.context.restore();
    }
  }

  /**
   * Copies one glyph out of the atlas.
   *
   * The tile is drawn into the row's band, not into `rowHeight`: the band is
   * the row's pixels, and a glyph whose box disagreed with them would hang over
   * its neighbour's paper, which the neighbour paints after this row and so
   * erases. At a whole-number scale the two are the same number to the pixel.
   */
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
      this.rowBandHeight
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

    // The baseline's readers the window touches and has not read yet (§21.7):
    // a joined image's halves come in the same way the document does, one span
    // at a time, at the source position each one opens at.
    const needed = baselineReadsAhead(this.baseline, from, to);
    const sourcePending = source.peek(from, to - from) === undefined;
    // Already resident on both sides: nothing to wait for, no frame to schedule.
    if (!sourcePending && needed.length === 0) return;

    this.prefetching = Promise.all([
      ...(sourcePending ? [source.prefetch(from, to - from)] : []),
      ...needed.map((one) => one.storage.prefetch(one.at, one.length)),
    ])
      .then(() => undefined)
      .catch(() => undefined)
      .then(() => {
        this.prefetching = undefined;
        this.onBytesArrived?.();
      });
  }
}

/** Whether two row sets hold the same rows, so an unchanged set repaints nothing. */
function sameRows(left: ReadonlySet<number>, right: ReadonlySet<number>): boolean {
  if (left.size !== right.size) return false;
  for (const row of left) if (!right.has(row)) return false;
  return true;
}

function sameContextMenuAnchor(
  left: { readonly offset: number; readonly framesByte: boolean } | undefined,
  right: { readonly offset: number; readonly framesByte: boolean } | undefined
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return left.offset === right.offset && left.framesByte === right.framesByte;
}

/** One span a row of the document touches, and the reference it answers with. */
interface RowReference {
  /** The stretch of the document this span answers, clipped to the row. */
  readonly from: number;
  readonly to: number;
  /** The source position `from` opens at. */
  readonly sourceAt: number;
  /** Where the span's own source ends: the document bytes past it read as new. */
  readonly limit: number;
  /** The span's bytes at `sourceAt`, out of its cache — `undefined` while cold. */
  readonly peeked: Uint8Array | undefined;
}

/**
 * The spans a row of the document touches, each peeked at the source position
 * it opens at (§21.7). A span the row does not reach is not peeked: a joined
 * image's other half stays out of its cache while it is off screen.
 */
function rowReferences(
  baseline: ModifiedBaseline,
  rowStart: number,
  available: number
): RowReference[] {
  const rowEnd = rowStart + available;
  const refs: RowReference[] = [];
  for (const span of baseline.spans) {
    const from = Math.max(rowStart, span.start);
    const to = Math.min(rowEnd, span.end);
    if (to <= from) continue;
    const sourceAt = span.sourceOffset + (from - span.start);
    const limit =
      span.sourceLimit !== undefined
        ? Math.min(span.sourceLimit, span.storage.size)
        : span.storage.size;
    const length = Math.max(0, Math.min(to - from, limit - sourceAt));
    refs.push({
      from,
      to,
      sourceAt,
      limit,
      peeked: length > 0 ? span.storage.peek(sourceAt, length) : new Uint8Array(0),
    });
  }
  return refs;
}

/**
 * Whether the byte at `offset` is painted modified against the row's
 * references (§21.7): new past the baseline's own end, new past the end of the
 * source its span was taken from, different from the reference, and never
 * marked where the baseline does not answer at all. A reference that has not
 * been read yet is not modified — the row is not painted while it is cold.
 */
function modifiedAgainstRefs(
  baseline: ModifiedBaseline,
  refs: readonly RowReference[],
  offset: number,
  byte: number
): boolean {
  const beyondFrom = baseline.beyondFrom;
  if (beyondFrom !== undefined && offset >= beyondFrom) return true;
  const ref = refs.find((one) => offset >= one.from && offset < one.to);
  if (ref === undefined) return false;
  const sourceAt = ref.sourceAt + (offset - ref.from);
  if (sourceAt >= ref.limit) return true;
  if (ref.peeked === undefined) return false;
  const theirs = ref.peeked[sourceAt - ref.sourceAt];
  return theirs === undefined || theirs !== byte;
}

/**
 * The spans a read-ahead window touches and has not read yet (§21.7), each at
 * the source position it opens at: the baseline's readers come in with the
 * document, one span at a time.
 */
function baselineReadsAhead(
  baseline: ModifiedBaseline,
  from: number,
  to: number
): { storage: ByteStorage; at: number; length: number }[] {
  const reads: { storage: ByteStorage; at: number; length: number }[] = [];
  for (const span of baseline.spans) {
    const docFrom = Math.max(from, span.start);
    const docTo = Math.min(to, span.end);
    if (docTo <= docFrom) continue;
    const at = span.sourceOffset + (docFrom - span.start);
    const limit =
      span.sourceLimit !== undefined
        ? Math.min(span.sourceLimit, span.storage.size)
        : span.storage.size;
    const length = Math.max(0, Math.min(docTo - docFrom, limit - at));
    if (length === 0) continue;
    if (span.storage.peek(at, length) === undefined) {
      reads.push({ storage: span.storage, at, length });
    }
  }
  return reads;
}

/**
 * The rows a context-menu frame around `offset` is drawn on: the anchor's own
 * row and one either side, because the ring's horizontal edges sit exactly on
 * the row boundaries and their stroke straddles them. The same reach the
 * invalidation uses, from the same function — a row drawn but not repainted
 * leaves a line behind (§10.2).
 *
 * @upstream ByteRipperApp/Hex/HexView.swift#HexView.invalidateContextMenuFrame
 */
function contextMenuFrameRows(
  layout: HexLayout | undefined,
  offset: number
): { readonly first: number; readonly end: number } | undefined {
  if (layout === undefined) return undefined;
  const row = layout.rowColumn(offset).row;
  return { first: Math.max(0, row - 1), end: row + 2 };
}

function sameZones(left: readonly DrawnZone[], right: readonly DrawnZone[]): boolean {
  return (
    left.length === right.length &&
    left.every((zone, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        zone.start === other.start &&
        zone.end === other.end &&
        zone.focused === other.focused
      );
    })
  );
}

function sameBands(left: readonly SegmentBand[], right: readonly SegmentBand[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((band, index) => {
    const other = right[index];
    return (
      other !== undefined &&
      band.start === other.start &&
      band.end === other.end &&
      band.tint === other.tint
    );
  });
}
