import { type ReactElement, useEffect, useRef } from "react";
import { L } from "@/core/localization/localization";
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
 * @upstream-differs a React component over the stored query, where upstream is an NSView
 * that observes a notification
 */
// help: panel.uefi.search
export function UefiSearchBar({
  query,
  status,
  progress,
  showsMeNote,
  focusToken,
  onQuery,
  onSearch,
  onStop,
}: {
  readonly query: UEFITreeQuery;
  readonly status: SearchStatus;
  /** Where in the file the row the search is at lies, from 0 to 1. */
  readonly progress: number;
  /** Whether the image has an ME region, which the search does not go into. */
  readonly showsMeNote: boolean;
  /** Moves on each time the field is asked to take the keyboard. */
  readonly focusToken: number;
  readonly onQuery: (query: UEFITreeQuery) => void;
  readonly onSearch: (direction: SearchDirection) => void;
  readonly onStop: () => void;
}): ReactElement {
  const field = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (focusToken > 0) {
      field.current?.focus();
      field.current?.select();
    }
  }, [focusToken]);

  const subtypes = searchSubtypes(query.type);
  const hasQuery = query.text.trim().length > 0 || query.type !== undefined;
  const store = (patch: Partial<UEFITreeQuery> & { text?: string }) => {
    const next: UEFITreeQuery = { ...query, ...patch };
    onQuery(hasSubtypes(next.type) ? next : { ...next, subtype: undefined });
  };

  return (
    <div className="uefi-search">
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
      {showsMeNote ? (
        <div className="uefi-search-note">
          {L("The contents of an ME region are not searched.")}
        </div>
      ) : null}
    </div>
  );
}
