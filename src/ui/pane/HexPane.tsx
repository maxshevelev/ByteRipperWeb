import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { DiffBlockIndex } from "@/core/diff/diffBlock";
import type { BinaryDocument } from "@/core/document/binaryDocument";
import { caretAt, selection as makeSelection } from "@/core/document/selectionModel";
import type { InputRegion, TypingController } from "@/core/edit/typingController";
import type { EditOverlayStorage } from "@/core/storage/editOverlayStorage";
import { formatHex, parseHex } from "@/core/text/hexText";
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
import { scrollLink } from "@/ui/pane/scrollLink";
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
  /** The file's name, shown in the pane's own header. */
  readonly name: string;
  /** Which slot this is, for the header and for focus. */
  readonly label: string;
  readonly isActive: boolean;
  /**
   * Which slot this is, as the scroll link's key. Comparison locks the two
   * panes to the same offsets, and the link needs to tell them apart.
   */
  readonly paneId: string;
  readonly onActivate: () => void;
  readonly onClose: () => void;
  /** The comparison, when there are two files. */
  readonly differences?: DiffBlockIndex | undefined;
  /** The other pane's selection, outlined here. */
  readonly peerSelection?: { start: number; end: number } | undefined;
  /** Called when this pane's selection moves, so the other pane can outline it. */
  readonly onSelectionChanged?: ((selection: { start: number; end: number }) => void) | undefined;
  /** Asks the workspace to reveal a range — difference navigation uses it. */
  readonly revealRequest?: { offset: number; token: number } | undefined;
  /**
   * The document's editing state machine. It belongs to the document, not to
   * this component: it holds a half-typed nibble and an open undo group,
   * neither of which should survive a remount or a layout change.
   */
  readonly typing: TypingController;
  readonly onSave?: (() => void) | undefined;
  readonly onSaveAs?: (() => void) | undefined;
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

export function HexPane({
  document: doc,
  wordSize,
  fontSizePx,
  name,
  label,
  isActive,
  paneId,
  onActivate,
  onClose,
  differences,
  peerSelection,
  onSelectionChanged,
  revealRequest,
  typing,
  onSave,
  onSaveAs,
}: HexPaneProps) {
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
  const [mode, setMode] = useState<"INS" | "OVR">("OVR");
  const [region, setRegion] = useState<InputRegion>("hex");
  const [dirty, setDirty] = useState(false);
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
      rendererRef.current?.setCaret({
        offset: current.start,
        nibble: typing.nibble,
        region: typing.inputRegion,
        insertMode: typing.isInsertMode,
        // A standing selection shows the active region on its own; the caret
        // reappears at its start the moment typing begins to consume it.
        visible: current.end === current.start || typing.nibble === 1,
      });
      setCaret(current.start);
      onSelectionChanged?.({ start: current.start, end: current.end });
      scheduleDraw();
    };
    apply();
    return doc.onSelectionChanged(apply);
  }, [doc, scheduleDraw, onSelectionChanged, typing]);

  /**
   * The red foreground on every byte that differs from the file on disk.
   *
   * Read from the overlay after each change: it already tracks exactly this for
   * the save path, so there is nothing here to keep in step separately.
   */
  useEffect(() => {
    const apply = () => {
      const overlay = doc.storage as Partial<EditOverlayStorage>;
      rendererRef.current?.setModifiedRanges(overlay.changedRanges ?? []);
      setDirty(doc.isDirty);
      scheduleDraw();
    };
    apply();
    const stopContent = doc.onContentChanged(apply);
    // The commit is a separate signal: a grouped byte becomes dirty when its
    // group closes, and that fires no content change.
    const stopCommit = doc.onTransactionCommitted(apply);
    return () => {
      stopContent();
      stopCommit();
    };
  }, [doc, scheduleDraw]);

  // The comparison, and the other pane's selection outlined here.
  useEffect(() => {
    rendererRef.current?.setDifferences(differences);
    scheduleDraw();
  }, [differences, scheduleDraw]);

  useEffect(() => {
    rendererRef.current?.setPeerSelection(peerSelection);
    scheduleDraw();
  }, [peerSelection, scheduleDraw]);

  // Difference navigation asks the pane to show a range. The token makes a
  // repeat of the same range a fresh request — pressing Next twice on a file
  // with one difference should still scroll back to it.
  useEffect(() => {
    if (revealRequest === undefined) return;
    // The caret moves; the block is not selected. A selection would claim the
    // user had chosen those bytes — and the next thing typed would replace
    // them, which is not what stepping through differences is for.
    doc.setSelection(caretAt(revealRequest.offset, doc.size));
    const host = scrollRef.current;
    const layout = layoutRef.current;
    if (host === null || layout === undefined) return;

    const rowTop = Math.floor(revealRequest.offset / BYTES_PER_ROW) * layout.rowHeight;
    // Centred, not merely brought inside the edge: a change the user asked to
    // be shown should have its surroundings visible too.
    host.scrollTop = Math.max(0, rowTop - host.clientHeight / 2 + layout.rowHeight);
  }, [revealRequest, doc]);

  // Comparison locks the panes to the same offsets. With one file open the
  // link has nothing to mirror to and does nothing.
  useEffect(() => {
    const host = scrollRef.current;
    if (host === null) return;
    return scrollLink.register(paneId, {
      element: host,
      rowHeight: () => layoutRef.current?.rowHeight ?? 0,
    });
  }, [paneId]);

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
    scrollLink.report(paneId);
  }, [scheduleDraw, paneId]);

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
   */
  const refreshCaret = useCallback(() => {
    const current = doc.selection;
    rendererRef.current?.setCaret({
      offset: current.start,
      nibble: typing.nibble,
      region: typing.inputRegion,
      insertMode: typing.isInsertMode,
      visible: current.end === current.start || typing.nibble === 1,
    });
    scheduleDraw();
  }, [doc, typing, scheduleDraw]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const command = resolveHexKey(event as unknown as HexKeyEvent, platform, region);
      if (command === undefined) return;

      const host = scrollRef.current;
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
          void typing.undo(command.batch);
          break;
        case "redo":
          void typing.redo();
          break;
        case "save":
          onSave?.();
          break;
        case "saveAs":
          onSaveAs?.();
          break;
        case "copy":
        case "paste":
          // The clipboard needs the browser's own event to carry the data, so
          // these are handled by onCopy/onPaste below rather than here. Falling
          // through without preventDefault is what lets that happen.
          return;
      }
      event.preventDefault();
    },
    [doc, moveCaret, region, onSave, onSaveAs, typing, refreshCaret]
  );

  /**
   * Copy, as hex text.
   *
   * Hex text is the format here, not a debug aid as it is upstream. A browser
   * has no portable way to put raw bytes on the clipboard, and text is what
   * travels anyway: into a forum post, a bug report, a terminal, and back into
   * this application, which is why the paste side reads the same spelling.
   *
   * `clipboardData` is only writable while the event is being dispatched, so
   * the bytes have to be in hand *now* — which is what `peek` is for. When the
   * selection is not resident the copy falls back to the asynchronous clipboard
   * API, which can wait for the read.
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
        event.clipboardData.setData("text/plain", formatHex(resident));
        return;
      }
      void doc.read(start, count).then((bytes) => {
        void navigator.clipboard?.writeText(formatHex(bytes)).catch(() => undefined);
      });
    },
    [doc]
  );

  const onPaste = useCallback(
    (event: React.ClipboardEvent<HTMLDivElement>) => {
      event.preventDefault();
      const bytes = parseHex(event.clipboardData.getData("text/plain"));
      // Text that is not unambiguously hex is refused rather than guessed at.
      if (bytes === undefined || bytes.length === 0) return;
      void typing.pasteBytes(bytes);
    },
    [typing]
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

      // Take the focus first. The handler ends in preventDefault — needed so a
      // drag does not turn into a text selection of the page — and that also
      // suppresses the click's own focusing, so without this the grid never
      // gets the keyboard and nothing typed into it arrives.
      event.currentTarget.focus();

      const hit = layout.hitTest(point.x, point.y, layout.rowCount(doc.size));
      if (hit === undefined) return;

      const column = hit.column.kind === "offset" ? 0 : hit.column.column;
      const offset = Math.min(layout.byteOffset(hit.row, column), doc.size);
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
    // Clicking anywhere in a pane makes it the active one — that is the whole
    // gesture. The keyboard route is the grid's own focus, which fires the same
    // handler through onFocusCapture.
    <div
      className="hex-pane"
      data-active={isActive ? "" : undefined}
      onPointerDownCapture={onActivate}
      onFocusCapture={onActivate}
    >
      <header className="pane-header">
        <span className="pane-label">{label}</span>
        <span className="pane-name" title={name}>
          {name}
        </span>
        <button type="button" className="pane-close" onClick={onClose} title={`Close ${label}`}>
          Close
        </button>
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
      >
        <canvas ref={canvasRef} className="hex-canvas" />
        <div
          className="hex-spacer"
          style={{ height: `${contentHeight}px`, width: `${contentWidth}px` }}
        />
      </div>
      <p className="hex-caret-readout" id={readoutId} aria-live="polite">
        <span>Offset {caret.toString(16).toUpperCase().padStart(8, "0")}</span>
        <span>{doc.size.toLocaleString()} bytes</span>
        <span className="readout-mode" data-insert={mode === "INS" ? "" : undefined}>
          {mode}
        </span>
        <span className="readout-region">{region === "hex" ? "Hex" : "Text"}</span>
        {dirty ? <span className="readout-dirty">Unsaved</span> : null}
      </p>
    </div>
  );
}
