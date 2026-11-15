import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { TOPIC, topicLink } from "@/core/help/helpIds";
import { L, localized } from "@/core/localization/localization";
import {
  type CpuidHeading,
  type CpuidHint,
  type CpuidLookupRow,
  cpuidHighlights,
  cpuidLookupFor,
  cpuidQueryWords,
  standardCompare,
} from "@/firmware/intelCpuid/cpuidLookup";
import { entrySources } from "@/firmware/intelCpuid/processorFamily";
import { processorTablesAreEmpty } from "@/firmware/intelCpuid/processorTables";
import { writePlainText } from "@/platform/clipboard/richClipboard";
import { ownWindowKind } from "@/platform/desktop/desktopWindows";
import {
  type CpuidLookupColumn,
  type CpuidLookupSort,
  clearCpuidHistory,
  cpuidLookupStore,
  editCpuidQuery,
  rememberCpuidQuery,
  setCpuidQuery,
  sortCpuidLookup,
} from "@/state/cpuidLookupStore";
import { processorTablesStore } from "@/state/processorTablesStore";
import { settingsStore } from "@/state/settingsStore";
import { useStore } from "@/state/useStore";
import { closeCpuidLookupPanel, foldParts } from "@/state/workspaceStore";
import { CpuidGlyph } from "@/ui/cpuidLookup/CpuidGlyph";
import { DockPanelHeader } from "@/ui/fragments/DockPanelHeader";
import { HelpButton } from "@/ui/help/HelpButton";
import type { PatternMenuRow } from "@/ui/search/patternMenu";
import { SearchField } from "@/ui/search/SearchField";
import { openContextMenu } from "@/ui/shell/ContextMenu";
import { ColumnResizer } from "@/ui/toolPanel/ColumnResizer";
import { clampColumnWidth, type TableColumn, useColumnWidths } from "@/ui/toolPanel/columnWidths";

/**
 * Window ▸ Intel CPUID Lookup: the processor tables of `github.com/maxshevelev/IntelCPUID`,
 * searched by CPUID, model, S-SPEC, code name or stepping — what the repository's lookup page
 * does, at the bench.
 *
 * A search field — the Find bar's, with its menu of the last searches — and the completions under
 * it; a line saying what was found; the entry of a CPUID typed whole; and the models found, in a
 * table that sorts by a column title, marks what the query found, copies its rows and looks up a
 * row's CPUID on a double-click. Under it, where the table is read from and the `?`.
 *
 * It reads the one copy of the tables the page holds (`processorTablesStore`), which the FIT panel
 * reads too: a newer table that lands is searched at once, and with none installed the panel says
 * so. A panel in the dock in a browser; in the desktop shell a window of its own, one for the app
 * (`Design/DESKTOP_WINDOWS.md`, D7). Its text follows the dump's size, as the tool panels' does.
 *
 * @upstream ByteRipperApp/CPUIDLookup/CPUIDLookupViewController.swift#CPUIDLookupViewController
 * @upstream ByteRipperApp/CPUIDLookup/CPUIDLookupViewController.swift#CPUIDLookupViewController.loadView
 * @upstream ByteRipperApp/CPUIDLookup/CPUIDLookupViewController.swift#CPUIDLookupViewController.render
 * @upstream ByteRipperApp/CPUIDLookup/CPUIDLookupViewController.swift#CPUIDLookupViewController.zoomChanged
 * @upstream ByteRipperApp/CPUIDLookup/CPUIDLookupWindowController.swift#CPUIDLookupWindowController
 * @upstream ByteRipperApp/CPUIDLookup/CPUIDLookupWindowController.swift#CPUIDLookupWindowController.init
 * @upstream-differs a React component over the lookup's store; the window is a dock panel in a
 * browser and a page of its own in the shell's window
 */
// help: window.cpuid-lookup
export function CpuidLookupPanel() {
  const tables = useStore(processorTablesStore);
  const state = useStore(cpuidLookupStore);
  const { fontSize } = useStore(settingsStore);
  // @upstream ByteRipperApp/CPUIDLookup/CPUIDLookupViewController.swift#CPUIDLookupViewController.lookup
  const lookup = cpuidLookupFor(tables);
  const { query, sort } = state;

  // The rows on screen, in the order shown, and what heads them.
  // @upstream ByteRipperApp/CPUIDLookup/CPUIDLookupViewController.swift#CPUIDLookupViewController.shown
  // @upstream ByteRipperApp/CPUIDLookup/CPUIDLookupViewController.swift#CPUIDLookupViewController.headings
  // @upstream ByteRipperApp/CPUIDLookup/CPUIDLookupViewController.swift#CPUIDLookupViewController.numberOfRows
  const shown = useMemo(() => sortedRows(lookup.rowsMatching(query), sort), [lookup, query, sort]);
  const headings = useMemo(() => lookup.headings(query), [lookup, query]);
  // Each row's place in the whole table: what names it to React, however the table is sorted.
  const places = useMemo(
    () => new Map(lookup.rows.map((row, place) => [row, place] as const)),
    [lookup]
  );
  const words = cpuidQueryWords(query);
  // Nothing found but the heading: the heading takes the panel.
  const fills = words.length > 0 && shown.length === 0;

  const inputRef = useRef<HTMLInputElement | null>(null);
  const tableRef = useRef<HTMLDivElement | null>(null);
  // The completions offered under the field; none while the list is shut.
  // @upstream ByteRipperApp/CPUIDLookup/CPUIDLookupViewController.swift#CPUIDLookupViewController.suggestions
  // @upstream ByteRipperApp/CPUIDLookup/CPUIDSuggestions.swift#CPUIDSuggestions.numberOfRows
  const [hints, setHints] = useState<readonly CpuidHint[]>([]);
  const [chosen, setChosen] = useState(-1);
  const [selected, setSelected] = useState<ReadonlySet<CpuidLookupRow>>(new Set());
  const [anchor, setAnchor] = useState<CpuidLookupRow | undefined>(undefined);
  // The heading sections opened by hand — notes, sources — by key.
  // @upstream ByteRipperApp/CPUIDLookup/CPUIDLookupViewController.swift#CPUIDLookupViewController.opened
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());

  // The field shows the query; put into it only when the two part — a row looked up, a recent
  // search picked — so typing is never rewritten under the caret.
  useEffect(() => {
    const input = inputRef.current;
    if (input === null || input.value === query) return;
    input.value = query;
    input.setSelectionRange(query.length, query.length);
  }, [query]);

  // The field's own name and what it searches by, for a screen reader and the pointer.
  // @upstream ByteRipperApp/CPUIDLookup/CPUIDLookupViewController.swift#CPUIDLookupViewController.searchField
  useEffect(() => {
    const input = inputRef.current;
    if (input === null) return;
    input.setAttribute("aria-label", L("Search"));
    input.title = L("Search by CPUID, model, S-SPEC, code name or stepping");
  });

  // The completions close when the field loses the keyboard — to the table, another window, a
  // click elsewhere; a completion pressed keeps it (`CpuidSuggestions`).
  // @upstream ByteRipperApp/CPUIDLookup/CPUIDLookupViewController.swift#CPUIDLookupViewController.controlTextDidEndEditing
  // @upstream ByteRipperApp/CPUIDLookup/CPUIDLookupWindowController.swift#CPUIDLookupWindowController.windowDidResignKey
  useEffect(() => {
    const input = inputRef.current;
    if (input === null) return;
    const shut = () => {
      setHints([]);
      setChosen(-1);
    };
    input.addEventListener("blur", shut);
    return () => input.removeEventListener("blur", shut);
  }, []);

  // The keyboard goes to the field when the panel comes up, and whenever the lookup is asked for.
  // @upstream ByteRipperApp/CPUIDLookup/CPUIDLookupViewController.swift#CPUIDLookupViewController.focusSearch
  // biome-ignore lint/correctness/useExhaustiveDependencies: each ask is a new focus
  useEffect(() => {
    inputRef.current?.focus();
  }, [state.focusAsk]);

  // The rows shown are what can stay chosen.
  useEffect(() => {
    setSelected((now) => {
      const kept = new Set([...now].filter((row) => shown.includes(row)));
      return kept.size === now.size ? now : kept;
    });
  }, [shown]);

  /**
   * @upstream ByteRipperApp/CPUIDLookup/CPUIDLookupViewController.swift#CPUIDLookupViewController.showSuggestions
   * @upstream ByteRipperApp/CPUIDLookup/CPUIDSuggestions.swift#CPUIDSuggestions.show
   */
  const showSuggestions = (text: string) => {
    if (document.activeElement !== inputRef.current) return closeSuggestions();
    setHints(lookup.hintsFor(text));
    setChosen(-1);
  };

  /**
   * @upstream ByteRipperApp/CPUIDLookup/CPUIDLookupViewController.swift#CPUIDLookupViewController.closeSuggestions
   * @upstream ByteRipperApp/CPUIDLookup/CPUIDSuggestions.swift#CPUIDSuggestions.close
   */
  const closeSuggestions = () => {
    setHints([]);
    setChosen(-1);
  };

  /**
   * Puts `text` in the field and searches it, as a search of its own, with the table at its top.
   *
   * @upstream ByteRipperApp/CPUIDLookup/CPUIDLookupViewController.swift#CPUIDLookupViewController.setQuery
   */
  const lookUp = (text: string) => {
    setCpuidQuery(text);
    closeSuggestions();
    tableRef.current?.scrollTo({ top: 0 });
  };

  /** @upstream ByteRipperApp/CPUIDLookup/CPUIDLookupViewController.swift#CPUIDLookupViewController.pick */
  const pick = (text: string) => {
    lookUp(text);
    const input = inputRef.current;
    if (input !== null) {
      input.value = text;
      input.focus();
      input.setSelectionRange(text.length, text.length);
    }
  };

  /**
   * ↑ and ↓ walk the completions, Return takes the one chosen — or remembers the query — and
   * Escape closes the list first.
   *
   * @upstream ByteRipperApp/CPUIDLookup/CPUIDLookupViewController.swift#CPUIDLookupViewController.control
   * @upstream ByteRipperApp/CPUIDLookup/CPUIDSuggestions.swift#CPUIDSuggestions.move
   * @upstream ByteRipperApp/CPUIDLookup/CPUIDSuggestions.swift#CPUIDSuggestions.chosen
   * @upstream ByteRipperApp/CPUIDLookup/CPUIDSuggestions.swift#CPUIDSuggestions.isOpen
   */
  const fieldKey = (event: KeyboardEvent<HTMLInputElement>): boolean => {
    const open = hints.length > 0;
    const move = (step: 1 | -1) => {
      const count = hints.length;
      const next =
        chosen < 0 ? (step > 0 ? 0 : count - 1) : (chosen + step + count + 1) % (count + 1);
      // One step past either end is back to the text as typed.
      setChosen(next === count ? -1 : next);
    };
    switch (event.key) {
      case "ArrowDown":
        if (open) {
          move(1);
          return true;
        }
        if (lookup.hintsFor(event.currentTarget.value).length === 0) return false;
        showSuggestions(event.currentTarget.value);
        return true;
      case "ArrowUp":
        if (!open) return false;
        move(-1);
        return true;
      case "Enter": {
        const hint = hints[chosen];
        if (hint !== undefined) pick(hint.text);
        else {
          closeSuggestions();
          rememberCpuidQuery();
        }
        return true;
      }
      case "Escape":
        if (!open) return false;
        closeSuggestions();
        return true;
      default:
        return false;
    }
  };

  // The magnifier's menu, drawn as the Find bar's is: the last searches under a header, then the
  // command that clears them; with nothing to list there is none.
  // @upstream ByteRipperApp/CPUIDLookup/CPUIDLookupViewController.swift#CPUIDLookupViewController.rebuildHistoryMenu
  // @upstream ByteRipperApp/CPUIDLookup/CPUIDLookupViewController.swift#CPUIDLookupViewController.recentPicked
  // @upstream ByteRipperApp/CPUIDLookup/CPUIDLookupViewController.swift#CPUIDLookupViewController.validateMenuItem
  const menuRows: PatternMenuRow[] =
    state.history.length === 0
      ? []
      : [
          { kind: "heading", key: "recents", label: L("Recent Queries"), icon: "recent" },
          ...state.history.map(
            (text, index): PatternMenuRow => ({ kind: "query", key: `q${index}`, index, text })
          ),
          { kind: "separator", key: "after-recents" },
          { kind: "command", key: "clearRecents", label: L("Clear Recents"), disabled: false },
        ];

  const status = statusLine({
    empty: processorTablesAreEmpty(tables),
    refreshing: state.refreshing,
    words: words.length,
    found: shown.length,
    headings,
    models: lookup.modelCount,
    cpuids: lookup.cpuidCount,
  });

  /** The rows a command acts on: those chosen, or the one clicked outside the choice. */
  const targetRows = (clicked?: CpuidLookupRow): CpuidLookupRow[] =>
    clicked !== undefined && !selected.has(clicked)
      ? [clicked]
      : shown.filter((row) => selected.has(row));

  /** A row pressed: chosen alone, added or taken away with ⌘ or Ctrl, a run with Shift. */
  const choose = (row: CpuidLookupRow, event: React.MouseEvent) => {
    if (event.shiftKey && anchor !== undefined && shown.includes(anchor)) {
      const [from, to] = [shown.indexOf(anchor), shown.indexOf(row)].sort((a, b) => a - b);
      setSelected(new Set(shown.slice(from, (to ?? 0) + 1)));
      return;
    }
    if (event.metaKey || event.ctrlKey) {
      const next = new Set(selected);
      if (next.has(row)) next.delete(row);
      else next.add(row);
      setSelected(next);
    } else setSelected(new Set([row]));
    setAnchor(row);
  };

  /** ↑ and ↓ move the choice through the table, as an AppKit table's arrows do. */
  const walk = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    if (shown.length === 0) return;
    event.preventDefault();
    const now = shown.findIndex((row) => selected.has(row));
    const at =
      now < 0
        ? 0
        : Math.max(0, Math.min(shown.length - 1, now + (event.key === "ArrowDown" ? 1 : -1)));
    const row = shown[at];
    if (row === undefined) return;
    setSelected(new Set([row]));
    setAnchor(row);
    requestAnimationFrame(() =>
      tableRef.current?.querySelector(`[data-row="${at}"]`)?.scrollIntoView({ block: "nearest" })
    );
  };

  // The columns at upstream's widths for the panels' default size, scaled with the dump's size as
  // upstream scales them with View ▸ Zoom; a column a reader drags is kept between visits.
  // @upstream ByteRipperApp/CPUIDLookup/CPUIDLookupViewController.swift#CPUIDLookupViewController.Column
  // @upstream ByteRipperApp/CPUIDLookup/CPUIDLookupViewController.swift#CPUIDLookupViewController.drawnSize
  const columns = lookupColumns();
  const kept = useColumnWidths(columns, "CPUIDLookupTable");
  const scale = fontSize / 13;
  const drawn = (column: TableColumn): number =>
    clampColumnWidth(kept.widths[column.id] ?? column.width, column) * scale;
  const drawnColumns = columns.map((one) => ({
    ...one,
    width: one.width * scale,
    min: one.min * scale,
  }));
  const drawnWidths = Object.fromEntries(columns.map((one) => [one.id, drawn(one)]));

  const inDock = ownWindowKind() === undefined;

  return (
    <section className="cpuid-lookup" aria-label={L("Intel CPUID Lookup")}>
      <DockPanelHeader
        glyph={<CpuidGlyph />}
        title={L("Intel CPUID Lookup")}
        closeLabel={L("Close %1$@", L("Intel CPUID Lookup"))}
        onClose={() => {
          rememberCpuidQuery();
          closeCpuidLookupPanel();
        }}
      />
      <div className="cpuid-lookup-search">
        <SearchField
          id="cpuid-lookup-query"
          inputRef={inputRef}
          className="find-input cpuid-lookup-input"
          defaultValue={query}
          placeholder={L("CPUID, model or S-SPEC — 306A9, i7-2600K, SR00C")}
          rows={menuRows}
          menuTitle={L("Recent Queries")}
          onEdit={(text) => {
            editCpuidQuery(text);
            showSuggestions(text);
          }}
          onChoose={(row) => {
            if (row.kind === "query") pick(row.text);
            else if (row.kind === "command" && row.key === "clearRecents") clearCpuidHistory();
          }}
          onEscape={() => {
            // The field clears itself first; an empty one folds the panel, as Escape does.
            if ((inputRef.current?.value ?? "") !== "") {
              if (inputRef.current !== null) inputRef.current.value = "";
              editCpuidQuery("");
            } else if (inDock) foldParts();
          }}
          onFieldKey={fieldKey}
        />
        {hints.length === 0 ? null : (
          <CpuidSuggestions
            hints={hints}
            query={query}
            chosen={chosen}
            onChoose={setChosen}
            onPick={pick}
          />
        )}
      </div>
      <p className="cpuid-lookup-status" role="status">
        {status}
      </p>
      {headings.length === 0 ? null : (
        <div className={fills ? "cpuid-lookup-heading is-filling" : "cpuid-lookup-heading"}>
          <CpuidHeadingText
            headings={headings}
            opened={opened}
            expanded={fills}
            onLookUp={lookUp}
            onToggle={(key) =>
              setOpened((now) => {
                const next = new Set(now);
                if (next.has(key)) next.delete(key);
                else next.add(key);
                return next;
              })
            }
          />
        </div>
      )}
      {fills ? null : (
        // The grid is the scroller that takes the keyboard, as the Agent window's list is; its
        // rows carry `aria-selected`.
        // biome-ignore lint/a11y/useSemanticElements: the grid role sits on the scroller that takes the keyboard; a <table> may not carry it
        <div
          className="cpuid-lookup-table"
          ref={tableRef}
          role="grid"
          aria-multiselectable="true"
          aria-label={L("Intel CPUID Lookup")}
          tabIndex={0}
          onKeyDown={walk}
          // Edit ▸ Copy: the rows as lines of tab-separated columns, in the order the table shows
          // them.
          // @upstream ByteRipperApp/CPUIDLookup/CPUIDLookupViewController.swift#CPUIDLookupViewController.copy
          onCopy={(event) => {
            const text = rowLines(targetRows());
            if (text === undefined) return;
            event.preventDefault();
            event.clipboardData.setData("text/plain", text);
          }}
        >
          <table>
            <colgroup>
              {columns.map((one) => (
                <col key={one.id} style={one.grows === true ? undefined : { width: drawn(one) }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                {columns.map((one, index) => {
                  const by = sort?.column === one.id ? sort : undefined;
                  return (
                    <th
                      key={one.id}
                      scope="col"
                      aria-sort={
                        by === undefined ? undefined : by.ascending ? "ascending" : "descending"
                      }
                    >
                      <button
                        type="button"
                        className="cpuid-lookup-sort"
                        onClick={() => sortCpuidLookup(one.id as CpuidLookupColumn)}
                      >
                        {one.title}
                        {by === undefined ? null : (
                          <span className="cpuid-lookup-sort-mark" aria-hidden="true">
                            {by.ascending ? "▲" : "▼"}
                          </span>
                        )}
                      </button>
                      <ColumnResizer
                        columns={drawnColumns}
                        index={index}
                        widths={drawnWidths}
                        onChange={(id, width) => kept.resize(id, width / scale)}
                        onReset={kept.reset}
                      />
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {shown.map((row, index) => (
                <tr
                  // A row is one model under one entry; the same model may stand under two.
                  key={places.get(row)}
                  data-row={index}
                  className={index % 2 === 1 ? "is-raised" : undefined}
                  aria-selected={selected.has(row)}
                  onMouseDown={(event) => {
                    if (event.button === 0) choose(row, event);
                  }}
                  // @upstream ByteRipperApp/CPUIDLookup/CPUIDLookupViewController.swift#CPUIDLookupViewController.lookUpClickedRow
                  onDoubleClick={() => {
                    const cpuid = row.cpuids[0];
                    if (cpuid !== undefined) lookUp(cpuid);
                  }}
                  // @upstream ByteRipperApp/CPUIDLookup/CPUIDLookupViewController.swift#CPUIDLookupViewController.menuNeedsUpdate
                  // @upstream ByteRipperApp/CPUIDLookup/CPUIDLookupViewController.swift#CPUIDLookupViewController.targetRows
                  // @upstream ByteRipperApp/CPUIDLookup/CPUIDLookupViewController.swift#CPUIDLookupViewController.lookUpFromMenu
                  // @upstream ByteRipperApp/CPUIDLookup/CPUIDLookupViewController.swift#CPUIDLookupViewController.copySSpecs
                  // @upstream ByteRipperApp/CPUIDLookup/CPUIDLookupViewController.swift#CPUIDLookupViewController.copyModels
                  // @upstream ByteRipperApp/CPUIDLookup/CPUIDLookupViewController.swift#CPUIDLookupViewController.put
                  onContextMenu={(event) => {
                    const rows = targetRows(row);
                    const cpuid = rows.length === 1 ? rows[0]?.cpuids[0] : undefined;
                    openContextMenu(event, [
                      ...(cpuid === undefined
                        ? []
                        : [
                            {
                              label: L("Look Up CPUID %1$@", cpuid),
                              onSelect: () => lookUp(cpuid),
                            },
                            { kind: "separator" as const },
                          ]),
                      {
                        label: L("Copy S-SPEC"),
                        onSelect: () =>
                          put(
                            rows.map((one) => one.sSpecs.join(", ")).filter((one) => one.length > 0)
                          ),
                      },
                      {
                        label: L("Copy Model"),
                        onSelect: () => put(rows.map((one) => one.name)),
                      },
                      {
                        label: L("Copy Row"),
                        onSelect: () => {
                          const text = rowLines(rows);
                          if (text !== undefined) void writePlainText(text);
                        },
                      },
                    ]);
                  }}
                >
                  <CpuidLookupCells row={row} query={query} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <footer className="cpuid-lookup-footer">
        <span className="cpuid-lookup-source">
          {tables.retrieved === undefined
            ? L("Data and sources:")
            : L("Updated %1$@. Data and sources:", tables.retrieved)}{" "}
          {/* @upstream ByteRipperApp/CPUIDLookup/CPUIDLookupViewController.swift#CPUIDLookupViewController.openRepository
              @upstream ByteRipperApp/CPUIDLookup/CPUIDLookupViewController.swift#CPUIDLookupViewController.sourceButton */}
          <a
            href={REPOSITORY}
            target="_blank"
            rel="noopener noreferrer"
            title={L("Open the repository the table is read from")}
          >
            github.com/maxshevelev/IntelCPUID
          </a>
        </span>
        {/* @upstream ByteRipperApp/CPUIDLookup/CPUIDLookupViewController.swift#CPUIDLookupViewController.help */}
        <HelpButton link={topicLink(TOPIC.cpuidLookup)} />
      </footer>
    </section>
  );
}

/** Where the table is read from, as a page to open. */
const REPOSITORY = "https://github.com/maxshevelev/IntelCPUID";

/**
 * The line over the table: what is shown, or why nothing is.
 *
 * @upstream ByteRipperApp/CPUIDLookup/CPUIDLookupViewController.swift#CPUIDLookupViewController.statusLabel
 */
export function statusLine(options: {
  readonly empty: boolean;
  readonly refreshing: boolean;
  readonly words: number;
  readonly found: number;
  readonly headings: readonly CpuidHeading[];
  readonly models: number;
  readonly cpuids: number;
}): string {
  const { empty, refreshing, words, found, headings, models, cpuids } = options;
  if (empty) {
    return refreshing
      ? L("Loading…")
      : L(
          "The table has not been read yet. It is read from the repository when the network is available."
        );
  }
  if (words === 0) {
    return L("%1$@ processors under %2$@ CPUIDs. Type to search.", String(models), String(cpuids));
  }
  const heading = headings[0];
  if (found === 0 && heading !== undefined) {
    return heading.family === undefined
      ? L("The table has no entry for this CPUID.")
      : L("No models are listed for this CPUID. What is known about it is above.");
  }
  if (found === 0) return L("Nothing found. Check the spelling, or try part of the number.");
  return L("Found: %1$@", String(found));
}

/**
 * The table's columns, in upstream's order and at its widths for 13-pixel text; Code name takes
 * what the others leave, as upstream's last column does.
 *
 * @upstream ByteRipperApp/CPUIDLookup/CPUIDLookupViewController.swift#CPUIDLookupViewController.Column.title
 * @upstream ByteRipperApp/CPUIDLookup/CPUIDLookupViewController.swift#CPUIDLookupViewController.Column.width
 */
const lookupColumns = localized((): readonly TableColumn[] => {
  const column = (id: CpuidLookupColumn, title: string, width: number): TableColumn => ({
    id,
    title,
    width,
    min: 60,
    grows: id === "codeName",
  });
  return [
    column("cpuid", "CPUID", 110),
    column("model", L("Model"), 260),
    column("sSpec", "S-SPEC", 200),
    column("stepping", L("Stepping"), 110),
    column("codeName", L("Code name"), 180),
  ];
});

/**
 * The rows in the order a column title asked for, the table's own order breaking ties.
 *
 * @upstream ByteRipperApp/CPUIDLookup/CPUIDLookupViewController.swift#CPUIDLookupViewController.sort
 */
export function sortedRows(
  rows: readonly CpuidLookupRow[],
  sort: CpuidLookupSort | undefined
): CpuidLookupRow[] {
  if (sort === undefined) return [...rows];
  const value = (row: CpuidLookupRow): string => {
    switch (sort.column) {
      case "cpuid":
        return row.cpuids.join(", ");
      case "model":
        return row.name;
      case "sSpec":
        return row.sSpecs.join(" ");
      case "stepping":
        return row.steppings;
      case "codeName":
        return row.codeNames;
    }
  };
  return rows
    .map((row, offset) => ({ row, offset, key: value(row) }))
    .sort((a, b) => {
      const order = standardCompare(a.key, b.key);
      if (order === 0) return a.offset - b.offset;
      return sort.ascending ? order : -order;
    })
    .map((one) => one.row);
}

/** The rows as lines of tab-separated columns; nothing for no rows. */
export function rowLines(rows: readonly CpuidLookupRow[]): string | undefined {
  if (rows.length === 0) return undefined;
  return rows
    .map((row) =>
      [row.cpuids.join(", "), row.name, row.sSpecs.join(", "), row.steppings, row.codeNames].join(
        "\t"
      )
    )
    .join("\n");
}

/** Lines on the clipboard, one each; nothing when there are none. */
function put(lines: readonly string[]): void {
  if (lines.length === 0) return;
  void writePlainText(lines.join("\n"));
}

/**
 * A row's five cells.
 *
 * @upstream ByteRipperApp/CPUIDLookup/CPUIDLookupViewController.swift#CPUIDLookupViewController.tableView
 */
function CpuidLookupCells({
  row,
  query,
}: {
  readonly row: CpuidLookupRow;
  readonly query: string;
}) {
  return (
    <>
      <td>
        <Marked text={row.cpuids.join(", ")} query={query} monospaced bold />
      </td>
      <td>
        <Marked
          text={row.name}
          query={query}
          suffix={row.series ? ` (${L("series")})` : undefined}
        />
      </td>
      <td>
        {row.sSpecs.length === 0 ? (
          <span className="cpuid-muted">—</span>
        ) : (
          <Marked text={row.sSpecs.join(", ")} query={query} monospaced />
        )}
      </td>
      <td>
        <Marked text={row.steppings} query={query} />
      </td>
      <td>
        <Marked text={row.codeNames} query={query} />
      </td>
    </>
  );
}

/**
 * A cell's text, with what the query found in it marked: a yellow wash with dark text, which reads
 * on a plain row, a raised one and a chosen one alike, in either theme.
 *
 * @upstream ByteRipperApp/CPUIDLookup/CPUIDLookupCell.swift#CPUIDLookupCell
 * @upstream ByteRipperApp/CPUIDLookup/CPUIDLookupCell.swift#CPUIDLookupCell.show
 * @upstream ByteRipperApp/CPUIDLookup/CPUIDLookupCell.swift#CPUIDLookupCell.draw
 * @upstream ByteRipperApp/CPUIDLookup/CPUIDLookupCell.swift#CPUIDLookupCell.markColor
 * @upstream-differs spans in the stylesheet's colours, where upstream draws an attributed string
 */
function Marked({
  text,
  query,
  monospaced = false,
  bold = false,
  suffix,
}: {
  readonly text: string;
  readonly query: string;
  readonly monospaced?: boolean;
  readonly bold?: boolean;
  readonly suffix?: string | undefined;
}) {
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (const { start, end } of cpuidHighlights(text, query)) {
    if (start > at) parts.push(text.slice(at, start));
    parts.push(
      <mark key={start} className="cpuid-mark">
        {text.slice(start, end)}
      </mark>
    );
    at = end;
  }
  if (at < text.length) parts.push(text.slice(at));
  const className = `cpuid-cell${monospaced ? " is-mono" : ""}${bold ? " is-bold" : ""}`;
  return (
    // The whole text under the pointer, where a long one is cut.
    <span className={className} title={[...text].length > 24 ? text : undefined}>
      {parts}
      {suffix === undefined ? null : <span className="cpuid-muted">{suffix}</span>}
    </span>
  );
}

/**
 * The completions under the field: eight at most, each with what kind of thing it is and what it
 * belongs to. The field keeps the keyboard; a press takes the row pressed.
 *
 * @upstream ByteRipperApp/CPUIDLookup/CPUIDSuggestions.swift#CPUIDSuggestions
 * @upstream ByteRipperApp/CPUIDLookup/CPUIDSuggestions.swift#CPUIDSuggestions.onPick
 * @upstream ByteRipperApp/CPUIDLookup/CPUIDSuggestions.swift#CPUIDSuggestions.clicked
 * @upstream ByteRipperApp/CPUIDLookup/CPUIDSuggestions.swift#CPUIDSuggestionCell
 * @upstream ByteRipperApp/CPUIDLookup/CPUIDSuggestions.swift#CPUIDSuggestionCell.show
 * @upstream ByteRipperApp/CPUIDLookup/CPUIDSuggestions.swift#CPUIDSuggestions.tableView
 * @upstream-differs a listbox under the field, where upstream hangs a borderless child window
 */
function CpuidSuggestions({
  hints,
  query,
  chosen,
  onChoose,
  onPick,
}: {
  readonly hints: readonly CpuidHint[];
  readonly query: string;
  readonly chosen: number;
  readonly onChoose: (index: number) => void;
  readonly onPick: (text: string) => void;
}) {
  return (
    <div className="menu-popup cpuid-suggestions" role="listbox" aria-label={L("Search")}>
      {hints.map((hint, index) => (
        <div
          key={`${hint.kind}:${hint.text}`}
          role="option"
          aria-selected={index === chosen}
          tabIndex={-1}
          className={index === chosen ? "cpuid-suggestion is-active" : "cpuid-suggestion"}
          // Taken on the press, which also keeps the keyboard in the field.
          onPointerDown={(event) => {
            event.preventDefault();
            onPick(hint.text);
          }}
          onPointerEnter={() => onChoose(index)}
        >
          <Marked
            text={hint.text}
            query={query}
            monospaced={hint.kind === "cpuid" || hint.kind === "sSpec"}
          />
          <span className="cpuid-suggestion-detail">
            {hintKind(hint)}
            {hint.detail === "" ? "" : ` · ${hint.detail}`}
          </span>
        </div>
      ))}
    </div>
  );
}

/** @upstream ByteRipperApp/CPUIDLookup/CPUIDSuggestions.swift#CPUIDSuggestions.kind */
function hintKind(hint: CpuidHint): string {
  switch (hint.kind) {
    case "cpuid":
      return "CPUID";
    case "sSpec":
      return "S-SPEC";
    case "model":
      return L("model");
    case "codeName":
      return L("code name");
  }
}

/**
 * What the lookup says over its table for a query that is one CPUID: the entry's code names,
 * steppings, product families, segments, cores and number of models; the microcode updates it
 * shares with other CPUIDs, each CPUID a link that looks it up; and, for an entry the article
 * lacks, the repository's note and the pages its facts were read from — folded under a line that
 * opens them, unless the table below is empty, when they are all the panel has to say.
 *
 * @upstream ByteRipperApp/CPUIDLookup/CPUIDHeadingText.swift#CPUIDHeadingText
 * @upstream ByteRipperApp/CPUIDLookup/CPUIDHeadingText.swift#CPUIDHeadingText.make
 * @upstream ByteRipperApp/CPUIDLookup/CPUIDLookupViewController.swift#CPUIDLookupViewController.textView
 * @upstream-differs elements with buttons for the CPUIDs and the folds, where upstream writes an
 * attributed string whose links carry the action in their scheme
 */
function CpuidHeadingText({
  headings,
  opened,
  expanded,
  onLookUp,
  onToggle,
}: {
  readonly headings: readonly CpuidHeading[];
  readonly opened: ReadonlySet<string>;
  readonly expanded: boolean;
  readonly onLookUp: (cpuid: string) => void;
  readonly onToggle: (key: string) => void;
}) {
  return (
    <>
      {headings.map((heading, index) => {
        const id = `${index}-${heading.cpuids.join("_")}`;
        const family = heading.family;
        const note = heading.notes?.note;
        const sources = heading.notes === undefined ? [] : entrySources(heading.notes);
        const fold = (key: string, title: string) => {
          const open = expanded || opened.has(key);
          return (
            <button
              type="button"
              className="cpuid-heading-fold"
              aria-expanded={open}
              onClick={() => onToggle(key)}
            >
              <span className="cpuid-muted" aria-hidden="true">
                {open ? "▾ " : "▸ "}
              </span>
              {title}
            </button>
          );
        };
        const notesKey = `notes-${id}`;
        const sourcesKey = `sources-${id}`;
        return (
          <div key={id} className="cpuid-heading">
            <p className="cpuid-heading-title">
              <span className="cpuid-heading-cpuids">{heading.cpuids.join(", ")}</span>
              <span className="cpuid-muted">{"  ·  "}</span>
              {family === undefined ? (
                <span className="cpuid-heading-absent">{L("not in the table")}</span>
              ) : (
                <>
                  <span className="cpuid-heading-names">{family.codeNames.join(", ")}</span>
                  {heading.cpuids.some((cpuid) => cpuid.includes("X")) ? (
                    <span className="cpuid-muted">{`  (${L("X stands for any digit")})`}</span>
                  ) : null}
                </>
              )}
            </p>
            <dl className="cpuid-heading-facts">
              {family === undefined ? null : (
                <>
                  <Fact label={L("Steppings")} values={family.steppings} />
                  <Fact label={L("Product family")} values={family.productFamilies} />
                  <Fact label={L("Segment")} values={family.segments} />
                  <Fact label={L("Cores")} values={family.cores ?? []} />
                  <Fact label={L("Models")} values={[String(family.processors.length)]} />
                </>
              )}
              {heading.shared.length === 0 ? null : (
                <>
                  <dt>{L("Shared microcode")}</dt>
                  <dd>
                    {heading.shared.map((shared) => (
                      <div key={`${shared.update.revision}:${shared.update.date}`}>
                        {sharedLine(
                          shared.update.revision,
                          shared.update.date,
                          shared.others.map((cpuid, n) => (
                            <span key={cpuid}>
                              {n > 0 ? ", " : null}
                              <button
                                type="button"
                                className="cpuid-heading-link"
                                onClick={() => onLookUp(cpuid)}
                              >
                                {cpuid}
                              </button>
                            </span>
                          ))
                        )}
                      </div>
                    ))}
                  </dd>
                </>
              )}
            </dl>
            {family === undefined ? (
              <p className="cpuid-muted">{L("The table has no entry for this CPUID.")}</p>
            ) : null}
            {note === undefined || note === "" ? null : (
              <>
                {fold(notesKey, L("Notes (in English)"))}
                {expanded || opened.has(notesKey) ? (
                  <p className="cpuid-heading-note">{note}</p>
                ) : null}
              </>
            )}
            {sources.length === 0 ? null : (
              <>
                {fold(sourcesKey, L("Sources (%1$@)", String(sources.length)))}
                {expanded || opened.has(sourcesKey) ? (
                  <ul className="cpuid-heading-sources">
                    {sources.map((source) => (
                      <li key={`${source.url}:${source.quote}`}>
                        <SourceLink url={source.url} />
                        <span className="cpuid-heading-quote">{`  ${source.quote}`}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            )}
          </div>
        );
      })}
    </>
  );
}

/** One fact of the entry, said only when there is something to say. */
function Fact({ label, values }: { readonly label: string; readonly values: readonly string[] }) {
  if (values.length === 0) return null;
  return (
    <>
      <dt>{label}</dt>
      <dd>{values.join(", ")}</dd>
    </>
  );
}

/** "update 0x3E of 2025-10-12 also serves …", the CPUIDs where the translation puts them. */
function sharedLine(revision: string, date: string, others: React.ReactNode): React.ReactNode {
  const MARK = "￼";
  const [before, after] = L(
    "update %1$@ of %2$@ also serves %3$@",
    `0x${revision}`,
    date,
    MARK
  ).split(MARK);
  return (
    <>
      {before}
      {others}
      {after}
    </>
  );
}

/** A source's page: its host as the link, the address whole under the pointer. */
function SourceLink({ url }: { readonly url: string }) {
  let host: string | undefined;
  try {
    const parsed = new URL(url);
    host = parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.host : undefined;
  } catch {
    host = undefined;
  }
  if (host === undefined) return <span>{url}</span>;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" title={url}>
      {host}
    </a>
  );
}
