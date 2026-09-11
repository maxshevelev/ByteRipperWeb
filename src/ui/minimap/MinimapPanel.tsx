import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  BYTES_PER_ROW,
  derivedTopRow,
  type MinimapMode,
  overviewRowCount,
  snappedOffsetAtY,
  viewportBand,
  visibleRowCount,
} from "@/render/minimap/minimapGeometry";
import {
  type CellState,
  type MinimapColors,
  MinimapRenderer,
} from "@/render/minimap/minimapRenderer";
import { diffStore } from "@/state/diffStore";
import {
  minimapStore,
  overviewWorthShowing,
  setMinimapMode,
  setMinimapRows,
} from "@/state/minimapStore";
import { useStore } from "@/state/useStore";
import { PANE_IDS, type PaneId, workspaceStore } from "@/state/workspaceStore";
import { scrollLink } from "@/ui/pane/scrollLink";
import { observeHexColors } from "@/ui/theme/hexColors";
import { readMinimapColors } from "@/ui/theme/minimapColors";

/**
 * The minimap panel: one map per open file, side by side, on one shared scale.
 *
 * The maps mirror the panes' arrangement, and both are binned over the longer
 * file — so a height on one map is the same absolute offset on the other, which
 * is the only reason two of them next to each other tell you anything.
 */

export interface MinimapPanelProps {
  /** Makes a pane the active one, as clicking its dump does. */
  readonly onActivate: (pane: PaneId) => void;
  /** The maps mirror the panes' arrangement. */
  readonly stacked: boolean;
}

export function MinimapPanel({ onActivate, stacked }: MinimapPanelProps) {
  const state = useStore(minimapStore);
  const workspace = useStore(workspaceStore);
  const open = PANE_IDS.filter((id) => workspace.panes[id] !== undefined);

  if (!state.visible || open.length === 0) return null;

  return (
    <aside className={`minimap${stacked ? " is-stacked" : ""}`} aria-label="Minimap">
      <div className="minimap-maps">
        {open.map((pane) => (
          <MinimapCanvas key={pane} pane={pane} mode={state.mode} onActivate={onActivate} />
        ))}
      </div>
      <MinimapFooter />
    </aside>
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
function MinimapFooter() {
  const state = useStore(minimapStore);
  const overviewUseful = overviewWorthShowing();

  return (
    <div className="minimap-footer">
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
  readonly onActivate: (pane: PaneId) => void;
}

function MinimapCanvas({ pane, mode, onActivate }: CanvasProps) {
  const viewport = usePaneViewports()[pane];
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

  // The draw itself.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || colors === undefined || size.width <= 0 || size.height <= 0) return;
    if (rendererRef.current === null) rendererRef.current = new MinimapRenderer(canvas, colors);
    const renderer = rendererRef.current;
    renderer.setColors(colors);
    renderer.resize(size.width, size.height, window.devicePixelRatio);

    const picture = state.pictures[pane];
    renderer.draw({
      mode,
      cells,
      picture,
      band: viewportBand({
        mode,
        viewport,
        areaHeight: size.height,
        topRow,
        extent: state.extent,
        overviewRows: picture?.rowCount ?? 0,
        minHeight: renderer.minMarkHeight * 2,
      }),
    });
  }, [colors, size, state.pictures, state.extent, pane, mode, cells, viewport, topRow]);

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

  // Click to jump, drag to scan. The pointer is captured so a drag that leaves
  // the map keeps steering it, which is what makes dragging the band usable.
  const dragging = useRef(false);
  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (event.button !== 0) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      dragging.current = true;
      onActivate(pane);
      const offset = offsetFromEvent(event);
      if (offset !== undefined) scrollLink.scrollToOffset(pane, offset, BYTES_PER_ROW);
    },
    [offsetFromEvent, onActivate, pane]
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (!dragging.current) return;
      const offset = offsetFromEvent(event);
      if (offset !== undefined) scrollLink.scrollToOffset(pane, offset, BYTES_PER_ROW);
    },
    [offsetFromEvent, pane]
  );

  const endDrag = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    dragging.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const label =
    slot === undefined
      ? "Minimap"
      : `Minimap of ${slot.name}, ${mode === "detail" ? "detail" : "overview"}`;

  return (
    <canvas
      ref={canvasRef}
      className="minimap-canvas"
      aria-label={label}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onWheel={(event) => scrollLink.scrollBy(pane, event.deltaY)}
    />
  );
}
