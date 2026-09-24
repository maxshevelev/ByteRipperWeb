import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { guidFromText } from "@/firmware/uefi/efiGuid";
import { DECOMPRESSED_BODY_LAYOUT } from "@/firmware/uefi/rootLayout";
import { downloadBlob } from "@/platform/files/download";
import {
  askFirmwareDetail,
  askFirmwareLayout,
  askFirmwareProtectedRanges,
  expandFirmwareNode,
  findFirmwareNodeAt,
  firmwareNodeAt,
  firmwareStore,
  fixFirmwareChecksum,
  parsePaneFirmware,
  pathKey,
  readSpaceBytes,
} from "@/state/firmwareStore";
import { cancelGuidCatalogue, catalogueStore, loadGuidCatalogue } from "@/state/guidCatalogue";
import type { ToolSessionState } from "@/state/parkedToolState";
import { useStore } from "@/state/useStore";
import { paneState } from "@/state/workspaceStore";
import { clearZones, publishZones } from "@/state/zoneStore";
import { type MEANode, meaNodeAt, meaZones } from "@/tools/meaTree";
import { EMPTY_DETAIL } from "@/tools/toolDetail";
import type { ToolContext, ToolModule } from "@/tools/toolModule";
import { useParkedToolState } from "@/tools/toolParkedState";
import type { ToolRowMarks } from "@/tools/toolRowMarks";
import { useZoneSelection } from "@/tools/toolZoneSelection";
import {
  isMeRegion,
  meDetail,
  meKey,
  meNodeAt,
  mePathCovering,
  mePathOf,
  meRegionPath,
  useMeSubtree,
} from "@/tools/uefi/meSubtree";
import {
  type DecompressedExport,
  decompressedExport,
  fileSourceOf,
  nodeIDOfZone,
  nodeOpen,
  nodeOpenTitle,
  partName,
  uefiZones,
} from "@/tools/uefi/uefiPresenter";
import { listed, nodeName, present, summary } from "@/tools/uefi/uefiTreeDisplay";
import { UEFI_TREE_MARKS, uefiTreeMarks } from "@/tools/uefi/uefiTreeMarks";
import { openContextMenu } from "@/ui/shell/ContextMenu";
import { PaneDivider } from "@/ui/shell/PaneDivider";
import { ScopeShapes } from "@/ui/shell/scopeGlyph";
import { ColumnResizer } from "@/ui/toolPanel/ColumnResizer";
import {
  columnsMinWidth,
  columnTemplate,
  type TableColumn,
  useColumnWidths,
} from "@/ui/toolPanel/columnWidths";
import { DisclosureChevron } from "@/ui/toolPanel/DisclosureChevron";
import { RowMarksIcons, rowMarkTitle, rowPaintAttrs } from "@/ui/toolPanel/RowMarks";
import { ToolDetail } from "@/ui/toolPanel/ToolDetail";
import { ToolRowMarksLegend, useShowsMarkings } from "@/ui/toolPanel/ToolRowMarksLegend";
import type { WireNode } from "@/workers/protocol";

/**
 * UEFI Structure: the image as a tree, and what the node in focus is.
 *
 * Laid out as upstream's `UEFIToolViewController`: a title naming the image, the
 * tree above and the detail below with a divider between them that is the
 * reader's to move, and a line under both that says when something is being
 * read. The detail's height is the divider's, never its content's — a detail
 * that grew with what it said took the tree's room, and a tall one left the tree
 * a few rows high.
 *
 * The two expensive containers — a region's raw-area scan and a volume's file
 * walk — are never opened until a row is, and the tree is virtualised, because
 * an image is routinely thousands of nodes.
 */

/**
 * One row as the list draws it. No node is the "Loading…" row of a slow branch.
 *
 * The outline is heterogeneous: a row stands either for a node of the UEFI tree
 * or for a row of the ME sub-tree grafted under the ME region (G57). Upstream
 * holds a row object per kind and switches on which its data source was handed;
 * here the two live in one shape, and `me` is what says which this is.
 *
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolViewController.swift#UEFITreeRow
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolViewController.swift#UEFITreeRow.id
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolViewController.swift#UEFITreeRow.isLoading
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolViewController.swift#MEOutlineRow
 */
export interface Row {
  readonly node: WireNode | undefined;
  /**
   * The ME sub-tree's node, when this row is one of its. Resolved as the rows
   * are built, which is the same read upstream makes by path on every ask.
   *
   * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolViewController.swift#UEFIToolViewController.meNode
   */
  readonly me?: MEANode | undefined;
  readonly depth: number;
  readonly key: string;
}

const ROW_HEIGHT = 22;
const HEADER_HEIGHT = 22;
/** Rows kept above and below the viewport, so a flick never shows a gap. */
const OVERSCAN = 8;
const INDENT = 16;
/**
 * Upstream's column widths (319, 62 and 69 points at its 11-point design size),
 * at this panel's 13 pixels. Type and Subtype hold one short word on almost
 * every row; Name is the column with something to say and takes the rest —
 * upstream's own choice here, unlike the ME tree's, and the reason the two
 * panels read differently from the same component.
 *
 * The design width of the two narrow ones is what a drag is put back to; their
 * floors are where their text starts to be cut short.
 *
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolViewController.swift#UEFIToolViewController.nameWidth
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolViewController.swift#UEFIToolViewController.typeWidth
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolViewController.swift#UEFIToolViewController.subtypeWidth
 */
const UEFI_COLUMNS: readonly TableColumn[] = [
  { id: "name", title: "Name", width: 300, min: 200, grows: true },
  { id: "type", title: "Type", width: 76, min: 56 },
  { id: "subtype", title: "Subtype", width: 88, min: 64 },
];
/**
 * How long a branch may take before its row says it is being read. Under this
 * the row simply opens when the branch is there, which is the common case.
 *
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolModule.swift#UEFIToolModule.loadingRowDelay
 */
const LOADING_ROW_DELAY = 200;

/** The tree's share of the split, which upstream starts at two thirds. */
const DEFAULT_TREE_SHARE = 2 / 3;
const TREE_SHARE_KEY = "byteripper.uefiTreeShare";

/**
 * The panel's name in the legend's remembered states. Upstream's, so a reader
 * who has made the same choice in both editions keeps it.
 *
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolViewController.swift#UEFIToolViewController.legend
 */
const UEFI_PANEL = "UEFIStructure";

function storedTreeShare(): number {
  try {
    const raw = localStorage.getItem(TREE_SHARE_KEY);
    const parsed = raw === null ? Number.NaN : Number.parseFloat(raw);
    return Number.isFinite(parsed) && parsed > 0 && parsed < 1 ? parsed : DEFAULT_TREE_SHARE;
  } catch {
    return DEFAULT_TREE_SHARE;
  }
}

/** @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolViewController.swift#UEFIToolViewController.showsEmptyPaddingKey */
const SHOWS_EMPTY_PADDING_KEY = "byteripper.uefiShowsEmptyPadding";

/** Off until the reader turns it on, and remembered like the panel's split. */
function storedShowsEmptyPadding(): boolean {
  try {
    return localStorage.getItem(SHOWS_EMPTY_PADDING_KEY) === "true";
  } catch {
    return false;
  }
}

const pathOf = (key: string): number[] => (key.length === 0 ? [] : key.split(".").map(Number));

/**
 * What a parked session hands back: the node the user was looking at, and the
 * rows that were open above it. The tree itself is the pane's, not the
 * session's — parking costs it nothing and coming back finds it as it was left.
 *
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolModule.swift#UEFIParkedState
 * @upstream-differs it keeps the open rows too: upstream's open rows live on the
 * pane (`PaneUEFIState.openUEFIRows`) and outlive the session, and this port
 * materializes a branch only when a row is opened, so the rows the reader had
 * open are the list's own state and travel with it
 */
interface Parked {
  /** @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolModule.swift#UEFIParkedState.focus */
  readonly focus: string | undefined;
  /**
   * The ME row the reader was looking at, as its key under the region's row.
   * Kept apart from `focus` because the two resolve against different trees,
   * and only one is the focus at a time.
   *
   * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolModule.swift#UEFIParkedState.meFocus
   */
  readonly meFocus: string | undefined;
  readonly open: ReadonlySet<string>;
}

/**
 * The state handed back by a previous session of this tool, as this tool keeps
 * it — or nothing, when there is none of that shape.
 *
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolModule.swift#UEFIToolSession.restore
 */
function restoredParked(state: ToolSessionState | undefined): Parked | undefined {
  const held = state as Partial<Parked> | undefined;
  if (held === undefined) return undefined;
  if (held.focus !== undefined && typeof held.focus !== "string") return undefined;
  if (held.meFocus !== undefined && typeof held.meFocus !== "string") return undefined;
  if (!(held.open instanceof Set)) return undefined;
  return { focus: held.focus, meFocus: held.meFocus, open: held.open };
}

/**
 * The ME sub-tree's rows, under the region's own.
 *
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolViewController.swift#UEFIToolViewController.outlineView
 */
function meRowsOf(
  nodes: readonly MEANode[],
  open: ReadonlySet<string>,
  depth: number,
  rows: Row[]
): void {
  for (const node of nodes) {
    const key = meKey(node.path);
    rows.push({ node: undefined, me: node, depth, key });
    if (open.has(key) && node.children.length > 0) meRowsOf(node.children, open, depth + 1, rows);
  }
}

/**
 * The rows the outline draws, in order: the listed nodes of the tree, the ME
 * sub-tree under an opened ME region, and the "Loading…" row of a branch slow
 * enough to have earned one.
 *
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolViewController.swift#UEFIToolViewController.show
 */
export function rowsOf(
  nodes: readonly WireNode[],
  open: ReadonlySet<string>,
  loading: ReadonlySet<string>,
  showsEmptyPadding: boolean,
  meRoots: readonly MEANode[],
  depth: number,
  rows: Row[] = []
): Row[] {
  for (const node of listed(nodes, showsEmptyPadding)) {
    const key = pathKey(node.id);
    rows.push({ node, depth, key });
    if (!open.has(key)) continue;
    // The ME region node opens onto the presented ME sub-tree, not onto
    // children of its own: the UEFI tree does not read past the descriptor's
    // word for what the region is.
    if (isMeRegion(node) && meRoots.length > 0) {
      meRowsOf(meRoots, open, depth + 1, rows);
      continue;
    }
    if (node.children.length > 0)
      rowsOf(node.children, open, loading, showsEmptyPadding, meRoots, depth + 1, rows);
    else if (loading.has(key))
      rows.push({ node: undefined, depth: depth + 1, key: `${key}#loading` });
  }
  return rows;
}

/**
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolModule.swift#UEFIToolSession
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolViewController.swift#UEFIToolViewController
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolViewController.swift#UEFIToolViewController.loadView
 * @upstream-differs a React component: its render and effects are the session and its view controller
 */
function UefiStructureView({ context }: { readonly context: ToolContext }) {
  const state = useStore(firmwareStore).panes[context.pane];
  const catalogue = useStore(catalogueStore);
  const park = restoredParked(context.restored);
  const [open, setOpen] = useState<ReadonlySet<string>>(park?.open ?? new Set());
  /** Branches slow enough to have earned a "Loading…" row. */
  const [loading, setLoading] = useState<ReadonlySet<string>>(new Set());
  /** Branches the reader asked to open whose children have not arrived. */
  const wanted = useRef(new Set<string>());
  const [selected, setSelected] = useState<string | undefined>(park?.focus);
  /**
   * The ME half of the selection, kept apart from the UEFI half so at most one
   * is in play: picking a node of the tree drops whatever ME row was in focus,
   * and picking an ME row does the reverse.
   *
   * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolModule.swift#UEFIToolSession.meFocus
   */
  const [meFocus, setMeFocus] = useState<string | undefined>(park?.meFocus);
  const [scrollTarget, setScrollTarget] = useState<string | undefined>(undefined);
  const [finding, setFinding] = useState(false);
  const [treeShare, setTreeShare] = useState(storedTreeShare);
  const { widths, resize, reset: resetWidths } = useColumnWidths(UEFI_COLUMNS);
  /**
   * Whether the tree lists empty padding.
   *
   * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolViewController.swift#UEFIToolViewController.showsEmptyPadding
   */
  const [showsEmptyPadding, setShowsEmptyPadding] = useState(storedShowsEmptyPadding);
  /**
   * Whether the tree paints its rows — the legend's Show Markings switch, which
   * is remembered beside the legend's own state.
   *
   * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolViewController.swift#UEFIToolViewController.legend
   */
  const [showsMarkings, setShowsMarkings] = useShowsMarkings(UEFI_PANEL);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);

  // The pane's image, parsed when the panel first asks for it. The zones go
  // when the panel does: a gutter still marking a tool nobody has open is a
  // promise about bytes nothing is watching.
  useEffect(() => {
    void parsePaneFirmware(context.pane);
    return () => clearZones(context.pane);
  }, [context.pane]);

  // The GUID names are fetched when the panel opens, as upstream does: behind
  // the tree rather than in front of it, which shows the GUIDs until they land,
  // and with the wait said in the line below.
  useEffect(() => {
    loadGuidCatalogue();
  }, []);

  /**
   * What this session would hand back if it ended now: the node in focus and
   * the rows that were open. Coming back re-materializes the branches on the
   * way — the effect above the render asks for any open row's children that
   * have not arrived — so a tree put away open comes back open.
   *
   * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolModule.swift#UEFIToolSession.parkedState
   * @upstream-differs the open rows travel with the state, where upstream keeps them on the pane
   */
  useParkedToolState(context.pane, () => ({ focus: selected, meFocus, open }));

  /**
   * The tree's viewport height, watched through a callback ref.
   *
   * Not an effect on mount: while the image is being read the tree is not in
   * the document at all, so an effect that ran then observed nothing, the
   * height stayed zero for good, and the list drew its overscan and no more —
   * eight rows, whatever was opened below them.
   */
  const treeRef = useCallback((element: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    scrollRef.current = element;
    if (element === null) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) setHeight(entry.contentRect.height);
    });
    observer.observe(element);
    observerRef.current = observer;
  }, []);

  const roots = state?.roots;
  const status = state?.status;

  // The protected ranges, once the tree is there to read them over: the reading
  // opens every volume's files and hashes megabytes, so a panel nobody has
  // opened pays for none of it.
  useEffect(() => {
    if (status === "ready") askFirmwareProtectedRanges(context.pane);
  }, [status, context.pane]);
  useEffect(() => {
    if (roots === undefined || status !== "ready") return;
    // A branch the reader asked for has arrived: the row opens now, once, with
    // what is in it.
    const arrived: string[] = [];
    for (const key of wanted.current) {
      const node = firmwareNodeAt(roots, pathOf(key));
      if (node === undefined || !node.isExpandable) arrived.push(key);
    }
    if (arrived.length > 0) {
      for (const key of arrived) wanted.current.delete(key);
      setOpen((current) => new Set([...current, ...arrived]));
      setLoading((current) => new Set([...current].filter((key) => !arrived.includes(key))));
    }
    // A row left open over a branch that is not read any more — the image was
    // read again after a fix, or an edit in the pane took that branch's
    // children away — is read again, so coming back to the tree does not find
    // it shut. The children come from the worker's reader as it now stands.
    //
    // @upstream-differs upstream's LazyUEFITree.invalidate collapses the branch
    // an edit touched and its own test expects the row to be shut; here the row
    // the user has open stays open and is filled in again. Same re-read, and
    // the tree does not jump shut under the pointer that asked for it.
    for (const key of open) {
      const node = firmwareNodeAt(roots, pathOf(key));
      if (node?.isExpandable === true) expandFirmwareNode(context.pane, node.id);
    }
  }, [roots, status, open, context.pane]);

  /**
   * The ME region's sub-tree, read once per pane and shared with the ME
   * Analyzer. Nothing is read until a reader opens the region's row.
   */
  const me = useMeSubtree(context.pane, status === "ready", roots);
  const meRoots = me.roots;
  const meIsReading = me.isReading;
  const closeMe = me.close;

  /**
   * The region's row the reader opened, while the analysis behind it runs. The
   * row is held shut in the meantime — it has nothing to open onto — the way a
   * UEFI branch not read yet is.
   *
   * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolViewController.swift#UEFIToolViewController.meOpening
   */
  const [meOpening, setMeOpening] = useState<string | undefined>(undefined);
  /**
   * The caret an open was made for, when the open was a reveal: the rows that
   * could place that byte do not exist until the analysis lands, so the offset
   * waits here and the row that owns it is settled on when they do.
   *
   * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolViewController.swift#UEFIToolViewController.openMERegion
   */
  const settleOn = useRef<number | undefined>(undefined);
  /** Whether the region has already been opened for a restored ME focus. */
  const openedForParkedFocus = useRef(false);

  const presented = useMemo(() => present(roots ?? []), [roots]);
  const rows = useMemo(
    () => rowsOf(presented.rows, open, loading, showsEmptyPadding, meRoots, 0),
    [presented, open, loading, showsEmptyPadding, meRoots]
  );
  const maxDepth = useMemo(
    () => rows.reduce((deepest, row) => Math.max(deepest, row.depth), 0),
    [rows]
  );

  /**
   * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolViewController.swift#UEFIToolViewController.outlineViewItemDidExpand
   * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolViewController.swift#UEFIToolViewController.outlineViewItemDidCollapse
   */
  const toggle = useCallback(
    (node: WireNode) => {
      const key = pathKey(node.id);
      if (open.has(key)) {
        wanted.current.delete(key);
        setOpen((current) => new Set([...current].filter((one) => one !== key)));
        setLoading((current) => new Set([...current].filter((one) => one !== key)));
        return;
      }
      // The ME region is not expandable in the UEFI tree and opens all the same:
      // onto the ME sub-tree, which is an analysis rather than a branch. Until
      // that analysis is in hand there is nothing to open onto, so the first ask
      // starts it and holds the row shut — and an open already in flight is not
      // asked for a second time, which would be a second full read of the
      // region.
      //
      // @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolViewController.swift#UEFIToolViewController.outlineView
      // @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolModule.swift#UEFIToolSession.openMERegion
      if (isMeRegion(node) && meRoots.length === 0) {
        if (meOpening !== undefined) return;
        setMeOpening(key);
        wanted.current.add(key);
        me.open();
        window.setTimeout(() => {
          if (!wanted.current.has(key)) return;
          setLoading((current) => new Set([...current, key]));
          setOpen((current) => new Set([...current, key]));
        }, LOADING_ROW_DELAY);
        return;
      }
      if (node.children.length > 0 || !node.isExpandable || isMeRegion(node)) {
        setOpen((current) => new Set([...current, key]));
        return;
      }
      // A branch not read yet stays shut while it is read, and opens when it
      // arrives. Only a slow one puts a "Loading…" row up in the meantime.
      wanted.current.add(key);
      expandFirmwareNode(context.pane, node.id);
      window.setTimeout(() => {
        if (!wanted.current.has(key)) return;
        setLoading((current) => new Set([...current, key]));
        setOpen((current) => new Set([...current, key]));
      }, LOADING_ROW_DELAY);
    },
    [open, context.pane, me, meOpening, meRoots]
  );

  /**
   * The reader picked a row of the ME sub-tree. The ME focus and the UEFI focus
   * are kept apart, so picking one drops the other. A row that stands for bytes
   * reveals them the way a UEFI node's does; a row that is only a summary of its
   * children has nothing to reveal and says nothing in the dump.
   *
   * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolModule.swift#UEFIToolSession.selectME
   * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolViewController.swift#UEFIToolViewController.onSelectME
   */
  const chooseMe = useCallback(
    (node: MEANode) => {
      setMeFocus(meKey(node.path));
      setSelected(undefined);
      publishZones(context.pane, meaZones(node));
      if (node.range !== undefined) context.reveal(node.range.start, node.range.end);
      // Looking at the Checksums row is what asks for the digests: three passes
      // over the whole region, which a parse leaves out.
      me.rowPicked(node);
    },
    [context, me]
  );

  /** A row of the ME sub-tree opens and shuts like any other. */
  const toggleMe = useCallback((node: MEANode) => {
    const key = meKey(node.path);
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // The analysis has landed — or failed. A row that never earned a "Loading…"
  // row simply opens now; a row that did has its placeholder replaced by the
  // sub-tree, or shut again when nothing came of the reading. An open always
  // settles somewhere: on the row the reveal asked about, else on the row the
  // session was parked with, else on the first root.
  //
  // @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolViewController.swift#UEFIToolViewController.meRegionLoading
  // @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolViewController.swift#UEFIToolViewController.openMERegion
  useEffect(() => {
    if (meOpening === undefined || meIsReading) return;
    const landed = meRoots.length > 0;
    setMeOpening(undefined);
    wanted.current.delete(meOpening);
    setLoading((current) => new Set([...current].filter((one) => one !== meOpening)));
    setOpen((current) => {
      const next = new Set(current);
      if (landed) next.add(meOpening);
      else next.delete(meOpening);
      return next;
    });
    const caret = settleOn.current;
    settleOn.current = undefined;
    if (!landed) return;
    const covering = caret === undefined ? undefined : mePathCovering(meRoots, caret);
    const settled =
      covering ??
      (meFocus !== undefined && meNodeAt(meRoots, meFocus) !== undefined
        ? mePathOf(meFocus)
        : meRoots[0]?.path);
    if (settled === undefined) return;
    const node = meaNodeAt(meRoots, settled);
    if (node === undefined) return;
    // Every ancestor of it open, so the row the open settled on is in the list.
    setOpen((current) => {
      const next = new Set(current);
      for (let length = 1; length < settled.length; length++) {
        next.add(meKey(settled.slice(0, length)));
      }
      return next;
    });
    chooseMe(node);
    setScrollTarget(meKey(settled));
  }, [meOpening, meIsReading, meRoots, meFocus, chooseMe]);

  // A session parked on an ME row comes back to it: the sub-tree it named is
  // not there until the region is read, so the region is opened for it.
  //
  // @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolModule.swift#UEFIToolSession.bind
  useEffect(() => {
    if (openedForParkedFocus.current) return;
    if (meFocus === undefined || meRoots.length > 0 || meOpening !== undefined) return;
    if (status !== "ready" || roots === undefined) return;
    const regionPath = meRegionPath(roots);
    const region = regionPath === undefined ? undefined : firmwareNodeAt(roots, regionPath);
    if (region === undefined) return;
    // Once: a reading that came back with nothing would otherwise be asked for
    // again on the render that ended it, and again after that.
    openedForParkedFocus.current = true;
    toggle(region);
  }, [meFocus, meRoots, meOpening, status, roots, toggle]);

  // The file in the pane was replaced by one with no ME region: there is no row
  // to graft a sub-tree under any more, so what the last file left goes with it
  // — the reading, and the focus that named one of its rows. Kept, that focus
  // would hold a detail on screen for a row the outline does not list.
  //
  // @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolModule.swift#UEFIToolSession.contentChanged
  useEffect(() => {
    if (status !== "ready" || roots === undefined) return;
    if (meRegionPath(roots) !== undefined) return;
    openedForParkedFocus.current = false;
    setMeFocus(undefined);
    closeMe();
  }, [status, roots, closeMe]);

  /**
   * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolViewController.swift#UEFIToolViewController.onSelect
   * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolViewController.swift#UEFIToolViewController.outlineViewSelectionDidChange
   */
  const choose = useCallback(
    (node: WireNode) => {
      const key = pathKey(node.id);
      setSelected(key);
      // A UEFI node and an ME row are two halves of one selection: picking a
      // node of the tree drops whatever ME row was in focus.
      setMeFocus(undefined);
      askFirmwareDetail(context.pane, node.id);
      // The node and its body, the body in focus — upstream's two zones, drawn
      // over the dump and in the minimap's gutter. Never the children: a store's
      // two hundred variables outlined at once is a dump nobody can read.
      const zones = uefiZones(node, roots);
      publishZones(context.pane, zones);
      // What clicking a row means: the whole node, header through tail — or,
      // for a node inside a compressed section, the section that holds it,
      // since its own ranges are offsets into a buffer and the dump has no
      // bytes to show for them. The outermost zone is that range either way.
      const whole = zones.zones[0];
      if (whole !== undefined) context.reveal(whole.start, whole.end);
    },
    [context, roots]
  );

  /**
   * What a node has decompressed, read out of the worker's own buffer: the
   * whole of what a compressed section opens to, or one node's bytes inside it.
   *
   * A section still closed decodes on the way out, which is why both commands
   * are offered before a row is opened — the row already says it is compressed.
   * Nothing comes back where the stream does not decode, and the command says
   * so rather than handing over an empty file.
   *
   * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolModule.swift#UEFIToolSession.withDecompressedBytes
   * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolModule.swift#UEFIToolSession.decompressedBytes
   */
  const decompressedBytes = useCallback(
    async (taken: DecompressedExport): Promise<Uint8Array | undefined> => {
      const bytes = await readSpaceBytes(context.pane, taken.space, taken.range);
      if (bytes === undefined || bytes.length === 0) {
        context.report("The section does not decompress.");
        return undefined;
      }
      return bytes;
    },
    [context]
  );

  /**
   * Export Decompressed Body… / Export Decompressed Bytes…: what the section
   * holds, written out as a file of its own.
   *
   * Upstream asks for a save panel and says how much it wrote; a page has no
   * panel to ask with, so the bytes go through the download flow the rest of
   * the application uses (D7) and the sentence is the same one.
   *
   * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolModule.swift#UEFIToolSession.exportDecompressed
   * @upstream-differs the browser's download flow in place of the save panel, so there is no cancelling to hear about
   */
  const exportDecompressed = useCallback(
    async (taken: DecompressedExport) => {
      const bytes = await decompressedBytes(taken);
      if (bytes === undefined) return;
      // `slice()` because a Blob wants bytes over a plain ArrayBuffer, which is
      // what the clipboard's own export does for the same reason.
      downloadBlob(
        new Blob([bytes.slice()], { type: "application/octet-stream" }),
        taken.suggestedName
      );
      context.report(`Exported ${bytes.length} bytes.`);
    },
    [context, decompressedBytes]
  );

  /**
   * Open Decompressed Body / Open Decompressed Bytes: the same bytes the export
   * saves, opened as a part of their own — its own offsets from zero, its own
   * search, its own tree — without saving anything first.
   *
   * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolModule.swift#UEFIToolSession.openDecompressedInNewTab
   */
  const openDecompressed = useCallback(
    async (node: WireNode, taken: DecompressedExport) => {
      const bytes = await decompressedBytes(taken);
      if (bytes === undefined) return;
      // What it links back to: the compressed section in the file that these
      // bytes came out of, which for a node inside a buffer is the section
      // holding it.
      // What a panel opened on these bytes should read them as: a whole
      // decompressed body is a run of sections by the FFSv3 rules every buffer
      // is read with; a node inside one is read as what that node is.
      const layout =
        taken.range === undefined
          ? DECOMPRESSED_BODY_LAYOUT
          : await askFirmwareLayout(context.pane, { node: node.id });
      context.openPart(
        bytes,
        partName(taken.suggestedName, paneState(context.pane)?.name ?? ""),
        fileSourceOf(node, roots ?? []),
        layout,
        // What they are, and where they go back to: the whole buffer, or this
        // node's bytes in it, compressed again on the way (§6).
        {
          kind: "decompressed",
          rebuild: {
            space: taken.space,
            ...(taken.range === undefined
              ? {}
              : { range: { start: taken.range[0], end: taken.range[1] } }),
          },
        }
      );
    },
    [context, decompressedBytes, roots]
  );

  /**
   * Open “…” / Open Body of “…”: the node itself, or its body without the
   * header in front of it, read as a file of its own — its own offsets from
   * zero, its own search, its own tree.
   *
   * Wherever the node lives: bytes of the file go across as they are, and
   * bytes of a buffer a compressed section opened to are read out of that
   * buffer, which is what `space` says.
   *
   * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolModule.swift#UEFIToolSession.openNodeInPanel
   */
  const openNode = useCallback(
    async (node: WireNode, body: boolean) => {
      const open = nodeOpen(node, body, roots);
      if (open === undefined) {
        context.report("There is nothing to open here.");
        return;
      }
      const bytes = await readSpaceBytes(context.pane, open.space, open.range);
      if (bytes === undefined || bytes.length === 0) {
        context.report("Those bytes could not be read.");
        return;
      }
      context.openPart(
        bytes,
        partName(open.suggestedName, paneState(context.pane)?.name ?? ""),
        open.source,
        await askFirmwareLayout(context.pane, { node: node.id, body }),
        // The file's own bytes, which go back as they are — through the
        // planner where the node is a structure the image can be laid out
        // again around (§6).
        { kind: "copy", rebuild: open.rebuild }
      );
    },
    [context, roots]
  );

  /**
   * The node under the caret, shown in the tree: every branch on the way
   * opened, its row selected, its detail up. Only the tree moves — the dump is
   * where the reader is standing, so nothing is published that would scroll it
   * away from the caret that asked.
   *
   * A byte of the ME region is owned by a row of the ME sub-tree, which the
   * walk below cannot see: those rows are presented under the region rather
   * than parsed into the tree, so the deepest node the walk finds inside the
   * region is the region itself. The sub-tree is asked first, and a region
   * nobody has opened yet is opened for the reveal rather than answered for by
   * the node above it.
   *
   * A reveal that moves off an ME row clears the zone map rather than
   * republishing: the zones on screen belong to the half just left, so they
   * cannot stay, and the new node's own zone cannot replace them either —
   * focusing a zone is what makes the dump scroll to its start, and for a node
   * the caret sits deep in, that is a scroll away from the byte the reveal was
   * asked about. An empty map clears them and moves nothing, because the dump's
   * scroll follows a focus and an empty map has none.
   *
   * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolModule.swift#UEFIToolSession.revealNodeAtCaret
   * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolModule.swift#UEFIToolSession.openMERegionForReveal
   * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolModule.swift#UEFIToolSession.showUEFIFocus
   * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolViewController.swift#UEFIToolViewController.onRevealAtCaret
   */
  const revealAtCaret = useCallback(async () => {
    const slot = paneState(context.pane);
    if (slot === undefined) return;
    const caret = slot.document.selection.start;
    // Captured before the UEFI half unsets it: a reveal that comes from an ME
    // row is a crossing, and a crossing clears the zone map (G59).
    const crossedHalves = meFocus !== undefined;
    // The ME half first, because the walk below has never heard of it.
    const mePath = mePathCovering(meRoots, caret);
    if (mePath !== undefined) {
      const node = meaNodeAt(meRoots, mePath);
      if (node !== undefined) {
        setOpen((current) => {
          const next = new Set(current);
          for (let length = 1; length < mePath.length; length++) {
            next.add(meKey(mePath.slice(0, length)));
          }
          return next;
        });
        setMeFocus(meKey(mePath));
        setSelected(undefined);
        setScrollTarget(meKey(mePath));
        me.rowPicked(node);
        return;
      }
    }
    // The presented sub-tree placed the byte in no row of its own — or there is
    // no sub-tree yet, and the rows that could place it do not exist. Only the
    // second is worth opening a region for: the first has answered.
    if (meRoots.length === 0) {
      const regionPath = meRegionPath(roots ?? []);
      const region = regionPath === undefined ? undefined : firmwareNodeAt(roots ?? [], regionPath);
      if (region !== undefined && caret >= region.body[0] && caret < region.body[1]) {
        // The open settles on the row that owns this byte, once there are rows.
        settleOn.current = caret;
        toggle(region);
        setScrollTarget(pathKey(region.id));
        return;
      }
    }
    setFinding(true);
    const path = await findFirmwareNodeAt(context.pane, slot.document.selection.start);
    setFinding(false);
    if (path === undefined) return;
    setOpen((current) => {
      const next = new Set(current);
      for (let length = 1; length < path.length; length++) next.add(pathKey(path.slice(0, length)));
      return next;
    });
    const key = pathKey(path);
    setSelected(key);
    setMeFocus(undefined);
    askFirmwareDetail(context.pane, path);
    setScrollTarget(key);
    if (crossedHalves) clearZones(context.pane);
  }, [context.pane, me, meFocus, meRoots, roots, toggle]);

  // Brings a row the panel chose itself into view, once it is in the list.
  useEffect(() => {
    if (scrollTarget === undefined) return;
    const index = rows.findIndex((row) => row.key === scrollTarget);
    const element = scrollRef.current;
    if (index < 0 || element === null) return;
    setScrollTarget(undefined);
    const top = index * ROW_HEIGHT;
    if (top < element.scrollTop) element.scrollTop = top;
    else if (HEADER_HEIGHT + top + ROW_HEIGHT > element.scrollTop + element.clientHeight) {
      element.scrollTop = HEADER_HEIGHT + top + ROW_HEIGHT - element.clientHeight;
    }
  }, [rows, scrollTarget]);

  /**
   * The zone the user picked in the dump, brought to the front: the branches on
   * the way to its node opened, its row selected, its detail up, and the map
   * published again so the outline over the dump and in the gutter moves with
   * it.
   *
   * Only the tree moves — the bytes are already selected, and the dump is where
   * the reader is standing. A zone naming no node of this image is nothing to
   * say, and a zone whose node has gone with a re-read leaves the panel with
   * nothing published, which is what upstream's own `show(publish:)` does with a
   * focus that resolves to nil.
   *
   * The zone on screen belongs to whichever focus is active, so the id is
   * routed by which one is set — not by the id's shape, which a one-level ME
   * path ("0") and a UEFI node ("0") cannot tell apart.
   *
   * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolModule.swift#UEFIToolSession.zoneSelected
   */
  const zonePicked = useCallback(
    (zoneId: string) => {
      if (meFocus !== undefined) {
        const mePath = zoneId.length === 0 ? [] : zoneId.split("/").map(Number);
        const node = meaNodeAt(meRoots, mePath);
        if (node === undefined) return;
        chooseMe(node);
        setScrollTarget(meKey(mePath));
        return;
      }
      const path = nodeIDOfZone(zoneId);
      if (path === undefined) return;
      setOpen((current) => {
        const next = new Set(current);
        for (let length = 1; length < path.length; length++) {
          next.add(pathKey(path.slice(0, length)));
        }
        return next;
      });
      const key = pathKey(path);
      setSelected(key);
      setMeFocus(undefined);
      askFirmwareDetail(context.pane, path);
      setScrollTarget(key);
      publishZones(context.pane, uefiZones(firmwareNodeAt(roots ?? [], path), roots ?? []));
    },
    [context.pane, roots, meFocus, meRoots, chooseMe]
  );
  useZoneSelection(context.pane, zonePicked);

  /**
   * What a row wears besides its name, decided in the pure marks of the tree
   * (`Design/ROW_MARKS.md` §5.1) — read off the node and the parse's
   * diagnostics, which is where this port keeps the checksums.
   *
   * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolViewController.swift#UEFIToolViewController.marks
   * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolViewController.swift#UEFIToolViewController.marks(for:)
   * @upstream Modules/UEFITool/Sources/UEFITool/UEFITreeMarks.swift#UEFITreeMarks
   */
  const marksOf = useCallback(
    (node: WireNode): ToolRowMarks =>
      uefiTreeMarks({
        node,
        diagnostics: state?.diagnostics ?? [],
        roots: roots ?? [],
        isOpen: open.has(pathKey(node.id)),
        protectedRanges: state?.protectedRanges?.ranges,
      }),
    [state?.diagnostics, state?.protectedRanges, roots, open]
  );

  /**
   * The revision of the volume a node sits in, which a file's fixed sum follows.
   *
   * @upstream Modules/UEFITool/Sources/UEFITool/UEFIChecksumCheck.swift#UEFIChecksumCheck.volumeRevision
   */
  const volumeRevisionFor = useCallback(
    (path: readonly number[]) => {
      let nodes = roots ?? [];
      let revision = 2;
      for (const index of path) {
        const next = nodes[index];
        if (next === undefined) break;
        if (next.kind === "volume" && next.subtype !== undefined) revision = next.subtype;
        nodes = next.children;
      }
      return revision;
    },
    [roots]
  );

  /** The keyboard, for the tree as a whole: a row is not a tab stop of its own. */
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const focused = selected ?? meFocus;
      const index = rows.findIndex((row) => row.key === focused);
      /** A row of either half is picked by the half it belongs to. */
      const pick = (row: Row) => {
        if (row.me !== undefined) chooseMe(row.me);
        else if (row.node !== undefined) choose(row.node);
        else return false;
        setScrollTarget(row.key);
        return true;
      };
      const moveTo = (from: number, step: 1 | -1) => {
        for (let at = from; at >= 0 && at < rows.length; at += step) {
          const row = rows[at];
          if (row !== undefined && pick(row)) return;
        }
      };
      const row = rows[index];
      const current = row?.node;
      const currentMe = row?.me;
      switch (event.key) {
        case "ArrowDown":
          moveTo(index + 1, 1);
          break;
        case "ArrowUp":
          moveTo(index < 0 ? rows.length - 1 : index - 1, -1);
          break;
        case "ArrowRight":
          if (row !== undefined && currentMe !== undefined) {
            if (!open.has(row.key) && currentMe.children.length > 0) toggleMe(currentMe);
            else moveTo(index + 1, 1);
            break;
          }
          if (current === undefined) return;
          if (
            !open.has(pathKey(current.id)) &&
            (listed(current.children, showsEmptyPadding).length > 0 ||
              current.isExpandable ||
              isMeRegion(current))
          ) {
            toggle(current);
          } else {
            moveTo(index + 1, 1);
          }
          break;
        case "ArrowLeft": {
          if (row !== undefined && currentMe !== undefined) {
            if (open.has(row.key)) {
              toggleMe(currentMe);
              break;
            }
            const above = rows.find((one) => one.key === meKey(currentMe.path.slice(0, -1)));
            if (above !== undefined) pick(above);
            break;
          }
          if (current === undefined) return;
          if (open.has(pathKey(current.id))) {
            toggle(current);
            break;
          }
          const parent = rows.find((one) => one.key === pathKey(current.id.slice(0, -1)));
          if (parent !== undefined) pick(parent);
          break;
        }
        default:
          return;
      }
      event.preventDefault();
    },
    [rows, selected, meFocus, open, choose, chooseMe, toggle, toggleMe, showsEmptyPadding]
  );

  const changeTreeShare = useCallback((share: number) => {
    setTreeShare(share);
    try {
      localStorage.setItem(TREE_SHARE_KEY, String(share));
    } catch {
      // A private window may refuse to store it; the split still applies here.
    }
  }, []);

  /** @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolViewController.swift#UEFIToolViewController.setShowsEmptyPadding */
  const changeShowsEmptyPadding = useCallback((shows: boolean) => {
    setShowsEmptyPadding(shows);
    try {
      localStorage.setItem(SHOWS_EMPTY_PADDING_KEY, String(shows));
    } catch {
      // A private window may refuse to store it; the tree still follows it here.
    }
  }, []);

  if (state === undefined || state.status === "parsing") {
    return (
      <div className="tool-empty">
        <p>Reading UEFI…</p>
        <progress value={state?.fraction ?? 0} max={1} />
      </div>
    );
  }
  if (state.status === "failed") {
    return <div className="tool-empty">{state.problem ?? "That image could not be parsed."}</div>;
  }

  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((scrollTop + height) / ROW_HEIGHT) + OVERSCAN);
  // The deepest row's indentation on top of the columns' own floors: narrower
  // than this and an opened row's name has nowhere to go, so the scroller
  // scrolls instead of the columns squeezing past what they can hold.
  const minWidth = columnsMinWidth(UEFI_COLUMNS) + maxDepth * INDENT;
  const title = presented.title;
  const titleKey = title === undefined ? undefined : pathKey(title.id);
  const shown = selected === undefined ? undefined : state.detail;
  // Which half of the selection the detail is about. An ME row's detail is its
  // own curated fields, which the worker knows nothing of; a UEFI node's is the
  // header the worker read back.
  const meShown = meFocus === undefined ? undefined : meNodeAt(meRoots, meFocus);

  return (
    <div className="uefi-tool">
      <div className="uefi-title-row">
        {title === undefined ? (
          <span className="uefi-title">
            {summary(state.roots, state.protectedRanges?.ranges.length ?? 0)}
          </span>
        ) : (
          // The title names the image, and the root it stands for is selected
          // by a click on it exactly as its row would be: its zone, its detail.
          // The title reads as selected while that root is the focus, which is
          // `data-selected` below.
          //
          // @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolViewController.swift#UEFIToolViewController.summaryClicked
          // @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolViewController.swift#UEFIToolViewController.onSelectTop
          // @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolModule.swift#UEFIToolSession.showTopNode
          // @upstream-differs upstream's label carries the click either way and
          // `showTopNode` returns early when the tree folded nothing into it;
          // here the element that carries the click is the one that exists only
          // when there is a root to select, so the same rule is said once, by
          // the rendering that already knows the answer.
          <button
            type="button"
            className="uefi-title"
            data-selected={selected === titleKey ? "" : undefined}
            title="Show the whole image in the dump"
            onClick={() => choose(title)}
          >
            {summary(state.roots, state.protectedRanges?.ranges.length ?? 0)}
          </button>
        )}
        <label
          className="uefi-padding-toggle"
          title="List the padding nobody wrote to — erased bytes between structures"
        >
          <input
            type="checkbox"
            checked={showsEmptyPadding}
            onChange={(event) => changeShowsEmptyPadding(event.target.checked)}
          />
          Show Empty Padding
        </label>
        <button
          type="button"
          className="uefi-reveal"
          onClick={() => void revealAtCaret()}
          title="Show the node under the caret in the tree"
          aria-label="Reveal the node at the caret"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <ScopeShapes />
          </svg>
        </button>
      </div>

      <div
        className="tool-split"
        style={{ gridTemplateRows: `minmax(0, ${treeShare}fr) 6px minmax(0, ${1 - treeShare}fr)` }}
      >
        {/* The tree and its legend are one pane of the split: the legend takes
            its room at the pane's bottom edge and the tree gives it up, so it
            never covers a row (`Design/ROW_MARKS.md` §6). */}
        <div className="tool-marked-list">
          <div
            className="uefi-tree"
            ref={treeRef}
            role="tree"
            tabIndex={0}
            aria-label="Firmware structure"
            onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
            onKeyDown={onKeyDown}
            style={
              {
                minWidth,
                "--table-columns": columnTemplate(widths, UEFI_COLUMNS),
              } as React.CSSProperties
            }
          >
            <div className="uefi-tree-head" style={{ minWidth }} aria-hidden="true">
              <span>
                Name
                <ColumnResizer
                  columns={UEFI_COLUMNS}
                  index={0}
                  widths={widths}
                  onChange={resize}
                  onReset={resetWidths}
                />
              </span>
              <span>
                Type
                <ColumnResizer
                  columns={UEFI_COLUMNS}
                  index={1}
                  widths={widths}
                  onChange={resize}
                  onReset={resetWidths}
                />
              </span>
              <span>Subtype</span>
            </div>
            <div
              className="uefi-tree-spacer"
              style={{ height: rows.length * ROW_HEIGHT, minWidth }}
            >
              {rows.slice(first, last).map((row, offset) => (
                <TreeRow
                  key={row.key}
                  row={row}
                  index={first + offset}
                  named={
                    row.node === undefined
                      ? ""
                      : nodeName(
                          {
                            kind: row.node.kind,
                            subtype: row.node.subtype,
                            name: row.node.name,
                            guid:
                              row.node.guid === undefined ? undefined : guidFromText(row.node.guid),
                          },
                          catalogue.catalogue
                        )
                  }
                  marks={row.me?.marks ?? (row.node === undefined ? undefined : marksOf(row.node))}
                  showsMarkings={showsMarkings}
                  showsEmptyPadding={showsEmptyPadding}
                  isOpen={open.has(row.key)}
                  isSelected={(selected ?? meFocus) === row.key}
                  onToggle={toggle}
                  onChoose={choose}
                  onToggleMe={toggleMe}
                  onChooseMe={chooseMe}
                  onMenu={(event, node) => {
                    choose(node);
                    // What this row has decompressed, if anything: a compressed
                    // section's whole buffer, or one node's bytes inside one.
                    const taken = decompressedExport(node);
                    // Fix Checksum is offered only on a node whose checksum is
                    // wrong — a clean row gets no menu at all. Never inside a
                    // compressed section: the fix would be a write into a
                    // buffer that is not the file.
                    openContextMenu(event, [
                      marksOf(node).problem === undefined || node.space.length !== 0
                        ? undefined
                        : {
                            label: "Fix Checksum",
                            onSelect: () => {
                              void fixFirmwareChecksum(
                                context.pane,
                                node.id,
                                volumeRevisionFor(node.id)
                              ).then((count) => {
                                if (count === 0) context.report("There was nothing to put back.");
                              });
                            },
                          },
                      taken === undefined
                        ? undefined
                        : {
                            label: taken.menuTitle,
                            onSelect: () => void exportDecompressed(taken),
                          },
                      taken === undefined
                        ? undefined
                        : {
                            label: taken.openTitle,
                            onSelect: () => void openDecompressed(node, taken),
                          },
                      // And the node itself, wherever it lives — with its body
                      // on its own where it has a header to leave behind.
                      nodeOpenTitle(node, false) === undefined
                        ? undefined
                        : {
                            label: nodeOpenTitle(node, false) ?? "",
                            onSelect: () => void openNode(node, false),
                          },
                      nodeOpenTitle(node, true) === undefined
                        ? undefined
                        : {
                            label: nodeOpenTitle(node, true) ?? "",
                            onSelect: () => void openNode(node, true),
                          },
                    ]);
                  }}
                />
              ))}
            </div>
          </div>

          <ToolRowMarksLegend
            panel={UEFI_PANEL}
            marks={UEFI_TREE_MARKS.legendMarks}
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
          subject={meFocus ?? (shown === undefined ? undefined : pathKey(shown.node))}
          detail={meShown !== undefined ? meDetail(meShown) : (shown?.detail ?? EMPTY_DETAIL)}
          placeholder="Select a node to see what it is."
        />
      </div>

      <footer className="tool-notice">
        {finding ? (
          <>
            <span>Opening the branches to the caret…</span>
            <progress />
          </>
        ) : catalogue.status === "loading" ? (
          <>
            <span>Downloading GUID names…</span>
            <button type="button" className="toolbar-button is-quiet" onClick={cancelGuidCatalogue}>
              Cancel
            </button>
          </>
        ) : null}
        {/*
          A catalogue that did not arrive says nothing here, which is upstream's
          own decision: the names the build ships are still there, so the tree is
          not wrong, only older — `refreshGuids` calls that "not a problem worth
          saying in red", and its `catch` says nothing at all. The typed failure
          is in the store (`catalogueMessage`) for whatever says it next.
        */}
      </footer>
    </div>
  );
}

/**
 * One row of the tree: its name, the type and subtype beside it, and whatever
 * `Design/ROW_MARKS.md` says it wears — the paint behind it and the icons ahead
 * of its name.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFITreeMarks.swift#UEFITreeMarks
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFITreeMarks.swift#UEFITreeMarks.marks
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolViewController.swift#UEFIToolViewController.outlineView
 * @upstream-differs the paint is attributes on the row and the icons are
 * elements inside it, where upstream draws the first in a row view and dresses
 * the second into the cell view
 */
function TreeRow({
  row,
  index,
  named,
  marks,
  showsMarkings,
  showsEmptyPadding,
  isOpen,
  isSelected,
  onToggle,
  onChoose,
  onToggleMe,
  onChooseMe,
  onMenu,
}: {
  readonly row: Row;
  readonly index: number;
  readonly named: string;
  readonly marks: ToolRowMarks | undefined;
  readonly showsMarkings: boolean;
  readonly showsEmptyPadding: boolean;
  readonly isOpen: boolean;
  readonly isSelected: boolean;
  readonly onToggle: (node: WireNode) => void;
  readonly onChoose: (node: WireNode) => void;
  readonly onToggleMe: (node: MEANode) => void;
  readonly onChooseMe: (node: MEANode) => void;
  readonly onMenu: (event: React.MouseEvent, node: WireNode) => void;
}) {
  const node = row.node;
  const style = { top: index * ROW_HEIGHT };
  const alternate = index % 2 === 1 ? "" : undefined;
  const indent = { paddingLeft: `${row.depth * INDENT + 2}px` };

  // A row of the ME sub-tree: its name in the Name column and nothing in the
  // two beside it. The ME tree is a semantic tree, not a structural one, and
  // has no UEFI type or subtype to show; what it would put there — the hex
  // `offset · size` — is in the detail's heading instead (`meDetailTitle`).
  //
  // @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolViewController.swift#UEFIToolViewController.text
  if (row.me !== undefined) {
    const me = row.me;
    const hasMeChildren = me.children.length > 0;
    return (
      // biome-ignore lint/a11y/useKeyWithClickEvents: the tree handles the keys
      <div
        className="uefi-row tool-marked-row"
        role="treeitem"
        tabIndex={-1}
        aria-level={row.depth + 1}
        aria-selected={isSelected}
        {...(hasMeChildren ? { "aria-expanded": isOpen } : {})}
        data-selected={isSelected ? "" : undefined}
        data-alt={alternate}
        // A section that holds nothing reads grey — the whole row, name
        // included: it is a place in the layout rather than something to go and
        // look at, and the ME Analyzer draws it the same way.
        data-empty={me.isEmptySection ? "" : undefined}
        title={rowMarkTitle(marks)}
        {...rowPaintAttrs(marks, showsMarkings)}
        style={style}
        onClick={() => onChooseMe(me)}
      >
        <span className="uefi-name" style={indent}>
          <button
            type="button"
            className="uefi-twist"
            tabIndex={-1}
            disabled={!hasMeChildren}
            aria-label={isOpen ? "Collapse" : "Expand"}
            onClick={(event) => {
              event.stopPropagation();
              onToggleMe(me);
            }}
          >
            {hasMeChildren ? <DisclosureChevron open={isOpen} /> : null}
          </button>
          <RowMarksIcons marks={marks} />
          <span className="uefi-name-text" title={me.subtitle.length > 0 ? me.subtitle : me.title}>
            {me.title}
          </span>
        </span>
        <span className="uefi-type" />
        <span className="uefi-subtype" />
      </div>
    );
  }

  if (node === undefined) {
    return (
      <div
        className="uefi-row"
        role="treeitem"
        tabIndex={-1}
        aria-level={row.depth + 1}
        data-alt={alternate}
        style={style}
      >
        <span className="uefi-name" style={indent}>
          <span className="uefi-twist" />
          <span className="uefi-loading">Loading…</span>
        </span>
      </div>
    );
  }

  // A branch read to nothing but empty padding has nothing to open on while
  // that padding is hidden. The ME region offers the twist either way: it is
  // not expandable in the UEFI tree, and it opens the ME sub-tree.
  const hasChildren =
    listed(node.children, showsEmptyPadding).length > 0 || node.isExpandable || isMeRegion(node);
  return (
    // The tree takes the keyboard for every row at once (`onKeyDown` above), so
    // a row answers the pointer only.
    // biome-ignore lint/a11y/useKeyWithClickEvents: the tree handles the keys
    <div
      className="uefi-row tool-marked-row"
      role="treeitem"
      // Focusable, as a treeitem must be; -1 keeps the tab stop on the tree
      // rather than putting one on every one of a few thousand rows.
      tabIndex={-1}
      aria-level={row.depth + 1}
      aria-selected={isSelected}
      {...(hasChildren ? { "aria-expanded": isOpen } : {})}
      data-selected={isSelected ? "" : undefined}
      data-alt={alternate}
      // The row's background and rail in words, so nothing it says is said by
      // colour alone (`Design/ROW_MARKS.md` §2).
      title={rowMarkTitle(marks)}
      {...rowPaintAttrs(marks, showsMarkings)}
      style={style}
      onClick={() => onChoose(node)}
      onContextMenu={(event) => onMenu(event, node)}
    >
      <span className="uefi-name" style={indent}>
        <button
          type="button"
          className="uefi-twist"
          tabIndex={-1}
          disabled={!hasChildren}
          aria-label={isOpen ? "Collapse" : "Expand"}
          onClick={(event) => {
            event.stopPropagation();
            onToggle(node);
          }}
        >
          {hasChildren ? <DisclosureChevron open={isOpen} /> : null}
        </button>
        <RowMarksIcons marks={marks} />
        <span className="uefi-name-text" title={node.guid ?? named}>
          {named}
        </span>
      </span>
      <span className="uefi-type" title={node.typeText}>
        {node.typeText}
      </span>
      <span className="uefi-subtype" title={node.subtypeText}>
        {node.subtypeText}
      </span>
    </div>
  );
}

/**
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolModule.swift#UEFIToolModule
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolModule.swift#UEFIToolModule.identifier
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolModule.swift#UEFIToolModule.title
 */
export const uefiStructureTool: ToolModule = {
  id: "dev.maxik.tool.uefi-structure",
  title: "UEFI Structure",
  summary: "The image as a tree: regions, volumes, files and sections.",
  View: UefiStructureView,
};
