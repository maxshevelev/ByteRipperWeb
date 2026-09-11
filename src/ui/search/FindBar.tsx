import { useEffect, useId, useRef } from "react";
import { encodingTitle, SEARCH_ENCODINGS, type SearchEncoding } from "@/core/search/searchPattern";
import { closeSearch, searchStore, startSearch, stepSearch } from "@/state/searchStore";
import { useStore } from "@/state/useStore";

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
 */
export function focusFindInput(): void {
  // After the render that mounts the bar, not before it.
  requestAnimationFrame(() => {
    const input = document.querySelector<HTMLInputElement>(`input.${FIND_INPUT_CLASS}`);
    input?.focus();
    input?.select();
  });
}

export function FindBar({ onReveal }: { readonly onReveal: (offset: number) => void }) {
  const state = useStore(searchStore);
  const inputId = useId();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Reveal whatever the search landed on.
  const current = state.current;
  useEffect(() => {
    if (current !== undefined) onReveal(current.start);
  }, [current, onReveal]);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    // Return re-runs the search when the query changed, and steps when it did
    // not — which is what every find bar does and what the fingers expect.
    if (state.status === "found" && state.matches !== undefined) stepSearch("forward");
    else startSearch({ query: inputRef.current?.value ?? state.query });
  };

  return (
    // `<search>` is the element the role names, and it is a landmark: a screen
    // reader can jump straight to the find bar rather than walking the dump.
    <search className="find-bar">
      <form className="find-form" onSubmit={submit}>
        <label className="visually-hidden" htmlFor={inputId}>
          Find in the dump
        </label>
        <input
          id={inputId}
          ref={inputRef}
          className="find-input"
          list={listId}
          defaultValue={state.query}
          placeholder="Find bytes or text…"
          spellCheck={false}
          onChange={(event) => startSearch({ query: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              closeSearch();
            }
          }}
        />
        {/* The queries this session has run, offered back rather than retyped. */}
        <datalist id={listId}>
          {state.history.map((entry) => (
            <option key={entry} value={entry} />
          ))}
        </datalist>

        <select
          className="find-encoding"
          value={state.encoding}
          onChange={(event) =>
            startSearch({
              query: state.query,
              encoding: event.target.value as SearchEncoding | "smart",
            })
          }
          title="How the text is turned into bytes"
        >
          <option value="smart">Smart</option>
          {SEARCH_ENCODINGS.map((encoding) => (
            <option key={encoding} value={encoding}>
              {encodingTitle(encoding)}
            </option>
          ))}
        </select>

        <button
          type="button"
          className={`toolbar-button find-case${state.caseSensitive ? " is-on" : ""}`}
          aria-pressed={state.caseSensitive}
          // Hex has no case to be sensitive about.
          disabled={state.encoding === "hex"}
          onClick={() => startSearch({ query: state.query, caseSensitive: !state.caseSensitive })}
          title="Match upper and lower case exactly"
        >
          Aa
        </button>

        <button
          type="button"
          className="toolbar-button"
          onClick={() => stepSearch("backward")}
          disabled={state.matches === undefined || !state.matches.isHighlightable}
          title="Previous match"
        >
          ◀
        </button>
        <button
          type="button"
          className="toolbar-button"
          onClick={() => stepSearch("forward")}
          disabled={state.matches === undefined || !state.matches.isHighlightable}
          title="Next match"
        >
          ▶
        </button>

        <span className="find-status">{statusText(state)}</span>
        <span className="toolbar-spacer" />
        <button
          type="button"
          className="toolbar-button"
          onClick={closeSearch}
          title="Close (Escape)"
        >
          Close
        </button>
      </form>
    </search>
  );
}

function statusText(state: ReturnType<typeof searchStore.getSnapshot>): string {
  if (state.status === "failed") return state.problem ?? "That search could not be run.";
  if (state.status === "idle") return "";
  if (state.status === "notFound") return "Not found";
  if (state.status === "searching" && state.current === undefined) return "Searching…";

  const parts: string[] = [];
  const matches = state.matches;
  const current = state.current;

  if (matches !== undefined && current !== undefined && matches.isHighlightable) {
    const ordinal = matches.indexStartingAt(current.start);
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
  if (state.encoding === "smart" && state.foundEncoding !== undefined) {
    parts.push(`as ${encodingTitle(state.foundEncoding)}`);
  }
  if (state.wrapped) parts.push("· wrapped");
  return parts.join(" ");
}
