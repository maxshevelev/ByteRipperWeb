import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { huffmanDictionariesWanted } from "@/firmware/me/engine/huffmanNeed";
import type { FirmwareAnalysis } from "@/firmware/me/models/firmwareAnalysis";
import { writeImage, writeRichText } from "@/platform/clipboard/richClipboard";
import { downloadBlob } from "@/platform/files/download";
import {
  analyzePaneMe,
  checksumPaneMe,
  firmwareStore,
  parsePaneFirmware,
} from "@/state/firmwareStore";
import {
  cancelHuffmanDictionaries,
  huffmanDictionaryMessage,
  huffmanDictionaryStore,
  loadHuffmanDictionaries,
} from "@/state/huffmanDictionaryStore";
import {
  cancelMEDatabase,
  loadMEDatabase,
  meDatabaseMessage,
  meDatabaseStore,
} from "@/state/meDatabaseStore";
import { useStore } from "@/state/useStore";
import type { PaneId } from "@/state/workspaceStore";
import { clearZones, publishZones } from "@/state/zoneStore";
import { buildSummary, type MEASummaryBlock, type MEASummaryRow } from "@/tools/me/meaSummary";
import {
  CHECKSUMS_TITLE,
  type MEAChecksums,
  type MEANode,
  meaNodeAt,
  meaZones,
  presentMEA,
} from "@/tools/me/meaTree";
import { EMPTY_DETAIL, field, type NodeDetail } from "@/tools/toolDetail";
import type { ToolContext, ToolModule } from "@/tools/toolModule";
import { PaneDivider } from "@/ui/shell/PaneDivider";
import { ToolDetail } from "@/ui/toolPanel/ToolDetail";

/**
 * ME Analyzer: what the Intel Management Engine firmware in this image is.
 *
 * Laid out as upstream's `MEAToolViewController`: two tabs over one content
 * area. «Summary» is MEA's own console table — the facts a bench asks for, in
 * the order the console prints them — with a copy of it as text and as a
 * picture beside the tabs. «Full Tree» is every structure the analysis read,
 * grouped and in reading order, with the detail of the row in focus under a
 * divider that is the reader's to move. A line under both says what is being
 * read or fetched, and what went wrong.
 *
 * Which tab was up, which rows were open and which was in focus are kept per
 * pane, so a panel put away and brought back is the panel that was left.
 */

type Tab = "summary" | "tree";

interface Parked {
  readonly tab: Tab;
  readonly open: ReadonlySet<string>;
  readonly focus: string | undefined;
}

const parked = new Map<PaneId, Parked>();

type Result =
  | { readonly phase: "waiting" }
  | { readonly phase: "done"; readonly analysis: FirmwareAnalysis | undefined }
  | { readonly phase: "failed"; readonly problem: string };

interface TreeRow {
  readonly node: MEANode;
  readonly depth: number;
  readonly key: string;
}

const INDENT = 16;
/** The tree's share of the split; upstream gives the detail a third. */
const DEFAULT_TREE_SHARE = 2 / 3;
const TREE_SHARE_KEY = "byteripper.meTreeShare";
/** How long a line about a copy stays up. */
const NOTICE_DURATION = 4000;

const keyOf = (path: readonly number[]) => path.join("/");
const pathOf = (key: string): number[] => (key.length === 0 ? [] : key.split("/").map(Number));

function storedTreeShare(): number {
  try {
    const raw = localStorage.getItem(TREE_SHARE_KEY);
    const parsed = raw === null ? Number.NaN : Number.parseFloat(raw);
    return Number.isFinite(parsed) && parsed > 0 && parsed < 1 ? parsed : DEFAULT_TREE_SHARE;
  } catch {
    return DEFAULT_TREE_SHARE;
  }
}

function rowsOf(
  nodes: readonly MEANode[],
  open: ReadonlySet<string>,
  depth = 0,
  rows: TreeRow[] = []
): TreeRow[] {
  for (const node of nodes) {
    const key = keyOf(node.path);
    rows.push({ node, depth, key });
    if (open.has(key) && node.children.length > 0) rowsOf(node.children, open, depth + 1, rows);
  }
  return rows;
}

/** The detail of the row in focus, in the shared detail's shape. */
function detailOf(node: MEANode | undefined): NodeDetail {
  if (node === undefined) return EMPTY_DETAIL;
  if (node.fields.length === 0) {
    return { title: "Nothing more to show for this row.", fields: [], tables: [] };
  }
  return {
    title: node.title,
    fields: node.fields.map((one) => field(one.label, one.value)),
    tables: [],
  };
}

function MeToolView({ context }: { readonly context: ToolContext }) {
  const pane = context.pane;
  const firmware = useStore(firmwareStore).panes[pane];
  const database = useStore(meDatabaseStore);
  const huffman = useStore(huffmanDictionaryStore);
  const park = parked.get(pane);
  const [tab, setTab] = useState<Tab>(park?.tab ?? "summary");
  const [open, setOpen] = useState<ReadonlySet<string>>(park?.open ?? new Set());
  const [focus, setFocus] = useState<string | undefined>(park?.focus);
  const [result, setResult] = useState<Result>({ phase: "waiting" });
  const [busy, setBusy] = useState(false);
  const [checksums, setChecksums] = useState<MEAChecksums | undefined>(undefined);
  const [treeShare, setTreeShare] = useState(storedTreeShare);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  /** Which analysis a reply belongs to: a reply to a superseded one is dropped. */
  const request = useRef(0);
  const askedChecksums = useRef(false);
  const treeRef = useRef<HTMLDivElement | null>(null);
  const summaryRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void parsePaneFirmware(pane);
    // The database is fetched when the panel opens, as upstream does: behind
    // the structure, which is on screen first, with the wait said below.
    if (meDatabaseStore.getSnapshot().status === "idle") loadMEDatabase();
    return () => clearZones(pane);
  }, [pane]);

  useEffect(() => {
    parked.set(pane, { tab, open, focus });
  }, [pane, tab, open, focus]);

  const databaseText = database.text;
  const huffmanText = huffman.text;
  const analyze = useCallback(() => {
    const job = ++request.current;
    setBusy(true);
    void analyzePaneMe(pane, databaseText, huffmanText).then((found) => {
      if (job !== request.current) return;
      setBusy(false);
      if (found === undefined) return;
      askedChecksums.current = false;
      setChecksums(undefined);
      setResult(
        found.problem === undefined
          ? { phase: "done", analysis: found.analysis }
          : { phase: "failed", problem: found.problem }
      );
    });
  }, [pane, databaseText, huffmanText]);

  // Read again when the image changes and when a database lands: MEA.dat turns a
  // structure into an identity, Huffman.dat lets the modules be checked, and
  // neither must wait for a click.
  const roots = firmware?.roots;
  const status = firmware?.status;
  const firmwareProblem = firmware?.problem;
  useEffect(() => {
    if (status === "failed") {
      request.current++;
      setBusy(false);
      setResult({ phase: "failed", problem: firmwareProblem ?? "That image could not be read." });
      return;
    }
    if (status !== "ready" || roots === undefined) return;
    analyze();
  }, [roots, status, firmwareProblem, analyze]);

  useEffect(() => {
    if (notice === undefined) return;
    const timer = window.setTimeout(() => setNotice(undefined), NOTICE_DURATION);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const analysis = result.phase === "done" ? result.analysis : undefined;

  // Huffman.dat only for an image that has something to decompress with it, the
  // way upstream fetches it in the middle of such an analysis and no other.
  const wantsDictionaries = analysis !== undefined && huffmanDictionariesWanted(analysis);
  useEffect(() => {
    if (wantsDictionaries && huffmanDictionaryStore.getSnapshot().status === "idle") {
      loadHuffmanDictionaries();
    }
  }, [wantsDictionaries]);
  const tree = useMemo(
    () => (analysis === undefined ? [] : presentMEA(analysis, checksums)),
    [analysis, checksums]
  );
  const blocks = useMemo(() => (analysis === undefined ? [] : buildSummary(analysis)), [analysis]);
  const rows = useMemo(() => rowsOf(tree, open), [tree, open]);
  const selected = focus === undefined ? undefined : meaNodeAt(tree, pathOf(focus));

  // The row in focus, outlined over the dump and in the minimap's gutter.
  const zones = useMemo(() => meaZones(selected), [selected]);
  useEffect(() => {
    publishZones(pane, zones);
  }, [pane, zones]);

  const choose = useCallback(
    (node: MEANode) => {
      setFocus(keyOf(node.path));
      if (node.range !== undefined) context.reveal(node.range.start, node.range.end);
      // The digests are three passes over the region, so they are worked out
      // when somebody looks at them and not before.
      if (node.path.length === 1 && node.title === CHECKSUMS_TITLE && !askedChecksums.current) {
        askedChecksums.current = true;
        const job = request.current;
        void checksumPaneMe(pane).then((found) => {
          if (job !== request.current || found === undefined) return;
          setChecksums({ sha256: found.sha256, sha384: found.sha384, crc32: found.crc32 });
        });
      }
    },
    [context, pane]
  );

  const toggle = useCallback((node: MEANode) => {
    const key = keyOf(node.path);
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const showRow = useCallback((key: string) => {
    // After the render that put the row in the list.
    window.requestAnimationFrame(() => {
      treeRef.current
        ?.querySelector<HTMLElement>(`[data-key="${key}"]`)
        ?.scrollIntoView({ block: "nearest" });
    });
  }, []);

  /** The keyboard, for the tree as a whole: a row is not a tab stop of its own. */
  const onTreeKey = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const index = rows.findIndex((row) => row.key === focus);
      const current = rows[index];
      const moveTo = (row: TreeRow | undefined) => {
        if (row === undefined) return;
        choose(row.node);
        showRow(row.key);
      };
      switch (event.key) {
        case "ArrowDown":
          moveTo(rows[index + 1]);
          break;
        case "ArrowUp":
          moveTo(index < 0 ? rows.at(-1) : rows[index - 1]);
          break;
        case "ArrowRight":
          if (current === undefined) return;
          if (current.node.children.length > 0 && !open.has(current.key)) toggle(current.node);
          else moveTo(rows[index + 1]);
          break;
        case "ArrowLeft":
          if (current === undefined) return;
          if (open.has(current.key)) toggle(current.node);
          else moveTo(rows.find((row) => row.key === keyOf(current.node.path.slice(0, -1))));
          break;
        default:
          return;
      }
      event.preventDefault();
    },
    [rows, focus, open, choose, toggle, showRow]
  );

  const onTabKey = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    setTab((current) => (current === "summary" ? "tree" : "summary"));
  }, []);

  const changeTreeShare = useCallback((share: number) => {
    setTreeShare(share);
    try {
      localStorage.setItem(TREE_SHARE_KEY, String(share));
    } catch {
      // A private window may refuse to store it; the split still applies here.
    }
  }, []);

  const copySummary = useCallback(() => {
    void writeRichText(summaryHtml(blocks), summaryPlain(blocks)).then((done) => {
      setNotice(
        done ? "Summary copied." : "The browser would not put the summary on the clipboard."
      );
    });
  }, [blocks]);

  const copyScreenshot = useCallback(() => {
    const element = summaryRef.current;
    const canvas = element === null ? undefined : summaryPicture(blocks, element);
    if (canvas === undefined) return;
    canvas.toBlob((blob) => {
      if (blob === null) return;
      void writeImage(blob).then((done) => {
        if (done) {
          setNotice("Screenshot copied.");
          return;
        }
        // Plain HTTP and a few browsers have no clipboard for pictures; the
        // picture is still the thing asked for, so it is kept as a file.
        downloadBlob(blob, "ME Summary.png");
        setNotice("The browser would not take a picture, so it was saved as a file.");
      });
    }, "image/png");
  }, [blocks]);

  const hasContent = analysis !== undefined;
  const databaseProblem = meDatabaseMessage(database);
  const huffmanProblem = wantsDictionaries ? huffmanDictionaryMessage(huffman) : undefined;

  return (
    <div className="me-tool">
      <div className="me-head">
        <div
          className="me-tabs"
          role="tablist"
          aria-label="ME Analyzer view"
          tabIndex={-1}
          onKeyDown={onTabKey}
        >
          <TabButton tab="summary" current={tab} onChoose={setTab}>
            Summary
          </TabButton>
          <TabButton tab="tree" current={tab} onChoose={setTab}>
            Full Tree
          </TabButton>
        </div>
        {tab === "summary" && hasContent ? (
          <div className="me-actions">
            <button
              type="button"
              className="me-action"
              title="Copy Summary"
              aria-label="Copy Summary"
              onClick={copySummary}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <rect x="5.5" y="5.5" width="8" height="9" rx="1.5" />
                <path d="M3.5 10.5h-.5a1.5 1.5 0 0 1-1.5-1.5V3a1.5 1.5 0 0 1 1.5-1.5h5A1.5 1.5 0 0 1 9.5 3v.5" />
              </svg>
            </button>
            <button
              type="button"
              className="me-action"
              title="Copy Screenshot"
              aria-label="Copy Screenshot"
              onClick={copyScreenshot}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M1.5 5.5A1.5 1.5 0 0 1 3 4h1.8l1.2-1.8h4l1.2 1.8H13a1.5 1.5 0 0 1 1.5 1.5v6.5A1.5 1.5 0 0 1 13 13.5H3A1.5 1.5 0 0 1 1.5 12z" />
                <circle cx="8" cy="8.5" r="2.6" />
              </svg>
            </button>
          </div>
        ) : null}
      </div>

      <div
        className="me-content"
        role="tabpanel"
        aria-label={tab === "summary" ? "Summary" : "Full Tree"}
      >
        {result.phase === "waiting" ? (
          <Placeholder
            symbol="cpu"
            title="Analyzing the ME firmware…"
            detail="Reading the region and its partitions."
          />
        ) : result.phase === "failed" ? (
          <Placeholder
            symbol="failed"
            title="The analysis did not finish"
            detail="The line below says what went wrong."
          />
        ) : analysis === undefined ? (
          <Placeholder
            symbol="question"
            title="No ME firmware"
            detail="Nothing in this file reads as Intel ME firmware."
          />
        ) : tab === "summary" ? (
          <SummaryView blocks={blocks} scrollRef={summaryRef} />
        ) : (
          <div
            className="tool-split"
            style={{
              gridTemplateRows: `minmax(0, ${treeShare}fr) 6px minmax(0, ${1 - treeShare}fr)`,
            }}
          >
            <div
              className="me-tree"
              ref={treeRef}
              role="tree"
              tabIndex={0}
              aria-label="ME firmware structure"
              onKeyDown={onTreeKey}
            >
              {rows.map((row, index) => (
                <MeTreeRow
                  key={row.key}
                  row={row}
                  alternate={index % 2 === 1}
                  isOpen={open.has(row.key)}
                  isSelected={focus === row.key}
                  onChoose={choose}
                  onToggle={toggle}
                />
              ))}
            </div>
            <PaneDivider
              layout="stacked"
              fraction={treeShare}
              onChange={changeTreeShare}
              initial={DEFAULT_TREE_SHARE}
              label="Resize the detail"
            />
            <ToolDetail
              subject={focus}
              detail={detailOf(selected)}
              placeholder="Select a row to see what it is."
            />
          </div>
        )}
      </div>

      <footer className="tool-notice">
        {busy ? (
          <>
            <span>Reading ME…</span>
            <progress />
          </>
        ) : result.phase === "failed" ? (
          <>
            <span className="me-notice-problem">{result.problem}</span>
            <button type="button" className="toolbar-button is-quiet" onClick={analyze}>
              Try Again
            </button>
          </>
        ) : database.status === "loading" ? (
          <>
            <span>Downloading MEA.dat…</span>
            <button type="button" className="toolbar-button is-quiet" onClick={cancelMEDatabase}>
              Cancel
            </button>
          </>
        ) : databaseProblem !== undefined ? (
          <>
            <span className="me-notice-problem" data-kind={database.failure?.kind}>
              {databaseProblem}
            </span>
            <button
              type="button"
              className="toolbar-button is-quiet"
              onClick={() => loadMEDatabase()}
            >
              Try Again
            </button>
          </>
        ) : huffman.status === "loading" ? (
          <>
            <span>Downloading Huffman.dat…</span>
            <button
              type="button"
              className="toolbar-button is-quiet"
              onClick={cancelHuffmanDictionaries}
            >
              Cancel
            </button>
          </>
        ) : huffmanProblem !== undefined ? (
          <>
            <span className="me-notice-problem" data-kind={huffman.failure?.kind}>
              {huffmanProblem}
            </span>
            <button
              type="button"
              className="toolbar-button is-quiet"
              onClick={() => loadHuffmanDictionaries()}
            >
              Try Again
            </button>
          </>
        ) : notice !== undefined ? (
          <span>{notice}</span>
        ) : null}
      </footer>
    </div>
  );
}

function TabButton({
  tab,
  current,
  onChoose,
  children,
}: {
  readonly tab: Tab;
  readonly current: Tab;
  readonly onChoose: (tab: Tab) => void;
  readonly children: React.ReactNode;
}) {
  const isCurrent = tab === current;
  return (
    <button
      type="button"
      role="tab"
      className="me-tab"
      aria-selected={isCurrent}
      tabIndex={isCurrent ? 0 : -1}
      onClick={() => onChoose(tab)}
    >
      {children}
    </button>
  );
}

function Placeholder({
  symbol,
  title,
  detail,
}: {
  readonly symbol: "cpu" | "question" | "failed";
  readonly title: string;
  readonly detail: string;
}) {
  return (
    <div className="me-placeholder" data-symbol={symbol}>
      <svg viewBox="0 0 32 32" aria-hidden="true">
        {symbol === "cpu" ? (
          <>
            <rect x="8" y="8" width="16" height="16" rx="2.5" />
            <rect x="12.5" y="12.5" width="7" height="7" rx="1" />
            <path d="M12 4v4M16 4v4M20 4v4M12 24v4M16 24v4M20 24v4M4 12h4M4 16h4M4 20h4M24 12h4M24 16h4M24 20h4" />
          </>
        ) : symbol === "question" ? (
          <>
            <circle cx="16" cy="16" r="12" />
            <path d="M12.2 12.6a3.9 3.9 0 1 1 5.6 3.5c-1.1.6-1.8 1.4-1.8 2.7v.7" />
            <circle className="me-placeholder-dot" cx="16" cy="23" r="1.1" />
          </>
        ) : (
          <>
            <path className="me-placeholder-fill" d="M11 3h10l8 8v10l-8 8H11l-8-8V11z" />
            <path className="me-placeholder-mark" d="M16 9v9" />
            <circle className="me-placeholder-mark-dot" cx="16" cy="22.5" r="1.4" />
          </>
        )}
      </svg>
      <p className="me-placeholder-title">{title}</p>
      <p className="me-placeholder-detail">{detail}</p>
    </div>
  );
}

const valueText = (row: MEASummaryRow) =>
  row.value.kind === "value" ? row.value.text : "Coming soon";

/** Keys for rows that may say the same thing twice — two identical messages. */
function uniqueKeys(texts: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return texts.map((text) => {
    const count = seen.get(text) ?? 0;
    seen.set(text, count + 1);
    return count === 0 ? text : `${text}#${count}`;
  });
}

function SummaryView({
  blocks,
  scrollRef,
}: {
  readonly blocks: readonly MEASummaryBlock[];
  readonly scrollRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="me-summary" ref={scrollRef}>
      <div className="me-summary-grid">
        {blocks.map((block) => {
          const keys = uniqueKeys(block.rows.map((row) => `${row.label}\t${valueText(row)}`));
          return (
            <Fragment key={block.title ?? ""}>
              {block.title === undefined ? null : (
                <h3 className="me-summary-title">{block.title}</h3>
              )}
              {block.rows.map((row, index) => (
                <Fragment key={keys[index]}>
                  <span className="me-summary-label">{row.label}</span>
                  <span
                    className="me-summary-value"
                    data-tone={row.tone === "standard" ? undefined : row.tone}
                    data-soon={row.value.kind === "comingSoon" ? "" : undefined}
                  >
                    {valueText(row)}
                  </span>
                </Fragment>
              ))}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

function MeTreeRow({
  row,
  alternate,
  isOpen,
  isSelected,
  onChoose,
  onToggle,
}: {
  readonly row: TreeRow;
  readonly alternate: boolean;
  readonly isOpen: boolean;
  readonly isSelected: boolean;
  readonly onChoose: (node: MEANode) => void;
  readonly onToggle: (node: MEANode) => void;
}) {
  const { node } = row;
  const hasChildren = node.children.length > 0;
  return (
    // The tree takes the keyboard for every row at once, so a row answers the
    // pointer only.
    // biome-ignore lint/a11y/useKeyWithClickEvents: the tree handles the keys
    <div
      className="me-row"
      role="treeitem"
      tabIndex={-1}
      aria-level={row.depth + 1}
      aria-selected={isSelected}
      {...(hasChildren ? { "aria-expanded": isOpen } : {})}
      data-key={row.key}
      data-selected={isSelected ? "" : undefined}
      data-alt={alternate ? "" : undefined}
      data-empty={node.isEmptySection ? "" : undefined}
      onClick={() => onChoose(node)}
      onDoubleClick={() => {
        if (hasChildren) onToggle(node);
      }}
    >
      <span className="me-name" style={{ paddingLeft: `${row.depth * INDENT + 2}px` }}>
        <button
          type="button"
          className="me-twist"
          tabIndex={-1}
          disabled={!hasChildren}
          aria-label={isOpen ? "Collapse" : "Expand"}
          onClick={(event) => {
            event.stopPropagation();
            onToggle(node);
          }}
        >
          {hasChildren ? (isOpen ? "▾" : "▸") : ""}
        </button>
        <span className="me-name-text" title={node.title}>
          {node.title}
        </span>
      </span>
      <span className="me-subtitle" title={node.subtitle}>
        {node.subtitle}
      </span>
    </div>
  );
}

// MARK: - Copies of the summary

const escapeHtml = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/** The summary as lines a plain field can take: a tab between label and value. */
export function summaryPlain(blocks: readonly MEASummaryBlock[]): string {
  return blocks
    .map((block) => {
      const lines = block.rows.map((row) => `${row.label}\t${valueText(row)}`);
      return (block.title === undefined ? lines : [block.title, ...lines]).join("\n");
    })
    .join("\n\n");
}

/** The summary as a two-column table, for a note or a report. */
export function summaryHtml(blocks: readonly MEASummaryBlock[]): string {
  const body = blocks
    .map((block) => {
      const title =
        block.title === undefined
          ? ""
          : `<tr><th colspan="2" align="left">${escapeHtml(block.title)}</th></tr>`;
      const rows = block.rows
        .map(
          (row) =>
            `<tr><td>${escapeHtml(row.label)}</td><td>${escapeHtml(valueText(row))}</td></tr>`
        )
        .join("");
      return title + rows;
    })
    .join("");
  return `<table>${body}</table>`;
}

/**
 * The summary drawn as a picture: the rows as they read on screen, in the
 * panel's own face and colours, with a margin round them.
 */
function summaryPicture(
  blocks: readonly MEASummaryBlock[],
  element: HTMLElement
): HTMLCanvasElement | undefined {
  const style = getComputedStyle(element);
  const token = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  const fontSize = Number.parseFloat(style.fontSize) || 13;
  const plain = `${fontSize}px ${style.fontFamily}`;
  const bold = `600 ${plain}`;
  const margin = 10;
  const gap = 16;
  const lineHeight = Math.ceil(fontSize * 1.55);
  const scale = window.devicePixelRatio || 1;

  const canvas = document.createElement("canvas");
  const draw = canvas.getContext("2d");
  if (draw === null) return undefined;

  type Line =
    | { readonly kind: "title"; readonly text: string }
    | { readonly kind: "row"; readonly row: MEASummaryRow };
  const lines: Line[] = [];
  for (const block of blocks) {
    if (block.title !== undefined) lines.push({ kind: "title", text: block.title });
    for (const row of block.rows) lines.push({ kind: "row", row });
  }

  draw.font = plain;
  let labelWidth = 0;
  let valueWidth = 0;
  for (const line of lines) {
    if (line.kind !== "row") continue;
    labelWidth = Math.max(labelWidth, draw.measureText(line.row.label).width);
    valueWidth = Math.max(valueWidth, draw.measureText(valueText(line.row)).width);
  }
  draw.font = bold;
  const titleWidth = Math.max(
    0,
    ...lines.map((line) => (line.kind === "title" ? draw.measureText(line.text).width : 0))
  );
  // A block title after the first has a line of air above it, as on screen.
  const titleGaps = lines.filter((line, index) => line.kind === "title" && index > 0).length;

  const width = Math.ceil(margin * 2 + Math.max(labelWidth + gap + valueWidth, titleWidth));
  const height = Math.ceil(margin * 2 + (lines.length + titleGaps * 0.5) * lineHeight);
  canvas.width = Math.ceil(width * scale);
  canvas.height = Math.ceil(height * scale);
  draw.scale(scale, scale);
  draw.fillStyle = token("--surface", "#ffffff");
  draw.fillRect(0, 0, width, height);
  draw.textBaseline = "middle";

  const tones: Record<MEASummaryRow["tone"], string> = {
    standard: token("--text", "#1d1d1f"),
    good: token("--semantic-good", "#1a7f37"),
    caution: token("--semantic-caution", "#b25000"),
    bad: token("--semantic-bad", "#c62828"),
  };
  let y = margin;
  lines.forEach((line, index) => {
    if (line.kind === "title") {
      if (index > 0) y += lineHeight * 0.5;
      draw.font = bold;
      draw.fillStyle = tones.standard;
      draw.fillText(line.text, margin, y + lineHeight / 2);
    } else {
      draw.font = plain;
      draw.fillStyle = token("--text-muted", "#6e6e73");
      draw.fillText(line.row.label, margin, y + lineHeight / 2);
      draw.fillStyle =
        line.row.value.kind === "comingSoon"
          ? token("--text-faint", "#8e8e93")
          : tones[line.row.tone];
      draw.fillText(valueText(line.row), margin + labelWidth + gap, y + lineHeight / 2);
    }
    y += lineHeight;
  });
  return canvas;
}

export const meTool: ToolModule = {
  id: "me-analyzer",
  title: "ME Analyzer",
  summary: "The Intel Management Engine firmware: its summary and every structure in it.",
  View: MeToolView,
};
