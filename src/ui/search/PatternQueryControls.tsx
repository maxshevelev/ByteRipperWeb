import { useEffect, useState } from "react";
import { L } from "@/core/localization/localization";
import { encodingTitle, SEARCH_ENCODINGS, type SearchEncoding } from "@/core/search/searchPattern";
import { favoritesStore, requestManageFavorites, syncProblem } from "@/state/favoritesStore";
import { showNotice } from "@/state/noticeStore";
import {
  clearRecents,
  searchStore,
  setCaseSensitive,
  setSearchEncoding,
  setSmartSearch,
} from "@/state/searchStore";
import { useStore } from "@/state/useStore";
import { AddFavoriteDialog } from "@/ui/search/AddFavoriteDialog";
import { type MenuSearch, type PatternMenuRow, patternMenuRows } from "@/ui/search/patternMenu";
import { SearchField } from "@/ui/search/SearchField";

/**
 * What to look for, asked the way the dump's Find bar asks it (§11): the pattern field — whose
 * magnifier drops the menu of recent queries and of the pattern library, with the commands that
 * keep, clear and manage them — the encoding popup, the Smart Search toggle and the case toggle.
 *
 * One set of controls wherever a pattern is asked for, so it reads, behaves and remembers alike:
 * the Find bar is built round it, and a tool that searches bytes gets one through its context
 * (`ToolContext.PatternQuery`). The recents and the library are the app's one history and one
 * library, and the Smart Search and case toggles are the app's one pair of standing choices.
 *
 * It holds no search of its own. It says what the field holds, and a row picked from the menu
 * is loaded into the controls — pattern, encoding and, for text, the case rule — and handed to
 * the owner to run.
 *
 * @upstream ByteRipperApp/Search/PatternQueryControls.swift#PatternQueryControls
 * @upstream ByteRipperApp/Search/PatternQueryControls.swift#PatternQueryControls.patternPicked
 * @upstream ByteRipperApp/Search/PatternQueryControls.swift#PatternQueryControls.rebuildPatternMenu
 * @upstream ByteRipperApp/Search/PatternQueryControls.swift#PatternQueryControls.onAddToFavorites
 * @upstream ByteRipperApp/Search/PatternQueryControls.swift#PatternQueryControls.onManageFavorites
 * @upstream-differs a React component over the search store, the field uncontrolled so typing is
 * never rewritten under the caret
 */
export function PatternQueryControls({
  id,
  inputRef,
  className,
  text,
  placeholder,
  onEdit,
  onPicked,
  onEscape,
  onKeep,
}: {
  readonly id: string;
  readonly inputRef: React.RefObject<HTMLInputElement | null>;
  readonly className: string;
  /** The text the field shows; put into it only when the two part. */
  readonly text: string;
  readonly placeholder: string;
  readonly onEdit: (text: string) => void;
  /** A row of either list was picked and loaded into the controls: the owner runs it. */
  readonly onPicked: (search: MenuSearch) => void;
  readonly onEscape: () => void;
  /**
   * Save Search Pattern, with what the field describes: the owner asks for the name. Without it
   * the controls ask themselves — which an owner whose controls sit in a form must not let them
   * do, a form in a form being one the browser does not keep apart.
   */
  readonly onKeep?: ((search: MenuSearch) => void) | undefined;
}) {
  const state = useStore(searchStore);
  const favoriteState = useStore(favoritesStore);
  const favorites = favoriteState.favorites;
  const [keeping, setKeeping] = useState<MenuSearch | undefined>(undefined);

  useEffect(() => {
    const input = inputRef.current;
    if (input === null || input.value === text) return;
    input.value = text;
    input.setSelectionRange(text.length, text.length);
  }, [inputRef, text]);

  const menuRows = patternMenuRows({
    recents: state.history,
    favorites,
    fieldText: text,
    problem: syncProblem(favoriteState),
  });

  const pick = (search: MenuSearch) => {
    const input = inputRef.current;
    if (input !== null) {
      input.value = search.pattern;
      input.setSelectionRange(search.pattern.length, search.pattern.length);
    }
    setSearchEncoding(search.encoding);
    // Hex is byte-exact, so its flag is kept but never restored.
    if (search.encoding !== "hex") setCaseSensitive(search.caseSensitive);
    onPicked(search);
  };

  const choose = (row: PatternMenuRow) => {
    if (row.kind === "entry") {
      const search = row.list === "recent" ? state.history[row.index] : favorites[row.index];
      if (search !== undefined) pick(search);
      return;
    }
    if (row.kind !== "command") return;
    if (row.key === "addToFavorites") {
      // What the field describes, with the encoding that worked.
      const search = {
        pattern: inputRef.current?.value ?? text,
        encoding: state.encoding,
        caseSensitive: state.caseSensitive,
      };
      if (onKeep !== undefined) onKeep(search);
      else setKeeping(search);
    } else if (row.key === "clearRecents") {
      clearRecents();
    } else {
      requestManageFavorites();
    }
  };

  // Hex is bytes, with no case to match: the toggle leaves the bar — unless Smart Search will try
  // the text encodings whatever the popup says.
  const caseFoldable = state.smart || state.encoding !== "hex";

  return (
    <>
      <SearchField
        id={id}
        inputRef={inputRef}
        className={className}
        defaultValue={text}
        placeholder={placeholder}
        rows={menuRows}
        onEdit={onEdit}
        onChoose={choose}
        onEscape={onEscape}
      />
      <select
        className="find-encoding"
        aria-label={L("Encoding")}
        value={state.encoding}
        onChange={(event) => setSearchEncoding(event.target.value as SearchEncoding)}
        // @web-only the popup's explanation; upstream's has no tooltip
        title={
          state.smart
            ? L("The encoding the search settled on. Picking one starts the next pass from it.")
            : L("How the text is turned into bytes")
        }
      >
        {SEARCH_ENCODINGS.map((encoding) => (
          <option key={encoding} value={encoding}>
            {encodingTitle(encoding)}
          </option>
        ))}
      </select>
      {/* Beside the encoding it takes over: with it on, the popup stops being the question and
          becomes the answer. */}
      <button
        type="button"
        className={`find-glyph${state.smart ? " is-on" : ""}`}
        aria-pressed={state.smart}
        aria-label={L("Smart Search")}
        title={
          state.smart
            ? L("Smart Search — the encoding is whichever one finds a match")
            : L("Smart Search — off, searching the chosen encoding only")
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
              ? L("Case Sensitive — matching exactly")
              : L("Case Sensitive — off, upper and lower case match")
          }
          onClick={() => setCaseSensitive(!state.caseSensitive)}
        >
          <CaseGlyph />
        </button>
      ) : null}
      {onKeep !== undefined ? null : (
        <AddFavoriteDialog
          search={keeping}
          onClose={() => setKeeping(undefined)}
          onKept={(name) => showNotice("addedToFavorites", [L("Added to Favorites"), name])}
        />
      )}
    </>
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
