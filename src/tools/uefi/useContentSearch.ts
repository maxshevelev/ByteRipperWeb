import { useCallback, useEffect, useRef, useState } from "react";
import { L } from "@/core/localization/localization";
import {
  firmwareFor,
  firmwareNodeAt,
  searchFirmwareContents,
  stopFirmwareContentSearch,
} from "@/state/firmwareStore";
import type { PaneId } from "@/state/paneId";
import type { ToolPatternQuery } from "@/tools/toolModule";
import type { ContentResultRow, ContentResultsState } from "@/tools/uefi/UefiContentResults";
import { compressionName } from "@/tools/uefi/uefiPresenter";
import type { WireContentMatch, WireNode } from "@/workers/protocol";

/**
 * Names that say what a node is rather than which one: a parent called so is not worth naming
 * before its child.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentQueries.swift#UEFIAgentQueries.placeholderNames
 */
const PLACEHOLDER_NAMES: ReadonlySet<string> = new Set([
  "unused",
  "unknown",
  "padding",
  "empty padding",
  "free space",
  "non-uefi data",
  "raw",
]);

const hex = (value: number) => `0x${value.toString(16).toUpperCase()}`;

/**
 * The node after its parent — `VSS store: SetupMode` — as the Contents search results name the
 * place: unless the parent is called only by a word for the bytes it covers.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFITreeDisplay.swift#UEFITreeDisplay.nameAfterParent
 */
export function nameAfterParent(
  path: readonly number[],
  roots: readonly WireNode[],
  nameOf: (node: WireNode, roots: readonly WireNode[]) => string
): string | undefined {
  const node = firmwareNodeAt(roots, path);
  if (node === undefined) return undefined;
  const own = nameOf(node, roots);
  if (path.length < 2) return own;
  const parent = firmwareNodeAt(roots, path.slice(0, -1));
  if (parent === undefined) return own;
  const above = nameOf(parent, roots);
  if (PLACEHOLDER_NAMES.has(above.toLowerCase())) return own;
  return L("%1$@: %2$@", above, own);
}

/**
 * A wire node's bytes in the file: its own, or for one in decompressed bytes the compressed
 * section's they came out of.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIContentSearch.swift#UEFIContentSearch.fileRange
 */
export function fileRangeOfPath(
  path: readonly number[],
  roots: readonly WireNode[]
): readonly [number, number] | undefined {
  for (let length = path.length; length >= 1; length--) {
    const node = firmwareNodeAt(roots, path.slice(0, length));
    if (node !== undefined && node.space.length === 0) return [node.header[0], node.tail[1]];
  }
  return undefined;
}

/**
 * A match as a row of the list: the node after its parent, the codecs, the address, the path,
 * and what opening it opens.
 *
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolViewController.swift#UEFIToolViewController.showContentMatches
 */
export function contentRow(
  match: WireContentMatch,
  roots: readonly WireNode[],
  nameOf: (node: WireNode, roots: readonly WireNode[]) => string
): ContentResultRow {
  const named = (path: readonly number[] | undefined) => {
    const node = path === undefined ? undefined : firmwareNodeAt(roots, path);
    return node === undefined ? undefined : nameOf(node, roots);
  };
  // The codecs a space's bytes came through, outermost first.
  // @upstream Modules/UEFITool/Sources/UEFITool/UEFIPresenter.swift#UEFIPresenter.codecNames
  const codecs: string[] = [];
  for (let length = 1; length <= match.space.length; length++) {
    codecs.push(
      compressionName(match.space.slice(0, length), roots) ??
        L("Decompressed", { context: "part badge" })
    );
  }
  if (match.decodedXORKey !== undefined) {
    codecs.push(`XOR ${match.decodedXORKey.toString(16).toUpperCase().padStart(2, "0")}`);
  }
  const inFile = match.space.length === 0;
  const address = inFile
    ? match.decodedXORKey === undefined
      ? hex(match.range[0])
      : L("%1$@, decoded", hex(match.range[0]))
    : L("%1$@ in %2$@", hex(match.range[0]), named(match.section) ?? "—");
  const path =
    match.node === undefined
      ? ""
      : match.node
          .map((_, index) => named((match.node as readonly number[]).slice(0, index + 1)) ?? "")
          .join(" ▸ ");
  const section = match.section === undefined ? undefined : firmwareNodeAt(roots, match.section);
  return {
    node: match.node === undefined ? "—" : (nameAfterParent(match.node, roots, nameOf) ?? "—"),
    codecs,
    address,
    path,
    openTitle:
      match.decodedXORKey !== undefined
        ? L("Open Decoded Block")
        : inFile
          ? undefined
          : section?.kind === "biosGuardUpdate"
            ? L("Open Assembled BIOS Region")
            : L("Open Decompressed Body"),
    excerpt: match.excerpt,
    excerptMatch: match.excerptMatch,
  };
}

/** What the panel gives the Contents search to work with. */
export interface ContentSearchHost {
  readonly pane: PaneId;
  readonly text: string;
  readonly wholeTree: boolean;
  /** The path of the node selected in the tree, if any: where a search from it starts. */
  readonly selected: readonly number[] | undefined;
  readonly nameOf: (node: WireNode, roots: readonly WireNode[]) => string;
  /** The Find bar's controls the pattern is asked with, and told what was found. */
  readonly query: ToolPatternQuery;
  /** What is wrong with the field, or nothing: said where the bar reports how a search went. */
  readonly onProblem: (problem: string | undefined) => void;
  /** Goes to `match`: its node in the tree, its bytes in the dump. */
  readonly goTo: (match: WireContentMatch, roots: readonly WireNode[]) => void;
  /** Opens the bytes a match behind a codec is in, the match selected. */
  readonly open: (match: WireContentMatch, roots: readonly WireNode[]) => void;
}

/**
 * The Contents search of the panel: Find All, the list, and going to and opening a match.
 *
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolViewController.swift#UEFIToolViewController.findAllContents
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolViewController.swift#UEFIToolViewController.goToContentMatch
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolViewController.swift#UEFIToolViewController.openContentMatch
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolViewController.swift#UEFIToolViewController.closeContentResults
 * @upstream-differs a hook over the panel's state, where upstream's is a part of the view controller
 */
export function useContentSearch(host: ContentSearchHost) {
  const hostRef = useRef(host);
  hostRef.current = host;
  const [state, setState] = useState<ContentResultsState>({ kind: "idle" });
  const [shown, setShown] = useState(false);
  const [rows, setRows] = useState<readonly ContentResultRow[]>([]);
  const [selected, setSelected] = useState<number | undefined>(undefined);
  const matches = useRef<{ list: readonly WireContentMatch[]; roots: readonly WireNode[] }>({
    list: [],
    roots: [],
  });
  const running = useRef<(() => void) | undefined>(undefined);

  const stop = useCallback(() => {
    running.current?.();
    running.current = undefined;
    setState((current) => (current.kind === "searching" ? { kind: "idle" } : current));
  }, []);

  /** @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolViewController.swift#UEFIToolViewController.findAllContents */
  const findAll = useCallback(async () => {
    const { pane, text, wholeTree, selected: from, nameOf, query, onProblem } = hostRef.current;
    const asked0 = query.attempts(text);
    if ("problem" in asked0) {
      onProblem(asked0.problem);
      return;
    }
    onProblem(undefined);
    const attempts = asked0.attempts;
    stop();
    const start = wholeTree ? [] : (from ?? []);
    matches.current = { list: [], roots: [] };
    setRows([]);
    setSelected(undefined);
    setShown(true);
    setState({ kind: "searching", fraction: 0 });
    const asked = searchFirmwareContents(
      pane,
      attempts.map((one) => one.pattern),
      start,
      (fraction) => setState({ kind: "searching", fraction })
    );
    running.current = asked.stop;
    const answer = await asked.answer;
    if (running.current !== asked.stop) return;
    running.current = undefined;
    if (answer?.result === undefined) {
      setState({ kind: "idle" });
      return;
    }
    const settled = attempts[answer.result.attempt];
    if (answer.result.total > 0 && settled !== undefined) query.found(text, settled.encoding);
    const roots = firmwareFor(pane)?.roots ?? answer.roots;
    matches.current = { list: answer.result.matches, roots };
    setRows(answer.result.matches.map((match) => contentRow(match, roots, nameOf)));
    const scopeNode = start.length === 0 ? undefined : firmwareNodeAt(roots, start);
    setState({
      kind: "done",
      total: answer.result.total,
      scope: scopeNode === undefined ? undefined : nameOf(scopeNode, roots),
    });
  }, [stop]);

  const choose = useCallback((index: number) => {
    const match = matches.current.list[index];
    if (match === undefined) return;
    setSelected(index);
    hostRef.current.goTo(match, matches.current.roots);
  }, []);

  const open = useCallback((index: number) => {
    const match = matches.current.list[index];
    if (match === undefined) return;
    // A match in the file's own bytes is in the dump, where a click has selected it.
    if (match.space.length === 0 && match.decodedXORKey === undefined) return;
    hostRef.current.open(match, matches.current.roots);
  }, []);

  /** The reader shut the results panel: the search, if one runs, ends. */
  const close = useCallback(() => {
    stop();
    matches.current = { list: [], roots: [] };
    setRows([]);
    setSelected(undefined);
    setState({ kind: "idle" });
    setShown(false);
  }, [stop]);

  // A search does not outlive the panel.
  useEffect(() => () => stopFirmwareContentSearch(host.pane), [host.pane]);

  return { state, shown, rows, selected, findAll, choose, open, stop, close };
}
