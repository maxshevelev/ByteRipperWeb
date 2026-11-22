import { useId, useRef, useState } from "react";
import { TOPIC, topicLink } from "@/core/help/helpIds";
import { L } from "@/core/localization/localization";
import { encodingTitle } from "@/core/search/searchPattern";
import { showNotice } from "@/state/noticeStore";
import {
  barFor,
  closeSearch,
  editQuery,
  resultsFor,
  runSearch,
  type SearchState,
  searchStore,
  startSearch,
  toggleSearchResults,
} from "@/state/searchStore";
import { useStore, useStoreSelector } from "@/state/useStore";
import {
  type PaneId,
  type SurfaceId,
  WORKSPACE_SURFACE,
  workspaceStore,
} from "@/state/workspaceStore";
import { HelpButton } from "@/ui/help/HelpButton";
import { AddFavoriteDialog } from "@/ui/search/AddFavoriteDialog";
import { ChevronGlyph, ListGlyph } from "@/ui/search/findGlyphs";
import { PatternQueryControls } from "@/ui/search/PatternQueryControls";
import type { MenuSearch } from "@/ui/search/patternMenu";

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

/** The bar's own surface, on its element: which bar the shell focuses. */
const SURFACE_ATTRIBUTE = "data-find-surface";

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
export function focusFindInput(surface: SurfaceId): void {
  // After the render that mounts the bar, not before it.
  requestAnimationFrame(() => {
    const input = document.querySelector<HTMLInputElement>(
      `[${SURFACE_ATTRIBUTE}="${surface}"] input.${FIND_INPUT_CLASS}`
    );
    input?.focus();
    input?.select();
  });
}

/**
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.query
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.onAddToFavorites
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.onManageFavorites
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.caseButton
 * @upstream ByteRipperApp/Search/PatternQueryControls.swift#PatternQueryControls.caseButton
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.smartButton
 * @upstream ByteRipperApp/Search/PatternQueryControls.swift#PatternQueryControls.smartButton
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.navControl
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.supportsCaseFolding
 * @upstream ByteRipperApp/Search/PatternQueryControls.swift#PatternQueryControls.supportsCaseFolding
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.setUp
 * @upstream ByteRipperApp/Search/PatternQueryControls.swift#PatternQueryControls.setUpPatternField
 * @upstream ByteRipperApp/Search/PatternQueryControls.swift#PatternQueryControls.setUpEncodingPopup
 * @upstream ByteRipperApp/Search/PatternQueryControls.swift#PatternQueryControls.setUpCaseButton
 * @upstream ByteRipperApp/Search/PatternQueryControls.swift#PatternQueryControls.setUpSmartButton
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.setUpCountLabel
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.setUpNavControl
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.setUpDoneButton
 * @upstream ByteRipperApp/Search/PatternQueryControls.swift#PatternQueryControls.syncCaseButtonAppearance
 * @upstream ByteRipperApp/Search/PatternQueryControls.swift#PatternQueryControls.syncSmartButtonAppearance
 * @upstream ByteRipperApp/Search/PatternQueryControls.swift#PatternQueryControls.updateCaseButtonVisibility
 * @upstream ByteRipperApp/Search/PatternQueryControls.swift#PatternQueryControls.smartToggled
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.iconPointSize
 * @upstream ByteRipperApp/Search/PatternQueryControls.swift#PatternQueryControls.iconPointSize
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.countLabel
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.doneButton
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.applyCountLabel
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.findAllButton
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.setUpFindAllButton
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.findAllPressed
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.runSearchAll
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.setResultsShown
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.resultsShown
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.verticalInset
 * @upstream ByteRipperApp/Search/SurfaceFindController.swift#SurfaceFindController.wireBar
 * @upstream-differs a React component over the search store, one per surface: the tab's over
 * its panes and the minimap, a fragment panel's over its dump (`surface`)
 */
export function FindBar({
  surface,
}: {
  /** Whose bar this is: the tab's, or a fragment panel's. */
  readonly surface: SurfaceId;
}) {
  const state = useStore(searchStore);
  const bar = barFor(state, surface);
  // The tab's bar searches the active pane; a panel's, its part.
  const activePane = useStoreSelector(workspaceStore, (workspace) => workspace.activePane);
  const pane: PaneId = surface === WORKSPACE_SURFACE ? activePane : surface;
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);

  // The bar reports on the pane it acts on. The other pane's list stays as it
  // was — it is about a file this search is not touching. What a search lands
  // on is shown by the shell (`useMatchLanding`), with the bar up or not.
  const results = resultsFor(state, pane);

  // A search from the bar leaves the keyboard in the field, so Return searches
  // again; the dump takes it only when the bar is closed.
  // @upstream ByteRipperApp/Search/SurfaceFindController.swift#SurfaceFindController.handOffFocus
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    // Return steps through the search in hand for what the field asks, and runs
    // a new one otherwise — which is what every find bar does and what the
    // fingers expect.
    runSearch(inputRef.current?.value ?? bar.query, "forward", surface);
  };

  const count = statusText(state, surface, pane);
  // No search yet is not "no matches": the stepper is a way of starting one, so
  // it stays live until a scan has actually come back empty.
  const navLive = results.status !== "notFound" && results.status !== "failed";

  /**
   * ‹ and › step through the matches a search holds, and start the search in
   * their direction when there is none yet.
   *
   * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.navPressed
   * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.press
   */
  const navigate = (direction: "forward" | "backward") => {
    runSearch(inputRef.current?.value ?? bar.query, direction, surface);
  };

  const [keeping, setKeeping] = useState<MenuSearch | undefined>(undefined);

  /**
   * Escape in the field, with its list already away, clears it — which ends the
   * search, since clearing is an edit. Done is the way out of the bar.
   */
  const clearField = () => {
    const input = inputRef.current;
    if (input !== null) input.value = "";
    editQuery("", surface);
  };

  // help: shell.find-bar
  return (
    // `<search>` is the element the role names, and it is a landmark: a screen
    // reader can jump straight to the find bar rather than walking the dump.
    <search className="find-bar" {...{ [SURFACE_ATTRIBUTE]: surface }}>
      <form className="find-form" onSubmit={submit}>
        <span className="find-label" aria-hidden="true">
          {L("Find")}
        </span>
        <label className="visually-hidden" htmlFor={inputId}>
          {L("Find")}
        </label>
        {/* Typing ends the last search and starts nothing: Return searches. The
            recent queries drop from the magnifier, or on ↓.
            The placeholder is upstream's word for the find's affordance — the
            toolbar button's tooltip — doubled as the field's: the field itself
            has none upstream, the bar's `Find` label names it instead.
            @upstream ByteRipperApp/App/MainWindowController.swift#MainWindowController.findItem */}
        <PatternQueryControls
          id={inputId}
          inputRef={inputRef}
          className={FIND_INPUT_CLASS}
          surface={surface}
          text={bar.query}
          placeholder={L("Find bytes or text")}
          onEdit={(text) => editQuery(text, surface)}
          // A row of either list was picked: it runs, and records nothing in the history — the
          // history is what was typed.
          // @upstream ByteRipperApp/Search/PatternQueryControls.swift#PatternQueryControls.patternPicked
          onPicked={(search) =>
            startSearch({ query: search.pattern, surface, recordHistory: false })
          }
          onEscape={clearField}
          onKeep={setKeeping}
        />
        {/* After the query it describes, before the stepper that walks it. */}
        {count === "" ? null : (
          <span
            className={`find-count${
              results.status === "failed"
                ? " is-problem"
                : results.status === "notFound"
                  ? " is-negative"
                  : ""
            }`}
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
          onClick={() => toggleSearchResults(inputRef.current?.value ?? bar.query, surface)}
        >
          <ListGlyph />
        </button>

        {/* The `?` before Done, opening the page about searching: hex and text,
            the encodings, and what the pattern library is for.
            @upstream Packages/HelpUI/Sources/HelpUI/HelpButton.swift#HelpButton.inline */}
        <HelpButton link={topicLink(TOPIC.search)} shape="inline" />

        <button
          type="button"
          className="toolbar-button find-done"
          onClick={() => closeSearch(surface)}
        >
          {L("Done")}
        </button>
      </form>
      {/* Beside the bar's form, never inside it: a form nested in a form is not
          one the browser keeps apart, and Return in the name field submitted
          the page itself — a reload. */}
      <AddFavoriteDialog
        search={keeping}
        onClose={() => setKeeping(undefined)}
        onKept={(name) => showNotice("addedToFavorites", [L("Added to Favorites"), name])}
      />
    </search>
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
 * @upstream ByteRipperApp/Search/SurfaceFindController.swift#SurfaceFindController.showFindMessage
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.PaneContext
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.PaneContext.count
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.PaneContext.resultsShown
 * @upstream ByteRipperApp/Search/FindBarView.swift#FindBarView.apply
 * @upstream-differs the count and the encoding that answered are read from the store's results in one function; a find message is said here, where a count would go, without a beep
 */
function statusText(state: SearchState, surface: SurfaceId, pane: PaneId): string {
  const results = resultsFor(state, pane);
  if (results.status === "failed") {
    return barFor(state, surface).problem ?? L("That search could not be run.");
  }
  if (results.status === "idle") return "";
  if (results.status === "notFound") return L("Not found");
  const matches = results.matches;
  const current = results.current;
  // A search the results button started has no current match — the caret did
  // not move — so until its index arrives it is still searching.
  // A pass still looking holds a set that covers nothing yet.
  const nothingCovered =
    matches === undefined || (matches.indexedUpTo === 0 && !matches.isComplete);
  if (
    (results.status === "searching" || results.status === "found") &&
    current === undefined &&
    nothingCovered
  ) {
    return L("Searching…");
  }

  const parts: string[] = [];

  if (matches?.isHighlightable) {
    const ordinal = current === undefined ? undefined : matches.indexStartingAt(current.start);
    // The ordinal is only meaningful once the whole file has been scanned;
    // until then the count is what has been found so far.
    if (ordinal !== undefined && matches.isComplete) {
      parts.push(L("%1$@ of %2$@", ordinal + 1, matches.total.toLocaleString()));
    } else {
      const total = matches.total.toLocaleString();
      parts.push(matches.isComplete ? L("%1$@ found", total) : L("%1$@+ found", total));
    }
  } else if (matches !== undefined && !matches.isHighlightable && matches.total > 0) {
    // Past the index ceiling: the count is exact even though the positions are
    // not kept, and saying so is more use than a silent partial highlight.
    parts.push(L("%1$@ found — too many to mark", matches.total.toLocaleString()));
  } else if (current !== undefined) {
    parts.push(L("Found"));
  }

  // Which encoding answered, when Smart Search was the one asking.
  if (state.smart && results.foundEncoding !== undefined) {
    parts.push(L("as %1$@", encodingTitle(results.foundEncoding)));
  }
  if (results.wrapped) parts.push(L("· wrapped"));
  return parts.join(" ");
}
