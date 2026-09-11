import { useEffect, useState } from "react";
import type { BinaryDocument } from "@/core/document/binaryDocument";
import type { MatchSet } from "@/core/search/matchSet";
import { DEFAULT_MAX_RESULTS } from "@/core/search/searchEngine";
import { formatHex } from "@/core/text/hexText";
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

  if (matches.total === 0) return null;

  if (!matches.isListable) {
    return (
      <aside className="search-results" aria-label="Search results">
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
    <aside className="search-results" aria-label="Search results">
      <ol className="search-results-list">
        {rows.map((row) => (
          <li key={row.start}>
            <button
              type="button"
              className={`search-result${current?.start === row.start ? " is-current" : ""}`}
              onClick={() => onGo(row.start)}
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
