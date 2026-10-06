import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { itemTypeOfKind } from "@/firmware/uefi/itemClassification";
import {
  expandFirmwareNodeAndWait,
  firmwareFor,
  firmwareNodeAt,
  pathKey,
} from "@/state/firmwareStore";
import { showWrapNotice } from "@/state/noticeStore";
import type { PaneId } from "@/state/paneId";
import { isMeRegion } from "@/tools/uefi/meSubtree";
import type { SearchStatus } from "@/tools/uefi/UefiSearchBar";
import { listed, present } from "@/tools/uefi/uefiTreeDisplay";
import {
  matchesQuery,
  queryIsEmpty,
  type SearchDirection,
  UEFISearchOpenings,
  type UEFITreeQuery,
  UEFITreeSearch,
  type UEFITreeSearchSource,
} from "@/tools/uefi/uefiTreeSearch";
import type { WireNode } from "@/workers/protocol";

/** How long a search may hold the main thread before it lets go for a moment. */
const SEARCH_SLICE_MS = 8;
/** How long a search runs before its bar shows a progress bar. */
const SEARCH_STATUS_DELAY_MS = 200;

const pathOf = (key: string): number[] => (key.length === 0 ? [] : key.split(".").map(Number));

/**
 * What the panel gives the search to work with.
 */
export interface TreeSearchHost {
  readonly pane: PaneId;
  readonly query: UEFITreeQuery;
  readonly showsEmptyPadding: boolean;
  readonly showsSuperseded: boolean;
  /** The name the row shows for a node (it needs the GUID catalogue). */
  readonly nameOf: (node: WireNode, roots: readonly WireNode[]) => string;
  /** The row selected, if the tree's: the walk starts from it. */
  readonly selected: string | undefined;
  /** The ME region's row, when an ME row is in focus. */
  readonly meRegionKey: string | undefined;
  readonly setOpen: Dispatch<SetStateAction<ReadonlySet<string>>>;
  readonly isOpen: (key: string) => boolean;
  /** Selects a match as a click on it would, and brings it into view. */
  readonly landOn: (node: WireNode, roots: readonly WireNode[]) => void;
}

/**
 * The search over the tree: the walk, the reading of branches it asks for, what it opened
 * and owes a closing.
 *
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolViewController.swift#UEFIToolViewController.search
 * @upstream-differs a hook over the panel's state, where upstream's walk is a part of the view
 * controller that drives the outline
 */
export function useTreeSearch(host: TreeSearchHost) {
  const [status, setStatus] = useState<SearchStatus>("none");
  const hostRef = useRef(host);
  hostRef.current = host;
  /** Which search is the current one: a new ask, a changed query or a new tree moves it on. */
  const run = useRef(0);
  /** What the search has opened in the tree and owes a closing. */
  const openings = useRef(new UEFISearchOpenings());
  /** The match the search last stood on: where it goes on from, until the reader selects another row. */
  const cursor = useRef<string | undefined>(undefined);
  const searching = useRef(false);

  /** Ends the search in hand, if there is one. */
  const cancel = useCallback(() => {
    run.current += 1;
    setStatus((current) => (current === "searching" ? "none" : current));
  }, []);

  /** The query moved, in this panel or the other: a search for the old one is over. */
  const shown = useRef(host.query);
  useEffect(() => {
    if (shown.current === host.query) return;
    const same =
      shown.current.text === host.query.text &&
      shown.current.type === host.query.type &&
      shown.current.subtype === host.query.subtype;
    shown.current = host.query;
    if (same) return;
    cancel();
    setStatus("none");
    openings.current.release();
  }, [host.query, cancel]);

  const source = useCallback((): { source: UEFITreeSearchSource; roots: readonly WireNode[] } => {
    const h = hostRef.current;
    const roots = firmwareFor(h.pane)?.roots ?? [];
    const top = present(roots).rows;
    const nodeOf = (key: string) => firmwareNodeAt(roots, pathOf(key));
    return {
      roots,
      source: {
        topRows: () => listed(top, h.showsEmptyPadding).map((node) => pathKey(node.id)),
        listedChildren: (key) => {
          const node = nodeOf(key);
          if (node === undefined) return [];
          // The ME region's sub-tree is another structure, which a name, a GUID and a type
          // do not describe.
          if (isMeRegion(node)) return [];
          if (node.children.length > 0) {
            const hiding =
              h.showsSuperseded || node.hiddenCopies === undefined
                ? undefined
                : new Set(
                    node.hiddenCopies.flatMap(([hidden]) => {
                      const child = node.children[hidden];
                      return child === undefined ? [] : [pathKey(child.id)];
                    })
                  );
            return listed(node.children, h.showsEmptyPadding, hiding).map((child) =>
              pathKey(child.id)
            );
          }
          return node.isExpandable ? undefined : [];
        },
      },
    };
  }, []);

  const matches = useCallback((node: WireNode, roots: readonly WireNode[]): boolean => {
    const h = hostRef.current;
    const type = itemTypeOfKind(node.kind);
    if (type === undefined) return false;
    return matchesQuery(
      h.query,
      {
        itemType: type,
        itemSubtype: node.subtype,
        name: node.name,
        guid: node.guid,
      },
      h.nameOf(node, roots)
    );
  }, []);

  /**
   * The search found `key`: open the way to the match and one level under it, select it as
   * a click on it would, and only then shut what the search opened for the last match and
   * this one does not need.
   *
   * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolViewController.swift#UEFIToolViewController.land
   */
  const land = useCallback(
    async (key: string, token: number, wrapped: boolean, direction: SearchDirection) => {
      const h = hostRef.current;
      cursor.current = key;
      setStatus("none");
      const path = pathOf(key);
      const way = path.map((_, index) => path.slice(0, index + 1));
      const match = firmwareNodeAt(firmwareFor(h.pane)?.roots ?? [], path);
      // The ME region opens by running an analysis, which is not a search's to start.
      if (match !== undefined && isMeRegion(match)) way.pop();
      const opened: string[] = [];
      for (const step of way) {
        if (token !== run.current) return;
        await expandFirmwareNodeAndWait(h.pane, step);
        const node = firmwareNodeAt(firmwareFor(h.pane)?.roots ?? [], step);
        const stepKey = pathKey(step);
        if (node === undefined || node.children.length === 0 || hostRef.current.isOpen(stepKey))
          continue;
        openings.current.record(stepKey);
        opened.push(stepKey);
      }
      if (token !== run.current) return;
      if (opened.length > 0) {
        h.setOpen((current) => new Set([...current, ...opened]));
      }
      const roots = firmwareFor(h.pane)?.roots ?? [];
      const found = firmwareNodeAt(roots, path);
      if (found === undefined) return;
      h.landOn(found, roots);
      const closings = openings.current.closings(key);
      if (closings.length > 0) {
        for (const closing of closings) openings.current.forget(closing);
        h.setOpen((current) => new Set([...current].filter((one) => !closings.includes(one))));
      }
      // The sign the dump's find shows when it has come round to the other end.
      if (wrapped) showWrapNotice(direction);
    },
    []
  );

  /**
   * Walks on until a row matches, a branch has to be read, or every row has been seen.
   *
   * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolViewController.swift#UEFIToolViewController.drive
   */
  const search = useCallback(
    async (direction: SearchDirection) => {
      const h = hostRef.current;
      if (queryIsEmpty(h.query) || firmwareFor(h.pane)?.status !== "ready") return;
      cancel();
      setStatus("none");
      run.current += 1;
      const token = run.current;
      searching.current = true;
      const origin =
        cursor.current !== undefined &&
        firmwareNodeAt(firmwareFor(h.pane)?.roots ?? [], pathOf(cursor.current)) !== undefined
          ? cursor.current
          : (h.selected ?? h.meRegionKey);
      const walk = new UEFITreeSearch(origin, direction);
      const timer = window.setTimeout(() => {
        if (token === run.current) setStatus("searching");
      }, SEARCH_STATUS_DELAY_MS);
      let began = performance.now();
      try {
        for (;;) {
          if (token !== run.current) return;
          const { source: tree, roots } = source();
          const next = walk.advance(tree);
          if (next.kind === "exhausted") {
            run.current += 1;
            setStatus("notFound");
            return;
          }
          if (next.kind === "expand") {
            await expandFirmwareNodeAndWait(h.pane, pathOf(next.key));
            began = performance.now();
            continue;
          }
          const node = firmwareNodeAt(roots, pathOf(next.key));
          if (node !== undefined && matches(node, roots)) {
            await land(next.key, token, walk.wrapped, direction);
            return;
          }
          if (performance.now() - began > SEARCH_SLICE_MS) {
            await new Promise((resolve) => window.setTimeout(resolve, 0));
            began = performance.now();
          }
        }
      } finally {
        window.clearTimeout(timer);
        searching.current = false;
      }
    },
    [cancel, source, matches, land]
  );

  return {
    status,
    search,
    /** The reader stopped a search that was reading branches. */
    stop: cancel,
    /** A row the reader opened or shut is theirs from now on. */
    forget: useCallback((key: string) => openings.current.forget(key), []),
    /** The reader went somewhere else: what the search opened stays as it is, and the next search starts from the row chosen. */
    readerChose: useCallback(() => {
      openings.current.release();
      cursor.current = undefined;
    }, []),
    /** The bar was closed or the file replaced. */
    reset: useCallback(
      (forFile: boolean) => {
        cancel();
        setStatus("none");
        openings.current.release();
        if (forFile) cursor.current = undefined;
      },
      [cancel]
    ),
  };
}
