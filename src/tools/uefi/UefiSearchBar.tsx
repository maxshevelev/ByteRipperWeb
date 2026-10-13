import { type ReactElement, useEffect, useRef } from "react";
import { L } from "@/core/localization/localization";
import type { UEFIContentQuery, UEFISearchMode } from "@/state/uefiSearchSettings";
import {
  hasSubtypes,
  type SearchDirection,
  searchSubtypes,
  searchTypes,
  type UEFITreeQuery,
} from "@/tools/uefi/uefiTreeSearch";

/** What the status line says when there is something to say. */
export type SearchStatus = "none" | "notFound" | "searching";

/**
 * The tree's search bar, between the title and the tree: what to look for on one line —
 * the text, and the two arrows that go to the next and the previous match — and what
 * kind of node on the next, with the one thing the search leaves out said under them when
 * the image has it.
 *
 * It holds no query of its own. What it shows is the stored one, and what the reader
 * changes goes back there; the other pane's bar reads the same and follows.
 *
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFISearchBar.swift#UEFISearchBar
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFISearchBar.swift#UEFISearchBar.init
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFISearchBar.swift#UEFISearchBar.status
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFISearchBar.swift#UEFISearchBar.progress
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFISearchBar.swift#UEFISearchBar.showsMENote
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFISearchBar.swift#UEFISearchBar.onSearch
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFISearchBar.swift#UEFISearchBar.onStop
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFISearchBar.swift#UEFISearchBar.focusField
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFISearchBar.swift#UEFISearchBar.control
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFISearchBar.swift#UEFISearchBar.controlTextDidChange
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFISearchBar.swift#UEFISearchBar.Status
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFISearchBar.swift#UEFISearchBar.onFindAll
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFISearchBar.swift#UEFISearchBar.selectedNodeName
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFISearchBar.swift#UEFISearchBar.updateScope
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFISearchBar.swift#UEFISearchBar.updateMENote
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFISearchBar.swift#UEFISearchBar.modeChosen
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFISearchBar.swift#UEFISearchBar.scopeChosen
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFISearchBar.swift#UEFISearchBar.findAllClicked
 * @upstream-differs a React component over the stored query, where upstream is an NSView
 * that observes a notification
 */
// help: panel.uefi.search
export function UefiSearchBar({
  query,
  mode,
  content,
  selectedNodeName,
  status,
  progress,
  showsMeNote,
  focusToken,
  onQuery,
  onMode,
  onContent,
  onSearch,
  onFindAll,
  onStop,
}: {
  readonly query: UEFITreeQuery;
  /** What the bar looks for: a node by its name, or a pattern in what the nodes hold. */
  readonly mode: UEFISearchMode;
  /** What the Contents search asks for. */
  readonly content: UEFIContentQuery;
  /** The name of the node selected in the tree; the Contents search starts there while the box is clear. */
  readonly selectedNodeName: string | undefined;
  readonly status: SearchStatus;
  /** Where in the file the row the search is at lies, from 0 to 1. */
  readonly progress: number;
  /** Whether the image has an ME region, which the search does not go into. */
  readonly showsMeNote: boolean;
  /** Moves on each time the field is asked to take the keyboard. */
  readonly focusToken: number;
  readonly onQuery: (query: UEFITreeQuery) => void;
  readonly onMode: (mode: UEFISearchMode) => void;
  readonly onContent: (content: UEFIContentQuery) => void;
  readonly onSearch: (direction: SearchDirection) => void;
  /** Every match of the Contents search. */
  readonly onFindAll: () => void;
  readonly onStop: () => void;
}): ReactElement {
  const field = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (focusToken > 0) {
      field.current?.focus();
      field.current?.select();
    }
  }, [focusToken]);

  const contents = mode === "contents";
  const subtypes = searchSubtypes(query.type);
  const hasQuery = query.text.trim().length > 0 || query.type !== undefined;
  const store = (patch: Partial<UEFITreeQuery> & { text?: string }) => {
    const next: UEFITreeQuery = { ...query, ...patch };
    onQuery(hasSubtypes(next.type) ? next : { ...next, subtype: undefined });
  };
  // The note on the ME region, which neither search goes into — but not for a Contents search
  // from the selected node, whose own place is what the line says then.
  const showsNote = showsMeNote && !(contents && !content.wholeTree);

  return (
    <div className="uefi-search">
      <div className="uefi-search-line">
        <fieldset
          className="uefi-search-mode"
          aria-label={L("What to search")}
          title={L("Search the nodes' names and GUIDs, or the bytes the nodes hold")}
        >
          <button type="button" aria-pressed={!contents} onClick={() => onMode("names")}>
            {L("Names")}
          </button>
          <button type="button" aria-pressed={contents} onClick={() => onMode("contents")}>
            {L("Contents")}
          </button>
        </fieldset>
        {contents ? (
          <>
            <label
              className="settings-check"
              title={L("Search the whole tree; unticked, the selected node and what is under it")}
            >
              <input
                type="checkbox"
                checked={content.wholeTree}
                onChange={(event) =>
                  onContent({ ...content, wholeTree: event.currentTarget.checked })
                }
              />
              {L("The whole tree")}
            </label>
            {content.wholeTree ? null : (
              <span className="uefi-search-scope">
                {selectedNodeName === undefined
                  ? L("Nothing selected: the whole tree")
                  : L("from %1$@", selectedNodeName)}
              </span>
            )}
          </>
        ) : null}
        {showsNote ? (
          <span className="uefi-search-note">{L("ME Region is not searched")}</span>
        ) : null}
      </div>
      {contents ? (
        <div className="uefi-search-line">
          <input
            ref={field}
            type="search"
            className="uefi-search-field"
            value={content.text}
            placeholder={L("Text or hex bytes")}
            aria-label={L("Search the contents")}
            title={L("A text, or hex bytes such as 24 ?? 4D 49")}
            spellCheck={false}
            onChange={(event) => onContent({ ...content, text: event.currentTarget.value })}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              onFindAll();
            }}
          />
          <button
            type="button"
            disabled={content.text.trim().length === 0}
            title={L("List every place the pattern occurs, compressed sections included")}
            onClick={onFindAll}
          >
            {L("Find All")}
          </button>
        </div>
      ) : (
        <>
          <div className="uefi-search-line">
            <input
              ref={field}
              type="search"
              className="uefi-search-field"
              value={query.text}
              placeholder={L("Name or GUID")}
              aria-label={L("Search the tree")}
              title={L("Part of a node's name or of its GUID")}
              spellCheck={false}
              onChange={(event) => store({ text: event.currentTarget.value })}
              // Return is Next, and Shift-Return Previous — the field's own behaviour rather
              // than a shortcut of the panel's.
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                onSearch(event.shiftKey ? "backward" : "forward");
              }}
            />
            <button
              type="button"
              className="uefi-search-step"
              disabled={!hasQuery}
              title={L("Go to the previous node that matches")}
              aria-label={L("Previous match")}
              onClick={() => onSearch("backward")}
            >
              ‹
            </button>
            <button
              type="button"
              className="uefi-search-step"
              disabled={!hasQuery}
              title={L("Go to the next node that matches")}
              aria-label={L("Next match")}
              onClick={() => onSearch("forward")}
            >
              ›
            </button>
          </div>
          <div className="uefi-search-line">
            <select
              value={query.type ?? ""}
              title={L("Only nodes of this type")}
              aria-label={L("Type")}
              onChange={(event) => {
                const value = event.currentTarget.value;
                store({ type: value === "" ? undefined : Number(value), subtype: undefined });
              }}
            >
              <option value="">{L("Any type")}</option>
              {searchTypes().map((choice) => (
                <option key={choice.code} value={choice.code}>
                  {choice.name}
                </option>
              ))}
            </select>
            <select
              value={subtypes.length === 0 ? "" : (query.subtype ?? "")}
              disabled={subtypes.length === 0}
              title={L("Only files or sections of this kind")}
              aria-label={L("Subtype")}
              onChange={(event) => {
                const value = event.currentTarget.value;
                store({ subtype: value === "" ? undefined : Number(value) });
              }}
            >
              <option value="">{L("Any subtype")}</option>
              {subtypes.map((choice) => (
                <option key={choice.code} value={choice.code}>
                  {choice.name}
                </option>
              ))}
            </select>
            {status === "searching" ? (
              <>
                <progress className="uefi-search-progress" value={progress} max={1} />
                <button
                  type="button"
                  className="uefi-search-stop"
                  title={L("Stop reading branches to look for a match")}
                  aria-label={L("Stop searching")}
                  onClick={onStop}
                >
                  ×
                </button>
              </>
            ) : (
              <span className="uefi-search-status" role="status">
                {status === "notFound" ? L("Not found") : ""}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
