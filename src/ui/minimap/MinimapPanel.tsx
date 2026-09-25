import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  baselineReferenceAt,
  type BaselineSpan,
  type ModifiedBaseline,
} from "@/core/segments/baseline";
import type { Segment } from "@/core/segments/segmentation";
import { hexAddress } from "@/core/text/hexText";
import {
  type MapMark,
  nearestBookmarkMark,
  segmentStripClick,
  type ZoneBracketBox,
  zoneBracket,
  zoneBracketClick,
} from "@/render/minimap/minimapClick";
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
  type MapPlacement,
  MinimapLayout,
  SIDE_BY_SIDE_GUTTER_FRACTION,
  ZONE_MAX_LANES,
} from "@/render/minimap/minimapLayout";
import {
  type CellState,
  type MinimapColors,
  MinimapRenderer,
  type ZoneBracket,
} from "@/render/minimap/minimapRenderer";
import { overviewBandFloor } from "@/render/minimap/viewportMarker";
import { bookmarksIn, bookmarksStore } from "@/state/bookmarksStore";
import { diffStore } from "@/state/diffStore";
import {
  DEFAULT_MINIMAP_WIDTH,
  MAX_MINIMAP_WIDTH,
  MIN_MINIMAP_WIDTH,
  mapOn,
  minimapStore,
  overviewWorthShowing,
  setMinimapMode,
  setMinimapRows,
  setMinimapWidth,
} from "@/state/minimapStore";
import { segmentsStore } from "@/state/segmentsStore";
import { baselineFor } from "@/state/segmentSources";
import { zoneSelected } from "@/state/toolController";
import { useStore } from "@/state/useStore";
import {
  isSlot,
  PANE_IDS,
  type PaneId,
  paneIn,
  paneState,
  type SlotId,
  type SurfaceId,
  surfaceOf,
  WORKSPACE_SURFACE,
  workspaceStore,
} from "@/state/workspaceStore";
import { zoneStore, zonesFor } from "@/state/zoneStore";
import { EMPTY_ZONES, type Zone } from "@/tools/zone";
import { ViewportMarks } from "@/ui/minimap/ViewportMarks";
import { scrollLink } from "@/ui/pane/scrollLink";
import { pieceMenu, selectPiece } from "@/ui/segments/segmentMenu";
import { openContextMenu } from "@/ui/shell/ContextMenu";
import { EdgeSplitter } from "@/ui/shell/EdgeSplitter";
import { openZone } from "@/ui/shell/paneMenus";
import {
  isDarkTheme,
  observeHexColors,
  readSegmentTints,
  saturatedHighlight,
} from "@/ui/theme/hexColors";
import { readMinimapColors } from "@/ui/theme/minimapColors";

/**
 * The minimap panel: one map per open file, side by side, on one shared scale.
 *
 * The maps mirror the panes' arrangement, and both are binned over the longer
 * file — so a height on one map is the same absolute offset on the other, which
 * is the only reason two of them next to each other tell you anything.
 */

export interface MinimapPanelProps {
  /**
   * The surface this map belongs to: the workspace's, or the part of the panel
   * it is drawn inside. Each has a map of its own, of its own bytes and its own
   * length (G50).
   */
  readonly surface?: SurfaceId;
  /** What each pane has selected, drawn as a strip on its map. */
  readonly selections: Partial<Record<PaneId, { readonly start: number; readonly end: number }>>;
  /** Makes a pane the active one, as clicking its dump does. */
  readonly onActivate: (pane: SlotId) => void;
  /** The maps mirror the panes' arrangement. */
  readonly stacked: boolean;
}

/** @upstream ByteRipperApp/Minimap/MinimapPanelView.swift#MinimapPanelView */
export function MinimapPanel({
  surface = WORKSPACE_SURFACE,
  selections,
  onActivate,
  stacked,
}: MinimapPanelProps) {
  const state = mapOn(useStore(minimapStore), surface);
  const workspace = useStore(workspaceStore);
  // The panes this surface draws: the workspace's open slots, or the part.
  const open: readonly PaneId[] =
    surface === WORKSPACE_SURFACE
      ? PANE_IDS.filter((id) => workspace.panes[id] !== undefined)
      : paneIn(workspace, surface) === undefined
        ? []
        : [surface];
  const viewports = usePaneViewports(open);
  const panelRef = useRef<HTMLElement | null>(null);
  const chrome = usePaneChrome(panelRef, open.length);

  if (!state.visible || open.length === 0) return null;

  return (
    <aside
      className={`minimap${stacked ? " is-stacked" : ""}`}
      aria-label="Minimap"
      ref={panelRef}
      style={
        {
          width: state.width,
          // The gutter between side-by-side maps is a gap in the stylesheet;
          // its fraction is upstream's constant, set from the one place it lives.
          "--minimap-gutter": SIDE_BY_SIDE_GUTTER_FRACTION,
        } as React.CSSProperties
      }
    >
      <EdgeSplitter
        edge="left"
        label="Resize the minimap"
        width={state.width}
        min={MIN_MINIMAP_WIDTH}
        max={MAX_MINIMAP_WIDTH}
        initial={DEFAULT_MINIMAP_WIDTH}
        onChange={(next) => setMinimapWidth(surface, next)}
      />
      {/*
        The switch strip stands in for the pane's header: same height, same
        surface, same rule under it. Below it the minimap leaves the column
        header's band blank — it has no columns to name — so the maps still
        begin on the line the bytes do. A map that started higher than the dump
        it stands for would put every offset a few rows out.
      */}
      <MinimapModes surface={surface} offsetTop={chrome.offsetTop} height={chrome.headerHeight} />
      {/*
       * A margin rather than padding: the shared band is positioned against
       * this element, and an absolute child is placed against the padding box
       * while the canvases are laid out in the content box. Any padding here
       * and the band sits that much higher than the map it is about — which is
       * a band that drifts from the pointer dragging it.
       */}
      <div className="minimap-maps" style={{ marginTop: chrome.gapBelowHeader }}>
        {open.map((pane, index) => (
          <MinimapCanvas
            key={pane}
            pane={pane}
            mode={state.mode}
            selection={selections[pane]}
            viewport={viewports[pane]}
            stacked={stacked}
            /*
             * Side by side the two maps are not laid out alike: the inner edges
             * carry no padding, so each map's margins — and so where its
             * bookmark marks and its segment strip go — depend on which of the
             * pair it is. Stacked, both are padded on both sides like a single
             * map, which is what "single" means here.
             */
            placement={placementFor(stacked, open.length, index)}
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
        {stacked ? null : (
          <SharedBand surface={surface} mode={state.mode} viewport={viewports[open[0] ?? "a"]} />
        )}
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
 *
 * @upstream ByteRipperApp/Minimap/MinimapPanelView.swift#MinimapPanelView.defaultHeaderHeight
 * @upstream ByteRipperApp/Minimap/MinimapPanelView.swift#MinimapPanelView.defaultStatusBarHeight
 * @upstream ByteRipperApp/Minimap/MinimapPanelView.swift#MinimapPanelView.switchBandHeight
 */
interface PaneChrome {
  /** The pane's transparent top border, which the minimap has to clear too. */
  readonly offsetTop: number;
  readonly headerHeight: number;
  /** What is left between the header and the dump: the column header. */
  readonly gapBelowHeader: number;
}

const NO_CHROME: PaneChrome = { offsetTop: 0, headerHeight: 0, gapBelowHeader: 0 };

/**
 * @upstream ByteRipperApp/Minimap/MinimapPanelView.swift#MinimapPanelView.setChromeHeights
 * @upstream ByteRipperApp/Minimap/MinimapPanelView.swift#MinimapPanelView.dumpAreaInWindow
 * @upstream-differs measured from the panes' elements
 * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.dumpAreaInWindow
 */
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

/** The one band the side-by-side layout draws, edge to edge and over the gap. */
function SharedBand({
  mode,
  surface,
  viewport,
}: {
  readonly surface: SurfaceId;
  readonly mode: MinimapMode;
  readonly viewport: { readonly start: number; readonly end: number } | undefined;
}) {
  const state = mapOn(useStore(minimapStore), surface);
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

  const drawn: readonly PaneId[] = surface === WORKSPACE_SURFACE ? PANE_IDS : [surface];
  const sizes = drawn.map((id) => paneIn(workspace, id)?.document.size ?? 0).filter((s) => s > 0);
  const band = viewportBand({
    mode,
    viewport,
    areaHeight: height,
    topRow: derivedTopRow({ mode, sizes, windowRows: visibleRowCount(height), viewport }),
    extent: state.extent,
    overviewRows:
      drawn.map((id) => state.pictures[id]?.rowCount ?? 0).find((rows) => rows > 0) ?? 0,
    // Drawn, not grabbed: overview gets upstream's two-device-pixel floor, so a
    // sliver's middle is where the panes really are.
    minHeight: mode === "overview" ? overviewBandFloor(window.devicePixelRatio) : 0,
  });

  return (
    <div className="minimap-band-layer" ref={ref} aria-hidden="true">
      <ViewportMarks mode={mode} band={band} />
    </div>
  );
}

/**
 * Where the panes are, as the link reports it.
 *
 * Re-read on every scroll — including the mirrored ones, which is why this
 * listens to the link rather than to one pane.
 *
 * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.viewports
 * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.setViewports
 * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.viewport
 */
function usePaneViewports(
  panes: readonly PaneId[]
): Partial<Record<PaneId, { start: number; end: number }>> {
  const [viewports, setViewports] = useState<
    Partial<Record<PaneId, { start: number; end: number }>>
  >({});
  // The list itself, so a panel that has just opened over a part reads that
  // part's scroll rather than the two slots' — a map whose band is about panes
  // it does not draw has no band at all.
  const key = panes.join(",");

  // biome-ignore lint/correctness/useExhaustiveDependencies: the list is the input, by key
  useEffect(() => {
    const read = () => {
      const next: Partial<Record<PaneId, { start: number; end: number }>> = {};
      for (const id of panes) {
        const range = scrollLink.visibleRange(id, BYTES_PER_ROW);
        if (range !== undefined) next[id] = range;
      }
      setViewports((previous) =>
        panes.every(
          (id) => previous[id]?.start === next[id]?.start && previous[id]?.end === next[id]?.end
        )
          ? previous
          : next
      );
    };
    read();
    return scrollLink.onChange(read);
  }, [key]);

  return viewports;
}

/**
 * The mode switch and the build's progress.
 *
 * @upstream ByteRipperApp/Minimap/MinimapPanelView.swift#MinimapPanelView.modeSwitch
 * @upstream ByteRipperApp/Minimap/MinimapPanelView.swift#MinimapPanelView.showMode
 */
function MinimapModes({
  offsetTop,
  surface,
  height,
}: {
  readonly surface: SurfaceId;
  readonly offsetTop: number;
  readonly height: number;
}) {
  const state = mapOn(useStore(minimapStore), surface);
  const overviewUseful = overviewWorthShowing(surface);

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
            onClick={() => setMinimapMode(surface, mode)}
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

/**
 * Which of the pair a map is.
 *
 * Stacked, both are padded on both sides like a single map — the inner edge
 * that loses its padding is the one two maps *share*, and stacked maps share a
 * horizontal edge rather than a vertical one.
 *
 * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.mapLayout
 * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.setMapLayout
 */
function placementFor(stacked: boolean, openCount: number, index: number): MapPlacement {
  if (stacked || openCount < 2) return "single";
  return index === 0 ? "left" : "right";
}

/**
 * The baseline's reference bytes for the window `[start, start + length)`,
 * one read per span the window touches (§21.7). A row inside a joined half is
 * measured against that half's own file, and the row's stretch of it comes in
 * whole.
 *
 * @upstream-differs upstream's detail re-asks the pane's own `hexByteStates`,
 * which reads the references out of the baseline's `Block`; the web's window is
 * a couple of thousand bytes, read straight from the spans
 */
async function baselineReferences(
  baseline: ModifiedBaseline,
  start: number,
  length: number
): Promise<Map<BaselineSpan, { sourceAt: number; bytes: Uint8Array }>> {
  const references = new Map<BaselineSpan, { sourceAt: number; bytes: Uint8Array }>();
  for (const span of baseline.spans) {
    const from = Math.max(start, span.start);
    const to = Math.min(start + length, span.end);
    if (to <= from) continue;
    const sourceAt = span.sourceOffset + (from - span.start);
    const limit =
      span.sourceLimit !== undefined
        ? Math.min(span.sourceLimit, span.storage.size)
        : span.storage.size;
    const readLength = Math.max(0, Math.min(to - from, limit - sourceAt));
    const bytes =
      readLength > 0
        ? await span.storage.read(sourceAt, readLength).catch(() => new Uint8Array(0))
        : new Uint8Array(0);
    references.set(span, { sourceAt, bytes });
  }
  return references;
}

/**
 * Whether the byte at `offset` is modified against the baseline's references
 * (§21.7): new past the baseline's own end, new past the end of the source its
 * span was taken from, different from the reference, and never marked where
 * the baseline does not answer at all.
 */
function modifiedAgainst(
  baseline: ModifiedBaseline,
  references: ReadonlyMap<BaselineSpan, { sourceAt: number; bytes: Uint8Array }>,
  offset: number,
  byte: number
): boolean {
  const reference = baselineReferenceAt(baseline, offset);
  if (reference.kind === "unmarked") return false;
  if (reference.kind === "beyond") return true;
  const pre = references.get(reference.span);
  if (pre === undefined) return true;
  const at = reference.sourceAt - pre.sourceAt;
  if (at >= pre.bytes.length) return true;
  return (pre.bytes[at] ?? 0) !== byte;
}

/**
 * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.Map
 * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.maps
 * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.setMaps
 * @upstream-differs one canvas per open pane, each given its own props
 */
interface CanvasProps {
  /** @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.Map.fileSize */
  readonly pane: PaneId;
  readonly mode: MinimapMode;
  /**
   * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.Map.selection
   * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.selection
   */
  readonly selection: { readonly start: number; readonly end: number } | undefined;
  readonly viewport: { readonly start: number; readonly end: number } | undefined;
  /** Stacked, each map carries its own band; side by side they share one. */
  readonly stacked: boolean;
  /**
   * Which of the pair this map is. Side by side the inner edges carry no
   * padding, so the two are not laid out alike — and that decides which margin
   * this map's bookmark marks and segment strip sit in.
   */
  readonly placement: MapPlacement;
  readonly onActivate: (pane: SlotId) => void;
}

/**
 * The floor on the viewport band's height, in CSS pixels.
 *
 * The band is a handle before it is an indication: a viewport that is a sliver
 * of a 16 MB file would otherwise be too thin to put a pointer on.
 */
const MIN_BAND_HEIGHT = 6;

/** @upstream ByteRipperApp/Minimap/MinimapPanelView.swift#MinimapPanelView.mapView */
function MinimapCanvas({
  pane,
  mode,
  selection,
  viewport,
  stacked,
  placement,
  onActivate,
}: CanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<MinimapRenderer | null>(null);
  const state = mapOn(useStore(minimapStore), surfaceOf(pane));
  const workspace = useStore(workspaceStore);
  const differences = useStore(diffStore).index;
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [cells, setCells] = useState<CellState[]>([]);
  const slot = paneIn(workspace, pane);
  // The pieces the detail's baseline is built from: a cut moving a piece's
  // link moves the marks, and the window's bytes do not.
  const partition = useStore(segmentsStore).panes[pane]?.partition;

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
    setMinimapRows(surfaceOf(pane), overviewRowCount(size.height, window.devicePixelRatio));
  }, [size.height, pane]);

  // What this surface's maps are binned over: the longer of the workspace's two
  // files, or the part's own length.
  const drawn: readonly PaneId[] = isSlot(pane) ? PANE_IDS : [pane];
  const sizes = drawn.map((id) => paneIn(workspace, id)?.document.size ?? 0).filter((s) => s > 0);
  const windowRows = visibleRowCount(size.height);
  const topRow = derivedTopRow({ mode, sizes, windowRows, viewport });

  // Detail mode pulls the bytes of its window on each change rather than
  // holding a picture: it is a couple of thousand bytes, and holding them would
  // mean invalidating them.
  // @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.byteStates
  // @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.invalidateCells
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
      // What the window's bytes are measured against (§21.7): the saved file,
      // or — an image with no file of its own — the files its pieces came
      // from, one read per span the window touches.
      const baseline = baselineFor(pane);
      const references = await baselineReferences(baseline, start, bytes.length);
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
          // The M4 rule, unchanged: a byte is modified when it differs from
          // what its baseline answers for it, not when it came from the edit
          // buffer.
          modified: modifiedAgainst(baseline, references, start + i, byte),
          different: differing[i] === 1,
        });
      }
      setCells(next);
    })();

    return () => {
      cancelled = true;
    };
  }, [mode, slot, pane, topRow, windowRows, differences, partition]);

  // The marks of the pane this map is about: a part's are its own, and the
  // workspace's would name rows of a file this map is not drawing.
  // @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.syncFragmentMinimapBookmarks
  const marks = bookmarksIn(useStore(bookmarksStore), pane);
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
  /** The band as it is drawn: upstream's floor in overview, the rows in detail. */
  const drawnBand = viewportBand({
    mode,
    viewport,
    areaHeight: size.height,
    topRow,
    extent: state.extent,
    overviewRows: state.pictures[pane]?.rowCount ?? 0,
    minHeight: mode === "overview" ? overviewBandFloor(window.devicePixelRatio) : 0,
  });

  /**
   * Where each bookmarked row falls on this map.
   *
   * The same mapping the selection strip uses, so a mark and the bytes it
   * marks are at the same height. A row outside the map is dropped here rather
   * than clamped: a mark pinned to the top edge would claim a position the file
   * does not have there.
   */
  const markPoints = (() => {
    if (marks.length === 0 || slot === undefined) return undefined;
    const shared = { mode, areaHeight: size.height, topRow, extent: state.extent };
    const points: MapMark[] = [];
    for (const mark of marks) {
      // Past this map's own file there is no row to mark — a comparison's
      // shorter file — and so nothing for a click to snap to either.
      if (mark.row >= slot.document.size) continue;
      const y = yOfOffset({ ...shared, offset: mark.row });
      if (y >= 0 && y <= size.height) points.push({ offset: mark.row, y });
    }
    return points;
  })();
  const markYs = markPoints?.map((point) => point.y);

  /**
   * The pieces, as bands down the strip beside the map.
   *
   * The same mapping the selection strip uses, so a boundary on the strip is a
   * boundary in the dump. A file that has not been cut gets no bands: one band
   * the length of the map would say nothing.
   */
  const pieces = useStore(segmentsStore).panes[pane]?.partition.segments ?? [];
  /** @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.segmentBlocks */
  const segmentBands = (() => {
    if (pieces.length < 2) return undefined;
    const tints = readSegmentTints();
    const dark = isDarkTheme();
    const shared = { mode, areaHeight: size.height, topRow, extent: state.extent };
    return pieces.map((piece) => {
      const top = Math.max(0, yOfOffset({ ...shared, offset: piece.start }));
      const bottom = Math.min(size.height, yOfOffset({ ...shared, offset: piece.end }));
      const tint = tints[piece.index % tints.length] ?? "";
      return {
        top,
        height: bottom - top,
        // The block under the pointer is a louder shade of its own tint — the
        // same colour, just louder, so the hovered piece reads as "the one
        // under the cursor" without its identity changing (§19.4.4).
        tint: hoveredPiece === piece.index ? saturatedHighlight(tint, dark) : tint,
      };
    });
  })();
  /** The boundaries between the pieces, where a click on the strip snaps to. */
  const cuts: MapMark[] = pieces.slice(1).map((piece) => ({
    offset: piece.start,
    y: yOfOffset({
      mode,
      areaHeight: size.height,
      topRow,
      extent: state.extent,
      offset: piece.start,
    }),
  }));

  /**
   * The open tool's zones, as brackets down the gutter.
   *
   * Depth is how many zones contain this one: nested brackets step inward, so
   * the nesting is what the eye reads rather than something to work out.
   */
  const zones = useStore(zoneStore).panes[pane] ?? EMPTY_ZONES;
  /**
   * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.setZoneMaps
   * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.brackets
   * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.zoneBrackets
   * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.ZoneBracket.id
   */
  const zoneBrackets = (() => {
    if (zones.zones.length === 0) return undefined;
    const shared = { mode, areaHeight: size.height, topRow, extent: state.extent };
    const brackets: (ZoneBracket & ZoneBracketBox)[] = [];
    for (const zone of zones.zones) {
      const top = yOfOffset({ ...shared, offset: zone.start });
      const bottom = yOfOffset({ ...shared, offset: zone.end });
      if (bottom < 0 || top > size.height) continue;
      const depth = zones.zones.filter(
        (other) => other !== zone && other.start <= zone.start && other.end >= zone.end
      ).length;
      brackets.push({
        id: zone.id,
        // The range is carried besides the painted box so a click near a
        // bracket's end can name the byte it stands for.
        start: zone.start,
        end: zone.end,
        top: Math.max(0, top),
        height: Math.min(size.height, bottom) - Math.max(0, top),
        depth,
        focused: zones.focus === zone.id,
      });
    }
    return brackets;
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
      placement,
      cells,
      picture: state.pictures[pane],
      selection: selectionStrip,
      bookmarks: markYs,
      segments: segmentBands,
      zones: zoneBrackets,
    });
  }, [
    colors,
    size,
    state.pictures,
    pane,
    mode,
    placement,
    cells,
    selectionStrip,
    markYs,
    segmentBands,
    zoneBrackets,
  ]);

  /**
   * The same layout the renderer uses, so the pointer finds what was painted.
   *
   * Built here rather than asked of the renderer because the hit-tests run on
   * events and the renderer runs on paints: two objects deriving the same
   * numbers from the same inputs is what this whole change is undoing, so there
   * is one expression of it and both sides read it.
   */
  const layout = useMemo(
    () =>
      new MinimapLayout({
        width: size.width,
        placement,
        segmentStripVisible: (segmentBands?.length ?? 0) > 1,
        zoneLaneCount:
          zoneBrackets === undefined || zoneBrackets.length === 0
            ? 0
            : Math.min(Math.max(...zoneBrackets.map((one) => one.depth)) + 1, ZONE_MAX_LANES),
      }),
    [size.width, placement, segmentBands, zoneBrackets]
  );

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

  /**
   * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.mouseDown
   * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.onSelectOffset
   */
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
      // The map draws the workspace's own panes, which is what a click on it
      // makes active.
      if (isSlot(pane)) onActivate(pane);

      const box = canvas.getBoundingClientRect();
      const x = event.clientX - box.left;
      const y = event.clientY - box.top;
      // The segment strip positions like the map does: the pane goes to the
      // byte the click's height stands for, or to the nearest cut's exact
      // offset when one is in reach. Checked before the band, which runs edge
      // to edge and would otherwise take the strip's clicks as a drag.
      const onStrip = segmentStripClick({
        strip: layout.segmentStripRect,
        cuts,
        x,
        y,
        mode,
        areaHeight: box.height,
        topRow,
        extent: state.extent,
        overviewRows: state.pictures[pane]?.rowCount ?? 0,
        fileSize: slot?.document.size ?? 0,
      });
      if (onStrip !== undefined) {
        scrollLink.scrollToOffset(pane, onStrip, BYTES_PER_ROW, { centre: true });
        return;
      }

      // And a click on a zone's own end goes to that end, for the same reason
      // and ahead of the band for the same one (§19.4.5). Only the two ends:
      // the middle of a bracket is a byte like any other on the map.
      const onBracket = zoneBracketClick({
        layout,
        brackets: zoneBrackets ?? [],
        x,
        y,
        mode,
        areaHeight: box.height,
        topRow,
        extent: state.extent,
        fileSize: slot?.document.size ?? 0,
      });
      if (onBracket !== undefined) {
        scrollLink.scrollToOffset(pane, onBracket.offset, BYTES_PER_ROW, { centre: true });
        return;
      }

      if (band !== undefined && y >= band.top && y <= band.top + band.height) {
        // On the band: this press is the start of a scroll, so it must not also
        // be read as a "take me here" jump.
        grab.current = { offset: y - band.top, height: band.height };
        return;
      }

      // Off the band: the click means the row of a bookmark whose mark it
      // landed near, or else the byte drawn under it, so the pane centres on it
      // — and the drag then continues from the band's middle, so the press can
      // still turn into a scroll.
      const offset = nearestBookmarkMark(layout, markPoints ?? [], x, y) ?? offsetFromEvent(event);
      if (offset !== undefined) {
        scrollLink.scrollToOffset(pane, offset, BYTES_PER_ROW, { centre: true });
      }
      const height = band?.height ?? MIN_BAND_HEIGHT;
      grab.current = { offset: height / 2, height };
    },
    [
      band,
      offsetFromEvent,
      onActivate,
      pane,
      layout,
      cuts,
      markPoints,
      mode,
      topRow,
      state.extent,
      state.pictures,
      slot,
      zoneBrackets,
    ]
  );

  /**
   * The piece the pointer is over in the strip, or nothing when it is not in
   * the strip at all.
   */
  /**
   * The zone whose bracket is under the pointer, if the pointer is in the gutter.
   *
   * The same hit-test the click uses, asked the same question — the lane nearest
   * the pointer answers first and the shortest bracket in it wins — so pointing
   * at a bracket and pressing on one cannot disagree about which it is.
   *
   * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.zoneBracket
   * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.zoneBracketHit
   * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.zoneBracketMenu
   * @upstream-differs the menu opens from the canvas's onContextMenu
   */
  const zoneUnder = useCallback(
    (event: { clientX: number; clientY: number }): Zone | undefined => {
      const canvas = canvasRef.current;
      if (canvas === null || zoneBrackets === undefined) return undefined;
      const box = canvas.getBoundingClientRect();
      const hit = zoneBracket(
        layout,
        zoneBrackets,
        event.clientX - box.left,
        event.clientY - box.top
      );
      return hit === undefined ? undefined : zones.zones.find((one) => one.id === hit.id);
    },
    [zoneBrackets, zones.zones, layout]
  );

  /**
   * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.segmentPiece
   * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.segmentStripMenu
   * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.rightMouseDown
   * @upstream-differs the menu opens from the canvas's onContextMenu
   */
  const pieceUnder = useCallback(
    (event: { clientX: number; clientY: number }): Segment | undefined => {
      const canvas = canvasRef.current;
      if (canvas === null || segmentBands === undefined) return undefined;
      const strip = layout.segmentStripRect;
      if (strip === undefined) return undefined;
      const box = canvas.getBoundingClientRect();
      const x = event.clientX - box.left;
      if (x < strip.x || x > strip.x + strip.width) return undefined;
      const y = event.clientY - box.top;
      const at = segmentBands.findIndex((band) => y >= band.top && y < band.top + band.height);
      return at < 0 ? undefined : pieces[at];
    },
    [segmentBands, pieces, layout]
  );

  /**
   * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.mouseDragged
   * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.mouseMoved
   * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.mouseExited
   * @upstream-differs leaving the canvas clears the hovered piece inline
   */
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

  /** @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.mouseUp */
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
          const zone = zoneUnder(event);
          if (zone !== undefined) {
            // The gutter's own menu: the commands that act on the zone under
            // the pointer (§19.4.5).
            // @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.minimapZoneMenu The zone's name is in the title, so the
            // menu says what it will act on; an unnamed zone is named by where
            // it starts, which is all there is.
            const named =
              zone.name.length === 0 ? `at ${hexAddress(zone.start)}` : `“${zone.name}”`;
            openContextMenu(event, [
              {
                label: `Select Zone ${named}`,
                onSelect: () => {
                  const slot = paneState(pane);
                  if (slot === undefined) return;
                  void slot.typing.setSelection(zone.start, zone.end);
                  scrollLink.scrollToOffset(pane, zone.start, BYTES_PER_ROW, { centre: true });
                  // The bytes are the host's half; telling the tool that
                  // published the zone is the other one, and it is the only
                  // side that knows what the zone stands for.
                  // @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.minimapMenuSelectZone
                  zoneSelected(pane, zone.id);
                },
              },
              {
                // The same act the dump's own menu performs, on the zone looked
                // up again: a tool-module may have republished between the menu
                // opening and the item being picked.
                // @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.minimapMenuOpenZone
                label: `Open Zone ${named}`,
                onSelect: () => {
                  const slot = paneState(pane);
                  const current = zonesFor(pane).zones.find((one) => one.id === zone.id);
                  if (slot === undefined || current === undefined) return;
                  openZone(pane, slot, current);
                },
              },
            ]);
            return;
          }
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
      {stacked ? <ViewportMarks mode={mode} band={drawnBand} /> : null}
    </div>
  );
}
