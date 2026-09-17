import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { huffmanDictionariesWanted } from "@/firmware/me/engine/huffmanNeed";
import type { FirmwareAnalysis } from "@/firmware/me/models/firmwareAnalysis";
import { writeImage, writeRichText } from "@/platform/clipboard/richClipboard";
import { downloadBlob } from "@/platform/files/download";
import { fileTableOf, fileTableStore, loadFileTable } from "@/state/fileTableStore";
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
import type { ToolSessionState } from "@/state/parkedToolState";
import { useStore } from "@/state/useStore";
import { clearZones, publishZones } from "@/state/zoneStore";
import { ConfigRecordPaths } from "@/tools/me/configRecordPaths";
import { EFSFileNames } from "@/tools/me/efsFileNames";
import {
  buildSummary,
  isEmphasized,
  type MEASummaryBlock,
  type MEASummaryRow,
} from "@/tools/me/meaSummary";
import {
  CHECKSUMS_TITLE,
  type MEAChecksums,
  type MEANode,
  meaNodeAt,
  meaZones,
  presentMEA,
} from "@/tools/me/meaTree";
import { MEA_TREE_MARKS } from "@/tools/me/meaTreeMarks";
import { fileTableWanted, MFSFileNames } from "@/tools/me/mfsFileNames";
import { EMPTY_DETAIL, field, type NodeDetail } from "@/tools/toolDetail";
import type { ToolContext, ToolModule } from "@/tools/toolModule";
import { useParkedToolState } from "@/tools/toolParkedState";
import { useZoneSelection } from "@/tools/toolZoneSelection";
import { CameraShapes, CopyDocumentShapes } from "@/ui/shell/copyGlyphs";
import { PaneDivider } from "@/ui/shell/PaneDivider";
import { RowMarksIcons, rowMarkTitle, rowPaintAttrs } from "@/ui/toolPanel/RowMarks";
import { ToolDetail } from "@/ui/toolPanel/ToolDetail";
import { ToolRowMarksLegend, useShowsMarkings } from "@/ui/toolPanel/ToolRowMarksLegend";

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

/**
 * @upstream Modules/MEATool/Sources/MEAToolUI/MEAToolModule.swift#MEAParkedState
 * @upstream-differs it keeps the open rows too
 */
interface Parked {
  /** @upstream Modules/MEATool/Sources/MEAToolUI/MEAToolModule.swift#MEAParkedState.tabIndex */
  readonly tab: Tab;
  readonly open: ReadonlySet<string>;
  /** @upstream Modules/MEATool/Sources/MEAToolUI/MEAToolModule.swift#MEAParkedState.focusPath */
  readonly focus: string | undefined;
}

/**
 * The state handed back by a previous session of this tool, as this tool keeps
 * it — or nothing, when there is none of that shape.
 *
 * @upstream Modules/MEATool/Sources/MEAToolUI/MEAToolModule.swift#MEAToolSession.restore
 */
function restoredParked(state: ToolSessionState | undefined): Parked | undefined {
  const held = state as Partial<Parked> | undefined;
  if (held === undefined) return undefined;
  if (held.tab !== "summary" && held.tab !== "tree") return undefined;
  if (!(held.open instanceof Set)) return undefined;
  if (held.focus !== undefined && typeof held.focus !== "string") return undefined;
  return { tab: held.tab, open: held.open, focus: held.focus };
}

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
/**
 * The panel's name in the legend's remembered states. Upstream's, so a reader
 * who has made the same choice in both editions keeps it.
 *
 * @upstream Modules/MEATool/Sources/MEAToolUI/MEAToolViewController.swift#MEAToolViewController.legend
 */
const MEA_PANEL = "MEAnalyzer";
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

/** @upstream Modules/MEATool/Sources/MEAToolUI/MEAToolViewController.swift#MEAToolViewController.show */
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
    fields: node.fields.map((one) =>
      one.tone === "good"
        ? { ...field(one.label, one.value), isDone: true }
        : field(one.label, one.value)
    ),
    tables: [],
  };
}

/**
 * @upstream Modules/MEATool/Sources/MEAToolUI/MEAToolModule.swift#MEAToolSession
 * @upstream Modules/MEATool/Sources/MEAToolUI/MEAToolViewController.swift#MEAToolViewController
 * @upstream Modules/MEATool/Sources/MEAToolUI/MEAToolViewController.swift#MEAToolViewController.loadView
 * @upstream-differs a React component: its render and effects are the session and its view controller
 */
function MeToolView({ context }: { readonly context: ToolContext }) {
  const pane = context.pane;
  const firmware = useStore(firmwareStore).panes[pane];
  const database = useStore(meDatabaseStore);
  const huffman = useStore(huffmanDictionaryStore);
  const fileTable = useStore(fileTableStore);
  const park = restoredParked(context.restored);
  const [tab, setTab] = useState<Tab>(park?.tab ?? "summary");
  const [open, setOpen] = useState<ReadonlySet<string>>(park?.open ?? new Set());
  const [focus, setFocus] = useState<string | undefined>(park?.focus);
  const [result, setResult] = useState<Result>({ phase: "waiting" });
  const [busy, setBusy] = useState(false);
  const [checksums, setChecksums] = useState<MEAChecksums | undefined>(undefined);
  const [treeShare, setTreeShare] = useState(storedTreeShare);
  const [showsMarkings, setShowsMarkings] = useShowsMarkings(MEA_PANEL);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  /** Which analysis a reply belongs to: a reply to a superseded one is dropped. */
  const request = useRef(0);
  const askedChecksums = useRef(false);
  const treeRef = useRef<HTMLDivElement | null>(null);
  const summaryRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void parsePaneFirmware(pane);
    // The database is fetched when the panel opens, as upstream does: behind
    // the structure, which is on screen first, with the wait said below. Asked
    // unconditionally rather than only when nothing is held: a database in hand
    // is what the day's re-check runs from, and the source answers this ask at
    // once either way.
    loadMEDatabase();
    return () => clearZones(pane);
  }, [pane]);

  /**
   * What this session would hand back if it ended now: the tab that was up, the
   * rows that were open and the row in focus.
   *
   * @upstream Modules/MEATool/Sources/MEAToolUI/MEAToolModule.swift#MEAToolSession.parkedState
   * @upstream-differs it keeps the open rows too
   */
  useParkedToolState(pane, () => ({ tab, open, focus }));

  const databaseText = database.text;
  const huffmanText = huffman.text;
  const fileTableText = fileTable.body?.text;
  /** @upstream Modules/MEATool/Sources/MEAToolUI/MEAToolViewController.swift#MEAToolViewController.onRetry */
  const analyze = useCallback(() => {
    const job = ++request.current;
    setBusy(true);
    void analyzePaneMe(pane, databaseText, huffmanText, fileTableText).then((found) => {
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
  }, [pane, databaseText, huffmanText, fileTableText]);

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
    if (status !== "ready" || roots === undefined) {
      // The image is being read, and whatever the panel holds was read against
      // the bytes before — an analysis of a file that is no longer the one on
      // screen. It goes back to the placeholder rather than standing there
      // unmarked: upstream puts its own back for the same reason, where any
      // content change is a `reparse` and every reparse begins with the busy
      // display and the wait.
      // @upstream Modules/MEATool/Sources/MEAToolUI/MEAToolModule.swift#MEAToolSession.contentChanged
      request.current++;
      setBusy(false);
      setResult({ phase: "waiting" });
      return;
    }
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
    // Asked on every analysis that wants them, not only on the first: what is
    // held answers at once and the day's re-check runs behind it, which is what
    // makes a dictionary that has since changed arrive without a reload.
    if (wantsDictionaries) loadHuffmanDictionaries();
  }, [wantsDictionaries]);

  // Every ID-keyed Configuration record in the analysis, wherever it came from:
  // the FITC partition's payload and a newer volume's own 6/7 streams are keyed
  // into the same table.
  const configIDs = useMemo(
    () => [
      ...(analysis?.oemConfiguration?.recordsByID ?? []).map((one) => one.fileID),
      ...(analysis?.mfsVolume?.configurationsByID ?? []).flatMap((stream) =>
        stream.records.map((one) => one.fileID)
      ),
    ],
    [analysis]
  );

  // FileTable.dat only for an analysis that needs it — a volume that cannot
  // name its own files, an EFS volume (which lists nothing without it), or
  // ID-keyed Configuration records that need it for a path — and asked for
  // *after* the analysis, which is what says so. Most dumps never need it, and
  // it is the largest of the three databases. Asked once per analysis: what is
  // held answers at once with the day's check behind it.
  const wantsNames = analysis !== undefined && fileTableWanted(analysis, configIDs);
  useEffect(() => {
    if (wantsNames) loadFileTable();
  }, [wantsNames]);

  // The names belong to the volume they were looked up for; `MFSFileNames.none`
  // is a volume the table does not describe, and every legacy volume, whose
  // rows keep the numbers their own bytes carry.
  const table = fileTableOf(fileTable);
  const names = useMemo(
    () =>
      analysis?.mfsVolume === undefined
        ? MFSFileNames.none
        : MFSFileNames.forVolume(table, analysis.mfsVolume),
    [analysis, table]
  );
  // The EFS volume's lookup reads the *MFS* volume's platform and dictionary —
  // upstream hands `efs_anl` the values `mfs_anl` read — so it is the MFS row's
  // fields, not the EFS page's own Dictionary, that name the tables.
  const efsNames = useMemo(
    () =>
      analysis?.efsVolume === undefined
        ? EFSFileNames.none
        : EFSFileNames.forVolume({
            table,
            volume: analysis.efsVolume,
            platform: analysis.mfsVolume?.ftblPlatform ?? -1,
            dictionary: analysis.mfsVolume?.ftblDictionary ?? -1,
          }),
    [analysis, table]
  );
  const configPaths = useMemo(
    () =>
      configIDs.length === 0
        ? ConfigRecordPaths.none
        : ConfigRecordPaths.forFileIDs({
            table,
            fileIDs: configIDs,
            platform: analysis?.mfsVolume?.ftblPlatform ?? -1,
            dictionary: analysis?.mfsVolume?.ftblDictionary ?? -1,
          }),
    [configIDs, table, analysis]
  );
  const tree = useMemo(
    () =>
      analysis === undefined ? [] : presentMEA(analysis, checksums, names, efsNames, configPaths),
    [analysis, checksums, names, efsNames, configPaths]
  );
  const blocks = useMemo(() => (analysis === undefined ? [] : buildSummary(analysis)), [analysis]);
  const rows = useMemo(() => rowsOf(tree, open), [tree, open]);
  const selected = focus === undefined ? undefined : meaNodeAt(tree, pathOf(focus));

  // The row in focus, outlined over the dump and in the minimap's gutter.
  const zones = useMemo(() => meaZones(selected), [selected]);
  useEffect(() => {
    publishZones(pane, zones);
  }, [pane, zones]);

  /**
   * @upstream Modules/MEATool/Sources/MEAToolUI/MEAToolViewController.swift#MEAToolViewController.onSelect
   * @upstream Modules/MEATool/Sources/MEAToolUI/MEAToolViewController.swift#MEAToolViewController.outlineViewSelectionDidChange
   */
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

  /**
   * The zone the user picked in the dump, brought to the front: every ancestor
   * of the row opened, the row scrolled to and taken in focus — the whole of
   * what upstream's `show` does with a path.
   *
   * Only the tree moves: the bytes are already selected, and the dump is where
   * the reader is standing. A path that names no node of this analysis is
   * nothing to say, which is the check upstream makes before it moves anything;
   * and the row's own description follows the focus by itself, as does the map
   * that goes back out to the dump.
   *
   * @upstream Modules/MEATool/Sources/MEAToolUI/MEAToolModule.swift#MEAToolSession.zoneSelected
   * @upstream Modules/MEATool/Sources/MEAToolUI/MEAToolViewController.swift#MEAToolViewController.expandPath
   */
  const zonePicked = useCallback(
    (zoneId: string) => {
      // Upstream reads the fields one by one and keeps the ones that are
      // numbers, so an id that is not one of ours comes back as a path that
      // finds nothing rather than as a refusal here.
      const path = zoneId
        .split("/")
        .filter((field) => /^[+-]?\d+$/.test(field))
        .map(Number);
      if (path.length === 0 || meaNodeAt(tree, path) === undefined) return;
      setOpen((current) => {
        const next = new Set(current);
        // The last step is the row itself; its ancestors above it are opened.
        for (let depth = 0; depth < path.length - 1; depth++) {
          next.add(keyOf(path.slice(0, depth + 1)));
        }
        return next;
      });
      setFocus(zoneId);
      showRow(zoneId);
    },
    [tree, showRow]
  );
  useZoneSelection(pane, zonePicked);

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

  const { showNotice } = context;

  /**
   * The summary as text on the clipboard, confirmed over the window with the
   * button's own sign — and only once the clipboard took it: the plate says the
   * summary is there, and a copy that failed is not something to say happened.
   * A refusal is said in the panel's own line instead, which is where it can be
   * acted on.
   *
   * @upstream Modules/MEATool/Sources/MEAToolUI/MEAToolViewController.swift#MEAToolViewController.copySummary
   * @upstream Modules/MEATool/Sources/MEAToolUI/MEAToolViewController.swift#MEAToolViewController.onSummaryCopied
   */
  const copySummary = useCallback(() => {
    if (blocks.length === 0) return;
    void writeRichText(summaryHtml(blocks), summaryPlain(blocks)).then((done) => {
      if (done) showNotice("copySummary", ["Summary Copied"]);
      else setNotice("The browser would not put the summary on the clipboard.");
    });
  }, [blocks, showNotice]);

  /**
   * @upstream Modules/MEATool/Sources/MEAToolUI/MEAToolViewController.swift#MEAToolViewController.copyScreenshot
   * @upstream Modules/MEATool/Sources/MEAToolUI/MEAToolViewController.swift#MEAToolViewController.onScreenshotCopied
   */
  const copyScreenshot = useCallback(() => {
    if (blocks.length === 0) return;
    const element = summaryRef.current;
    const canvas = element === null ? undefined : summaryPicture(blocks, element);
    if (canvas === undefined) return;
    canvas.toBlob((blob) => {
      if (blob === null) return;
      void writeImage(blob).then((done) => {
        if (done) {
          showNotice("copyScreenshot", ["Screenshot Copied"]);
          return;
        }
        // Plain HTTP and a few browsers have no clipboard for pictures; the
        // picture is still the thing asked for, so it is kept as a file.
        downloadBlob(blob, "ME Summary.png");
        setNotice("The browser would not take a picture, so it was saved as a file.");
      });
    }, "image/png");
  }, [blocks, showNotice]);

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
                <CopyDocumentShapes />
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
                <CameraShapes />
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
          // Two waits wear one placeholder upstream, because upstream's own is
          // the shorter of the two: the tree it reads against is already being
          // built for the UEFI panel. Here the parse is this panel's first wait
          // and can be a long one, so the caption names the wait that is
          // actually running and the bar measures it.
          // @upstream-differs upstream's caption reads "Reading the region and
          // its partitions." from the moment the panel opens, while the file
          // behind it is still being parsed
          <Placeholder
            symbol="cpu"
            title="Analyzing the ME firmware…"
            detail={
              firmware?.status === "ready"
                ? "Reading the region and its partitions."
                : "Reading the file first: the region is found in its tree."
            }
            fraction={firmware?.status === "ready" ? undefined : (firmware?.fraction ?? 0)}
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
            {/* The tree and its legend are one pane of the split: the legend
                takes its room at the pane's bottom edge and the tree gives it
                up, so it never covers a row (`Design/ROW_MARKS.md` §6). */}
            <div className="tool-marked-list">
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
                    showsMarkings={showsMarkings}
                    onChoose={choose}
                    onToggle={toggle}
                  />
                ))}
              </div>

              <ToolRowMarksLegend
                panel={MEA_PANEL}
                marks={MEA_TREE_MARKS.legendMarks}
                showsMarkings={showsMarkings}
                onShowsMarkingsChange={setShowsMarkings}
              />
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

/** @upstream Modules/MEATool/Sources/MEAToolUI/MEAToolViewController.swift#MEAToolViewController.onTabChanged */
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

/**
 * @upstream Modules/MEATool/Sources/MEAToolUI/MEAToolViewController.swift#MEAToolViewController.Placeholder
 * @upstream Modules/MEATool/Sources/MEAToolUI/MEAToolViewController.swift#MEAToolViewController.Placeholder.symbol
 * @upstream Modules/MEATool/Sources/MEAToolUI/MEAToolViewController.swift#MEAToolViewController.Placeholder.title
 * @upstream Modules/MEATool/Sources/MEAToolUI/MEAToolViewController.swift#MEAToolViewController.Placeholder.caption
 * @upstream Modules/MEATool/Sources/MEAToolUI/MEAToolViewController.swift#MEAToolViewController.setPlaceholder
 * @upstream-differs a component taking the symbol, title and caption (detail) as props
 */
function Placeholder({
  symbol,
  title,
  detail,
  fraction,
}: {
  readonly symbol: "cpu" | "question" | "failed";
  readonly title: string;
  readonly detail: string;
  /**
   * How far the wait the caption names has got, where it has something to
   * measure — nothing while the analysis itself is the wait, which has no
   * steps to count.
   */
  readonly fraction?: number | undefined;
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
      {fraction === undefined ? null : <progress value={fraction} max={1} />}
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

/** @upstream Modules/MEATool/Sources/MEAToolUI/MEAToolViewController.swift#MEAToolViewController.showSummary */
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
                    data-emphasis={isEmphasized(row) ? "" : undefined}
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

/** @upstream Modules/MEATool/Sources/MEAToolUI/MEAToolViewController.swift#MEAToolViewController.outlineView */
function MeTreeRow({
  row,
  alternate,
  isOpen,
  isSelected,
  showsMarkings,
  onChoose,
  onToggle,
}: {
  readonly row: TreeRow;
  readonly alternate: boolean;
  readonly isOpen: boolean;
  readonly isSelected: boolean;
  readonly showsMarkings: boolean;
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
      className="me-row tool-marked-row"
      role="treeitem"
      tabIndex={-1}
      aria-level={row.depth + 1}
      aria-selected={isSelected}
      {...(hasChildren ? { "aria-expanded": isOpen } : {})}
      data-key={row.key}
      data-selected={isSelected ? "" : undefined}
      data-alt={alternate ? "" : undefined}
      data-empty={node.isEmptySection ? "" : undefined}
      // The row's background and rail in words, so nothing it says is said by
      // colour alone (`Design/ROW_MARKS.md` §2).
      title={rowMarkTitle(node.marks)}
      {...rowPaintAttrs(node.marks, showsMarkings)}
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
        <RowMarksIcons marks={node.marks} />
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

/**
 * The summary as lines a plain field can take: a tab between label and value.
 *
 * @upstream Modules/MEATool/Sources/MEAToolUI/MEAToolViewController.swift#MEAToolViewController.richText
 */
export function summaryPlain(blocks: readonly MEASummaryBlock[]): string {
  return blocks
    .map((block) => {
      const lines = block.rows.map((row) => `${row.label}\t${valueText(row)}`);
      return (block.title === undefined ? lines : [block.title, ...lines]).join("\n");
    })
    .join("\n\n");
}

/**
 * The summary as a two-column table, for a note or a report.
 *
 * @upstream Modules/MEATool/Sources/MEAToolUI/MEAToolViewController.swift#MEAToolViewController.richText
 */
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
 * panel's own face and colours, with a margin round them. A toned value keeps
 * the weight the panel gives it — a picture that dropped it would not be the
 * rows as they read.
 *
 * @upstream Modules/MEATool/Sources/MEAToolUI/MEAToolViewController.swift#MEAToolViewController.summaryPicture
 */
function summaryPicture(
  blocks: readonly MEASummaryBlock[],
  element: HTMLElement
): HTMLCanvasElement | undefined {
  const style = getComputedStyle(element);
  const token = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  const fontSize = Number.parseFloat(style.fontSize) || 13;
  const plain = `${fontSize}px ${style.fontFamily}`;
  const semibold = `600 ${plain}`;
  // A status-toned value is drawn a step heavier than a heading, as upstream
  // draws it in `.bold` where its titles are `.semibold`.
  const bold = `700 ${plain}`;
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
  for (const line of lines) {
    if (line.kind !== "row") continue;
    labelWidth = Math.max(labelWidth, draw.measureText(line.row.label).width);
  }
  // Each value is measured in the face it will be drawn in: an emphasized one
  // is wider than the plain measure, and the canvas is cut to the widest row.
  let valueWidth = 0;
  for (const line of lines) {
    if (line.kind !== "row") continue;
    draw.font = isEmphasized(line.row) ? bold : plain;
    valueWidth = Math.max(valueWidth, draw.measureText(valueText(line.row)).width);
  }
  draw.font = semibold;
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
      draw.font = semibold;
      draw.fillStyle = tones.standard;
      draw.fillText(line.text, margin, y + lineHeight / 2);
    } else {
      draw.font = plain;
      draw.fillStyle = token("--text-muted", "#6e6e73");
      draw.fillText(line.row.label, margin, y + lineHeight / 2);
      // The value carries the weight and the colour the panel gives it; the
      // label beside it is neither.
      draw.font = isEmphasized(line.row) ? bold : plain;
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

/**
 * @upstream Modules/MEATool/Sources/MEAToolUI/MEAToolModule.swift#MEAToolModule
 * @upstream Modules/MEATool/Sources/MEAToolUI/MEAToolModule.swift#MEAToolModule.identifier
 * @upstream Modules/MEATool/Sources/MEAToolUI/MEAToolModule.swift#MEAToolModule.title
 */
export const meTool: ToolModule = {
  id: "dev.maxik.tool.me-analyzer",
  title: "ME Analyzer",
  summary: "The Intel Management Engine firmware: its summary and every structure in it.",
  View: MeToolView,
};
