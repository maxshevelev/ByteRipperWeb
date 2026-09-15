import { useCallback, useEffect, useRef, useState } from "react";
import type { BinaryDocument } from "@/core/document/binaryDocument";
import type { MatchSet } from "@/core/search/matchSet";
import { formatHex } from "@/core/text/hexText";
import { hideSearchResults, type SearchStatus, selectMatch } from "@/state/searchStore";
import { createTimeSlicer } from "@/state/timeSlice";
import { activeDecoder, type PaneId } from "@/state/workspaceStore";
import {
  searchResultsContent,
  searchResultsMessage,
  searchResultsTitle,
} from "@/ui/search/searchResultsContent";

/**
 * Every match, as a list, under a title that counts them and a × that puts the
 * list away.
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
 *
 * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.minSearchResultsHeight
 */
const MIN_HEIGHT = 64;
const MAX_HEIGHT = 420;
/** @upstream ByteRipperApp/Search/SearchResultsViewController.swift#SearchResultsViewController.panelHeight */
const DEFAULT_HEIGHT = 150;
/** @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.searchResultsHeightDefaultsKey */
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
  /** Whose results these are: the list belongs to one pane's file. */
  readonly pane: PaneId;
  /** The pane's set, when its search has one yet. */
  readonly matches: MatchSet | undefined;
  /** How far the pane's search has got. */
  readonly status: SearchStatus;
  readonly document: BinaryDocument;
  readonly current: { readonly start: number; readonly end: number } | undefined;
  /** @upstream ByteRipperApp/Search/SearchResultsViewController.swift#SearchResultsViewController.onSelect */
  readonly onGo: (offset: number) => void;
}

/**
 * @upstream ByteRipperApp/Search/SearchResultsViewController.swift#SearchResultsViewController.tableView
 * @upstream ByteRipperApp/Search/SearchResultCellView.swift#SearchResultCellView
 * @upstream ByteRipperApp/Search/SearchResultCellView.swift#SearchResultCellView.attributedText
 * @upstream-differs a list item per match
 */
interface Row {
  readonly start: number;
  readonly hex: string;
  readonly text: string;
}

/**
 * @upstream ByteRipperApp/Search/SearchResultsViewController.swift#SearchResultsViewController
 * @upstream ByteRipperApp/Search/SearchResultsViewController.swift#SearchResultsViewController.show
 * @upstream ByteRipperApp/Search/SearchResultsViewController.swift#SearchResultsViewController.reload
 * @upstream ByteRipperApp/Search/SearchResultsViewController.swift#SearchResultsViewController.headerLabel
 * @upstream ByteRipperApp/Search/SearchResultsViewController.swift#SearchResultsViewController.closeButton
 * @upstream ByteRipperApp/Search/SearchResultsViewController.swift#SearchResultsViewController.closePressed
 * @upstream ByteRipperApp/Search/SearchResultsViewController.swift#SearchResultsViewController.messageLabel
 */
export function SearchResults({
  pane,
  matches,
  status,
  document: doc,
  current,
  onGo,
}: SearchResultsProps) {
  const content = searchResultsContent(matches, status);
  const [rows, setRows] = useState<Row[]>([]);

  /**
   * The rows already read, by where their match starts. A running search
   * publishes its set every tenth of a second, each one the last plus what the
   * scan found since; reading every excerpt again for each was the list holding
   * the interface. A different document, pattern or decoder starts afresh.
   */
  const built = useRef<{
    readonly doc: BinaryDocument;
    readonly pattern: MatchSet["pattern"];
    readonly decoder: ReturnType<typeof activeDecoder>;
    readonly rows: Map<number, Row>;
  }>(undefined);

  const listing = content.kind === "matches" ? matches : undefined;

  useEffect(() => {
    if (listing === undefined) {
      setRows([]);
      return;
    }

    const decoder = activeDecoder();
    let known = built.current;
    if (
      known === undefined ||
      known.doc !== doc ||
      known.pattern !== listing.pattern ||
      known.decoder !== decoder
    ) {
      known = { doc, pattern: listing.pattern, decoder, rows: new Map() };
      built.current = known;
    }
    const cache = known.rows;

    let cancelled = false;
    const pause = createTimeSlicer();
    void (async () => {
      const listed: Row[] = [];
      for (let index = 0; index < listing.total; index++) {
        const range = listing.rangeAt(index);
        if (range === undefined) continue;
        let row = cache.get(range.start);
        if (row === undefined) {
          const from = Math.max(0, range.start - CONTEXT_BYTES);
          const to = Math.min(doc.size, range.end + CONTEXT_BYTES);
          const bytes = await doc.read(from, to - from);
          if (cancelled) return;
          row = {
            start: range.start,
            hex: formatHex(bytes, bytes.length),
            text: decoder.decodeAll(bytes),
          };
          cache.set(range.start, row);
        }
        listed.push(row);
        const turn = pause();
        if (turn !== undefined) {
          await turn;
          if (cancelled) return;
        }
      }
      if (!cancelled) setRows(listed);
    })();

    return () => {
      cancelled = true;
    };
    // The document's version is not a dependency on purpose: an edit clears the
    // set, which takes the panel away, and its cache of rows with it.
  }, [listing, doc]);

  const [height, setHeight] = useState(storedHeight);
  const panelRef = useRef<HTMLElement | null>(null);
  const dragging = useRef(false);

  /** @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.setSearchResultsPanelHeight */
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
    // Capture keeps the drag steering after the pointer leaves the handle.
    // Failing to get it is not a reason to refuse the drag — it just stops at
    // the handle's edge.
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // No active pointer with that id; carry on without capture.
    }
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
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Nothing to release.
    }
  }, []);

  const message = searchResultsMessage(content);

  return (
    <aside className="search-results" aria-label="Search results" ref={panelRef} style={{ height }}>
      {/* biome-ignore lint/a11y/useSemanticElements: an <hr> cannot be dragged */}
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

      {/* The title counts what the list holds; the × puts the list away and
          leaves the search itself alone. */}
      <div className="search-results-title">
        <span aria-live="polite">{searchResultsTitle(content, matches)}</span>
        <button
          type="button"
          className="search-results-close"
          aria-label="Close search results"
          title="Close search results"
          onClick={() => hideSearchResults(pane)}
        >
          <svg
            viewBox="0 0 16 16"
            width="11"
            height="11"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          >
            <path d="m3.5 3.5 9 9M12.5 3.5l-9 9" />
          </svg>
        </button>
      </div>

      {message !== undefined ? (
        <p className="search-results-message">{message}</p>
      ) : (
        <>
          {/*
            The column titles the macOS app's table has. Header and rows share
            one grid template, so the titles sit over the values they name. A
            grid rather than a <table>: every row is a button, and a button is
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
                    // The row becomes the current match, then the panes go to
                    // it: clicking a result is choosing one, not only looking.
                    selectMatch(pane, row.start);
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
        </>
      )}
    </aside>
  );
}
