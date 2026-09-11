import { useCallback, useEffect, useRef, useState } from "react";
import type { BinaryDocument } from "@/core/document/binaryDocument";
import type { MatchSet } from "@/core/search/matchSet";
import { DEFAULT_MAX_RESULTS } from "@/core/search/searchEngine";
import { formatHex } from "@/core/text/hexText";
import { selectMatch } from "@/state/searchStore";
import { activeDecoder } from "@/state/workspaceStore";

/**
 * Every match, as a list.
 *
 * The excerpts are read from the *live* document rather than kept with the
 * match, so a row shows what the bytes are now — including an edit made since
 * the search ran. A list that cached its excerpts would quietly show the file
 * as it used to be.
 *
 * Past the listing limit the panel states the count and refuses: four thousand
 * rows impersonate a tool without being one, and a count in the thousands is
 * already the diagnosis — the pattern is too generic.
 */

/** Bytes either side of a match, so a row reads in context. */
const CONTEXT_BYTES = 4;

/**
 * The panel's height, in pixels, and the band it may be dragged through.
 *
 * It shares the pane with the dump, so it has to leave the dump worth looking
 * at — a results list that can swallow the bytes it is about is a list you have
 * to close to use.
 */
const MIN_HEIGHT = 64;
const MAX_HEIGHT = 420;
const DEFAULT_HEIGHT = 150;
const HEIGHT_STORAGE_KEY = "byteripper.searchResultsHeight";

const clampHeight = (height: number) =>
  Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round(height)));

function storedHeight(): number {
  try {
    const raw = localStorage.getItem(HEIGHT_STORAGE_KEY);
    if (raw === null) return DEFAULT_HEIGHT;
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? clampHeight(parsed) : DEFAULT_HEIGHT;
  } catch {
    // A private window may refuse to read it; the default is no worse.
    return DEFAULT_HEIGHT;
  }
}

export interface SearchResultsProps {
  readonly matches: MatchSet;
  readonly document: BinaryDocument;
  readonly current: { readonly start: number; readonly end: number } | undefined;
  readonly onGo: (offset: number) => void;
}

interface Row {
  readonly start: number;
  readonly hex: string;
  readonly text: string;
}

export function SearchResults({ matches, document: doc, current, onGo }: SearchResultsProps) {
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    if (!matches.isListable) {
      setRows([]);
      return;
    }

    let cancelled = false;
    void (async () => {
      const decoder = activeDecoder();
      const built: Row[] = [];
      for (let index = 0; index < matches.total; index++) {
        const range = matches.rangeAt(index);
        if (range === undefined) continue;
        const from = Math.max(0, range.start - CONTEXT_BYTES);
        const to = Math.min(doc.size, range.end + CONTEXT_BYTES);
        const bytes = await doc.read(from, to - from);
        if (cancelled) return;
        built.push({
          start: range.start,
          hex: formatHex(bytes, bytes.length),
          text: decoder.decodeAll(bytes),
        });
      }
      if (!cancelled) setRows(built);
    })();

    return () => {
      cancelled = true;
    };
    // The document's version is not a dependency on purpose: the panel refreshes
    // when the set changes, and an edit republishes the set through the store.
  }, [matches, doc]);

  const [height, setHeight] = useState(storedHeight);
  const panelRef = useRef<HTMLElement | null>(null);
  const dragging = useRef(false);

  const resize = useCallback((next: number) => {
    const clamped = clampHeight(next);
    setHeight(clamped);
    try {
      localStorage.setItem(HEIGHT_STORAGE_KEY, String(clamped));
    } catch {
      // Not storable here; the height still applies for this session.
    }
  }, []);

  // Dragging upward makes the panel taller: it is anchored to the pane's
  // bottom, so its height is the distance from the pointer to that edge.
  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }, []);

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging.current) return;
      const panel = panelRef.current;
      if (panel === null) return;
      resize(panel.getBoundingClientRect().bottom - event.clientY);
    },
    [resize]
  );

  const endDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const splitter = (
    // biome-ignore lint/a11y/useSemanticElements: an <hr> cannot be dragged
    <div
      className="search-results-splitter"
      role="separator"
      tabIndex={0}
      aria-label="Resize the search results"
      aria-orientation="horizontal"
      aria-valuenow={height}
      aria-valuemin={MIN_HEIGHT}
      aria-valuemax={MAX_HEIGHT}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={() => resize(DEFAULT_HEIGHT)}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 48 : 16;
        if (event.key === "ArrowUp") resize(height + step);
        else if (event.key === "ArrowDown") resize(height - step);
        else if (event.key === "Home" || event.key === "Enter") resize(DEFAULT_HEIGHT);
        else return;
        event.preventDefault();
      }}
    />
  );

  if (matches.total === 0) return null;

  if (!matches.isListable) {
    return (
      <aside className="search-results" aria-label="Search results" ref={panelRef}>
        {splitter}
        <p className="search-results-refusal">
          {matches.total.toLocaleString()} matches — too many to list.
          <br />
          <span className="search-results-hint">
            A list of {matches.total.toLocaleString()} rows would not be a tool. Narrow the pattern
            past {DEFAULT_MAX_RESULTS.toLocaleString()} and they appear here.
          </span>
        </p>
      </aside>
    );
  }

  return (
    <aside className="search-results" aria-label="Search results" ref={panelRef} style={{ height }}>
      {splitter}
      {/*
        The column titles the macOS app's table has. Header and rows share one
        grid template, so the titles sit over the values they name — three runs
        of hex digits with nothing saying which is which is what this replaces.
        A grid rather than a <table>: every row is a button, and a button is
        what a row has to be for the keyboard to reach it.
      */}
      <div className="search-results-head" role="presentation">
        <span>Offset</span>
        <span>Excerpt Hex</span>
        <span>Excerpt Text</span>
      </div>
      <ol className="search-results-list">
        {rows.map((row) => (
          <li key={row.start}>
            <button
              type="button"
              className={`search-result${current?.start === row.start ? " is-current" : ""}`}
              onClick={() => {
                // The row becomes the current match, then the panes go to it:
                // clicking a result is choosing one, not only looking at it.
                selectMatch(row.start);
                onGo(row.start);
              }}
            >
              <span className="search-result-offset">
                {row.start.toString(16).toUpperCase().padStart(8, "0")}
              </span>
              <span className="search-result-hex">{row.hex}</span>
              <span className="search-result-text">{row.text}</span>
            </button>
          </li>
        ))}
      </ol>
    </aside>
  );
}
