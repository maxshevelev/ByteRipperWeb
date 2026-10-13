import { type ReactElement, useEffect, useRef } from "react";
import { L } from "@/core/localization/localization";
import { openContextMenu } from "@/ui/shell/ContextMenu";

/**
 * One line of the list, as the panel words it.
 *
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIContentResultsView.swift#UEFIContentResultsView.Row
 */
export interface ContentResultRow {
  /**
   * The node that holds the match, after its parent's name where the parent has one of its own.
   *
   * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIContentResultsView.swift#UEFIContentResultsView.Row.node
   */
  readonly node: string;
  /**
   * The codecs the match's bytes came through, outermost first: `LZMA`, `XOR 81`.
   *
   * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIContentResultsView.swift#UEFIContentResultsView.Row.codecs
   */
  readonly codecs: readonly string[];
  /**
   * The file address, or where in a compressed section's decompressed bytes.
   *
   * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIContentResultsView.swift#UEFIContentResultsView.Row.address
   */
  readonly address: string;
  /**
   * The names from the top of the tree down to the node.
   *
   * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIContentResultsView.swift#UEFIContentResultsView.Row.path
   */
  readonly path: string;
  /**
   * What opening the row opens, for a match behind a codec; nothing for the file's own bytes.
   *
   * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIContentResultsView.swift#UEFIContentResultsView.Row.openTitle
   */
  readonly openTitle: string | undefined;
  /** @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIContentResultsView.swift#UEFIContentResultsView.Row.excerpt */
  readonly excerpt: Uint8Array;
  /** @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIContentResultsView.swift#UEFIContentResultsView.Row.excerptMatch */
  readonly excerptMatch: readonly [number, number];
}

/**
 * What the panel says.
 *
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIContentResultsView.swift#UEFIContentResultsView.State
 */
export type ContentResultsState =
  | { readonly kind: "idle" }
  | { readonly kind: "searching"; readonly fraction: number }
  /** It is over: every match, and where it looked — nothing for the whole tree. */
  | { readonly kind: "done"; readonly total: number; readonly scope: string | undefined };

const grouped = (value: number) => value.toLocaleString();

/**
 * The header's words.
 *
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIContentResultsView.swift#UEFIContentResultsView.apply
 */
export function contentResultsTitle(state: ContentResultsState, listed: number): string {
  switch (state.kind) {
    case "idle":
      return L("Search results (0)");
    case "searching":
      return L("Search results (searching…)");
    case "done": {
      const count =
        listed === state.total
          ? grouped(state.total)
          : L("%1$@, the first %2$@ listed", grouped(state.total), grouped(listed));
      return state.scope === undefined
        ? L("Search results (%1$@)", count)
        : L("Search results in %1$@ (%2$@)", state.scope, count);
    }
  }
}

/** "AB CD EF", the matched bytes bold — as the dump's results draw them. */
function HexExcerpt({ row }: { readonly row: ContentResultRow }) {
  const [from, to] = row.excerptMatch;
  const text = (bytes: Uint8Array) =>
    [...bytes].map((byte) => byte.toString(16).toUpperCase().padStart(2, "0")).join(" ");
  const before = row.excerpt.subarray(0, from);
  const match = row.excerpt.subarray(from, to);
  const after = row.excerpt.subarray(to);
  return (
    <span className="search-result-hex">
      {before.length > 0 ? `${text(before)} ` : ""}
      <b>{text(match)}</b>
      {after.length > 0 ? ` ${text(after)}` : ""}
    </span>
  );
}

/** The bytes as ASCII, a dimmed dot for one that is not printable, the matched bytes bold. */
function TextExcerpt({ row }: { readonly row: ContentResultRow }) {
  const [from, to] = row.excerptMatch;
  const chars = (bytes: Uint8Array) =>
    [...bytes].map((byte, index) =>
      byte >= 0x20 && byte < 0x7f ? (
        String.fromCharCode(byte)
      ) : (
        // biome-ignore lint/suspicious/noArrayIndexKey: a byte's place in the excerpt is its identity
        <span key={index} className="content-result-dot">
          .
        </span>
      )
    );
  return (
    <span className="search-result-text">
      {chars(row.excerpt.subarray(0, from))}
      <b>{chars(row.excerpt.subarray(from, to))}</b>
      {chars(row.excerpt.subarray(to))}
    </span>
  );
}

/**
 * The Contents search's results, under the tree — the panel the dump's Search All opens under the
 * dump, read the same way: a header with the count and a ×, and a row per match with the bytes
 * around it, the match in bold. What the dump's panel has no need of comes first: the node that
 * holds the match, after the node above it where that one has a name of its own, and after a badge
 * for each codec its bytes came through. While the search runs the header carries its progress and
 * a stop button.
 *
 * A click goes to the match; the arrow keys go to the next or the previous as a click does. A
 * double click on a match behind a codec opens the bytes it is in as a fragment panel, the match
 * selected — and so does the row's right-click menu, which names what opens.
 *
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIContentResultsView.swift#UEFIContentResultsView
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIContentResultsView.swift#UEFIBadgedCell
 * @upstream-differs a list of buttons in the dump's search results' grid, where upstream is a table
 */
// help: panel.uefi.content-search
export function UefiContentResults({
  state,
  rows,
  selected,
  onChoose,
  onOpen,
  onStop,
  onClose,
  onSpace,
}: {
  /**
   * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIContentResultsView.swift#UEFIContentResultsView.state
   * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIContentResultsView.swift#UEFIContentResultsView.show
   * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIContentResultsView.swift#UEFIContentResultsView.showSearching
   * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIContentResultsView.swift#UEFIContentResultsView.clear
   */
  readonly state: ContentResultsState;
  /** @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIContentResultsView.swift#UEFIContentResultsView.rows */
  readonly rows: readonly ContentResultRow[];
  readonly selected: number | undefined;
  /**
   * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIContentResultsView.swift#UEFIContentResultsView.onChoose
   * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIContentResultsView.swift#UEFIContentResultsView.choose
   */
  readonly onChoose: (index: number) => void;
  /**
   * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIContentResultsView.swift#UEFIContentResultsView.onOpen
   * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIContentResultsView.swift#UEFIContentResultsView.open
   * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIContentResultsView.swift#UEFIContentResultsView.menu
   */
  readonly onOpen: (index: number) => void;
  /** @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIContentResultsView.swift#UEFIContentResultsView.onStop */
  readonly onStop: () => void;
  /** @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIContentResultsView.swift#UEFIContentResultsView.onClose */
  readonly onClose: () => void;
  /**
   * Space on the list: the details of the selected match's node in the large view, as on the
   * tree; false when there is nothing to show. The list keeps the arrow keys while it is open.
   *
   * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolDetailPane.swift#ToolDetailPane.attach
   */
  readonly onSpace: (list: HTMLElement) => boolean;
}): ReactElement {
  const list = useRef<HTMLOListElement | null>(null);
  useEffect(() => {
    if (selected === undefined) return;
    const row = list.current?.children[selected] as HTMLElement | undefined;
    row?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const searching = state.kind === "searching";
  return (
    <section className="search-results uefi-content-results" aria-label={L("Search results")}>
      <div className="search-results-title">
        <span aria-live="polite">{contentResultsTitle(state, rows.length)}</span>
        {searching ? (
          <>
            <progress className="uefi-content-progress" value={state.fraction} max={1} />
            <button
              type="button"
              className="search-results-close"
              aria-label={L("Stop searching")}
              title={L("Stop the search through the contents")}
              onClick={onStop}
            >
              <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                <circle cx="8" cy="8" r="7" fill="currentColor" opacity="0.45" />
                <path
                  d="m5.5 5.5 5 5M10.5 5.5l-5 5"
                  stroke="var(--surface)"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </>
        ) : null}
        <button
          type="button"
          className="search-results-close"
          aria-label={L("Close search results")}
          title={L("Close search results")}
          onClick={onClose}
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
      {rows.length === 0 ? (
        <p className="search-results-message">
          {searching ? L("Searching…") : state.kind === "done" ? L("No matches.") : ""}
        </p>
      ) : (
        <>
          <div className="search-results-head" role="presentation">
            <span
              title={L(
                "The node that holds the match, after the node above it and the codecs its bytes came through"
              )}
            >
              {L("Node")}
            </span>
            <span>{L("Excerpt Hex")}</span>
            <span>{L("Excerpt Text")}</span>
          </div>
          <ol
            className="search-results-list"
            ref={list}
            data-key-table=""
            onKeyDown={(event) => {
              if (event.key === " " && !event.ctrlKey && !event.metaKey && !event.altKey) {
                if (onSpace(event.currentTarget)) event.preventDefault();
                return;
              }
              if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
              event.preventDefault();
              const step = event.key === "ArrowDown" ? 1 : -1;
              const next = Math.min(rows.length - 1, Math.max(0, (selected ?? -1) + step));
              onChoose(next);
              (list.current?.children[next]?.firstElementChild as HTMLElement | null)?.focus();
            }}
          >
            {rows.map((row, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: a row is its place in the list of one search
              <li key={index}>
                <button
                  type="button"
                  className={`search-result${selected === index ? " is-current" : ""}`}
                  title={[row.path, row.address].filter((one) => one !== "").join("\n")}
                  onClick={() => onChoose(index)}
                  onDoubleClick={() => onOpen(index)}
                  onContextMenu={(event) => {
                    const title = row.openTitle;
                    if (title === undefined) return;
                    openContextMenu(event, [
                      {
                        label: title,
                        tooltip: L(
                          "Open the bytes this match is in as a panel, the match selected"
                        ),
                        onSelect: () => onOpen(index),
                      },
                    ]);
                  }}
                >
                  <span className="content-result-node">
                    {row.codecs.map((codec, at) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: the codecs' order is the chain's
                      <span key={at} className="pane-codec-badge">
                        {codec}
                      </span>
                    ))}
                    <span className="content-result-name">{row.node}</span>
                  </span>
                  <HexExcerpt row={row} />
                  <TextExcerpt row={row} />
                </button>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
