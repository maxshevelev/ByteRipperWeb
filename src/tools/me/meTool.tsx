import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TOPIC } from "@/core/help/helpIds";
import { L, localized } from "@/core/localization/localization";
import { huffmanDictionariesWanted } from "@/firmware/me/engine/huffmanNeed";
import type { FirmwareAnalysis } from "@/firmware/me/models/firmwareAnalysis";
import { writeImage, writeRichText } from "@/platform/clipboard/richClipboard";
import { downloadBlob } from "@/platform/files/download";
import { fileTableStore, loadFileTable } from "@/state/fileTableStore";
import {
  checksumPaneMe,
  ensurePaneFirmware,
  fileNamesPaneMe,
  firmwareStore,
  readPaneMe,
} from "@/state/firmwareStore";
import {
  cancelHuffmanDictionaries,
  huffmanDictionaryMessage,
  huffmanDictionaryStore,
  loadHuffmanDictionaries,
} from "@/state/huffmanDictionaryStore";
import { toggleLargeDetail, useLargeDetailOf } from "@/state/largeDetailStore";
import { liveMeData, useMeDataReplaced } from "@/state/meData";
import {
  cancelMEDatabase,
  loadMEDatabase,
  meDatabaseMessage,
  meDatabaseStore,
} from "@/state/meDatabaseStore";
import type { ToolSessionState } from "@/state/parkedToolState";
import { useStore } from "@/state/useStore";
import { clearZones, publishZones } from "@/state/zoneStore";
import { ConfigRecordPaths } from "@/tools/configRecordPaths";
import { EFSFileNames } from "@/tools/efsFileNames";
import { meAgentComparisons, meAgentLocator, meAgentQueries } from "@/tools/me/agent/meAgentModule";
import {
  buildConfiguration,
  configurationRowDiffers,
  type MEAConfigurationBlock,
  type MEAConfigurationRow,
} from "@/tools/me/meaConfiguration";
import {
  buildSummary,
  isEmphasized,
  type MEASummaryBlock,
  type MEASummaryRow,
  summaryValueText,
} from "@/tools/me/meaSummary";
import {
  CONFIGURATION_ABSENT,
  configurationFITC,
  configurationMFS,
} from "@/tools/meaConfigurationText";
import { meaPartOpen } from "@/tools/meaParts";
import {
  CHECKSUMS_TITLE,
  type MEAChecksums,
  type MEANode,
  meaNodeAt,
  meaZones,
  presentMEA,
} from "@/tools/meaTree";
import { MEA_TREE_MARKS } from "@/tools/meaTreeMarks";
import { type MEAPending, NOTHING_PENDING } from "@/tools/mePending";
import { type MeReading, pendingOf } from "@/tools/meReads";
import { fileTableWanted, MFSFileNames, meFileNamesAsk } from "@/tools/mfsFileNames";
import { EMPTY_DETAIL, type NodeDetail, tonedField } from "@/tools/toolDetail";
import type { ToolContext, ToolModule } from "@/tools/toolModule";
import { useToolNavigation } from "@/tools/toolNavigation";
import { useParkedToolState } from "@/tools/toolParkedState";
import type { ToolValueTone } from "@/tools/toolValueTone";
import { useZoneSelection } from "@/tools/toolZoneSelection";
import { HelpPopover } from "@/ui/help/HelpPopover";
import { HelpPopoverLayout, HelpPopoverProse } from "@/ui/help/HelpPopoverLayout";
import { CameraShapes, CopyDocumentShapes } from "@/ui/shell/copyGlyphs";
import { PaneDivider } from "@/ui/shell/PaneDivider";
import { ColumnResizer } from "@/ui/toolPanel/ColumnResizer";
import { columnTemplate, type TableColumn, useColumnWidths } from "@/ui/toolPanel/columnWidths";
import { DisclosureChevron } from "@/ui/toolPanel/DisclosureChevron";
import { RowMarksIcons, rowMarkTitle, rowPaintAttrs } from "@/ui/toolPanel/RowMarks";
import {
  DetailFields,
  detailSelectionHandlers,
  type FieldHelp,
  type ListedField,
  ToolDetail,
} from "@/ui/toolPanel/ToolDetail";
import { ToolRowMarksLegend, useShowsMarkings } from "@/ui/toolPanel/ToolRowMarksLegend";
import { ROW_KEY_ATTRIBUTE, useTreeMotion } from "@/ui/toolPanel/treeMotion";

/**
 * ME Analyzer: what the Intel Management Engine firmware in this image is.
 *
 * Laid out as upstream's `MEAToolViewController`: two tabs over one content
 * area. «Summary» is MEA's own console table — the facts a bench asks for, in
 * the order the console prints them — with a copy of it as text and as a
 * picture beside the tabs. «Full Info» is every structure the analysis read,
 * grouped and in reading order, with the detail of the row in focus under a
 * divider that is the reader's to move. A line under both says what is being
 * read or fetched, and what went wrong.
 *
 * Which tab was up, which rows were open and which was in focus are kept per
 * pane, so a panel put away and brought back is the panel that was left.
 */

/**
 * The panel's three tabs, kept by name: a tab added between two others moves no kept tab.
 *
 * @upstream Modules/MEATool/Sources/MEAToolUI/MEAToolModule.swift#MEAParkedState.tabNames
 */
type Tab = "summary" | "configuration" | "tree";
const TABS: readonly Tab[] = ["summary", "configuration", "tree"];

/**
 * @upstream Modules/MEATool/Sources/MEAToolUI/MEAToolModule.swift#MEAParkedState
 * @upstream-differs it keeps the open rows too, where upstream's live on the pane
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
  if (held.tab === undefined || !TABS.includes(held.tab)) return undefined;
  if (!(held.open instanceof Set)) return undefined;
  if (held.focus !== undefined && typeof held.focus !== "string") return undefined;
  return { tab: held.tab, open: held.open, focus: held.focus };
}

/**
 * @upstream Modules/MEATool/Sources/MEAToolUI/MEAToolModule.swift#MEAParkedState
 * @upstream-differs its open rows go as a list, a set having no JSON of its own
 */
function encodedParked(state: ToolSessionState): string | undefined {
  const parked = restoredParked(state);
  return parked === undefined ? undefined : JSON.stringify({ ...parked, open: [...parked.open] });
}

/** @upstream Modules/MEATool/Sources/MEAToolUI/MEAToolModule.swift#MEAToolModule.restoredState */
function decodedParked(data: string): ToolSessionState | undefined {
  try {
    const held = JSON.parse(data) as { open?: unknown };
    if (!Array.isArray(held.open) || !held.open.every((key) => typeof key === "string"))
      return undefined;
    return restoredParked({ ...held, open: new Set(held.open) });
  } catch {
    return undefined;
  }
}

type Result =
  | { readonly phase: "waiting" }
  | {
      readonly phase: "done";
      readonly analysis: FirmwareAnalysis | undefined;
      /**
       * Whether the databases were read with: an analysis shown before they arrived is
       * read again when they do, and what depends on them says so until then.
       */
      readonly usedFileTable: boolean;
      readonly usedHuffman: boolean;
    }
  | { readonly phase: "failed"; readonly problem: string };

interface TreeRow {
  readonly node: MEANode;
  readonly depth: number;
  readonly key: string;
}

const INDENT = 16;

/** One row's height, which the rows' motion moves them by. */
const ROW_HEIGHT = 22;

/** A row's key, which the rows' motion follows it by. */
const rowKeyOf = (row: TreeRow): string => row.key;
/**
 * The tree's columns, and which of them takes the panel's spare width.
 *
 * Upstream lays these out at 300 and 150 and gives the slack to **Name**
 * (`MEAToolViewController`, `name.resizingMask = [.autoresizingMask,
 * .userResizingMask]`). The owner asked for the other one: widening the panel
 * widens the values, not the name. Flipping `grows` back is the whole change —
 * the rest of the panel reads the flag rather than the column.
 *
 * @upstream Modules/MEATool/Sources/MEAToolUI/MEAToolViewController.swift#MEAToolViewController.nameWidth
 * @upstream Modules/MEATool/Sources/MEAToolUI/MEAToolViewController.swift#MEAToolViewController.summaryWidth
 * @upstream-differs `grows` is on the values column, where upstream carries
 * `.autoresizingMask` on the name column
 */
const ME_COLUMNS: () => readonly TableColumn[] = localized(() => [
  { id: "name", title: L("Name"), width: 300, min: 150 },
  { id: "values", title: "", width: 150, min: 150, grows: true },
]);
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
    return { title: L("Nothing more to show for this row."), fields: [], tables: [] };
  }
  return {
    title: node.title,
    // The tone travels with the field: the detail draws a status bold, in the
    // tone's colour and with the tick a passed check carries — the same
    // rendering the Summary tab's row gets from the same tone.
    fields: node.fields.map((one) => ({
      ...tonedField(one.label, one.value, one.tone ?? "standard"),
      ...(one.evidence === undefined ? {} : { evidence: one.evidence }),
    })),
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
  // The split this panel's details fold out of; the card open over another panel leaves it be.
  const detailSplit = useRef<HTMLDivElement>(null);
  const detailLarge = useLargeDetailOf(detailSplit);
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
  const { widths, resize, reset: resetWidths } = useColumnWidths(ME_COLUMNS());
  const [showsMarkings, setShowsMarkings] = useShowsMarkings(MEA_PANEL);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  /** Which analysis a reply belongs to: a reply to a superseded one is dropped. */
  const request = useRef(0);
  const askedChecksums = useRef(false);
  /**
   * The analysis on screen, to tell a re-ask that came back with the same one
   * from a genuinely new reading.
   *
   * Not a gate: whether a reading has to be made again is the *pane's* question
   * and is answered where the reading is kept (`readPaneMe`), which is
   * upstream's arrangement too — its session re-parses on every content change
   * and the pane's cache is what makes that cheap. A gate of the panel's own
   * was answering it a second time and getting it wrong: it keyed on the
   * document's content generation, and a document that has just been replaced
   * counts from zero again, so a file dropped over this one read as the file
   * that was already here and the panel kept the analysis of the file that had
   * gone.
   */
  const shown = useRef<FirmwareAnalysis | undefined>(undefined);
  const treeRef = useRef<HTMLDivElement | null>(null);
  const summaryRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void ensurePaneFirmware(pane);
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
   * rows that were open and the row in focus. Not the analysis — that is the
   * pane's, cached in the firmware store the way upstream caches it on the
   * pane's own holder, so a panel put away and brought back is answered from
   * there rather than reading the region a second time.
   *
   * @upstream Modules/MEATool/Sources/MEAToolUI/MEAToolModule.swift#MEAToolSession.parkedState
   * @upstream-differs it keeps the open rows too
   */
  useParkedToolState(pane, () => ({ tab, open, focus }));

  const databaseText = database.text;
  const huffmanText = huffman.text;
  const fileTableText = fileTable.body?.text;
  const replaced = useMeDataReplaced();
  /** @upstream Modules/MEATool/Sources/MEAToolUI/MEAToolViewController.swift#MEAToolViewController.onRetry */
  // biome-ignore lint/correctness/useExhaustiveDependencies: `replaced` is a reason to read again, not something the body reads — the reading takes the files from their stores
  const analyze = useCallback(() => {
    const job = ++request.current;
    setBusy(true);
    const land = (read: MeReading) => {
      const found = read.response;
      // A new analysis is a new question, and the digests it held were about
      // the bytes it read — but the pane answers a re-ask of the same question
      // with the very reading that is on screen, and throwing the digests away
      // for that would send the Checksums row back to "Loading…" for nothing.
      if (found.analysis !== shown.current) {
        askedChecksums.current = false;
        setChecksums(undefined);
      }
      shown.current = found.problem === undefined ? found.analysis : undefined;
      setResult(
        found.problem === undefined
          ? {
              phase: "done",
              analysis: found.analysis,
              usedFileTable: read.usedFileTable,
              usedHuffman: read.usedHuffman,
            }
          : { phase: "failed", problem: found.problem }
      );
    };
    // The first reading of a file is made without the dictionaries and shown at once —
    // they are most of an analysis — and the one with them replaces it. An analysis
    // already on screen stays until the one asked for lands.
    void readPaneMe(pane, liveMeData, shown.current === undefined, (first) => {
      if (job === request.current) land(first);
    }).then((read) => {
      if (job !== request.current) return;
      setBusy(false);
      if (read !== undefined) land(read);
    });
    // A data file replaced by a newer one is read again with (`useMeDataReplaced`); its first
    // landing is not — the reading waits for what it wants.
  }, [pane, replaced]);

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
      setResult({
        phase: "failed",
        problem: firmwareProblem ?? L("That image could not be read."),
      });
      shown.current = undefined;
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
      shown.current = undefined;
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
  // What the analysis on screen has not been read with yet. It is shown the moment it
  // exists, and read again when `FileTable.dat` and `Huffman.dat` arrive; a value that
  // depends on one of them says "Loading…" until then rather than one the second
  // reading may change. A database that failed to load is not waited for.
  const pending = useMemo<MEAPending>(
    () =>
      result.phase !== "done"
        ? NOTHING_PENDING
        : pendingOf(analysis, result, {
            fileTable: fileTable.status === "failed",
            huffman: huffman.status === "failed",
          }),
    [analysis, result, fileTable.status, huffman.status]
  );
  useEffect(() => {
    // Asked on every analysis that wants them, not only on the first: what is
    // held answers at once and the day's re-check runs behind it, which is what
    // makes a dictionary that has since changed arrive without a reload.
    if (wantsDictionaries) loadHuffmanDictionaries();
  }, [wantsDictionaries]);

  // FileTable.dat only for an analysis that needs it — a volume that cannot
  // name its own files, an EFS volume (which lists nothing without it), or
  // ID-keyed Configuration records that need it for a path — and asked for
  // *after* the analysis, which is what says so. Most dumps never need it, and
  // it is the largest of the three databases. Asked once per analysis: what is
  // held answers at once with the day's check behind it.
  const wantsNames = analysis !== undefined && fileTableWanted(analysis);
  useEffect(() => {
    if (wantsNames) loadFileTable();
  }, [wantsNames]);

  // The names an analysis cannot give itself, looked up in `FileTable.dat` off
  // the main thread, as upstream does: the table is parsed in the worker, and
  // the panel never holds it. `.none` is a volume the table does not describe,
  // and every legacy volume, whose rows keep the numbers their own bytes carry.
  // The EFS lookup reads the *MFS* volume's platform and dictionary — upstream
  // hands `efs_anl` the values `mfs_anl` read — so it is the MFS row's fields,
  // not the EFS page's own Dictionary, that name the tables.
  const [names, setNames] = useState<MFSFileNames>(MFSFileNames.none);
  const [efsNames, setEfsNames] = useState<EFSFileNames>(EFSFileNames.none);
  const [configPaths, setConfigPaths] = useState<ConfigRecordPaths>(ConfigRecordPaths.none);
  /** Which names ask a reply belongs to: a reply to a superseded one is dropped. */
  const fileNamesJob = useRef(0);
  useEffect(() => {
    // A new analysis is a new question: the names it held were about the
    // volumes it read, and they go with it rather than standing there unmarked.
    setNames(MFSFileNames.none);
    setEfsNames(EFSFileNames.none);
    setConfigPaths(ConfigRecordPaths.none);
    if (analysis === undefined || fileTableText === undefined) return;
    const ask = meFileNamesAsk(analysis);
    if (ask === undefined) return;
    const job = ++fileNamesJob.current;
    void fileNamesPaneMe(pane, {
      mfs: ask.mfs,
      efs: ask.efs,
      configIDs: ask.configIDs,
      platform: analysis.mfsVolume?.ftblPlatform ?? -1,
      dictionary: analysis.mfsVolume?.ftblDictionary ?? -1,
      databaseText,
      huffmanText,
      fileTableText,
    }).then((found) => {
      if (job !== fileNamesJob.current) return;
      if (found === undefined) return;
      setNames(found.mfs ?? MFSFileNames.none);
      setEfsNames(found.efs ?? EFSFileNames.none);
      setConfigPaths(found.config ?? ConfigRecordPaths.none);
    });
  }, [analysis, databaseText, huffmanText, fileTableText, pane]);
  const tree = useMemo(
    () =>
      analysis === undefined
        ? []
        : presentMEA(analysis, checksums, names, efsNames, configPaths, pending),
    [analysis, checksums, names, efsNames, configPaths, pending]
  );
  const blocks = useMemo(
    () => (analysis === undefined ? [] : buildSummary(analysis, pending)),
    [analysis, pending]
  );
  const configurationBlocks = useMemo(
    () => (analysis === undefined ? [] : buildConfiguration(analysis)),
    [analysis]
  );
  const rows = useMemo(() => rowsOf(tree, open), [tree, open]);
  // A branch opens and shuts in motion, as the UEFI tree's does.
  const motion = useTreeMotion(rows, rowKeyOf, treeRef, ROW_HEIGHT);
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
      if (node.range !== undefined) context.reveal(node.range.start, node.range.end, false);
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

  /**
   * Opens a row in a fragment panel: a copy of its bytes, or an MFS or EFS file
   * gathered from its chunks (`meaPartOpen`). A row without bytes opens
   * nothing, and says so by the answer.
   *
   * @upstream Modules/MEATool/Sources/MEAToolUI/MEAToolModule.swift#MEAToolSession.open
   * @upstream Modules/MEATool/Sources/MEAToolUI/MEAToolViewController.swift#MEAToolViewController.onOpen
   * @upstream Modules/MEATool/Sources/MEAToolUI/MEAToolViewController.swift#MEAToolViewController.rowDoubleClicked
   */
  // help: panel.me.open
  const openRow = useCallback(
    (node: MEANode): boolean => {
      const part = meaPartOpen(node);
      if (part === undefined) return false;
      context.openPart(part.name, part.source, part.codec);
      return true;
    },
    [context]
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

  /**
   * What the window's navigation history keeps of the panel: the row in focus, by its path.
   * Back chooses it again and draws its zone, without taking the dump anywhere, and gives the
   * tree the keyboard.
   *
   * @upstream Modules/MEATool/Sources/MEAToolUI/MEAToolModule.swift#MEAToolSession.navigationMark
   * @upstream Modules/MEATool/Sources/MEAToolUI/MEAToolModule.swift#MEAToolSession.showNavigationMark
   * @upstream Modules/MEATool/Sources/MEAToolUI/MEAToolModule.swift#MEAToolSession.focusChoice
   * @upstream Modules/MEATool/Sources/MEAToolUI/MEAToolViewController.swift#MEAToolViewController.focusTree
   */
  useToolNavigation(pane, "dev.maxik.tool.me-analyzer", {
    mark: () => focus,
    show: (mark) => {
      if (typeof mark === "string") zonePicked(mark);
    },
    focus: () => treeRef.current?.focus(),
  });

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
        // Space on the row in focus opens the details in the large view, and closes it
        // again.
        case " ":
          if (event.ctrlKey || event.metaKey || event.altKey) return;
          if (!toggleLargeDetail(current !== undefined, event.currentTarget)) return;
          break;
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
    const step = event.key === "ArrowRight" ? 1 : TABS.length - 1;
    setTab((current) => TABS[(TABS.indexOf(current) + step) % TABS.length] ?? current);
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
    void writeRichText(summaryHtml(blocks, toneColours()), summaryPlain(blocks)).then((done) => {
      if (done) showNotice("copySummary", [L("Summary Copied")]);
      else setNotice(L("The browser would not put the summary on the clipboard."));
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
          showNotice("copyScreenshot", [L("Screenshot Copied")]);
          return;
        }
        // Plain HTTP and a few browsers have no clipboard for pictures; the
        // picture is still the thing asked for, so it is kept as a file.
        downloadBlob(blob, "ME Summary.png");
        setNotice(L("The browser would not take a picture, so it was saved as a file."));
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
          aria-label={L("ME Analyzer view")}
          tabIndex={-1}
          onKeyDown={onTabKey}
        >
          <TabButton tab="summary" current={tab} onChoose={setTab}>
            {L("Summary")}
          </TabButton>
          <TabButton tab="configuration" current={tab} onChoose={setTab}>
            {L("Configuration")}
          </TabButton>
          <TabButton tab="tree" current={tab} onChoose={setTab}>
            {L("Full Info")}
          </TabButton>
        </div>
        {tab === "summary" && hasContent ? (
          <div className="me-actions">
            <button
              type="button"
              className="me-action"
              title={L("Copy Summary")}
              aria-label={L("Copy Summary")}
              onClick={copySummary}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <CopyDocumentShapes />
              </svg>
            </button>
            <button
              type="button"
              className="me-action"
              title={L("Copy Screenshot")}
              aria-label={L("Copy Screenshot")}
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
        aria-label={
          tab === "summary"
            ? L("Summary")
            : tab === "configuration"
              ? L("Configuration")
              : L("Full Info")
        }
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
            title={L("Analyzing the ME firmware…")}
            detail={
              firmware?.status === "ready"
                ? L("Reading the region and its partitions.")
                : L("Reading the file first: the region is found in its tree.")
            }
            fraction={firmware?.status === "ready" ? undefined : (firmware?.fraction ?? 0)}
          />
        ) : result.phase === "failed" ? (
          <Placeholder
            symbol="failed"
            title={L("The analysis did not finish")}
            detail={L("The line below says what went wrong.")}
          />
        ) : analysis === undefined ? (
          <Placeholder
            symbol="question"
            title={L("No ME firmware")}
            detail={L("Nothing in this file reads as Intel ME firmware.")}
          />
        ) : tab === "summary" ? (
          <SummaryView blocks={blocks} scrollRef={summaryRef} />
        ) : tab === "configuration" ? (
          configurationBlocks.length > 0 ? (
            <ConfigurationView blocks={configurationBlocks} />
          ) : pending.fileTable ? (
            // While the reading that names the files is still on, an empty tab is no answer yet.
            <Placeholder
              symbol="list"
              title={L("Reading the configuration…")}
              detail={L("The settings appear when the analysis finishes.")}
            />
          ) : (
            <Placeholder
              symbol="list"
              title={L("No configuration read")}
              // @upstream-differs upstream's caption still says CSME 13 to 16, the generations
              // it read when the sentence was written; the maps now read 11 to 18
              detail={L(
                "The settings are read on CSME 11 to 18, from the configuration files the image carries."
              )}
            />
          )
        ) : (
          <div
            className="tool-split"
            ref={detailSplit}
            data-detail-large={detailLarge ? "" : undefined}
            style={{
              gridTemplateRows: detailLarge
                ? "minmax(0, 1fr) 0 0"
                : `minmax(0, ${treeShare}fr) 6px minmax(0, ${1 - treeShare}fr)`,
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
                aria-label={L("ME firmware structure")}
                data-key-table=""
                onKeyDown={onTreeKey}
                style={
                  { "--table-columns": columnTemplate(widths, ME_COLUMNS()) } as React.CSSProperties
                }
              >
                {/* The tree's heading, as the UEFI tree's: the value column
                    holds `offset · size` and is not titled, which is what
                    upstream's own header says. Each boundary between them is
                    the reader's to move. */}
                <div className="me-tree-head" aria-hidden="true">
                  <span>
                    {L("Name")}
                    <ColumnResizer
                      columns={ME_COLUMNS()}
                      index={0}
                      widths={widths}
                      onChange={resize}
                      onReset={resetWidths}
                    />
                  </span>
                  <span />
                </div>
                {/* The rows of a branch that shut, where they stood, fading under the rows
                    that slide up over them. */}
                {motion.exiting.map((gone) => (
                  <MeTreeRow
                    key={`exit:${gone.key}`}
                    row={gone.row}
                    alternate={gone.index % 2 === 1}
                    exitingAt={gone.top}
                    isOpen={false}
                    isSelected={false}
                    showsMarkings={showsMarkings}
                    onChoose={() => {}}
                    onToggle={() => {}}
                    onOpen={() => false}
                  />
                ))}
                {rows.map((row, index) => (
                  <MeTreeRow
                    key={row.key}
                    row={row}
                    alternate={index % 2 === 1}
                    isOpen={open.has(row.key)}
                    isSelected={focus === row.key}
                    showsMarkings={showsMarkings}
                    onChoose={(node) => {
                      // A click is the reader's choice, and a step for the history; the arrow
                      // keys walking the rows are not (`onWillChoose`).
                      // @upstream Modules/MEATool/Sources/MEAToolUI/MEAToolViewController.swift#MEAToolViewController.onWillChoose
                      context.noteNavigationStep();
                      choose(node);
                    }}
                    onToggle={toggle}
                    onOpen={openRow}
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
              label={L("Resize the detail")}
            />
            <ToolDetail
              onFocusTable={() => treeRef.current?.focus()}
              subject={focus}
              detail={detailOf(selected)}
              placeholder={L("Select a row to see what it is.")}
              // The engine's field names run long (`systemHeaderCRCValid`): the column
              // takes the longest of them, up to half the list.
              // @upstream Modules/MEATool/Sources/MEAToolUI/MEAToolViewController.swift#MEAToolViewController.renderDetail
              names="longest"
              // Decided by the curator, with the name: this is the one place
              // that knows a row is the partition table rather than a row that
              // happens to be called "Regions (FPT)".
              helpTerm={selected?.helpTerm}
            />
          </div>
        )}
      </div>

      <footer className="tool-notice">
        {busy ? (
          <>
            <span>{L("Reading ME…")}</span>
            <progress />
          </>
        ) : result.phase === "failed" ? (
          <>
            <span className="me-notice-problem">{result.problem}</span>
            <button type="button" className="toolbar-button is-quiet" onClick={analyze}>
              {L("Try Again")}
            </button>
          </>
        ) : database.status === "loading" ? (
          <>
            <span>{L("Downloading %1$@…", "MEA.dat")}</span>
            <button type="button" className="toolbar-button is-quiet" onClick={cancelMEDatabase}>
              {L("Cancel")}
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
              {L("Try Again")}
            </button>
          </>
        ) : huffman.status === "loading" ? (
          <>
            <span>{L("Downloading %1$@…", "Huffman.dat")}</span>
            <button
              type="button"
              className="toolbar-button is-quiet"
              onClick={cancelHuffmanDictionaries}
            >
              {L("Cancel")}
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
              {L("Try Again")}
            </button>
          </>
        ) : wantsNames && fileTable.status === "loading" ? (
          // What an EFS volume, a table-named MFS volume and the Configuration records
          // wait on; its download has no cancel of its own.
          <span>{L("Downloading %1$@…", "FileTable.dat")}</span>
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
  readonly symbol: "cpu" | "question" | "failed" | "list";
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
        ) : symbol === "list" ? (
          <>
            <rect x="4" y="6" width="24" height="20" rx="2.5" />
            <path d="M9 12h1.5M9 16h1.5M9 20h1.5M14 12h9M14 16h9M14 20h9" />
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

const valueText = (row: MEASummaryRow) => summaryValueText(row.value);

/** Keys for rows that may say the same thing twice — two identical messages. */
function uniqueKeys(texts: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return texts.map((text) => {
    const count = seen.get(text) ?? 0;
    seen.set(text, count + 1);
    return count === 0 ? text : `${text}#${count}`;
  });
}

/**
 * What each summary row's label column is wide at: upstream's 200 points at its design
 * size of 11, in the panel's own type size, so it follows a zoom as upstream's scaled
 * width does.
 *
 * @upstream Modules/MEATool/Sources/MEAToolUI/MEAToolViewController.swift#MEAToolViewController.summaryLabelWidth
 */
const SUMMARY_LABEL_WIDTH = "calc(200em / 11)";

/**
 * One Summary row as a field of the shared detail list: the label, and the value
 * drawn as the row's tone asks. A status value is bold and coloured, with the tick a
 * passed check carries, all of it from the tone, which is the same rendering the
 * tree's detail and the UEFI Structure's use; a `.comingSoon` value is drawn grey,
 * the shape of a row the engine will answer once the bridge reaches it, and so is a
 * `.pending` one, which the reading under way will answer.
 *
 * @upstream Modules/MEATool/Sources/MEAToolUI/MEAToolViewController.swift#MEAToolViewController.summaryField
 */
function summaryField(row: MEASummaryRow): ListedField {
  const muted = row.value.kind === "comingSoon" || row.value.kind === "pending";
  // A verdict is drawn as its two parts: the answer in the row's tone, the evidence plain.
  if (row.value.kind === "verdict") {
    return {
      label: row.label,
      value: row.value.text,
      evidence: row.value.evidence,
      tone: row.tone,
    };
  }
  return { label: row.label, value: valueText(row), tone: muted ? "standard" : row.tone, muted };
}

/**
 * The Summary's blocks, each one the shared detail list (`DetailFields`) — the rows the
 * UEFI Structure and this panel's own detail are drawn with — under the block's heading.
 * The list is what gives a reader the selection: a drag down the rows takes a band of
 * them, Ctrl+A or ⌘A in a block the block, and a copy puts it on the clipboard with a
 * tab between a name and its value, which a summary pasted into a report wants. The
 * name column is one width in every block, so the values line up from the table to the
 * messages — wider than the detail list's, because the summary carries long labels
 * ("TCB Security Version Number") — and a label too long for it wraps.
 *
 * @upstream Modules/MEATool/Sources/MEAToolUI/MEAToolViewController.swift#MEAToolViewController.showSummary
 * @upstream Modules/MEATool/Sources/MEAToolUI/MEAToolViewController.swift#MEAToolViewController.renderSummary
 */
export function SummaryView({
  blocks,
  scrollRef,
}: {
  readonly blocks: readonly MEASummaryBlock[];
  readonly scrollRef: React.RefObject<HTMLDivElement | null>;
}) {
  // Two blocks can carry one title — an image with two independent firmware
  // copies names each the same thing — so the repeats are numbered apart, as the
  // rows inside a block are. A title alone had React dropping one of the pair,
  // and saying so.
  const blockKeys = uniqueKeys(blocks.map((block) => block.title ?? ""));
  const selecting = detailSelectionHandlers();
  return (
    <div className="me-summary" ref={scrollRef}>
      {blocks.map((block, blockIndex) => (
        <Fragment key={blockKeys[blockIndex]}>
          {block.title === undefined ? null : <h3 className="me-summary-title">{block.title}</h3>}
          {block.rows.length === 0 ? null : (
            // Focusable by a click, so Ctrl+A or ⌘A and the copy arrive at the block.
            // biome-ignore lint/a11y/noStaticElementInteractions: the keys select text, not a control's
            <div
              className="me-summary-block"
              tabIndex={selecting.tabIndex}
              onCopy={selecting.onCopy}
              onKeyDown={(event) => {
                selecting.selectAll(event);
              }}
            >
              <DetailFields fields={block.rows.map(summaryField)} nameWidth={SUMMARY_LABEL_WIDTH} />
            </div>
          )}
        </Fragment>
      ))}
    </div>
  );
}

/**
 * The Configuration tab: one block per configuration file, each setting with the two copies of
 * the file it lives in side by side — the shared detail list's rows, with a row's second value
 * being the column the detail list does not otherwise carry, so the tab reads as a table and
 * behaves as a list.
 *
 * The name column is one width for every list in the tab, and so are the two value columns,
 * which is what makes the columns of one file line up with the next and with the heading row.
 * Where the two copies disagree, **the file system's value** is drawn bold — the one emphasis the
 * tab uses, and no colour: it is the state in force, and a setting the platform rewrote is not a
 * fault. A value one copy does not carry is the quiet dash; a setting the tool switches off is
 * quiet, value and all.
 *
 * @upstream Modules/MEATool/Sources/MEAToolUI/MEAToolViewController.swift#MEAToolViewController.showConfiguration
 * @upstream Modules/MEATool/Sources/MEAToolUI/MEAToolViewController.swift#MEAToolViewController.renderConfiguration
 * @upstream Modules/MEATool/Sources/MEAToolUI/MEAToolViewController.swift#MEAToolViewController.configurationColumns
 * @upstream Modules/MEATool/Sources/MEAToolUI/MEAToolViewController.swift#MEAToolViewController.configurationHeadingRow
 * @upstream Modules/MEATool/Sources/MEAToolUI/MEAToolViewController.swift#MEAToolViewController.configurationFileHeading
 * @upstream Modules/MEATool/Sources/MEAToolUI/MEAToolViewController.swift#MEAToolViewController.configurationCell
 * @upstream-differs the shared name column is the longest name in characters, the browser
 * measuring no text before it lays it out
 */
export function ConfigurationView({
  blocks,
}: {
  readonly blocks: readonly MEAConfigurationBlock[];
}) {
  const [shownHelp, setShownHelp] = useState<
    { help: FieldHelp; anchor: HTMLElement } | undefined
  >();
  // Which copies carry anything at all: a copy the image does not carry in *any* file is not a
  // column of dashes — the tab then names the one copy it has, in the one value column.
  const fitc = blocks.some((block) => block.rows.some((row) => row.fitc !== undefined));
  const mfs = blocks.some((block) => block.rows.some((row) => row.mfs !== undefined));
  const compares = fitc && mfs;
  const first = (row: MEAConfigurationRow) => (fitc ? row.fitc : row.mfs);
  const longest = Math.max(
    0,
    ...blocks.flatMap((block) => block.rows.map((row) => row.name.length))
  );
  const reservesHelp = blocks.some((block) =>
    block.rows.some((row) => row.help !== undefined || row.note !== undefined)
  );
  const nameWidth = `calc(${Math.min(longest, 48)}ch * 0.82${reservesHelp ? " + 1.4em" : ""})`;
  // A value one copy does not carry is the quiet dash; a switched-off setting is quiet too —
  // in either column.
  const cell = (text: string | undefined, differs: boolean, quiet: boolean) => ({
    value: text ?? CONFIGURATION_ABSENT,
    strong: differs && !quiet,
    muted: text === undefined || quiet,
  });
  const selecting = detailSelectionHandlers();
  // Two files can share an alias; the repeats are numbered apart, as the Summary's blocks are.
  const blockKeys = uniqueKeys(blocks.map((block) => block.alias));
  return (
    <div className="me-summary me-configuration">
      <div className="me-configuration-heading">
        <DetailFields
          nameWidth={nameWidth}
          fields={[
            {
              label: "",
              value: fitc ? configurationFITC() : configurationMFS(),
              tone: "standard",
              ...(compares ? { second: { value: configurationMFS() } } : {}),
            },
          ]}
        />
      </div>
      {blocks.map((block, index) => (
        <Fragment key={blockKeys[index]}>
          <h3 className="me-summary-title me-configuration-file">
            {block.alias} <span className="me-configuration-detail">{block.detail}</span>
          </h3>
          {/* biome-ignore lint/a11y/noStaticElementInteractions: the keys select text, not a control's */}
          <div
            className="me-summary-block"
            tabIndex={selecting.tabIndex}
            onCopy={selecting.onCopy}
            onKeyDown={(event) => selecting.selectAll(event)}
          >
            <DetailFields
              nameWidth={nameWidth}
              onHelp={(help, anchor) => setShownHelp({ help, anchor })}
              fields={block.rows.map((row): ListedField => {
                const value = cell(first(row), false, row.disabled);
                return {
                  label: row.name,
                  value: value.value,
                  tone: "standard",
                  muted: value.muted,
                  ...(compares
                    ? { second: cell(row.mfs, configurationRowDiffers(row), row.disabled) }
                    : {}),
                  // The tool's own words about the setting, where it has them — and a row with
                  // a condition and no help has the `?` too: the condition is the answer its
                  // name has no room for.
                  ...(row.help !== undefined || row.note !== undefined
                    ? {
                        help: {
                          identifier: row.identifier,
                          text: row.help ?? "",
                          note: row.note,
                          buttonName: L("Setting help"),
                          buttonTooltip: L("Show what Flash Image Tool says about this setting"),
                        },
                      }
                    : {}),
                };
              })}
            />
          </div>
        </Fragment>
      ))}
      {shownHelp === undefined ? null : (
        <SettingHelpPopover
          help={shownHelp.help}
          anchor={shownHelp.anchor}
          onClose={() => setShownHelp(undefined)}
        />
      )}
    </div>
  );
}

/**
 * What Flash Image Tool says about one setting: a popover off the `?` beside its name, in every
 * help popover's shape, the tool's own words under the identifier the row does not show and the
 * condition that placed the setting as its subtitle.
 *
 * @upstream Modules/MEATool/Sources/MEAToolUI/MEASettingHelpPopover.swift#MEASettingHelpPopover
 * @upstream Modules/MEATool/Sources/MEAToolUI/MEASettingHelpPopover.swift#MEASettingHelpPopover.show
 * @upstream Modules/MEATool/Sources/MEAToolUI/MEASettingHelpPopover.swift#MEASettingHelpPopover.makeContent
 */
function SettingHelpPopover({
  help,
  anchor,
  onClose,
}: {
  readonly help: FieldHelp;
  readonly anchor: HTMLElement;
  readonly onClose: () => void;
}) {
  return (
    <HelpPopover anchor={anchor} label={help.identifier} onClose={onClose}>
      <HelpPopoverLayout title={help.identifier} note={help.note}>
        <HelpPopoverProse text={help.text} />
      </HelpPopoverLayout>
    </HelpPopover>
  );
}

/** @upstream Modules/MEATool/Sources/MEAToolUI/MEAToolViewController.swift#MEAToolViewController.outlineView */
function MeTreeRow({
  row,
  alternate,
  exitingAt,
  isOpen,
  isSelected,
  showsMarkings,
  onChoose,
  onToggle,
  onOpen,
}: {
  readonly row: TreeRow;
  readonly alternate: boolean;
  /** Where a row of a branch that shut stood, drawn there a moment longer while it fades. */
  readonly exitingAt?: number | undefined;
  readonly isOpen: boolean;
  readonly isSelected: boolean;
  readonly showsMarkings: boolean;
  readonly onChoose: (node: MEANode) => void;
  readonly onToggle: (node: MEANode) => void;
  /** A double-click: the row's bytes opened as a fragment; false for a row with none. */
  readonly onOpen: (node: MEANode) => boolean;
}) {
  const { node } = row;
  const hasChildren = node.children.length > 0;
  // Where the motion finds the row; a row that is going lies where it stood, under every other,
  // takes no pointer and is not read out.
  const motionAttrs =
    exitingAt === undefined
      ? { [ROW_KEY_ATTRIBUTE]: row.key }
      : {
          "data-motion": "under",
          "data-motion-exit": "",
          "aria-hidden": true,
          style: { position: "absolute", top: exitingAt, left: 0, right: 0 } as const,
        };
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
      {...motionAttrs}
      onClick={() => onChoose(node)}
      onDoubleClick={() => {
        // A row with bytes opens as a fragment, as a UEFI row does; a group row
        // opens nothing and expands or collapses as it always has.
        if (!onOpen(node) && hasChildren) onToggle(node);
      }}
    >
      {/* As much as the triangle's square reaches back over (`.me-twist`), so it starts at the row's edge. */}
      <span className="me-name" style={{ paddingLeft: `${row.depth * INDENT + 4}px` }}>
        <button
          type="button"
          className="me-twist"
          tabIndex={-1}
          disabled={!hasChildren}
          aria-label={isOpen ? L("Collapse") : L("Expand")}
          onClick={(event) => {
            event.stopPropagation();
            onToggle(node);
          }}
        >
          {hasChildren ? <DisclosureChevron open={isOpen} /> : null}
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
 * A status-toned value goes across bold and in its tone's colour, the way the
 * panel draws it and the way the picture copy carries it: the rich flavour is
 * where a clipboard can say that, and a copy that dropped it would read as if
 * the fact had no answer.
 *
 * `tones` is the palette as the page is drawing it, since the colours are the
 * theme's rather than this function's.
 *
 * @upstream Modules/MEATool/Sources/MEAToolUI/MEAToolViewController.swift#MEAToolViewController.richText
 */
export function summaryHtml(
  blocks: readonly MEASummaryBlock[],
  tones: Readonly<Record<ToolValueTone, string>>
): string {
  const body = blocks
    .map((block) => {
      const title =
        block.title === undefined
          ? ""
          : `<tr><th colspan="2" align="left">${escapeHtml(block.title)}</th></tr>`;
      const rows = block.rows
        .map((row) => {
          const text = escapeHtml(valueText(row));
          const value = isEmphasized(row)
            ? `<b style="color:${tones[row.tone]}">${text}</b>`
            : text;
          return `<tr><td>${escapeHtml(row.label)}</td><td>${value}</td></tr>`;
        })
        .join("");
      return title + rows;
    })
    .join("");
  return `<table>${body}</table>`;
}

/**
 * The tone colours as the page is drawing them right now — the app's palette,
 * read off the document, so a copy carries the same green the panel showed.
 */
function toneColours(): Record<ToolValueTone, string> {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    standard: token("--text", "#1d1d1f"),
    good: token("--semantic-good", "#1a7f37"),
    caution: token("--semantic-caution", "#8a6d00"),
    bad: token("--semantic-bad", "#c4241f"),
  };
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
        line.row.value.kind === "comingSoon" || line.row.value.kind === "pending"
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
  // Resolved on every access: the page can switch language while the panel is
  // open, and a name computed once at import would go stale.
  get title() {
    return L("ME Analyzer");
  },
  summary: "The Intel Management Engine firmware: its summary and every structure in it.",
  // help: panel.me
  helpTopic: TOPIC.toolME,
  View: MeToolView,
  encodedState: encodedParked,
  restoredState: decodedParked,
  agentQueries: meAgentQueries,
  agentComparisons: meAgentComparisons,
  agentLocator: meAgentLocator,
};
