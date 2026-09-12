import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Segment } from "@/core/segments/segmentation";
import {
  BYTES_PER_ROW,
  derivedTopRow,
  type MinimapMode,
  overviewRowCount,
  scrollTargetForBand,
  snappedOffsetAtY,
  viewportBand,
  visibleRowCount,
  wheelScrollTarget,
  yOfOffset,
} from "@/render/minimap/minimapGeometry";
import {
  type CellState,
  type MinimapColors,
  MinimapRenderer,
  SEGMENT_STRIP,
} from "@/render/minimap/minimapRenderer";
import { bookmarksStore } from "@/state/bookmarksStore";
import { diffStore } from "@/state/diffStore";
import {
  DEFAULT_MINIMAP_WIDTH,
  MAX_MINIMAP_WIDTH,
  MIN_MINIMAP_WIDTH,
  minimapStore,
  overviewWorthShowing,
  setMinimapMode,
  setMinimapRows,
  setMinimapWidth,
} from "@/state/minimapStore";
import { segmentsStore } from "@/state/segmentsStore";
import { useStore } from "@/state/useStore";
import { PANE_IDS, type PaneId, workspaceStore } from "@/state/workspaceStore";
import { scrollLink } from "@/ui/pane/scrollLink";
import { pieceMenu, selectPiece } from "@/ui/segments/segmentMenu";
import { openContextMenu } from "@/ui/shell/ContextMenu";
import { observeHexColors, readSegmentTints } from "@/ui/theme/hexColors";
import { readMinimapColors } from "@/ui/theme/minimapColors";

/**
 * The minimap panel: one map per open file, side by side, on one shared scale.
 *
 * The maps mirror the panes' arrangement, and both are binned over the longer
 * file — so a height on one map is the same absolute offset on the other, which
 * is the only reason two of them next to each other tell you anything.
 */

export interface MinimapPanelProps {
  /** What each pane has selected, drawn as a strip on its map. */
  readonly selections: Partial<Record<PaneId, { readonly start: number; readonly end: number }>>;
  /** Makes a pane the active one, as clicking its dump does. */
  readonly onActivate: (pane: PaneId) => void;
  /** The maps mirror the panes' arrangement. */
  readonly stacked: boolean;
}

export function MinimapPanel({ selections, onActivate, stacked }: MinimapPanelProps) {
  const state = useStore(minimapStore);
  const workspace = useStore(workspaceStore);
  const viewports = usePaneViewports();
  const open = PANE_IDS.filter((id) => workspace.panes[id] !== undefined);
  const panelRef = useRef<HTMLElement | null>(null);
  const chrome = usePaneChrome(panelRef, open.length);

  if (!state.visible || open.length === 0) return null;

  return (
    <aside
      className={`minimap${stacked ? " is-stacked" : ""}`}
      aria-label="Minimap"
      ref={panelRef}
      style={{ width: state.width }}
    >
      <MinimapSplitter width={state.width} />
      {/*
        The switch strip stands in for the pane's header: same height, same
        surface, same rule under it. Below it the minimap leaves the column
        header's band blank — it has no columns to name — so the maps still
        begin on the line the bytes do. A map that started higher than the dump
        it stands for would put every offset a few rows out.
      */}
      <MinimapModes offsetTop={chrome.offsetTop} height={chrome.headerHeight} />
      <div className="minimap-maps" style={{ paddingTop: chrome.gapBelowHeader }}>
        {open.map((pane) => (
          <MinimapCanvas
            key={pane}
            pane={pane}
            mode={state.mode}
            selection={selections[pane]}
            viewport={viewports[pane]}
            stacked={stacked}
            onActivate={onActivate}
          />
        ))}
        {/*
         * Side by side, the band is one element across the whole panel rather
         * than a rectangle inside each canvas. The panes are locked to the same
         * offsets, so what it says is true of both maps at once — and drawn per
         * canvas it broke at every seam, which read as two separate claims
         * about two separate files. Stacked, each map keeps its own.
         */}
        {stacked ? null : <SharedBand mode={state.mode} viewport={viewports[open[0] ?? "a"]} />}
      </div>
    </aside>
  );
}

/**
 * Where the pane's chrome sits, measured off the page.
 *
 * Three numbers, because the minimap has to line up with two different things
 * at once: its switch strip stands in for the pane's header and must match it,
 * and its maps stand in for the dump and must start where the dump does. The
 * band between the two is the dump's column header, which the minimap has no
 * counterpart for and simply leaves blank.
 *
 * Measured rather than assumed: the pane header's height comes from its own
 * padding and font, and the column header's from the hex font's metrics, so a
 * constant here would be right until one of them moved.
 */
interface PaneChrome {
  /** The pane's transparent top border, which the minimap has to clear too. */
  readonly offsetTop: number;
  readonly headerHeight: number;
  /** What is left between the header and the dump: the column header. */
  readonly gapBelowHeader: number;
}

const NO_CHROME: PaneChrome = { offsetTop: 0, headerHeight: 0, gapBelowHeader: 0 };

function usePaneChrome(
  panelRef: React.RefObject<HTMLElement | null>,
  openPanes: number
): PaneChrome {
  const [chrome, setChrome] = useState<PaneChrome>(NO_CHROME);

  useLayoutEffect(() => {
    // No panes, nothing to line up with.
    if (openPanes === 0) {
      setChrome(NO_CHROME);
      return;
    }

    const measure = () => {
      const panel = panelRef.current;
      const header = document.querySelector(".pane-header");
      const scroller = document.querySelector(".hex-scroller");
      if (panel === null || header === null || scroller === null) return;

      const panelTop = panel.getBoundingClientRect().top;
      const headerBox = header.getBoundingClientRect();
      const next: PaneChrome = {
        offsetTop: Math.max(0, headerBox.top - panelTop),
        headerHeight: headerBox.height,
        gapBelowHeader: Math.max(0, scroller.getBoundingClientRect().top - headerBox.bottom),
      };
      setChrome((previous) =>
        Math.abs(previous.offsetTop - next.offsetTop) < 0.5 &&
        Math.abs(previous.headerHeight - next.headerHeight) < 0.5 &&
        Math.abs(previous.gapBelowHeader - next.gapBelowHeader) < 0.5
          ? previous
          : next
      );
    };

    measure();
    const observer = new ResizeObserver(measure);
    for (const element of [
      panelRef.current,
      document.querySelector(".pane-header"),
      document.querySelector(".hex-scroller"),
    ]) {
      if (element !== null) observer.observe(element);
    }
    return () => observer.disconnect();
    // Re-bound when a pane opens or closes, and not otherwise: this component
    // re-renders on every scroll, and rebuilding the observer each time would
    // be a teardown and a measurement per frame of a drag.
  }, [panelRef, openPanes]);

  return chrome;
}

/**
 * The handle on the panel's leading edge.
 *
 * Dragging leftward widens the panel, which is the opposite of the pane divider
 * next door — the panel is anchored to the window's right edge, so its width is
 * the distance from the pointer to that edge. Keyboard-reachable for the same
 * reason the pane divider is: a layout only a pointer can change is a layout
 * some people cannot change.
 */
function MinimapSplitter({ width }: { readonly width: number }) {
  const dragging = useRef(false);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }, []);

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    const panel = event.currentTarget.parentElement;
    if (panel === null) return;
    setMinimapWidth(panel.getBoundingClientRect().right - event.clientX);
  }, []);

  const endDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const step = event.shiftKey ? 24 : 8;
      if (event.key === "ArrowLeft") setMinimapWidth(width + step);
      else if (event.key === "ArrowRight") setMinimapWidth(width - step);
      else if (event.key === "Home" || event.key === "Enter") {
        setMinimapWidth(DEFAULT_MINIMAP_WIDTH);
      } else return;
      event.preventDefault();
    },
    [width]
  );

  return (
    // biome-ignore lint/a11y/useSemanticElements: an <hr> cannot be dragged
    <div
      className="minimap-splitter"
      role="separator"
      tabIndex={0}
      aria-label="Resize the minimap"
      aria-orientation="vertical"
      aria-valuenow={width}
      aria-valuemin={MIN_MINIMAP_WIDTH}
      aria-valuemax={MAX_MINIMAP_WIDTH}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={() => setMinimapWidth(DEFAULT_MINIMAP_WIDTH)}
      onKeyDown={onKeyDown}
    />
  );
}

/** The one band the side-by-side layout draws, edge to edge and over the gap. */
function SharedBand({
  mode,
  viewport,
}: {
  readonly mode: MinimapMode;
  readonly viewport: { readonly start: number; readonly end: number } | undefined;
}) {
  const state = useStore(minimapStore);
  const workspace = useStore(workspaceStore);
  const [height, setHeight] = useState(0);
  const ref = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) setHeight(entry.contentRect.height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const sizes = PANE_IDS.map((id) => workspace.panes[id]?.document.size ?? 0).filter((s) => s > 0);
  const band = viewportBand({
    mode,
    viewport,
    areaHeight: height,
    topRow: derivedTopRow({ mode, sizes, windowRows: visibleRowCount(height), viewport }),
    extent: state.extent,
    overviewRows: state.pictures.a?.rowCount ?? state.pictures.b?.rowCount ?? 0,
    minHeight: MIN_BAND_HEIGHT,
  });

  return (
    <div className="minimap-band-layer" ref={ref} aria-hidden="true">
      {band === undefined ? null : (
        <div className="minimap-band" style={{ top: band.top, height: band.height }} />
      )}
    </div>
  );
}

/**
 * Where the panes are, as the link reports it.
 *
 * Re-read on every scroll — including the mirrored ones, which is why this
 * listens to the link rather than to one pane.
 */
function usePaneViewports(): Partial<Record<PaneId, { start: number; end: number }>> {
  const [viewports, setViewports] = useState<
    Partial<Record<PaneId, { start: number; end: number }>>
  >({});

  useEffect(() => {
    const read = () => {
      const next: Partial<Record<PaneId, { start: number; end: number }>> = {};
      for (const id of PANE_IDS) {
        const range = scrollLink.visibleRange(id, BYTES_PER_ROW);
        if (range !== undefined) next[id] = range;
      }
      setViewports((previous) =>
        PANE_IDS.every(
          (id) => previous[id]?.start === next[id]?.start && previous[id]?.end === next[id]?.end
        )
          ? previous
          : next
      );
    };
    read();
    return scrollLink.onChange(read);
  }, []);

  return viewports;
}

/** The mode switch and the build's progress. */
function MinimapModes({
  offsetTop,
  height,
}: {
  readonly offsetTop: number;
  readonly height: number;
}) {
  const state = useStore(minimapStore);
  const overviewUseful = overviewWorthShowing();

  return (
    <div className="minimap-head" style={height > 0 ? { height, marginTop: offsetTop } : undefined}>
      <fieldset className="minimap-modes">
        <legend className="visually-hidden">Minimap mode</legend>
        {(["detail", "overview"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            className={`minimap-mode${state.mode === mode ? " is-on" : ""}`}
            aria-pressed={state.mode === mode}
            disabled={mode === "overview" && !overviewUseful}
            title={
              mode === "overview" && !overviewUseful
                ? "This file is small enough that the overview would magnify it rather than compress it."
                : mode === "detail"
                  ? "One cell per byte, around where the panes are"
                  : "The whole file at once, shaded by content"
            }
            onClick={() => setMinimapMode(mode)}
          >
            {mode === "detail" ? "Detail" : "Overview"}
          </button>
        ))}
      </fieldset>
      {state.status === "building" && (
        <progress
          className="minimap-progress"
          value={state.progress}
          max={1}
          aria-label="Building the overview"
        />
      )}
    </div>
  );
}

interface CanvasProps {
  readonly pane: PaneId;
  readonly mode: MinimapMode;
  readonly selection: { readonly start: number; readonly end: number } | undefined;
  readonly viewport: { readonly start: number; readonly end: number } | undefined;
  /** Stacked, each map carries its own band; side by side they share one. */
  readonly stacked: boolean;
  readonly onActivate: (pane: PaneId) => void;
}

/**
 * The floor on the viewport band's height, in CSS pixels.
 *
 * The band is a handle before it is an indication: a viewport that is a sliver
 * of a 16 MB file would otherwise be too thin to put a pointer on.
 */
const MIN_BAND_HEIGHT = 6;

function MinimapCanvas({ pane, mode, selection, viewport, stacked, onActivate }: CanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<MinimapRenderer | null>(null);
  const state = useStore(minimapStore);
  const workspace = useStore(workspaceStore);
  const differences = useStore(diffStore).index;
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [cells, setCells] = useState<CellState[]>([]);
  const slot = workspace.panes[pane];

  // The colours are read from the theme rather than hard-coded, and re-read
  // when it changes — the same contract the hex grid's palette has.
  const [colors, setColors] = useState<MinimapColors | undefined>(undefined);
  useEffect(() => {
    const refresh = () => setColors(readMinimapColors());
    refresh();
    return observeHexColors(refresh);
  }, []);

  // The panel's height decides the binning, so the store has to know it.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry === undefined) return;
      const box = entry.contentRect;
      setSize({ width: box.width, height: box.height });
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (size.height <= 0) return;
    setMinimapRows(overviewRowCount(size.height, window.devicePixelRatio));
  }, [size.height]);

  const sizes = PANE_IDS.map((id) => workspace.panes[id]?.document.size ?? 0).filter((s) => s > 0);
  const windowRows = visibleRowCount(size.height);
  const topRow = derivedTopRow({ mode, sizes, windowRows, viewport });

  // Detail mode pulls the bytes of its window on each change rather than
  // holding a picture: it is a couple of thousand bytes, and holding them would
  // mean invalidating them.
  useEffect(() => {
    if (mode !== "detail" || slot === undefined || windowRows <= 0) {
      setCells([]);
      return;
    }
    let cancelled = false;
    const start = topRow * 16;
    const length = Math.min(windowRows * 16, Math.max(0, slot.document.size - start));
    if (length <= 0) {
      setCells([]);
      return;
    }

    void (async () => {
      const bytes = await slot.document.read(start, length);
      const saved =
        slot.saved === undefined
          ? undefined
          : await slot.saved
              .read(start, Math.min(length, Math.max(0, slot.saved.size - start)))
              .catch(() => undefined);
      if (cancelled) return;

      // The comparison's own answer for this window, read once rather than
      // asked per byte: `stateAt` is a binary search, and a window is a couple
      // of thousand bytes.
      const differing = new Uint8Array(bytes.length);
      for (const block of differences?.blocksIn(start, start + bytes.length) ?? []) {
        if (block.kind !== "different") continue;
        const from = Math.max(0, block.start - start);
        const to = Math.min(bytes.length, block.end - start);
        for (let i = from; i < to; i++) differing[i] = 1;
      }

      const next: CellState[] = [];
      for (let i = 0; i < bytes.length; i++) {
        const byte = bytes[i] ?? 0;
        next.push({
          significant: byte !== 0x00 && byte !== 0xff,
          // The M4 rule, unchanged: a byte is modified when it differs from the
          // saved file, not when it came from the edit buffer.
          modified: saved !== undefined && i < saved.length && saved[i] !== byte,
          different: differing[i] === 1,
        });
      }
      setCells(next);
    })();

    return () => {
      cancelled = true;
    };
  }, [mode, slot, topRow, windowRows, differences]);

  const marks = useStore(bookmarksStore).bookmarks;
  /** The piece the pointer is over, so the strip can say which it would act on. */
  const [hoveredPiece, setHoveredPiece] = useState<number | undefined>(undefined);

  /** The band as it is currently drawn, which is also the drag handle. */
  const band = viewportBand({
    mode,
    viewport,
    areaHeight: size.height,
    topRow,
    extent: state.extent,
    overviewRows: state.pictures[pane]?.rowCount ?? 0,
    minHeight: MIN_BAND_HEIGHT,
  });

  /**
   * Where each bookmarked row falls on this map.
   *
   * The same mapping the selection strip uses, so a mark and the bytes it
   * marks are at the same height. A row outside the map is dropped here rather
   * than clamped: a mark pinned to the top edge would claim a position the file
   * does not have there.
   */
  const markYs = (() => {
    if (marks.length === 0) return undefined;
    const shared = { mode, areaHeight: size.height, topRow, extent: state.extent };
    const ys: number[] = [];
    for (const mark of marks) {
      const y = yOfOffset({ ...shared, offset: mark.row });
      if (y >= 0 && y <= size.height) ys.push(y);
    }
    return ys;
  })();

  /**
   * The pieces, as bands down the strip beside the map.
   *
   * The same mapping the selection strip uses, so a boundary on the strip is a
   * boundary in the dump. A file that has not been cut gets no bands: one band
   * the length of the map would say nothing.
   */
  const pieces = useStore(segmentsStore).panes[pane]?.partition.segments ?? [];
  const segmentBands = (() => {
    if (pieces.length < 2) return undefined;
    const tints = readSegmentTints();
    const shared = { mode, areaHeight: size.height, topRow, extent: state.extent };
    return pieces.map((piece) => {
      const top = Math.max(0, yOfOffset({ ...shared, offset: piece.start }));
      const bottom = Math.min(size.height, yOfOffset({ ...shared, offset: piece.end }));
      return {
        top,
        height: bottom - top,
        tint: tints[piece.index % tints.length] ?? "",
        hovered: hoveredPiece === piece.index,
      };
    });
  })();

  /**
   * The panes' own selection, as a strip across the map.
   *
   * A caret is not a selection and draws nothing: a single byte highlighted
   * across the full width of a whole-file overview would claim far more of the
   * file than the user picked.
   */
  const selectionStrip = (() => {
    if (selection === undefined || selection.end <= selection.start) return undefined;
    const shared = { mode, areaHeight: size.height, topRow, extent: state.extent };
    const top = Math.max(0, yOfOffset({ ...shared, offset: selection.start }));
    const bottom = Math.min(size.height, yOfOffset({ ...shared, offset: selection.end }));
    if (bottom <= 0 || top >= size.height) return undefined;
    // Given the same floor a difference mark gets, for the same reason: a
    // selection of a few bytes in a 16 MB file is thinner than a pixel.
    return { top, height: Math.max(bottom - top, MIN_BAND_HEIGHT) };
  })();

  // The draw itself.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || colors === undefined || size.width <= 0 || size.height <= 0) return;
    if (rendererRef.current === null) rendererRef.current = new MinimapRenderer(canvas, colors);
    const renderer = rendererRef.current;
    renderer.setColors(colors);
    renderer.resize(size.width, size.height, window.devicePixelRatio);

    renderer.draw({
      mode,
      cells,
      picture: state.pictures[pane],
      selection: selectionStrip,
      bookmarks: markYs,
      segments: segmentBands,
    });
  }, [colors, size, state.pictures, pane, mode, cells, selectionStrip, markYs, segmentBands]);

  const offsetFromEvent = useCallback(
    (event: { clientY: number }): number | undefined => {
      const canvas = canvasRef.current;
      if (canvas === null || slot === undefined) return undefined;
      const box = canvas.getBoundingClientRect();
      return snappedOffsetAtY({
        mode,
        y: event.clientY - box.top,
        areaHeight: box.height,
        topRow,
        extent: state.extent,
        overviewRows: state.pictures[pane]?.rowCount ?? 0,
        fileSize: slot.document.size,
      });
    },
    [mode, topRow, state.extent, state.pictures, pane, slot]
  );

  /**
   * Where in the band the drag took hold, or `undefined` when no drag is on.
   *
   * Dragging the band is a scrollbar gesture: the grab offset is kept so the
   * band stays under the point of the pointer that picked it up, rather than
   * jumping its middle to the cursor.
   */
  const grab = useRef<{ offset: number; height: number } | undefined>(undefined);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (event.button !== 0) return;
      const canvas = event.currentTarget;
      // Capture keeps a drag steering the map after the pointer leaves it,
      // which is most of what makes the band usable. Failing to get it is not
      // a reason to refuse the drag — it just stops at the canvas edge.
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {
        // No active pointer with that id; carry on without capture.
      }
      onActivate(pane);

      const y = event.clientY - canvas.getBoundingClientRect().top;
      if (band !== undefined && y >= band.top && y <= band.top + band.height) {
        // On the band: this press is the start of a scroll, so it must not also
        // be read as a "take me here" jump.
        grab.current = { offset: y - band.top, height: band.height };
        return;
      }

      // Off the band: the click means the byte drawn under it, so the pane
      // centres on it — and the drag then continues from the band's middle, so
      // the press can still turn into a scroll.
      const offset = offsetFromEvent(event);
      if (offset !== undefined) {
        scrollLink.scrollToOffset(pane, offset, BYTES_PER_ROW, { centre: true });
      }
      const height = band?.height ?? MIN_BAND_HEIGHT;
      grab.current = { offset: height / 2, height };
    },
    [band, offsetFromEvent, onActivate, pane]
  );

  /**
   * The piece the pointer is over in the strip, or nothing when it is not in
   * the strip at all.
   */
  const pieceUnder = useCallback(
    (event: { clientX: number; clientY: number }): Segment | undefined => {
      const canvas = canvasRef.current;
      if (canvas === null || segmentBands === undefined) return undefined;
      const box = canvas.getBoundingClientRect();
      if (event.clientX < box.right - SEGMENT_STRIP) return undefined;
      const y = event.clientY - box.top;
      const at = segmentBands.findIndex((band) => y >= band.top && y < band.top + band.height);
      return at < 0 ? undefined : pieces[at];
    },
    [segmentBands, pieces]
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      setHoveredPiece(pieceUnder(event)?.index);
      const held = grab.current;
      if (held === undefined) return;
      const canvas = event.currentTarget;
      const y = event.clientY - canvas.getBoundingClientRect().top;
      // A scrollbar gesture, and deliberately unsnapped: a continuous drag that
      // jumped to a file edge would fight the hand holding it.
      const target = scrollTargetForBand({
        mode,
        bandTop: y - held.offset,
        bandHeight: held.height,
        areaHeight: size.height,
        sizes,
        ...(viewport === undefined
          ? {}
          : { paneRows: Math.max(1, Math.ceil((viewport.end - viewport.start) / BYTES_PER_ROW)) }),
      });
      if (target !== undefined) scrollLink.scrollToOffset(pane, target, BYTES_PER_ROW);
    },
    [mode, size.height, sizes, viewport, pane, pieceUnder]
  );

  const endDrag = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    grab.current = undefined;
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Nothing to release.
    }
  }, []);

  const onWheel = useCallback(
    (event: React.WheelEvent<HTMLCanvasElement>) => {
      const target = wheelScrollTarget({ deltaY: event.deltaY, viewport, sizes });
      if (target !== undefined) scrollLink.scrollToOffset(pane, target, BYTES_PER_ROW);
    },
    [viewport, sizes, pane]
  );

  const label =
    slot === undefined
      ? "Minimap"
      : `Minimap of ${slot.name}, ${mode === "detail" ? "detail" : "overview"}`;

  return (
    <div className="minimap-map">
      <canvas
        ref={canvasRef}
        className="minimap-canvas"
        aria-label={label}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={() => setHoveredPiece(undefined)}
        onWheel={onWheel}
        onContextMenu={(event) => {
          // The strip's own menu, and nothing anywhere else on the map: the map
          // has no other context menu, and a browser's own is better than an
          // empty one.
          const piece = pieceUnder(event);
          if (piece === undefined) return;
          openContextMenu(
            event,
            pieceMenu({
              pane,
              piece,
              pieceCount: pieces.length,
              onReveal: (chosen) => {
                selectPiece(pane, chosen);
                scrollLink.scrollToOffset(pane, chosen.start, BYTES_PER_ROW);
              },
            })
          );
        }}
      />
      {stacked && band !== undefined ? (
        <div className="minimap-band" style={{ top: band.top, height: band.height }} />
      ) : null}
    </div>
  );
}
