import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { rowContaining } from "@/core/bookmarks/bookmarkStore";
import type { DiffBlockIndex } from "@/core/diff/diffBlock";
import type { BinaryDocument } from "@/core/document/binaryDocument";
import { caretAt, selection as makeSelection } from "@/core/document/selectionModel";
import type { InputRegion, TypingController } from "@/core/edit/typingController";
import type { MatchSet } from "@/core/search/matchSet";
import type { ByteStorage } from "@/core/storage/byteStorage";
import { formatHex } from "@/core/text/hexText";
import { bytesFromClipboardData, readBytes, writeBytes } from "@/platform/clipboard/byteClipboard";
import { elementHeightLimit } from "@/platform/layout/elementHeightLimit";
import { hexFontStack, measureFont } from "@/render/hexGrid/fontMetrics";
import {
  type HexGridCaret,
  type HexGridColors,
  HexGridRenderer,
  type MatchLookup,
} from "@/render/hexGrid/hexGridRenderer";
import { HexHeaderRenderer, headerHeight } from "@/render/hexGrid/hexHeaderRenderer";
import { BYTES_PER_ROW, HexLayout, type WordSize } from "@/render/hexGrid/hexLayout";
import {
  type BookmarkEditSession,
  bookmarkEditStore,
  editBookmarkInPane,
  handleOffsetDoubleClick,
  toggleBookmarkInPane,
} from "@/state/bookmarkEditStore";
import { bookmarkAt, bookmarksStore, moveBookmark, pointerRow } from "@/state/bookmarksStore";
import { editStore } from "@/state/editStore";
import { toggleMinimap } from "@/state/minimapStore";
import { type SearchStatus, stepSearch } from "@/state/searchStore";
import { segmentsStore } from "@/state/segmentsStore";
import { settingsStore } from "@/state/settingsStore";
import { redoLast, undoLast } from "@/state/undoRouter";
import { useStore } from "@/state/useStore";
import { activeDecoder, decoderFor, type PaneId } from "@/state/workspaceStore";
import { zoneStore } from "@/state/zoneStore";
import { BookmarkEditPopover } from "@/ui/bookmarks/BookmarkEditPopover";
import { DocumentIcon } from "@/ui/pane/DocumentIcon";
import {
  AUTOSCROLL_INTERVAL_MS,
  canAutoscrollToward,
  dragAutoscrollStep,
  isBeyondVisibleEdge,
} from "@/ui/pane/dragAutoscroll";
import {
  detectKeyboardPlatform,
  type HexKeyEvent,
  isContextClick,
  resolveHexKey,
  resolveTarget,
} from "@/ui/pane/hexKeys";
import { OperationStrip } from "@/ui/pane/OperationStrip";
import { PaneScroller } from "@/ui/pane/paneScroller";
import { RenameField } from "@/ui/pane/RenameField";
import { remeasuredTop, scrollLink } from "@/ui/pane/scrollLink";
import { SearchResults } from "@/ui/search/SearchResults";
import { CloseButton } from "@/ui/shell/CloseButton";
import { observeHexColors, readHexColors, readSegmentTints } from "@/ui/theme/hexColors";

/**
 * A pane: the canvas the grid is drawn on, and everything that has to be a DOM
 * element around it.
 *
 * React's job here is the chrome and the event plumbing. It never renders a
 * byte and it never re-renders on a scroll — the scroll offset lives in a ref
 * and goes straight to the renderer, because a `setState` per wheel event is a
 * React render per frame for a canvas that would have repainted anyway.
 */

export interface HexPaneProps {
  /** @upstream ByteRipperApp/Hex/HexView.swift#HexView.dataSource */
  readonly document: BinaryDocument;
  readonly wordSize: WordSize;
  /**
   * The file's name, shown in the pane's own header.
   *
   * @upstream ByteRipperApp/Pane/PaneHeaderView.swift#PaneHeaderView
   * @upstream-differs the header is the pane's own markup
   */
  readonly name: string;
  /** Which slot this is, for the header and for focus. */
  readonly label: string;
  /**
   * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.isActive
   * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.setActive
   */
  readonly isActive: boolean;
  /**
   * Which slot this is, as the scroll link's key. Comparison locks the two
   * panes to the same offsets, and the link needs to tell them apart.
   */
  readonly paneId: PaneId;
  /**
   * @upstream ByteRipperApp/Hex/HexView.swift#HexView.onFocus
   *
   * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.onActivate
   * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.mouseDown
   */
  readonly onActivate: () => void;
  /** @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.onClose */
  readonly onClose: () => void;
  /** The comparison, when there are two files. */
  readonly differences?: DiffBlockIndex | undefined;
  /**
   * The companion's length, when there is one.
   *
   * Both panes scroll by absolute offset, so both must reach the longer file's
   * end — otherwise the shorter one stops at its own last row while the other
   * keeps going, and the pair stops showing the same offsets. Rows past this
   * pane's own EOF are simply empty.
   */
  readonly companionSize?: number | undefined;
  /** The other pane's selection, outlined here. */
  readonly peerSelection?: { start: number; end: number } | undefined;
  /**
   * Takes both panes to a match the results list was clicked on.
   *
   * The list lives in the pane whose file was searched — a result is about
   * *this* file, and a panel across the bottom of the window did not say which
   * of two open dumps it meant.
   */
  readonly onGoToMatch?: ((offset: number) => void) | undefined;
  /**
   * A right-click on the dump, with the byte under the pointer. The caret has
   * already been placed there — see {@link placeContextCaret} — so the menu's
   * offset-scoped commands and the caret agree about what was aimed at.
   *
   * @upstream ByteRipperApp/Hex/HexView.swift#HexView.offsetMenuProvider
   * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.offsetMenuProvider
   */
  readonly onDumpMenu?: ((event: React.MouseEvent, offset: number) => void) | undefined;
  /**
   * A right-click on the pane's header: this pane's File menu.
   *
   * @upstream ByteRipperApp/Pane/PaneHeaderView.swift#PaneHeaderView.rightMouseDown
   * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.paneMenu
   */
  readonly onHeaderMenu?: ((event: React.MouseEvent) => void) | undefined;
  /**
   * Whether the header's name is a field being edited (§23).
   *
   * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.isRenaming
   */
  readonly renaming?: boolean | undefined;
  /** The field closed, with what was typed and whether to take it. */
  readonly onRenameEnd?: ((typed: string, commit: boolean) => void) | undefined;
  /**
   * True while files are being dragged over the window (§22.4).
   *
   * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.enableFileDrop
   * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.draggingEntered
   * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.draggingExited
   * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.draggingEnded
   * @upstream ByteRipperApp/DragDrop/DropBands.swift#PaneDropBandsView
   * @upstream ByteRipperApp/DragDrop/DropBands.swift#PaneDropBandsView.dragActive
   * @upstream ByteRipperApp/DragDrop/DropBands.swift#PaneDropBandsView.setDragActive
   * @upstream ByteRipperApp/DragDrop/DropBands.swift#PaneDropBandsView.showBands
   * @upstream ByteRipperApp/DragDrop/DropBands.swift#PaneDropBandsView.hideBands
   */
  readonly dragActive?: boolean | undefined;
  /**
   * A drop on one of this pane's bands: the file joins at that end rather than
   * replacing what the pane holds.
   *
   * @upstream ByteRipperApp/Window/ComparisonView.swift#ComparisonView.bands1
   * @upstream ByteRipperApp/Window/ComparisonView.swift#ComparisonView.bands2
   * @upstream ByteRipperApp/DragDrop/DragDrop.swift#SingleFileDropTarget
   * @upstream ByteRipperApp/DragDrop/DragDrop.swift#SingleFileDropTarget.isJoin
   * @upstream ByteRipperApp/DragDrop/DragDrop.swift#SingleFileDropTarget.title
   * @upstream ByteRipperApp/DragDrop/DropBands.swift#PaneDropBandsView.onDrop
   * @upstream ByteRipperApp/DragDrop/DropBands.swift#PaneDropBandsView.insertTarget
   * @upstream ByteRipperApp/DragDrop/DropBands.swift#PaneDropBandsView.appendTarget
   * @upstream-differs a pane offers its start and end bands for a join; a drop elsewhere opens
   */
  readonly onJoinDrop?: ((event: React.DragEvent, where: "start" | "end") => void) | undefined;
  /** Called when this pane's selection moves, so the other pane can outline it. */
  readonly onSelectionChanged?: ((selection: { start: number; end: number }) => void) | undefined;
  /**
   * Asks the workspace to reveal a range — difference navigation uses it.
   *
   * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.revealSelectionCentered
   * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.revealSelectionCenteredIfNeeded
   * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.revealOffsetCentered
   * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.revealOffsetIfOffScreen
   * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.scrollRowToTop
   */
  readonly revealRequest?:
    | {
        offset: number;
        token: number;
        moveCaret?: boolean | undefined;
        onlyIfOffScreen?: boolean | undefined;
      }
    | undefined;
  /**
   * The document's editing state machine. It belongs to the document, not to
   * this component: it holds a half-typed nibble and an open undo group,
   * neither of which should survive a remount or a layout change.
   *
   * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.typingModeLabel
   */
  readonly typing: TypingController;
  /**
   * The file as it was last saved. Absent for a document never on disk, where
   * every byte would otherwise be drawn as an unsaved edit.
   */
  readonly saved?: ByteStorage | undefined;
  readonly onSave?: (() => void) | undefined;
  readonly onSaveAs?: (() => void) | undefined;
  readonly onGoTo?: (() => void) | undefined;
  readonly onFind?: (() => void) | undefined;
  /**
   * The search matches to grey in this pane, when a search is active.
   *
   * The whole set rather than the renderer's narrow {@link MatchLookup}: the
   * results list under the dump needs to enumerate them, and the renderer takes
   * the set through that interface anyway.
   */
  readonly matches?: MatchSet | undefined;
  /**
   * Whether the results panel is up under the dump. The find bar's results
   * button is what raises it; the panel's × takes it down.
   *
   * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.searchResultsPanelVisible
   */
  readonly resultsShown?: boolean | undefined;
  /** How far the pane's search has got, so an open panel can say "Searching…". */
  readonly searchStatus?: SearchStatus | undefined;
  readonly currentMatch?: { start: number; end: number } | undefined;
}

const platform = detectKeyboardPlatform();

/**
 * How many bytes one copy will produce, at most.
 *
 * A megabyte of bytes is three megabytes of hex text — past what any clipboard
 * is for, and past what anything would paste it into. A selection larger than
 * this copies its first megabyte.
 */
const COPY_LIMIT = 1024 * 1024;

/**
 * The renderer's view of the caret, from the document and the typing state.
 *
 * One function because the caret is repainted from two places — a selection
 * change and a change of mode, column or nibble — and a field added to one of
 * them and forgotten in the other is a caret that lies about half its state.
 *
 * @upstream ByteRipperApp/Hex/HexView.swift#HexViewDataSource.hexCaretNibble
 * @upstream ByteRipperApp/Hex/HexView.swift#HexViewDataSource.hexHasPendingInsert
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.hexCaretVisible
 */
function rendererCaret(doc: BinaryDocument, typing: TypingController): HexGridCaret {
  const current = doc.selection;
  return {
    offset: current.start,
    nibble: typing.nibble,
    region: typing.inputRegion,
    insertMode: typing.isInsertMode,
    pendingInsert: typing.hasPendingInsert,
    // A standing selection shows the active region on its own; the caret
    // reappears at its start the moment typing begins to consume it.
    visible: current.end === current.start || typing.nibble === 1,
  };
}

/**
 * @upstream ByteRipperApp/Hex/HexView.swift#HexView
 * @upstream-differs the event half; the drawing half is HexGridRenderer
 * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView
 * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.viewModel
 * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.searchResults
 * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.searchResultsSplit
 */
export function HexPane({
  document: doc,
  wordSize,
  name,
  label,
  isActive,
  paneId,
  onActivate,
  onClose,
  differences,
  companionSize,
  peerSelection,
  onGoToMatch,
  onDumpMenu,
  onHeaderMenu,
  renaming,
  onRenameEnd,
  dragActive,
  onJoinDrop,
  onSelectionChanged,
  revealRequest,
  typing,
  saved,
  onSave,
  onSaveAs,
  onGoTo,
  onFind,
  matches,
  currentMatch,
  resultsShown,
  searchStatus,
}: HexPaneProps) {
  const readoutId = useId();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  /** @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.scrollView */
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const spacerRef = useRef<HTMLDivElement | null>(null);
  /**
   * Where the pane is in its content. Every row, offset and pointer position is
   * measured from this, never from the element's `scrollTop`, which a file
   * taller than the browser lays out turns into a scaled thumb position.
   */
  const scrollerRef = useRef<PaneScroller | null>(null);
  const rendererRef = useRef<HexGridRenderer | null>(null);
  const frameRef = useRef<number | undefined>(undefined);
  /** @upstream ByteRipperApp/Hex/HexView.swift#HexView.hexLayout */
  const layoutRef = useRef<HexLayout | undefined>(undefined);
  const headerRef = useRef<HTMLCanvasElement | null>(null);
  const headerRendererRef = useRef<HexHeaderRenderer | null>(null);
  const colorsRef = useRef<HexGridColors | undefined>(undefined);
  const headerRuleRef = useRef("");
  const viewportHeightRef = useRef(0);
  const dragAnchorRef = useRef<number | undefined>(undefined);
  /** The row a bookmark is being dragged from, while that drag is happening. */
  const markDragRef = useRef<number | undefined>(undefined);
  /**
   * The row the pointer was last resolved to during a mark's drag. A step is
   * taken only when this changes — the mark answers the pointer *crossing* a
   * row, not the row the pointer happens to be over (§20.6).
   *
   * This is what stops a mark that has just jumped over another from shuffling
   * back and forth: after the jump the mark sits past the obstacle while the
   * pointer is still on the obstacle's row, so re-reading that row would
   * compute the jump again — in the other direction, since the mark is now on
   * the far side of it.
   *
   * @upstream ByteRipperApp/Hex/HexView.swift#HexView.draggingBookmarkPointerRow
   */
  const markDragPointerRowRef = useRef<number | undefined>(undefined);
  /** Which join band a dragged file is currently over, if either (§22.4). */
  const [overBand, setOverBand] = useState<"start" | "end" | undefined>(undefined);
  /**
   * The named bookmark the pointer is resting on, and where to show its name.
   *
   * A mark says *that* a row is marked; the name says what it was marked for,
   * and there is nowhere in a 16-byte row to print it. So it is a tooltip — but
   * the dump is a canvas, and a canvas has no elements to hang `title` on.
   */
  const [markTip, setMarkTip] = useState<{ name: string; top: number; left: number } | undefined>(
    undefined
  );

  /** Only what the chrome actually displays lives in React state. */
  const [caret, setCaret] = useState(0);
  const [mode, setMode] = useState<"INS" | "OVR">("OVR");
  const [region, setRegion] = useState<InputRegion>("hex");
  const [dirty, setDirty] = useState(false);
  const [contentWidth, setContentWidth] = useState(0);

  /** Paints on the next frame, coalescing however many reasons arrived. */
  const scheduleDraw = useCallback(() => {
    if (frameRef.current !== undefined) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = undefined;
      rendererRef.current?.draw();
    });
  }, []);

  /**
   * Paints now, not on the next frame.
   *
   * For a resize this is the difference between a repaint and a flicker.
   * Resizing the backing store clears it, and a `ResizeObserver` runs after
   * layout but *before* the frame is painted — so drawing here puts the new
   * content up in the same frame the old was cleared from. Deferring it to
   * `requestAnimationFrame` left one frame of empty canvas, which over a
   * splitter drag is one per frame of the drag.
   */
  const drawNow = useCallback(() => {
    if (frameRef.current !== undefined) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = undefined;
    }
    rendererRef.current?.draw();
  }, []);

  // The renderer, made once per canvas.
  /**
   * The header is pinned outside the scroller, so it has to be told about a
   * sideways scroll — that is the whole reason it is redrawn on scroll at all.
   *
   * @upstream ByteRipperApp/Hex/HexColumnHeaderView.swift#HexColumnHeaderView.refreshForGridChange
   */
  // The font, its size and the row pitch are the user's, and so is the text
  // column's table: any of them changing re-lays the pane out.
  const settings = useStore(settingsStore);
  const fontFamily = hexFontStack(settings.fontFamily);
  const { fontSize, rowHeightScale, textDecoding } = settings;

  const drawHeader = useCallback(() => {
    const canvas = headerRef.current;
    const layout = layoutRef.current;
    const host = scrollRef.current;
    if (canvas === null || layout === undefined) return;
    if (headerRendererRef.current === null) {
      headerRendererRef.current = new HexHeaderRenderer(canvas);
    }
    const box = canvas.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return;
    const palette = colorsRef.current;
    if (palette === undefined) return;
    headerRendererRef.current.resize(box.width, box.height, window.devicePixelRatio);
    headerRendererRef.current.draw({
      layout,
      fontPx: fontSize,
      fontFamily,
      colors: {
        background: palette.background,
        ink: palette.address,
        rule: headerRuleRef.current,
      },
      scrollLeft: host?.scrollLeft ?? 0,
    });
  }, [fontSize, fontFamily]);

  /** Hands the renderer where the pane now is. */
  const applyViewport = useCallback(() => {
    const host = scrollRef.current;
    const scroller = scrollerRef.current;
    if (host === null || scroller === null) return;
    rendererRef.current?.setViewport({
      scrollTop: scroller.top,
      scrollLeft: host.scrollLeft,
      widthCss: host.clientWidth,
      heightCss: host.clientHeight,
    });
  }, []);

  /** What a change of position owes: the paint, the header, and the other pane. */
  const scrolled = useCallback(() => {
    applyViewport();
    drawHeader();
    scheduleDraw();
    scrollLink.report(paneId);
  }, [applyViewport, drawHeader, scheduleDraw, paneId]);

  /**
   * Scrolls to a content position: the one way this pane's own code moves it.
   *
   * @upstream ByteRipperApp/Hex/HexView.swift#HexView.scrollRowToTop
   */
  const scrollPaneTo = useCallback(
    (top: number, left?: number) => {
      const scroller = scrollerRef.current;
      if (scroller === null) return;
      scroller.moveTo(top, left);
      scrolled();
    },
    [scrolled]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = scrollRef.current;
    const spacer = spacerRef.current;
    if (canvas === null || host === null || spacer === null) return;
    const renderer = new HexGridRenderer(canvas);
    renderer.setBytesArrivedHandler(scheduleDraw);
    rendererRef.current = renderer;
    scrollerRef.current = new PaneScroller(host, spacer, elementHeightLimit());
    return () => {
      renderer.setBytesArrivedHandler(undefined);
      rendererRef.current = null;
      scrollerRef.current = null;
    };
  }, [scheduleDraw]);

  // Configuration: the layout, the atlas's inputs, the palette. Anything here
  // changing rebuilds the atlas and repaints everything, which is the cheap
  // side of D6's bargain.
  useEffect(() => {
    const renderer = rendererRef.current;
    if (renderer === null) return;

    const configure = () => {
      // Where the pane is, captured at the old measure before the metrics move.
      // Without it a font change scrolls the file out from under the reader,
      // further the further down they are.
      const scroller = scrollerRef.current;
      const previous = layoutRef.current;
      const anchor =
        scroller === null || previous === undefined
          ? undefined
          : {
              top: scroller.top,
              rowHeight: previous.rowHeight,
              viewportHeight: scroller.viewportHeight,
            };

      const metrics = measureFont(fontSize, fontFamily, rowHeightScale);
      const layout = new HexLayout({
        charWidth: metrics.charWidth,
        rowHeight: metrics.rowHeight,
        offsetColumnChars: Math.max(8, doc.size.toString(16).length),
        wordSize,
      });
      layoutRef.current = layout;
      // The strip is one hex row plus the header's own padding, so it tracks
      // the font size rather than being a number CSS guesses at.
      headerRef.current?.parentElement?.style.setProperty(
        "--hex-header-height",
        `${headerHeight(layout.rowHeight)}px`
      );
      // Kept, because the header redraws on every sideways scroll and
      // getComputedStyle on that path would be a style recalculation per frame.
      const palette = readHexColors();
      colorsRef.current = palette;
      headerRuleRef.current = getComputedStyle(document.documentElement)
        .getPropertyValue("--header-rule")
        .trim();
      renderer.configure({
        layout,
        decoder: decoderFor(textDecoding),
        colors: palette,
        fontFamily,
        fontSizePx: fontSize,
        devicePixelRatio: window.devicePixelRatio,
      });
      renderer.setSource(doc);
      renderer.setScrollExtent(companionSize);
      const moved = scroller?.setContentHeight(renderer.contentHeight) === true;
      setContentWidth(renderer.contentWidth);
      // The width now, not on the next render: a wider or narrower row brings the
      // sideways scroll bar in or takes it away, which changes the viewport's
      // height — and the settle below reads that height to find the middle.
      if (spacerRef.current !== null) {
        spacerRef.current.style.width = `${renderer.contentWidth}px`;
      }
      // A re-layout is the pane fitting itself, not a scroll: it settles under
      // the position the panes share — the same rows at the new measure, as far
      // as this file reaches — and the other pane is not moved. Only a pane with
      // nothing to settle to keeps its own place — the middle of its view, across
      // a change of measure.
      if (scrollLink.settle(paneId)) applyViewport();
      else if (anchor !== undefined && scroller !== null) {
        scrollPaneTo(remeasuredTop(anchor, layout.rowHeight, scroller.viewportHeight));
      } else if (moved) scrolled();
      scheduleDraw();
      drawHeader();
    };

    configure();
    const stopWatchingColors = observeHexColors(configure);
    const stopWatchingScale = observeDevicePixelRatio(configure);
    return () => {
      stopWatchingColors();
      stopWatchingScale();
    };
  }, [
    doc,
    wordSize,
    fontSize,
    fontFamily,
    rowHeightScale,
    textDecoding,
    scheduleDraw,
    drawHeader,
    companionSize,
    scrollPaneTo,
    scrolled,
    applyViewport,
    paneId,
  ]);

  /**
   * The header is sized to its element, so it has to hear about a resize.
   *
   * Without this its backing store keeps the width it was first drawn at and
   * CSS stretches that drawing across the new one — which does not look broken,
   * it looks like labels that no longer sit over their columns.
   */
  useLayoutEffect(() => {
    const canvas = headerRef.current;
    if (canvas === null) return;
    const observer = new ResizeObserver(() => drawHeader());
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [drawHeader]);

  // The viewport, and its size.
  useEffect(() => {
    const host = scrollRef.current;
    const renderer = rendererRef.current;
    if (host === null || renderer === null) return;

    const measure = () => {
      viewportHeightRef.current = host.clientHeight;
      // The track's mapping depends on the viewport's height, so a resize can
      // move the element's offset without moving the content.
      const moved = scrollerRef.current?.fit() === true;
      // A resize is not a scroll: a shorter viewport can clamp the pane, and
      // reporting that would drag the other pane with it.
      const settled = scrollLink.settle(paneId);
      applyViewport();
      drawNow();
      if (moved && !settled) scrollLink.report(paneId);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, [drawNow, applyViewport, paneId]);

  // Selection changes from anywhere — a click, a key, an edit's clamp.
  useEffect(() => {
    const apply = () => {
      const current = doc.selection;
      rendererRef.current?.setSelection({ start: current.start, end: current.end });
      rendererRef.current?.setCaret(rendererCaret(doc, typing));
      setCaret(current.start);
      onSelectionChanged?.({ start: current.start, end: current.end });
      scheduleDraw();
    };
    apply();
    return doc.onSelectionChanged(apply);
  }, [doc, scheduleDraw, onSelectionChanged, typing]);

  /**
   * The red foreground, and the pane's unsaved marker.
   *
   * The red comes from comparing each byte with the file on disk, which the
   * renderer does itself — this only has to hand it the saved file and repaint
   * when the bytes move.
   */
  useEffect(() => {
    rendererRef.current?.setSavedSource(saved);
    scheduleDraw();
  }, [saved, scheduleDraw]);

  useEffect(() => {
    const apply = () => {
      setDirty(doc.isDirty);
      const height = rendererRef.current?.contentHeight ?? 0;
      const moved = scrollerRef.current?.setContentHeight(height) === true;
      // A file that grew or shrank — an insert, a delete, a revert — fits itself
      // back under the shared position; the clamp at a shorter end is not a
      // scroll to hand to the other pane, and a longer file comes level again.
      if (scrollLink.settle(paneId)) {
        if (moved) {
          applyViewport();
          drawHeader();
        }
      } else if (moved) scrolled();
      scheduleDraw();
    };
    apply();

    /**
     * Repaint what an edit touched.
     *
     * An overwrite dirties its own bytes. An insert or a delete moves every
     * byte after it, so the whole tail is stale — and the document's height
     * changes with it, which is what the scrollbar is measured from.
     */
    const stopContent = doc.onContentChanged((change) => {
      const renderer = rendererRef.current;
      for (const op of change.ops) {
        if (op.kind === "overwrite") renderer?.invalidateBytes(op.at, op.at + op.after.length);
        else renderer?.invalidateBytes(op.at, doc.size);
      }
      apply();
    });
    // The commit is a separate signal: a grouped byte becomes dirty when its
    // group closes, and that fires no content change.
    const stopCommit = doc.onTransactionCommitted(apply);
    return () => {
      stopContent();
      stopCommit();
    };
  }, [doc, scheduleDraw, scrolled, applyViewport, drawHeader, paneId]);

  // The comparison, and the other pane's selection outlined here.
  useEffect(() => {
    rendererRef.current?.setDifferences(differences);
    scheduleDraw();
  }, [differences, scheduleDraw]);

  useEffect(() => {
    rendererRef.current?.setPeerSelection(peerSelection);
    scheduleDraw();
  }, [peerSelection, scheduleDraw]);

  useEffect(() => {
    rendererRef.current?.setMatches(matches, currentMatch);
    scheduleDraw();
  }, [matches, currentMatch, scheduleDraw]);

  // Difference navigation asks the pane to show a range. The token makes a
  // repeat of the same range a fresh request — pressing Next twice on a file
  // with one difference should still scroll back to it.
  // @upstream ByteRipperApp/Hex/HexView.swift#HexView.revealOffsetCentered
  // @upstream ByteRipperApp/Hex/HexView.swift#HexView.revealSelectionCentered
  // @upstream ByteRipperApp/Hex/HexView.swift#HexView.revealSelectionCenteredIfNeeded
  useEffect(() => {
    if (revealRequest === undefined) return;
    // The caret moves; the block is not selected. A selection would claim the
    // user had chosen those bytes — and the next thing typed would replace
    // them, which is not what stepping through differences is for.
    //
    // A minimap click moves neither: it is a way of *looking* somewhere, and
    // taking the caret along would lose the place the user was editing.
    if (revealRequest.moveCaret !== false) {
      doc.setSelection(caretAt(revealRequest.offset, doc.size));
    }
    const scroller = scrollerRef.current;
    const layout = layoutRef.current;
    if (scroller === null || layout === undefined) return;
    // A tool focusing a zone is showing the user something, not sending them
    // there: a zone already in front of them is left exactly where it is, and
    // the rows do not move under someone who can already see them.
    if (revealRequest.onlyIfOffScreen === true) {
      const onScreen = scrollLink.visibleRange(paneId, BYTES_PER_ROW);
      if (
        onScreen !== undefined &&
        revealRequest.offset >= onScreen.start &&
        revealRequest.offset < onScreen.end
      ) {
        return;
      }
    }

    const rowTop = Math.floor(revealRequest.offset / BYTES_PER_ROW) * layout.rowHeight;
    // Centred, not merely brought inside the edge: a change the user asked to
    // be shown should have its surroundings visible too.
    scrollPaneTo(Math.max(0, rowTop - scroller.viewportHeight / 2 + layout.rowHeight));
  }, [revealRequest, doc, scrollPaneTo, paneId]);

  // Comparison locks the panes to the same offsets. With one file open the
  // link has nothing to mirror to and does nothing.
  //
  // A move the link makes is applied to the renderer here and now, not left to
  // this pane's scroll event: that event arrives a frame later, and the pane
  // being followed would visibly lead the one following it.
  //
  // What a move made by the link owes this pane lives in a ref, kept current,
  // so the registration is made once per pane rather than again whenever one of
  // these is re-created. A font change re-creates the header's — and for the
  // commit in which the pane was out of the link, it re-laid itself out alone,
  // off the shared position, which is how the middle of the view went astray.
  const linkMovedRef = useRef<() => void>(() => undefined);
  useLayoutEffect(() => {
    linkMovedRef.current = () => {
      applyViewport();
      drawHeader();
      scheduleDraw();
    };
  }, [applyViewport, drawHeader, scheduleDraw]);

  useEffect(() => {
    return scrollLink.register(paneId, {
      rowHeight: () => layoutRef.current?.rowHeight ?? 0,
      position: () => ({
        top: scrollerRef.current?.top ?? 0,
        left: scrollerRef.current?.left ?? 0,
      }),
      extent: () => ({
        maxTop: scrollerRef.current?.maxTop ?? 0,
        maxLeft: scrollerRef.current?.maxLeft ?? 0,
        viewportHeight: scrollerRef.current?.viewportHeight ?? 0,
      }),
      moveTo: (position) => {
        scrollerRef.current?.moveTo(position.top, position.left);
        linkMovedRef.current();
      },
    });
  }, [paneId]);

  const onScroll = useCallback(() => {
    const scroller = scrollerRef.current;
    // The echo of an offset this pane or the link set: already applied.
    if (scroller === null || !scroller.noteScroll()) return;
    // A tip is placed in the element's own coordinates, which on a scaled track
    // no longer move with the row it names.
    if (scroller.scaled) setMarkTip(undefined);
    scrolled();
  }, [scrolled]);

  /**
   * A wheel over a file taller than the browser lays out moves the content by
   * exactly its distance rather than the scaled thumb (see `PaneScroller.wheel`).
   * Registered by hand because React's wheel listener is passive, and a passive
   * listener cannot keep the browser from scrolling as well.
   */
  useEffect(() => {
    const host = scrollRef.current;
    if (host === null) return;
    const onWheel = (event: WheelEvent) => {
      const scroller = scrollerRef.current;
      const layout = layoutRef.current;
      if (scroller === null || layout === undefined) return;
      if (!scroller.wheel(event, layout.rowHeight)) return;
      event.preventDefault();
      setMarkTip(undefined);
      scrolled();
    };
    host.addEventListener("wheel", onWheel, { passive: false });
    return () => host.removeEventListener("wheel", onWheel);
  }, [scrolled]);

  /**
   * Brings an offset into view with the least scrolling that will do it.
   *
   * @upstream ByteRipperApp/Hex/HexView.swift#HexView.revealCaret
   */
  const reveal = useCallback(
    (offset: number) => {
      const scroller = scrollerRef.current;
      const layout = layoutRef.current;
      if (scroller === null || layout === undefined) return;

      const rowTop = Math.floor(offset / BYTES_PER_ROW) * layout.rowHeight;
      const rowBottom = rowTop + layout.rowHeight;
      if (rowTop < scroller.top) scrollPaneTo(rowTop);
      else if (rowBottom > scroller.top + scroller.viewportHeight) {
        scrollPaneTo(rowBottom - scroller.viewportHeight);
      }
    },
    [scrollPaneTo]
  );

  const moveCaret = useCallback(
    (target: number, extend: boolean) => {
      const clamped = Math.min(Math.max(target, 0), doc.size);
      const anchor = extend ? (doc.hasSelection ? doc.selection.start : doc.caret) : clamped;
      doc.setSelection(
        extend ? makeSelection(anchor, clamped, doc.size) : caretAt(clamped, doc.size)
      );
      reveal(clamped);
    },
    [doc, reveal]
  );

  /**
   * The bookmark popover, when its session is about this pane. The row is
   * scrolled into view first — a popover has to point at something the user
   * can see, and ⇧⌘D can be pressed with the caret's row just off screen — and
   * the popover is placed under its mark, or over it where there is no room.
   *
   * @upstream ByteRipperApp/Hex/HexView.swift#HexView.bookmarkMarkRect
   */
  const editing = useStore(bookmarkEditStore).session;
  const editingHere = editing?.pane === paneId ? editing : undefined;
  const [editAnchor, setEditAnchor] = useState<
    { token: number; top: number; left: number; above: boolean } | undefined
  >(undefined);
  useEffect(() => {
    if (editingHere === undefined) {
      setEditAnchor(undefined);
      return;
    }
    reveal(editingHere.row);
    // After the scroll lands, or the popover points at where the row used to be.
    const frame = requestAnimationFrame(() => {
      const layout = layoutRef.current;
      const host = scrollRef.current;
      const scroller = scrollerRef.current;
      if (layout === undefined || host === null || scroller === null) return;
      const inView = Math.floor(editingHere.row / BYTES_PER_ROW) * layout.rowHeight - scroller.top;
      const roomBelow = scroller.viewportHeight - (inView + layout.rowHeight);
      const above = roomBelow < 130 && inView > roomBelow;
      setEditAnchor({
        token: editingHere.token,
        top: (above ? inView - 6 : inView + layout.rowHeight + 6) + host.scrollTop,
        left: layout.leftPadding,
        above,
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [editingHere, reveal]);

  /**
   * A mark just made is where the eye lands once it is named — on the commit,
   * after the popover has let the keyboard go, so the move is not lost behind it.
   *
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.revealBookmark
   */
  const onBookmarkCommitted = useCallback(
    (session: BookmarkEditSession, row: number) => {
      if (session.existingName === undefined) moveCaret(row, false);
    },
    [moveCaret]
  );
  const focusDump = useCallback(() => scrollRef.current?.focus({ preventScroll: true }), []);

  useEffect(() => {
    rendererRef.current?.setActive(isActive);
    scheduleDraw();
  }, [isActive, scheduleDraw]);

  // The pane tells the controller where to scroll when typing starts at an
  // offset that may be off screen.
  useEffect(() => {
    typing.revealHandler = reveal;
    setMode(typing.modeLabel);
    setRegion(typing.inputRegion);
    return () => {
      typing.revealHandler = undefined;
    };
  }, [typing, reveal]);

  /**
   * Repaints the caret from the controller's current state.
   *
   * The selection does not change when the mode, the column or the nibble does,
   * so those three need their own nudge — and the nibble changes on every hex
   * digit, which is what makes the bar step across the byte as you type.
   *
   * @upstream ByteRipperApp/Hex/HexView.swift#HexView.redrawCaret
   */
  const refreshCaret = useCallback(() => {
    rendererRef.current?.setCaret(rendererCaret(doc, typing));
    scheduleDraw();
  }, [doc, typing, scheduleDraw]);

  // The typing mode can be switched from outside the pane — the toolbar's
  // toggle — so the readout and the caret follow the controller, not only this
  // pane's own key.
  const editVersion = useStore(editStore).version;
  useEffect(() => {
    void editVersion;
    setMode(typing.modeLabel);
    refreshCaret();
  }, [editVersion, typing, refreshCaret]);

  /**
   * @upstream ByteRipperApp/Hex/HexView.swift#HexView.keyDown
   * @upstream ByteRipperApp/Hex/HexView.swift#HexView.delegate
   */
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const command = resolveHexKey(event as unknown as HexKeyEvent, platform, region);
      if (command === undefined) return;

      const scroller = scrollerRef.current;
      const layout = layoutRef.current;
      const rowsPerPage = Math.max(
        1,
        Math.floor(viewportHeightRef.current / (layout?.rowHeight ?? 17))
      );

      switch (command.kind) {
        case "moveBy":
          void typing.breakRun();
          moveCaret(doc.caret + command.delta, command.extend);
          break;
        case "moveTo":
          void typing.breakRun();
          moveCaret(
            resolveTarget(command.target, doc.caret, doc.size, rowsPerPage, command.extend),
            command.extend
          );
          break;
        case "scrollByPage":
          if (scroller !== null) {
            scrollPaneTo(
              scroller.top + (command.down ? 1 : -1) * rowsPerPage * (layout?.rowHeight ?? 17)
            );
          }
          break;
        case "scrollTo":
          if (scroller !== null) scrollPaneTo(command.edge === "top" ? 0 : scroller.maxTop);
          break;
        case "selectAll":
          doc.setSelection(makeSelection(0, doc.size, doc.size));
          break;
        case "toggleMinimap":
          toggleMinimap();
          break;
        case "goToPosition":
          onGoTo?.();
          break;
        case "find":
          onFind?.();
          break;
        case "findNext":
          stepSearch("forward");
          break;
        case "findPrevious":
          stepSearch("backward");
          break;

        case "hexDigit":
          void typing.typeHexDigit(command.digit).then(refreshCaret);
          break;
        case "character": {
          // The decoding table decides whether the character is representable;
          // one it cannot encode is refused rather than written as something
          // else.
          const byte = activeDecoder().encode(command.character);
          if (byte !== undefined) void typing.typeByte(byte);
          break;
        }
        case "delete":
          void (command.forward ? typing.deleteForward() : typing.deleteBackward());
          break;
        case "toggleInsertMode":
          void typing.toggleInsertMode().then(() => {
            setMode(typing.modeLabel);
            refreshCaret();
          });
          break;
        case "switchColumn": {
          const next: InputRegion = region === "hex" ? "text" : "hex";
          setRegion(next);
          void typing.setInputRegion(next).then(refreshCaret);
          break;
        }
        case "undo":
          // Through the router: a cut is undoable too, and the last thing done
          // is what a press should take back.
          void undoLast(paneId, command.batch);
          break;
        case "redo":
          void redoLast(paneId);
          break;
        case "save":
          onSave?.();
          break;
        case "saveAs":
          onSaveAs?.();
          break;
        case "toggleBookmark":
          toggleBookmarkInPane(paneId, doc.selection.start);
          break;
        case "editBookmark":
          editBookmarkInPane(paneId, doc.selection.start);
          break;
        case "contextMenu": {
          // Shift+F10 and the Menu key are the platform's own way of asking for
          // a context menu, and the caret is what they aim at.
          const host = scrollRef.current;
          const layout = layoutRef.current;
          if (host !== null && layout !== undefined && onDumpMenu !== undefined) {
            const box = host.getBoundingClientRect();
            const row = Math.floor(doc.caret / BYTES_PER_ROW);
            const y = row * layout.rowHeight - (scrollerRef.current?.top ?? 0) + layout.rowHeight;
            onDumpMenu(
              {
                clientX: box.left + 80,
                clientY: box.top + Math.min(Math.max(y, 0), box.height),
                preventDefault: () => undefined,
              } as unknown as React.MouseEvent,
              doc.caret
            );
          }
          break;
        }
        case "copy":
        case "paste":
          // The clipboard needs the browser's own event to carry the data, so
          // these are handled by onCopy/onPaste below rather than here. Falling
          // through without preventDefault is what lets that happen.
          return;
      }
      event.preventDefault();
    },
    [
      doc,
      moveCaret,
      region,
      onSave,
      onSaveAs,
      onGoTo,
      onFind,
      onDumpMenu,
      paneId,
      typing,
      refreshCaret,
      scrollPaneTo,
    ]
  );

  /**
   * Copy.
   *
   * Hex text always goes on the clipboard, because that is what travels. Where
   * the browser allows it the raw bytes go too, under a `web `-prefixed type,
   * so a copy from this application pastes back into it losslessly and into
   * everything else legibly.
   *
   * `clipboardData` is only writable while the event is being dispatched, so
   * the sync path needs the bytes in hand *now* — which is what `peek` is for.
   * The asynchronous route covers both the not-yet-resident case and the raw
   * type, which no copy event can carry.
   */
  const onCopy = useCallback(
    (event: React.ClipboardEvent<HTMLDivElement>) => {
      const { start, end } = doc.selection;
      if (end <= start) return;
      event.preventDefault();

      // Bounded: Select All on a 64 MB dump must not build a 190 MB string.
      const count = Math.min(end - start, COPY_LIMIT);
      const resident = doc.peek(start, count);
      if (resident !== undefined) {
        // Written synchronously first, so the clipboard is never left empty if
        // the asynchronous write is refused.
        event.clipboardData.setData("text/plain", formatHex(resident));
        void writeBytes(resident);
        return;
      }
      void doc.read(start, count).then(async (bytes) => {
        if (!(await writeBytes(bytes))) {
          await navigator.clipboard?.writeText(formatHex(bytes)).catch(() => undefined);
        }
      });
    },
    [doc]
  );

  const onPaste = useCallback(
    (event: React.ClipboardEvent<HTMLDivElement>) => {
      event.preventDefault();
      // The raw type first, when the clipboard carries it: it needs no parsing
      // and cannot be misread. The event's own text is the fallback, and is
      // what every browser has.
      const fromEvent = bytesFromClipboardData(event.clipboardData);
      if (fromEvent !== undefined && fromEvent.length > 0) {
        void typing.pasteBytes(fromEvent);
        return;
      }
      void readBytes().then((bytes: Uint8Array | undefined) => {
        // Text that is not unambiguously hex is refused rather than guessed at.
        if (bytes !== undefined && bytes.length > 0) void typing.pasteBytes(bytes);
      });
    },
    [typing]
  );

  /**
   * The marks the offset column draws.
   *
   * The whole set on every change: there are a handful of bookmarks and
   * thousands of rows, and the renderer refuses an identical set, so this
   * repaints exactly when a mark actually moved.
   */
  /**
   * The zones the open tool publishes for this pane, outlined over the bytes as
   * upstream draws them — the focused one washed. The shell never sees a node;
   * the ranges and the focus are the whole of what a tool asks to have drawn.
   */
  const zones = useStore(zoneStore).panes[paneId];
  useEffect(() => {
    rendererRef.current?.setZones(zones.zones, zones.focus);
    scheduleDraw();
  }, [zones, scheduleDraw]);

  const marks = useStore(bookmarksStore).bookmarks;
  useEffect(() => {
    rendererRef.current?.setBookmarks(new Set(marks.map((mark) => mark.row)));
    scheduleDraw();
  }, [marks, scheduleDraw]);

  /**
   * The paper each row is printed on: one tint per piece (§21.3).
   *
   * A file that has not been cut is one piece and is given no bands at all —
   * tinting the whole dump one colour would say something about it that is not
   * true of any part of it.
   */
  const partition = useStore(segmentsStore).panes[paneId]?.partition;
  useEffect(() => {
    const pieces = partition?.segments ?? [];
    const tints = readSegmentTints();
    rendererRef.current?.setSegments(
      pieces.length < 2
        ? []
        : pieces.map((piece) => ({
            start: piece.start,
            end: piece.end,
            tint: tints[piece.index % tints.length] ?? "",
          }))
    );
    scheduleDraw();
  }, [partition, scheduleDraw]);

  /** Where a pointer is, in the grid's own content coordinates. */
  const contentPoint = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const host = scrollRef.current;
    if (host === null) return undefined;
    const bounds = host.getBoundingClientRect();
    return {
      x: event.clientX - bounds.left + host.scrollLeft,
      y: event.clientY - bounds.top + (scrollerRef.current?.top ?? 0),
    };
  }, []);

  /** @upstream ByteRipperApp/Hex/HexView.swift#HexView.mouseDown */
  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const layout = layoutRef.current;
      const point = contentPoint(event);
      if (layout === undefined || point === undefined) return;

      // Take the focus first. The handler ends in preventDefault — needed so a
      // drag does not turn into a text selection of the page — and that also
      // suppresses the click's own focusing, so without this the grid never
      // gets the keyboard and nothing typed into it arrives.
      event.currentTarget.focus();

      // A press that opens the context menu is not a click in the dump. The
      // browser sends it here before `contextmenu`, and treating it as a click
      // put the caret down and took the selection away — so the menu, opened on
      // the selection, no longer had one to act on. Where the caret goes is
      // `onContextMenu`'s decision, as it is upstream's `placeContextMenuCaret`.
      if (isContextClick(event, platform)) return;

      const hit = layout.hitTest(point.x, point.y, layout.rowCount(doc.size));
      if (hit === undefined) return;

      const column = hit.column.kind === "offset" ? 0 : hit.column.column;
      const offset = Math.min(layout.byteOffset(hit.row, column), doc.size);

      // A press on a marked address picks the mark up rather than starting a
      // selection: the offset column is where marks live, and dragging one to
      // another row is how §20.3 says a mark is moved.
      if (hit.column.kind === "offset" && bookmarkAt(offset) !== undefined) {
        markDragRef.current = rowContaining(offset);
        // The gesture starts on the mark's own row, so the first step comes
        // when the pointer leaves it.
        markDragPointerRowRef.current = rowContaining(offset);
        event.currentTarget.setPointerCapture(event.pointerId);
        event.preventDefault();
        return;
      }
      // Clicking in a column is how you choose which one you are typing into.
      if (hit.column.kind === "hex" || hit.column.kind === "text") {
        const clicked: InputRegion = hit.column.kind === "hex" ? "hex" : "text";
        if (clicked !== region) {
          setRegion(clicked);
          void typing.setInputRegion(clicked).then(refreshCaret);
        }
      }
      dragAnchorRef.current = offset;
      event.currentTarget.setPointerCapture(event.pointerId);
      doc.setSelection(
        event.shiftKey ? makeSelection(doc.caret, offset, doc.size) : caretAt(offset, doc.size)
      );
      event.preventDefault();
    },
    [contentPoint, doc, region, typing, refreshCaret]
  );

  /**
   * Shows a named mark's name while the pointer rests on it.
   *
   * @upstream ByteRipperApp/Hex/HexView.swift#HexView.bookmarkTooltipTag
   * @upstream ByteRipperApp/Hex/HexView.swift#HexView.view
   * @upstream ByteRipperApp/Hex/HexView.swift#HexViewDataSource.hexBookmark
   * @upstream-differs a tip element placed over the mark, not a tooltip rect
   */
  const trackMarkTip = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const layout = layoutRef.current;
    const host = scrollRef.current;
    if (layout === undefined || host === null) return;
    const bounds = host.getBoundingClientRect();
    const top = scrollerRef.current?.top ?? 0;
    const x = event.clientX - bounds.left + host.scrollLeft;
    const y = event.clientY - bounds.top + top;
    // The offset column only: the tip is about the mark, not about the row.
    if (x > layout.leftPadding + layout.offsetColumnWidth + layout.gapAfterOffset) {
      setMarkTip(undefined);
      return;
    }
    const row = Math.max(0, Math.floor(y / layout.rowHeight)) * BYTES_PER_ROW;
    const mark = bookmarkAt(row);
    if (mark === undefined || mark.name.length === 0) {
      setMarkTip(undefined);
      return;
    }
    // In the scroller's own coordinates, so it travels with the row it names
    // rather than hanging at a fixed height while the dump scrolls — which are
    // the content's, less the difference a scaled track makes. And beside the
    // mark rather than over it: the address it names is the one thing the tip
    // must not hide.
    setMarkTip({
      name: mark.name,
      top: (row / BYTES_PER_ROW) * layout.rowHeight - top + host.scrollTop,
      left: layout.leftPadding + layout.offsetColumnWidth + layout.gapAfterOffset,
    });
  }, []);

  /** The held pointer's place on screen, which the autoscroll steps read. */
  const dragPointerRef = useRef<{ readonly x: number; readonly y: number } | undefined>(undefined);
  /** @upstream ByteRipperApp/Hex/HexView.swift#HexView.autoscrollTimer */
  const autoscrollRef = useRef<number | undefined>(undefined);

  /** @upstream ByteRipperApp/Hex/HexView.swift#HexView.stopDragAutoscroll */
  const stopAutoscroll = useCallback(() => {
    if (autoscrollRef.current !== undefined) window.clearInterval(autoscrollRef.current);
    autoscrollRef.current = undefined;
  }, []);

  // A pane that goes away mid-drag takes its timer with it.
  useEffect(() => stopAutoscroll, [stopAutoscroll]);

  /**
   * One step of a drag at a pointer on screen: the pane scrolls toward a pointer
   * past its edge, and the selection — or the mark being moved — goes on at the
   * visible edge. Returns whether the pane can keep scrolling toward it, asked of
   * where the pane is *after* the step: the pointer stays put on screen while the
   * content scrolls past it, so the overshoot holds.
   *
   * @upstream ByteRipperApp/Hex/HexView.swift#HexView.performDragAutoscrollTick
   * @upstream ByteRipperApp/Hex/HexView.swift#HexView.extendDragSelection
   * @upstream ByteRipperApp/Hex/HexView.swift#HexView.moveDraggedBookmark
   */
  const dragTo = useCallback(
    (clientX: number, clientY: number): boolean => {
      const layout = layoutRef.current;
      const host = scrollRef.current;
      const scroller = scrollerRef.current;
      const dragging = markDragRef.current;
      const anchor = dragAnchorRef.current;
      if (layout === undefined || host === null || scroller === null) return false;
      if (dragging === undefined && anchor === undefined) return false;

      const bounds = host.getBoundingClientRect();
      const pointerY = clientY - bounds.top;
      const before = {
        top: scroller.top,
        viewportHeight: scroller.viewportHeight,
        maxTop: scroller.maxTop,
      };
      const step = dragAutoscrollStep(pointerY, before);
      if (step.top !== scroller.top) scrollPaneTo(step.top);
      const y = step.pointerY + scroller.top;

      if (dragging !== undefined) {
        // A step happens when the pointer CROSSES into another row, and only
        // then: the mark follows the crossing rather than the row the pointer
        // is over, so a mark that has just jumped over another stays jumped
        // (§20.6). And a crossing counts only once the pointer is a couple of
        // points inside the new row, so a hand resting on a boundary does not
        // step the mark to and fro.
        const from = markDragPointerRowRef.current ?? rowContaining(dragging);
        const row = pointerRow(y, from, layout.rowHeight);
        if (row !== from) {
          markDragPointerRowRef.current = row;
          // The last row this pane draws is the limit, not a size held
          // elsewhere: a mark may not be dragged out of the file.
          const lastRow = rowContaining(Math.max(0, doc.size - 1));
          const target = row * BYTES_PER_ROW;
          const landed = moveBookmark(dragging, Math.min(target, lastRow), lastRow);
          if (landed !== undefined) markDragRef.current = landed;
        }
      } else if (anchor !== undefined) {
        const x = clientX - bounds.left + host.scrollLeft;
        const end = layout.dragEndOffset(x, y, layout.rowCount(doc.size));
        if (end !== undefined) {
          doc.setSelection(makeSelection(anchor, Math.min(end, doc.size), doc.size));
        }
      }

      const after = { ...before, top: scroller.top };
      return isBeyondVisibleEdge(pointerY, after) && canAutoscrollToward(pointerY, after);
    },
    [doc, scrollPaneTo]
  );

  /**
   * @upstream ByteRipperApp/Hex/HexView.swift#HexView.mouseDragged
   * @upstream ByteRipperApp/Hex/HexView.swift#HexView.onBookmarkDrag
   * @upstream ByteRipperApp/Hex/HexView.swift#HexView.lastDragPoint
   * @upstream ByteRipperApp/Hex/HexView.swift#HexView.updateDragAutoscrollTimer
   */
  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      trackMarkTip(event);
      if (markDragRef.current === undefined && dragAnchorRef.current === undefined) return;
      dragPointerRef.current = { x: event.clientX, y: event.clientY };
      if (!dragTo(event.clientX, event.clientY)) {
        stopAutoscroll();
        return;
      }
      // Past the edge with room to go: the steps go on while the pointer is held
      // still, which is when no further move event will come to drive them.
      if (autoscrollRef.current !== undefined) return;
      autoscrollRef.current = window.setInterval(() => {
        const pointer = dragPointerRef.current;
        if (pointer === undefined || !dragTo(pointer.x, pointer.y)) stopAutoscroll();
      }, AUTOSCROLL_INTERVAL_MS);
    },
    [trackMarkTip, dragTo, stopAutoscroll]
  );

  /**
   * A double-click on an address opens the bookmark popover on that row
   * (§20.3): it marks and names a bare row, and edits the mark already there.
   *
   * The mouse gesture for what ⌘D does, on the one column where a double-click
   * has nothing else to mean — in the bytes it selects a word.
   *
   * @upstream ByteRipperApp/Hex/HexView.swift#HexView.onOffsetDoubleClick
   * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.onOffsetDoubleClick
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.handleOffsetDoubleClick
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.wireBookmarkDoubleClick
   */
  const onDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const layout = layoutRef.current;
      const host = scrollRef.current;
      if (layout === undefined || host === null) return;
      const bounds = host.getBoundingClientRect();
      const hit = layout.hitTest(
        event.clientX - bounds.left + host.scrollLeft,
        event.clientY - bounds.top + (scrollerRef.current?.top ?? 0),
        layout.rowCount(doc.size)
      );
      if (hit === undefined || hit.column.kind !== "offset") return;
      event.preventDefault();
      handleOffsetDoubleClick(paneId, layout.byteOffset(hit.row, 0));
    },
    [doc, paneId]
  );

  /**
   * A right-click on a byte or on its address.
   *
   * The caret moves to the byte the menu will act on, exactly as a left-click
   * would place it — unless the click landed *inside* the selection, because
   * placing the caret would clear it and the menu's selection-scoped commands
   * (Copy, Fill Selection…, Delete Bytes…) are about that selection.
   *
   * @upstream ByteRipperApp/Hex/HexView.swift#HexView.rightMouseDown
   * @upstream ByteRipperApp/Hex/HexView.swift#HexView.placeContextMenuCaret
   * @upstream ByteRipperApp/Hex/HexView.swift#HexView.rightClickedOffset
   * @upstream ByteRipperApp/Hex/HexView.swift#HexView.contextMenuOffset
   * @upstream ByteRipperApp/Hex/HexView.swift#HexView.contextMenuAnchor
   * @upstream ByteRipperApp/Hex/HexView.swift#HexView.ContextMenuAnchor
   * @upstream ByteRipperApp/Hex/HexView.swift#HexView.ContextMenuAnchor.offset
   */
  const onContextMenu = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const layout = layoutRef.current;
      const host = scrollRef.current;
      if (layout === undefined || host === null || onDumpMenu === undefined) return;
      const bounds = host.getBoundingClientRect();
      const hit = layout.hitTest(
        event.clientX - bounds.left + host.scrollLeft,
        event.clientY - bounds.top + (scrollerRef.current?.top ?? 0),
        layout.rowCount(doc.size)
      );
      if (hit === undefined) return;
      const column = hit.column.kind === "offset" ? 0 : hit.column.column;
      const offset = Math.min(layout.byteOffset(hit.row, column), doc.size);

      const selection = doc.selection;
      const inSelection =
        selection.end > selection.start && offset >= selection.start && offset < selection.end;
      if (!inSelection) doc.setSelection(caretAt(offset, doc.size));
      onDumpMenu(event, offset);
    },
    [doc, onDumpMenu]
  );

  /** @upstream ByteRipperApp/Hex/HexView.swift#HexView.mouseUp */
  const endDrag = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      dragAnchorRef.current = undefined;
      markDragRef.current = undefined;
      markDragPointerRowRef.current = undefined;
      dragPointerRef.current = undefined;
      stopAutoscroll();
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    [stopAutoscroll]
  );

  return (
    // Clicking anywhere in a pane makes it the active one — that is the whole
    // gesture. The keyboard route is the grid's own focus, which fires the same
    // handler through onFocusCapture.
    <div
      className="hex-pane"
      data-active={isActive ? "" : undefined}
      onPointerDownCapture={onActivate}
      onFocusCapture={onActivate}
    >
      {/*
        The two join bands (§22.4): a file dropped at the top goes in before
        what the pane holds, one dropped at the bottom after it. Only while
        something is actually being dragged, and only when the pane has content
        for a join to be relative to.
      */}
      {dragActive === true && onJoinDrop !== undefined ? (
        <>
          {/* biome-ignore lint/a11y/noStaticElementInteractions: see above. */}
          <div
            className="join-band is-start"
            data-over={overBand === "start" ? "" : undefined}
            onDragOver={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setOverBand("start");
            }}
            onDragLeave={() => setOverBand(undefined)}
            onDrop={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setOverBand(undefined);
              onJoinDrop(event, "start");
            }}
          >
            Insert at the start
          </div>
          {/* biome-ignore lint/a11y/noStaticElementInteractions: see above. */}
          <div
            className="join-band is-end"
            data-over={overBand === "end" ? "" : undefined}
            onDragOver={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setOverBand("end");
            }}
            onDragLeave={() => setOverBand(undefined)}
            onDrop={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setOverBand(undefined);
              onJoinDrop(event, "end");
            }}
          >
            Append at the end
          </div>
        </>
      ) : null}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: a context menu is
          not interactivity of its own — the keyboard reaches the same commands
          through the toolbar's menu, and the dump below answers Shift+F10. */}
      <header
        className="pane-header"
        onContextMenu={onHeaderMenu === undefined ? undefined : (event) => onHeaderMenu(event)}
      >
        <DocumentIcon slot={label} dirty={dirty} untitled={saved === undefined} />
        {renaming === true ? (
          <RenameField
            name={name}
            onEnd={(typed, commit) => {
              onRenameEnd?.(typed, commit);
              // The dump takes the keyboard back, the way it has it everywhere
              // else: a field that vanished must not leave nothing focused.
              scrollRef.current?.focus();
            }}
          />
        ) : (
          <span className="pane-name" title={name}>
            {name}
          </span>
        )}
        <CloseButton label={`Close ${label}`} onClick={onClose} />
      </header>
      {/*
        The scroller is a real scrolling element with a spacer inside it, so the
        browser's own scrollbar, wheel handling, trackpad momentum and
        scroll-anchoring all work — none of which is worth reimplementing. The
        canvas sits on top of it, pinned to the viewport and painted for the
        current offset.

        It takes the focus, because the bytes are pixels and there is no
        interactive element inside to put it on. Its role is `application` and
        not `grid`: a grid role promises rows and cells a screen reader can walk
        into, and there are none. What is true is that this is a custom widget
        with a keyboard model of its own, which is what `application` says — and
        the caret readout below carries the state as a live region. The full
        accessible description of the caret and the document is M12's work.
      */}
      <canvas ref={headerRef} className="hex-header" />
      <div
        ref={scrollRef}
        className="hex-scroller"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the app's keyboard surface
        tabIndex={0}
        role="application"
        aria-label="Hex dump"
        aria-describedby={readoutId}
        onScroll={onScroll}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onCopy={onCopy}
        onPaste={onPaste}
        onContextMenu={onContextMenu}
        onDoubleClick={onDoubleClick}
        onPointerLeave={() => setMarkTip(undefined)}
      >
        <canvas ref={canvasRef} className="hex-canvas" />
        {markTip === undefined ? null : (
          <p className="bookmark-tip" style={{ top: markTip.top, left: markTip.left }}>
            {markTip.name}
          </p>
        )}
        {editingHere !== undefined && editAnchor?.token === editingHere.token ? (
          <BookmarkEditPopover
            key={editingHere.token}
            session={editingHere}
            top={editAnchor.top}
            left={editAnchor.left}
            above={editAnchor.above}
            onCommitted={onBookmarkCommitted}
            onKeyboardClose={focusDump}
          />
        ) : null}
        {/* Its height is PaneScroller's to set: the content's own when that
            fits, the browser's layout limit when it does not. */}
        <div ref={spacerRef} className="hex-spacer" style={{ width: `${contentWidth}px` }} />
      </div>
      {resultsShown === true && onGoToMatch !== undefined ? (
        <SearchResults
          pane={paneId}
          matches={matches}
          status={searchStatus ?? "idle"}
          document={doc}
          current={currentMatch}
          onGo={onGoToMatch}
        />
      ) : null}
      <p className="hex-caret-readout" id={readoutId} aria-live="polite">
        <span>Offset {caret.toString(16).toUpperCase().padStart(8, "0")}</span>
        <span>{doc.size.toLocaleString()} bytes</span>
        <span className="readout-mode" data-insert={mode === "INS" ? "" : undefined}>
          {mode}
        </span>
        <span className="readout-region">{region === "hex" ? "Hex" : "Text"}</span>
        {dirty ? <span className="readout-dirty">Unsaved</span> : null}
        <OperationStrip pane={paneId} />
      </p>
    </div>
  );
}

/**
 * Calls back whenever the device pixel ratio changes.
 *
 * Which is what a page zoom is, as far as a canvas is concerned: the element
 * keeps its size in CSS pixels and the backing store needs more of them. There
 * is no event for it, so this watches a media query pinned to the current ratio
 * and re-pins it each time — the query stops matching the moment the ratio
 * moves.
 *
 * Without it the browser's zoom — now the only zoom there is — would leave the
 * dump drawn at the old scale and blurred up to the new one.
 */
function observeDevicePixelRatio(onChange: () => void): () => void {
  let query: MediaQueryList | undefined;
  let stopped = false;

  const listen = () => {
    if (stopped) return;
    query = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    query.addEventListener("change", handle, { once: true });
  };
  const handle = () => {
    onChange();
    listen();
  };

  listen();
  return () => {
    stopped = true;
    query?.removeEventListener("change", handle);
  };
}
