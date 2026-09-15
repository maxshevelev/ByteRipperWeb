import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type MicrocodeCatalogueEntry, platformText } from "@/tools/fit/microcodeCatalogue";
import {
  actionTitle,
  countText,
  formTitle,
  type MicrocodeFormMode,
  narrowingCpuids,
  narrowingTitle,
  releaseText,
  searchIsHidden,
  shownEntries,
  sizeText,
} from "@/tools/fit/microcodeFormModel";
import { Dialog } from "@/ui/dialogs/Dialog";

/**
 * The sheet for adding or replacing a microcode: the catalogue from
 * `github.com/platomav/CPUMicrocodes`, narrowed down. Ported from upstream's
 * `FITAddMicrocodeViewController`.
 *
 * It decides nothing about the image — the placement, the change and every
 * refusal are the panel's. What it owns is the narrowing, and even that is
 * `microcodeFormModel.ts`, tested without a window.
 */

/** A line at the bottom: what is happening, or what went wrong. */
export interface MicrocodeFormStatus {
  readonly text: string;
  readonly busy: boolean;
  /** Red, because the sheet is where the user is looking. */
  readonly problem: boolean;
}

/** Upstream's columns, their widths laid out for 11-point text and scaled to 13 pixels. */
const COLUMNS = [
  { title: "CPUID", width: 83 },
  { title: "Plat", width: 54 },
  { title: "Revision", width: 87 },
  { title: "Date", width: 106 },
  { title: "Release", width: 87 },
  { title: "Size", width: 83 },
] as const;

const ROW_HEIGHT = 20;
const HEADER_HEIGHT = 21;
/** Rows kept either side of the viewport: the Intel list is thousands long. */
const OVERSCAN = 10;

/**
 * @upstream Modules/FITTool/Sources/FITToolUI/FITAddMicrocodeViewController.swift#FITAddMicrocodeViewController
 * @upstream Modules/FITTool/Sources/FITToolUI/FITAddMicrocodeViewController.swift#FITAddMicrocodeViewController.loadView
 */
export function MicrocodeForm({
  mode,
  entries,
  status,
  onPick,
  onChooseFile,
  onCancel,
}: {
  readonly mode: MicrocodeFormMode;
  readonly entries: readonly MicrocodeCatalogueEntry[];
  /** What the panel has to say — a fetch, a failure — or nothing, and the count shows. */
  readonly status: MicrocodeFormStatus | undefined;
  readonly onPick: (entry: MicrocodeCatalogueEntry) => void;
  readonly onChooseFile: () => void;
  readonly onCancel: () => void;
}) {
  const [search, setSearch] = useState("");
  // Off to begin with: narrowing before the user has looked would hide most of
  // what there is.
  const [narrowed, setNarrowed] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string | undefined>(undefined);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);

  const shown = useMemo(
    () => shownEntries(entries, mode, search, narrowed),
    [entries, mode, search, narrowed]
  );
  const selected = shown.find((one) => one.path === selectedPath);
  const busy = status?.busy === true;
  const line = status ?? { text: countText(shown.length, entries), busy: false, problem: false };

  // A narrowing that drops the selected row drops the selection with it, and
  // the button stands down, as upstream's does.
  useEffect(() => {
    if (selectedPath !== undefined && !shown.some((one) => one.path === selectedPath)) {
      setSelectedPath(undefined);
    }
  }, [shown, selectedPath]);

  /** The list's height, watched from the element itself once it exists. */
  const listCallbackRef = useCallback((element: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    listRef.current = element;
    if (element === null) return;
    const observer = new ResizeObserver(([one]) => {
      if (one !== undefined) setHeight(one.contentRect.height);
    });
    observer.observe(element);
    observerRef.current = observer;
  }, []);

  const pick = useCallback(() => {
    if (selected !== undefined && !busy) onPick(selected);
  }, [selected, busy, onPick]);

  /**
   * @upstream Modules/FITTool/Sources/FITToolUI/FITAddMicrocodeViewController.swift#FITAddMicrocodeViewController.selectedEntry
   * @upstream Modules/FITTool/Sources/FITToolUI/FITAddMicrocodeViewController.swift#FITAddMicrocodeViewController.tableViewSelectionDidChange
   */
  const selectAt = useCallback(
    (index: number) => {
      const one = shown[Math.max(0, Math.min(shown.length - 1, index))];
      if (one === undefined) return;
      setSelectedPath(one.path);
      const element = listRef.current;
      if (element === null) return;
      const at = shown.indexOf(one) * ROW_HEIGHT;
      if (at < element.scrollTop) element.scrollTop = at;
      else if (HEADER_HEIGHT + at + ROW_HEIGHT > element.scrollTop + element.clientHeight) {
        element.scrollTop = HEADER_HEIGHT + at + ROW_HEIGHT - element.clientHeight;
      }
    },
    [shown]
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const index = selected === undefined ? -1 : shown.indexOf(selected);
      if (event.key === "ArrowDown") selectAt(index + 1);
      else if (event.key === "ArrowUp") selectAt(index < 0 ? 0 : index - 1);
      else if (event.key === "Enter") pick();
      else return;
      event.preventDefault();
    },
    [selected, shown, selectAt, pick]
  );

  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(shown.length, Math.ceil((scrollTop + height) / ROW_HEIGHT) + OVERSCAN);

  return (
    <Dialog open title={formTitle(mode)} onClose={onCancel} className="microcode-dialog">
      <div className="dialog-body microcode-form">
        <p className="dialog-help">
          From github.com/platomav/CPUMicrocodes — a FIT names no other kind.
        </p>

        <div className="microcode-filters">
          <label className="dialog-check">
            <input
              type="checkbox"
              checked={narrowed}
              disabled={narrowingCpuids(mode).size === 0}
              onChange={(event) => setNarrowed(event.target.checked)}
            />
            {narrowingTitle(mode)}
          </label>
          {searchIsHidden(mode, narrowed) ? null : (
            <input
              type="search"
              className="microcode-search"
              placeholder="CPUID"
              aria-label="CPUID"
              value={search}
              // The list is searched by what a bench writes down: the CPUID.
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  listRef.current?.focus();
                  selectAt(0);
                }
              }}
            />
          )}
        </div>

        {/* biome-ignore lint/a11y/useSemanticElements: the grid role sits on the scroller that takes the keyboard; a <table> may not carry it */}
        <div
          className="microcode-list"
          ref={listCallbackRef}
          role="grid"
          aria-label="Intel microcodes"
          tabIndex={0}
          onKeyDown={onKeyDown}
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        >
          <table className="microcode-table">
            <colgroup>
              {COLUMNS.map((column) => (
                <col key={column.title} style={{ width: column.width }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                {COLUMNS.map((column) => (
                  <th key={column.title} scope="col" className="microcode-head">
                    {column.title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {first > 0 ? <tr style={{ height: first * ROW_HEIGHT }} /> : null}
              {shown.slice(first, last).map((one, offset) => (
                <tr
                  key={one.path}
                  className="microcode-row"
                  aria-selected={one.path === selectedPath}
                  data-selected={one.path === selectedPath ? "" : undefined}
                  data-alt={(first + offset) % 2 === 1 ? "" : undefined}
                  data-prerelease={one.isProduction ? undefined : ""}
                  title={one.path}
                  onClick={() => setSelectedPath(one.path)}
                  onDoubleClick={() => {
                    setSelectedPath(one.path);
                    if (!busy) onPick(one);
                  }}
                >
                  <td>{one.cpuidText}</td>
                  <td>{platformText(one)}</td>
                  <td>{one.revisionText}</td>
                  <td>{one.date}</td>
                  <td className="microcode-release">{releaseText(one)}</td>
                  <td>{sizeText(one)}</td>
                </tr>
              ))}
              {last < shown.length ? (
                <tr style={{ height: (shown.length - last) * ROW_HEIGHT }} />
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="microcode-buttons">
          {line.busy ? <span className="microcode-spinner" role="presentation" /> : null}
          <span className="microcode-status" data-problem={line.problem ? "" : undefined}>
            {line.text}
          </span>
          <button
            type="button"
            className="toolbar-button"
            onClick={onChooseFile}
            disabled={busy}
            title="Add a microcode you already have, without the network"
          >
            Choose File…
          </button>
          <button type="button" className="toolbar-button" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="toolbar-button is-primary"
            onClick={pick}
            disabled={selected === undefined || busy}
          >
            {actionTitle(mode, selected)}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
