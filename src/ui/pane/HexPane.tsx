import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { BinaryDocument } from "@/core/document/binaryDocument";
import { caretAt, selection as makeSelection } from "@/core/document/selectionModel";
import { MONOSPACE_STACK, measureFont } from "@/render/hexGrid/fontMetrics";
import { HexGridRenderer } from "@/render/hexGrid/hexGridRenderer";
import { BYTES_PER_ROW, HexLayout, type WordSize } from "@/render/hexGrid/hexLayout";
import { activeDecoder } from "@/state/workspaceStore";
import {
  detectKeyboardPlatform,
  type HexKeyEvent,
  resolveHexKey,
  resolveTarget,
} from "@/ui/pane/hexKeys";
import { observeHexColors, readHexColors } from "@/ui/theme/hexColors";

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
  readonly document: BinaryDocument;
  readonly wordSize: WordSize;
  readonly fontSizePx: number;
}

const platform = detectKeyboardPlatform();

export function HexPane({ document: doc, wordSize, fontSizePx }: HexPaneProps) {
  const readoutId = useId();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<HexGridRenderer | null>(null);
  const frameRef = useRef<number | undefined>(undefined);
  const layoutRef = useRef<HexLayout | undefined>(undefined);
  const viewportHeightRef = useRef(0);
  const dragAnchorRef = useRef<number | undefined>(undefined);

  /** Only what the chrome actually displays lives in React state. */
  const [caret, setCaret] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const [contentWidth, setContentWidth] = useState(0);

  /** Paints on the next frame, coalescing however many reasons arrived. */
  const scheduleDraw = useCallback(() => {
    if (frameRef.current !== undefined) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = undefined;
      rendererRef.current?.draw();
    });
  }, []);

  // The renderer, made once per canvas.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const renderer = new HexGridRenderer(canvas);
    renderer.setBytesArrivedHandler(scheduleDraw);
    rendererRef.current = renderer;
    return () => {
      renderer.setBytesArrivedHandler(undefined);
      rendererRef.current = null;
    };
  }, [scheduleDraw]);

  // Configuration: the layout, the atlas's inputs, the palette. Anything here
  // changing rebuilds the atlas and repaints everything, which is the cheap
  // side of D6's bargain.
  useEffect(() => {
    const renderer = rendererRef.current;
    if (renderer === null) return;

    const configure = () => {
      const metrics = measureFont(fontSizePx);
      const layout = new HexLayout({
        charWidth: metrics.charWidth,
        rowHeight: metrics.rowHeight,
        offsetColumnChars: Math.max(8, doc.size.toString(16).length),
        wordSize,
      });
      layoutRef.current = layout;
      renderer.configure({
        layout,
        decoder: activeDecoder(),
        colors: readHexColors(),
        fontFamily: MONOSPACE_STACK,
        fontSizePx,
        devicePixelRatio: window.devicePixelRatio,
      });
      renderer.setSource(doc);
      setContentHeight(renderer.contentHeight);
      setContentWidth(renderer.contentWidth);
      scheduleDraw();
    };

    configure();
    return observeHexColors(configure);
  }, [doc, wordSize, fontSizePx, scheduleDraw]);

  // The viewport, and its size.
  useEffect(() => {
    const host = scrollRef.current;
    const renderer = rendererRef.current;
    if (host === null || renderer === null) return;

    const measure = () => {
      viewportHeightRef.current = host.clientHeight;
      renderer.setViewport({
        scrollTop: host.scrollTop,
        scrollLeft: host.scrollLeft,
        widthCss: host.clientWidth,
        heightCss: host.clientHeight,
      });
      scheduleDraw();
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, [scheduleDraw]);

  // Selection changes from anywhere — a click, a key, an edit's clamp.
  useEffect(() => {
    const apply = () => {
      const current = doc.selection;
      rendererRef.current?.setSelection({ start: current.start, end: current.end });
      setCaret(current.start);
      scheduleDraw();
    };
    apply();
    return doc.onSelectionChanged(apply);
  }, [doc, scheduleDraw]);

  const onScroll = useCallback(() => {
    const host = scrollRef.current;
    const renderer = rendererRef.current;
    if (host === null || renderer === null) return;
    renderer.setViewport({
      scrollTop: host.scrollTop,
      scrollLeft: host.scrollLeft,
      widthCss: host.clientWidth,
      heightCss: host.clientHeight,
    });
    scheduleDraw();
  }, [scheduleDraw]);

  /** Brings an offset into view with the least scrolling that will do it. */
  const reveal = useCallback((offset: number) => {
    const host = scrollRef.current;
    const layout = layoutRef.current;
    if (host === null || layout === undefined) return;

    const rowTop = Math.floor(offset / BYTES_PER_ROW) * layout.rowHeight;
    const rowBottom = rowTop + layout.rowHeight;
    if (rowTop < host.scrollTop) host.scrollTop = rowTop;
    else if (rowBottom > host.scrollTop + host.clientHeight) {
      host.scrollTop = rowBottom - host.clientHeight;
    }
  }, []);

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

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const command = resolveHexKey(event as unknown as HexKeyEvent, platform);
      if (command === undefined) return;

      const host = scrollRef.current;
      const layout = layoutRef.current;
      const rowsPerPage = Math.max(
        1,
        Math.floor(viewportHeightRef.current / (layout?.rowHeight ?? 17))
      );

      switch (command.kind) {
        case "moveBy":
          moveCaret(doc.caret + command.delta, command.extend);
          break;
        case "moveTo":
          moveCaret(
            resolveTarget(command.target, doc.caret, doc.size, rowsPerPage, command.extend),
            command.extend
          );
          break;
        case "scrollByPage":
          if (host !== null) {
            host.scrollTop += (command.down ? 1 : -1) * rowsPerPage * (layout?.rowHeight ?? 17);
          }
          break;
        case "scrollTo":
          if (host !== null) host.scrollTop = command.edge === "top" ? 0 : host.scrollHeight;
          break;
        case "selectAll":
          doc.setSelection(makeSelection(0, doc.size, doc.size));
          break;
        case "goToPosition":
          // The Go To dialog arrives with the command palette; until then the
          // shortcut must still not fall through to the browser's own Cmd+L,
          // which would put focus in the address bar mid-edit.
          break;
      }
      event.preventDefault();
    },
    [doc, moveCaret]
  );

  /** Where a pointer is, in the grid's own content coordinates. */
  const contentPoint = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const host = scrollRef.current;
    if (host === null) return undefined;
    const bounds = host.getBoundingClientRect();
    return {
      x: event.clientX - bounds.left + host.scrollLeft,
      y: event.clientY - bounds.top + host.scrollTop,
    };
  }, []);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const layout = layoutRef.current;
      const point = contentPoint(event);
      if (layout === undefined || point === undefined) return;

      const hit = layout.hitTest(point.x, point.y, layout.rowCount(doc.size));
      if (hit === undefined) return;

      const column = hit.column.kind === "offset" ? 0 : hit.column.column;
      const offset = Math.min(layout.byteOffset(hit.row, column), doc.size);
      dragAnchorRef.current = offset;
      event.currentTarget.setPointerCapture(event.pointerId);
      doc.setSelection(
        event.shiftKey ? makeSelection(doc.caret, offset, doc.size) : caretAt(offset, doc.size)
      );
      event.preventDefault();
    },
    [contentPoint, doc]
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const anchor = dragAnchorRef.current;
      const layout = layoutRef.current;
      const host = scrollRef.current;
      if (anchor === undefined || layout === undefined || host === null) return;

      const bounds = host.getBoundingClientRect();
      // A drag past the viewport's edge keeps selecting: the pointer's y is
      // clamped into the content and the view follows it.
      const rawY = event.clientY - bounds.top;
      if (rawY < 0) host.scrollTop += rawY;
      else if (rawY > bounds.height) host.scrollTop += rawY - bounds.height;

      const y = Math.min(Math.max(rawY, 0), bounds.height - 1) + host.scrollTop;
      const x = event.clientX - bounds.left + host.scrollLeft;
      const end = layout.dragEndOffset(x, y, layout.rowCount(doc.size));
      if (end === undefined) return;

      doc.setSelection(makeSelection(anchor, Math.min(end, doc.size), doc.size));
    },
    [doc]
  );

  const endDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    dragAnchorRef.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  return (
    <div className="hex-pane">
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
      >
        <canvas ref={canvasRef} className="hex-canvas" />
        <div
          className="hex-spacer"
          style={{ height: `${contentHeight}px`, width: `${contentWidth}px` }}
        />
      </div>
      <p className="hex-caret-readout" id={readoutId} aria-live="polite">
        Offset {caret.toString(16).toUpperCase().padStart(8, "0")} · {doc.size.toLocaleString()}{" "}
        bytes
      </p>
    </div>
  );
}
