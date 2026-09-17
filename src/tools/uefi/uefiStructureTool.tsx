import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { guidFromText } from "@/firmware/uefi/efiGuid";
import {
  askFirmwareDetail,
  expandFirmwareNode,
  findFirmwareNodeAt,
  firmwareNodeAt,
  firmwareStore,
  fixFirmwareChecksum,
  parsePaneFirmware,
  pathKey,
} from "@/state/firmwareStore";
import { cancelGuidCatalogue, catalogueStore, loadGuidCatalogue } from "@/state/guidCatalogue";
import type { ToolSessionState } from "@/state/parkedToolState";
import { useStore } from "@/state/useStore";
import { workspaceStore } from "@/state/workspaceStore";
import { clearZones, publishZones } from "@/state/zoneStore";
import { EMPTY_DETAIL } from "@/tools/toolDetail";
import type { ToolContext, ToolModule } from "@/tools/toolModule";
import { useParkedToolState } from "@/tools/toolParkedState";
import type { ToolRowMarks } from "@/tools/toolRowMarks";
import { useZoneSelection } from "@/tools/toolZoneSelection";
import { nodeIDOfZone, uefiZones } from "@/tools/uefi/uefiPresenter";
import { listed, nodeName, present, summary } from "@/tools/uefi/uefiTreeDisplay";
import { UEFI_TREE_MARKS, uefiTreeMarks } from "@/tools/uefi/uefiTreeMarks";
import { openContextMenu } from "@/ui/shell/ContextMenu";
import { PaneDivider } from "@/ui/shell/PaneDivider";
import { ScopeShapes } from "@/ui/shell/scopeGlyph";
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
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolViewController.swift#UEFITreeRow
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolViewController.swift#UEFITreeRow.id
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolViewController.swift#UEFITreeRow.isLoading
 */
interface Row {
  readonly node: WireNode | undefined;
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
 * at this panel's 13 pixels. Type and Subtype hold one short word on almost every
 * row; Name is the column with something to say and takes the rest. The two
 * narrow ones are mirrored in `.uefi-row`'s grid.
 */
const NAME_WIDTH = 300;
const TYPE_WIDTH = 76;
const SUBTYPE_WIDTH = 88;
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
  if (!(held.open instanceof Set)) return undefined;
  return { focus: held.focus, open: held.open };
}

/** @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolViewController.swift#UEFIToolViewController.show */
function rowsOf(
  nodes: readonly WireNode[],
  open: ReadonlySet<string>,
  loading: ReadonlySet<string>,
  showsEmptyPadding: boolean,
  depth: number,
  rows: Row[] = []
): Row[] {
  for (const node of listed(nodes, showsEmptyPadding)) {
    const key = pathKey(node.id);
    rows.push({ node, depth, key });
    if (!open.has(key)) continue;
    if (node.children.length > 0)
      rowsOf(node.children, open, loading, showsEmptyPadding, depth + 1, rows);
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
  const [scrollTarget, setScrollTarget] = useState<string | undefined>(undefined);
  const [finding, setFinding] = useState(false);
  const [treeShare, setTreeShare] = useState(storedTreeShare);
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
  useParkedToolState(context.pane, () => ({ focus: selected, open }));

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

  const presented = useMemo(() => present(roots ?? []), [roots]);
  const rows = useMemo(
    () => rowsOf(presented.rows, open, loading, showsEmptyPadding, 0),
    [presented, open, loading, showsEmptyPadding]
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
      if (node.children.length > 0 || !node.isExpandable) {
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
    [open, context.pane]
  );

  /**
   * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolViewController.swift#UEFIToolViewController.onSelect
   * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolViewController.swift#UEFIToolViewController.outlineViewSelectionDidChange
   */
  const choose = useCallback(
    (node: WireNode) => {
      const key = pathKey(node.id);
      setSelected(key);
      askFirmwareDetail(context.pane, node.id);
      // The node and its body, the body in focus — upstream's two zones, drawn
      // over the dump and in the minimap's gutter. Never the children: a store's
      // two hundred variables outlined at once is a dump nobody can read.
      publishZones(context.pane, uefiZones(node));
      // The whole node, header through tail — what clicking a row means.
      context.reveal(node.header[0], Math.max(node.body[1], node.tail[1]));
    },
    [context]
  );

  /**
   * The node under the caret, shown in the tree: every branch on the way
   * opened, its row selected, its detail up. Only the tree moves — the dump is
   * where the reader is standing, so nothing is published that would scroll it
   * away from the caret that asked.
   *
   * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolModule.swift#UEFIToolSession.revealNodeAtCaret
   * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolViewController.swift#UEFIToolViewController.onRevealAtCaret
   */
  const revealAtCaret = useCallback(async () => {
    const slot = workspaceStore.getSnapshot().panes[context.pane];
    if (slot === undefined) return;
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
    askFirmwareDetail(context.pane, path);
    setScrollTarget(key);
  }, [context.pane]);

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
   * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolModule.swift#UEFIToolSession.zoneSelected
   */
  const zonePicked = useCallback(
    (zoneId: string) => {
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
      askFirmwareDetail(context.pane, path);
      setScrollTarget(key);
      publishZones(context.pane, uefiZones(firmwareNodeAt(roots ?? [], path)));
    },
    [context.pane, roots]
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
   * @upstream-differs the protected ranges and the decompressed buffers are not
   * read here yet (G3, G1), so no row wears a tint or a rail
   */
  const marksOf = useCallback(
    (node: WireNode): ToolRowMarks =>
      uefiTreeMarks({ node, diagnostics: state?.diagnostics ?? [] }),
    [state?.diagnostics]
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
      const index = rows.findIndex((row) => row.key === selected);
      const moveTo = (from: number, step: 1 | -1) => {
        for (let at = from; at >= 0 && at < rows.length; at += step) {
          const row = rows[at];
          if (row?.node === undefined) continue;
          choose(row.node);
          setScrollTarget(row.key);
          return;
        }
      };
      const current = rows[index]?.node;
      switch (event.key) {
        case "ArrowDown":
          moveTo(index + 1, 1);
          break;
        case "ArrowUp":
          moveTo(index < 0 ? rows.length - 1 : index - 1, -1);
          break;
        case "ArrowRight":
          if (current === undefined) return;
          if (
            !open.has(pathKey(current.id)) &&
            (listed(current.children, showsEmptyPadding).length > 0 || current.isExpandable)
          ) {
            toggle(current);
          } else {
            moveTo(index + 1, 1);
          }
          break;
        case "ArrowLeft": {
          if (current === undefined) return;
          if (open.has(pathKey(current.id))) {
            toggle(current);
            break;
          }
          const parent = rows.find((row) => row.key === pathKey(current.id.slice(0, -1)));
          if (parent?.node !== undefined) {
            choose(parent.node);
            setScrollTarget(parent.key);
          }
          break;
        }
        default:
          return;
      }
      event.preventDefault();
    },
    [rows, selected, open, choose, toggle, showsEmptyPadding]
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
  const minWidth = NAME_WIDTH + maxDepth * INDENT + TYPE_WIDTH + SUBTYPE_WIDTH;
  const title = presented.title;
  const titleKey = title === undefined ? undefined : pathKey(title.id);
  const shown = selected === undefined ? undefined : state.detail;

  return (
    <div className="uefi-tool">
      <div className="uefi-title-row">
        {title === undefined ? (
          <span className="uefi-title">{summary(state.roots)}</span>
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
            {summary(state.roots)}
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
          >
            <div className="uefi-tree-head" style={{ minWidth }} aria-hidden="true">
              <span>Name</span>
              <span>Type</span>
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
                  marks={row.node === undefined ? undefined : marksOf(row.node)}
                  showsMarkings={showsMarkings}
                  showsEmptyPadding={showsEmptyPadding}
                  isOpen={open.has(row.key)}
                  isSelected={selected === row.key}
                  onToggle={toggle}
                  onChoose={choose}
                  onMenu={(event, node) => {
                    choose(node);
                    // Upstream offers exactly one command here, and only on a node
                    // whose checksum is wrong — a clean row gets no menu at all.
                    openContextMenu(event, [
                      marksOf(node).problem === undefined
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
          subject={shown === undefined ? undefined : pathKey(shown.node)}
          detail={shown?.detail ?? EMPTY_DETAIL}
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
  readonly onMenu: (event: React.MouseEvent, node: WireNode) => void;
}) {
  const node = row.node;
  const style = { top: index * ROW_HEIGHT };
  const alternate = index % 2 === 1 ? "" : undefined;
  const indent = { paddingLeft: `${row.depth * INDENT + 2}px` };

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
  // that padding is hidden.
  const hasChildren = listed(node.children, showsEmptyPadding).length > 0 || node.isExpandable;
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
          {hasChildren ? (isOpen ? "▾" : "▸") : ""}
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
