import { useEffect, useId, useRef, useState } from "react";
import { TOPIC, topicLink } from "@/core/help/helpIds";
import { L } from "@/core/localization/localization";
import { encodingTitle, SEARCH_ENCODINGS, type SearchEncoding } from "@/core/search/searchPattern";
import { favoritesStore, syncProblem } from "@/state/favoritesStore";
import { showNotice } from "@/state/noticeStore";
import {
  clearRecents,
  closeSearch,
  editQuery,
  resultsFor,
  searchStore,
  setCaseSensitive,
  setSearchEncoding,
  setSmartSearch,
  startSearch,
  stepSearch,
  toggleSearchResults,
} from "@/state/searchStore";
import { useStore } from "@/state/useStore";
import { HelpButton } from "@/ui/help/HelpButton";
import { AddFavoriteDialog } from "@/ui/search/AddFavoriteDialog";
import { type MenuSearch, type PatternMenuRow, patternMenuRows } from "@/ui/search/patternMenu";
import { SearchField } from "@/ui/search/SearchField";

/**
 * The find bar.
 *
 * It says three things the engine makes it possible to say, and which a bar
 * that guessed could not: the *exact* count, however large — `> 1000` is not a
 * diagnosis, since 1001 and 3,000,000 call for different actions — which
 * encoding actually found the match, when Smart Search was the one asking, and
 * whether the last step came round the end of the file.
 */
/** The class the shell focuses through, so only one place names it. */
export const FIND_INPUT_CLASS = "find-input";

/**
 * Puts the keyboard in the find field and selects what is there.
 *
 * Reaching for the element rather than passing a ref down: the bar is mounted
 * and unmounted by the shell, so a ref would be null exactly when the shortcut
 * that mounts it needs to use it.
 *
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.focusForEditing
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.focusPatternField
 */
export function focusFindInput(): void {
  // After the render that mounts the bar, not before it.
  requestAnimationFrame(() => {
    const input = document.querySelector<HTMLInputElement>(`input.${FIND_INPUT_CLASS}`);
    input?.focus();
    input?.select();
  });
}

/**
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.caseButton
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.smartButton
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.navControl
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.supportsCaseFolding
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.setUp
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.setUpPatternField
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.setUpEncodingPopup
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.setUpCaseButton
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.setUpSmartButton
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.setUpCountLabel
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.setUpNavControl
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.setUpDoneButton
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.syncCaseButtonAppearance
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.syncSmartButtonAppearance
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.updateCaseButtonVisibility
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.smartToggled
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.iconPointSize
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.countLabel
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.doneButton
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.applyCountLabel
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.findAllButton
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.setUpFindAllButton
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.findAllPressed
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.runSearchAll
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.setResultsShown
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.resultsShown
 * @upstream-differs a React component over the search store
 */
export function FindBar({
  onReveal,
  onManageFavorites,
}: {
  readonly onReveal: (offset: number) => void;
  /** Opens the favourites' list, where Manage Favorites… promises it. */
  readonly onManageFavorites: () => void;
}) {
  const state = useStore(searchStore);
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Reveal whatever the search landed on.
  // The bar reports on the pane it acts on. The other pane's list stays as it
  // was — it is about a file this search is not touching.
  const results = resultsFor(state, state.pane);
  const current = results.current;
  useEffect(() => {
    if (current !== undefined) onReveal(current.start);
  }, [current, onReveal]);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  // A search writes a hex pattern back the way the dump prints it, in the store.
  // The field is not controlled — typing must never be rewritten under the
  // caret — so the store's text is put into it only when the two part, with the
  // caret at the end, since the whole text was replaced.
  // @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.setPatternText
  useEffect(() => {
    const input = inputRef.current;
    if (input === null || input.value === state.query) return;
    input.value = state.query;
    input.setSelectionRange(state.query.length, state.query.length);
  }, [state.query]);

  // A search from the bar leaves the keyboard in the field, so Return searches
  // again; the dump takes it only when the bar is closed.
  // @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.handOffFocusAfterFind
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    // Return re-runs the search when the query changed, and steps when it did
    // not — which is what every find bar does and what the fingers expect.
    if (results.status === "found" && results.matches !== undefined) stepSearch("forward");
    else startSearch({ query: inputRef.current?.value ?? state.query });
  };

  const count = statusText(state);
  // No search yet is not "no matches": the stepper is a way of starting one, so
  // it stays live until a scan has actually come back empty.
  const navLive = results.status !== "notFound" && results.status !== "failed";
  // Hex is bytes, with no case to match: the toggle leaves the bar — unless
  // Smart Search will try the text encodings whatever the popup says.
  const caseFoldable = state.smart || state.encoding !== "hex";

  /**
   * ‹ and › step through the matches a search holds, and start the search in
   * their direction when there is none yet.
   *
   * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.navPressed
   * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.press
   */
  const navigate = (direction: "forward" | "backward") => {
    if (results.matches?.isHighlightable === true) stepSearch(direction);
    else startSearch({ query: inputRef.current?.value ?? state.query, direction });
  };

  const favoriteState = useStore(favoritesStore);
  const favorites = favoriteState.favorites;
  const [keeping, setKeeping] = useState<MenuSearch | undefined>(undefined);

  /** @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.rebuildPatternMenu */
  const menuRows = patternMenuRows({
    recents: state.history,
    favorites,
    fieldText: state.query,
    problem: syncProblem(favoriteState),
  });

  /**
   * A row of either list was picked: it fills the field — pattern, encoding and,
   * for text, the case rule — and runs the search. An entry is chosen
   * deliberately, and the Return that would follow it never means anything
   * else. It records nothing in the history: the history is what was typed.
   *
   * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.patternPicked
   * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.apply
   * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.setPatternText
   */
  const pick = (search: MenuSearch) => {
    const input = inputRef.current;
    if (input !== null) {
      input.value = search.pattern;
      input.setSelectionRange(search.pattern.length, search.pattern.length);
    }
    setSearchEncoding(search.encoding);
    // Hex is byte-exact, so its flag is kept but never restored.
    if (search.encoding !== "hex") setCaseSensitive(search.caseSensitive);
    startSearch({ query: search.pattern, recordHistory: false });
  };

  /**
   * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.onAddToFavorites
   * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.addToFavorites
   * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.onManageFavorites
   * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.manageFavorites
   * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.entryForField
   */
  const choose = (row: PatternMenuRow) => {
    if (row.kind === "entry") {
      const search = row.list === "recent" ? state.history[row.index] : favorites[row.index];
      if (search !== undefined) pick(search);
      return;
    }
    if (row.kind !== "command") return;
    if (row.key === "addToFavorites") {
      // What the field describes, with the encoding that worked.
      setKeeping({
        pattern: inputRef.current?.value ?? state.query,
        encoding: state.encoding,
        caseSensitive: state.caseSensitive,
      });
    } else if (row.key === "clearRecents") {
      clearRecents();
    } else {
      onManageFavorites();
    }
  };

  /**
   * Escape in the field, with its list already away, clears it — which ends the
   * search, since clearing is an edit. Done is the way out of the bar.
   */
  const clearField = () => {
    const input = inputRef.current;
    if (input !== null) input.value = "";
    editQuery("");
  };

  // help: shell.find-bar
  return (
    // `<search>` is the element the role names, and it is a landmark: a screen
    // reader can jump straight to the find bar rather than walking the dump.
    <search className="find-bar">
      <form className="find-form" onSubmit={submit}>
        <span className="find-label" aria-hidden="true">
          Find
        </span>
        <label className="visually-hidden" htmlFor={inputId}>
          Find
        </label>
        {/* Typing ends the last search and starts nothing: Return searches. The
            recent queries drop from the magnifier, or on ↓. */}
        <SearchField
          id={inputId}
          inputRef={inputRef}
          className={FIND_INPUT_CLASS}
          defaultValue={state.query}
          placeholder={L("Find bytes or text…")}
          rows={menuRows}
          onEdit={editQuery}
          onChoose={choose}
          onEscape={clearField}
        />
        <select
          className="find-encoding"
          aria-label={L("Encoding")}
          value={state.encoding}
          onChange={(event) => setSearchEncoding(event.target.value as SearchEncoding)}
          title={
            state.smart
              ? "The encoding the search settled on. Picking one starts the next pass from it."
              : "How the text is turned into bytes"
          }
        >
          {SEARCH_ENCODINGS.map((encoding) => (
            <option key={encoding} value={encoding}>
              {encodingTitle(encoding)}
            </option>
          ))}
        </select>

        {/* Beside the encoding it takes over: with it on, the popup stops being
            the question and becomes the answer. */}
        <button
          type="button"
          className={`find-glyph${state.smart ? " is-on" : ""}`}
          aria-pressed={state.smart}
          aria-label={L("Smart Search")}
          title={
            state.smart
              ? "Smart Search — the encoding is whichever one finds a match"
              : "Smart Search — off, searching the chosen encoding only"
          }
          onClick={() => setSmartSearch(!state.smart)}
        >
          <SmartSearchGlyph />
        </button>

        {caseFoldable ? (
          <button
            type="button"
            className={`find-glyph${state.caseSensitive ? " is-on" : ""}`}
            aria-pressed={state.caseSensitive}
            aria-label={L("Case Sensitive")}
            title={
              state.caseSensitive
                ? "Case Sensitive — matching exactly"
                : "Case Sensitive — off, upper and lower case match"
            }
            onClick={() => setCaseSensitive(!state.caseSensitive)}
          >
            <CaseGlyph />
          </button>
        ) : null}

        {/* After the query it describes, before the stepper that walks it. */}
        {count === "" ? null : (
          <span
            className={`find-count${results.status === "failed" ? " is-problem" : ""}`}
            aria-live="polite"
          >
            {count}
          </span>
        )}

        <fieldset className="find-nav">
          <legend className="visually-hidden">{L("Find Previous / Find Next")}</legend>
          <button
            type="button"
            className="find-nav-button"
            aria-label={L("Find Previous")}
            title={L("Find Previous")}
            disabled={!navLive}
            onClick={() => navigate("backward")}
          >
            <ChevronGlyph direction="backward" />
          </button>
          <button
            type="button"
            className="find-nav-button"
            aria-label={L("Find Next")}
            title={L("Find Next")}
            disabled={!navLive}
            onClick={() => navigate("forward")}
          >
            <ChevronGlyph direction="forward" />
          </button>
        </fieldset>

        {/* A toggle, not a search: accent while the pane's list is up, the
            bar's quiet grey otherwise — the case toggle's "on" language. */}
        <button
          type="button"
          className={`find-glyph${results.resultsShown ? " is-on" : ""}`}
          aria-label={L("Search Results")}
          aria-pressed={results.resultsShown}
          title={results.resultsShown ? L("Hide Search Results") : L("Show Search Results")}
          disabled={!navLive}
          onClick={() => toggleSearchResults(inputRef.current?.value ?? state.query)}
        >
          <ListGlyph />
        </button>

        {/* The `?` before Done, opening the page about searching: hex and text,
            the encodings, and what the pattern library is for.
            @upstream Packages/HelpUI/Sources/HelpUI/HelpButton.swift#HelpButton.inline */}
        <HelpButton link={topicLink(TOPIC.search)} shape="inline" />

        <button type="button" className="toolbar-button find-done" onClick={closeSearch}>
          {L("Done")}
        </button>
      </form>
      {/* Beside the bar's form, never inside it: a form nested in a form is not
          one the browser keeps apart, and Return in the name field submitted
          the page itself — a reload. */}
      <AddFavoriteDialog
        search={keeping}
        onClose={() => setKeeping(undefined)}
        onKept={(name) => showNotice("addedToFavorites", ["Added to Favorites", name])}
      />
    </search>
  );
}

const glyphStroke = {
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/** `wand.and.sparkles`. */
function SmartSearchGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" {...glyphStroke}>
      <path d="M2.5 13.5 10 6" />
      <path d="m9 5 2 2" />
      <path d="M12 1.5v2M11 2.5h2" />
      <path d="M13.5 6.5v1.5M12.75 7.25h1.5" />
      <path d="M6 1.5v1.5M5.25 2.25h1.5" />
    </svg>
  );
}

/** `textformat`: a large A beside a small a. */
function CaseGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" {...glyphStroke}>
      <path d="M1.5 12.5 4.75 3.5 8 12.5M2.7 9.5h4.1" />
      <path d="M14.5 8v4.5" />
      <circle cx="12.25" cy="10.25" r="2.25" />
    </svg>
  );
}

/** `list.bullet`. */
function ListGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" {...glyphStroke}>
      <path d="M6 4h8.5M6 8h8.5M6 12h8.5" />
      <circle cx="2.5" cy="4" r="0.6" />
      <circle cx="2.5" cy="8" r="0.6" />
      <circle cx="2.5" cy="12" r="0.6" />
    </svg>
  );
}

/** `chevron.left` / `chevron.right`. */
function ChevronGlyph({ direction }: { readonly direction: "forward" | "backward" }) {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" {...glyphStroke}>
      <path d={direction === "forward" ? "m6 3 5 5-5 5" : "M10 3 5 8l5 5"} />
    </svg>
  );
}

/**
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.show
 * @upstream ByteRipperApp/Search/FindCount.swift#FindCount
 * @upstream ByteRipperApp/Search/FindCount.swift#FindCount.total
 * @upstream ByteRipperApp/Search/FindCount.swift#FindCount.ordinal
 * @upstream ByteRipperApp/Search/FindCount.swift#FindCount.isListable
 * @upstream ByteRipperApp/Search/FindCount.swift#FindCount.isHighlightable
 * @upstream ByteRipperApp/Search/FindCount.swift#FindCount.reading
 * @upstream ByteRipperApp/Search/FindCount.swift#FindCount.hasMatches
 * @upstream ByteRipperApp/Search/FindCount.swift#FindCount.text
 * @upstream ByteRipperApp/Search/FindCount.swift#FindCount.warning
 * @upstream ByteRipperApp/Search/SearchEncodingNaming.swift#SmartSearch.Attempt
 * @upstream ByteRipperApp/Search/SearchEncodingNaming.swift#SmartSearch.Attempt.label
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.showFindMessage
 * @upstream-differs the count and the encoding that answered are read from the store's results in one function; a find message is said here, where a count would go, without a beep
 */
function statusText(state: ReturnType<typeof searchStore.getSnapshot>): string {
  const results = resultsFor(state, state.pane);
  if (results.status === "failed") return state.problem ?? "That search could not be run.";
  if (results.status === "idle") return "";
  if (results.status === "notFound") return "Not found";
  const matches = results.matches;
  const current = results.current;
  // A search the results button started has no current match — the caret did
  // not move — so until its index arrives it is still searching.
  if (
    (results.status === "searching" || results.status === "found") &&
    current === undefined &&
    matches === undefined
  ) {
    return "Searching…";
  }

  const parts: string[] = [];

  if (matches?.isHighlightable) {
    const ordinal = current === undefined ? undefined : matches.indexStartingAt(current.start);
    // The ordinal is only meaningful once the whole file has been scanned;
    // until then the count is what has been found so far.
    if (ordinal !== undefined && matches.isComplete) {
      parts.push(`${ordinal + 1} of ${matches.total.toLocaleString()}`);
    } else {
      parts.push(`${matches.total.toLocaleString()}${matches.isComplete ? "" : "+"} found`);
    }
  } else if (matches !== undefined && !matches.isHighlightable && matches.total > 0) {
    // Past the index ceiling: the count is exact even though the positions are
    // not kept, and saying so is more use than a silent partial highlight.
    parts.push(`${matches.total.toLocaleString()} found — too many to mark`);
  } else if (current !== undefined) {
    parts.push("Found");
  }

  // Which encoding answered, when Smart Search was the one asking.
  if (state.smart && results.foundEncoding !== undefined) {
    parts.push(`as ${encodingTitle(results.foundEncoding)}`);
  }
  if (results.wrapped) parts.push("· wrapped");
  return parts.join(" ");
}
